// Crawler-ul principal MarketFixer: robots.txt, sitemap.xml, BFS pe același origin,
// verificare linkuri rupte (HEAD cu fallback GET) și protecție SSRF.
import {
  normalizeUrl,
  crawlKey,
  isHttpUrl,
  isSkippableResource,
  InvalidUrlError,
} from './url.js';
import {
  BlockedAddressError,
  isBlockedIp,
  assertHostnameAllowed,
  assertPublicUrl,
  safeLookup,
} from './ssrf.js';
import { fetchUrl, decodeBody, DEFAULT_TIMEOUT_MS } from './http.js';
import { parseRobots, createRobotsMatcher } from './robots.js';
import { discoverSitemaps } from './sitemap.js';
import { parseLinks } from './links.js';

export {
  normalizeUrl,
  crawlKey,
  isHttpUrl,
  isSkippableResource,
  InvalidUrlError,
  BlockedAddressError,
  isBlockedIp,
  assertHostnameAllowed,
  assertPublicUrl,
  safeLookup,
  parseRobots,
  createRobotsMatcher,
};

const MAX_PAGES_HARD_LIMIT = 50;
const DEFAULT_CONCURRENCY = 4;
const MAX_BROKEN_LINK_CHECKS = 50;

function isHtmlContentType(contentType) {
  if (!contentType) return true;
  const ct = contentType.toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml+xml');
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

/**
 * Scanează un site pornind de la `rootUrl`.
 * @param {string} rootUrl
 * @param {object} [options]
 * @param {number} [options.maxPages=20]
 * @param {boolean} [options.allowPrivate=false]
 * @param {number} [options.timeoutMs=10000]
 * @param {number} [options.concurrency=4]
 * @param {number} [options.maxBrokenLinkChecks=50]
 * @param {(progress: {phase: string, done: number, total: number}) => void} [options.onProgress]
 */
export async function crawlSite(
  rootUrl,
  {
    maxPages = 20,
    allowPrivate = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_CONCURRENCY,
    maxBrokenLinkChecks = MAX_BROKEN_LINK_CHECKS,
    onProgress,
  } = {},
) {
  const normalizedRoot = normalizeUrl(rootUrl);
  const rootParsed = new URL(normalizedRoot);
  if (!allowPrivate) {
    assertHostnameAllowed(rootParsed.hostname);
  }
  const origin = rootParsed.origin;
  const limit = Math.min(MAX_PAGES_HARD_LIMIT, Math.max(1, Number(maxPages) || 20));

  // 1. Preluare robots.txt
  let robotsTxt = null;
  try {
    const robotsRes = await fetchUrl(`${origin}/robots.txt`, {
      allowPrivate,
      timeoutMs: Math.min(timeoutMs, 5000),
      maxBytes: 512 * 1024,
      accept: 'text/plain,*/*;q=0.8',
    });
    if (robotsRes.status >= 200 && robotsRes.status < 300) {
      robotsTxt = decodeBody(robotsRes.body, robotsRes.headers['content-type']);
    }
  } catch (err) {
    if (err instanceof BlockedAddressError) throw err;
    robotsTxt = null;
  }

  const robots = createRobotsMatcher(robotsTxt, 'MarketFixerBot');

  // 2. Descoperire sitemap.xml
  let sitemapFound = false;
  let sitemapUrls = [];
  try {
    const sm = await discoverSitemaps(origin, robots.sitemaps, {
      allowPrivate,
      timeoutMs: Math.min(timeoutMs, 6000),
    });
    sitemapFound = sm.sitemapFound;
    sitemapUrls = sm.sitemapUrls;
  } catch {
    sitemapFound = false;
    sitemapUrls = [];
  }

  // 3. BFS pe același origin
  const pages = [];
  const queue = [];
  const seenKeys = new Set();
  const fetchedStatuses = new Map(); // normalizedUrl -> { status, error }
  const linkParent = new Map(); // normalizedUrl -> first pageUrl where it was found

  function enqueue(targetUrl, depth, foundOn = null) {
    let key;
    let normalized;
    try {
      normalized = normalizeUrl(targetUrl, origin);
      key = crawlKey(normalized);
    } catch {
      return;
    }
    const parsed = new URL(normalized);
    if (parsed.origin !== origin) return;
    if (depth > 0 && isSkippableResource(normalized)) return;
    if (!robots.isAllowed(normalized)) return;
    if (foundOn && !linkParent.has(normalized)) {
      linkParent.set(normalized, foundOn);
    }
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    queue.push({ url: normalized, depth });
  }

  enqueue(normalizedRoot, 0, null);

  let sitemapSeeded = false;
  const seedFromSitemap = () => {
    if (sitemapSeeded) return;
    sitemapSeeded = true;
    for (const smUrl of sitemapUrls) {
      if (seenKeys.size >= limit * 2) break;
      enqueue(smUrl, 1, null);
    }
  };

  let activeWorkers = 0;

  const reportProgress = () => {
    if (typeof onProgress !== 'function') return;
    const totalEstimate = Math.min(limit, Math.max(pages.length + queue.length + activeWorkers, 1));
    onProgress({
      phase: 'crawling',
      done: pages.length,
      total: Math.max(pages.length, totalEstimate),
    });
  };

  reportProgress();

  await new Promise((resolve, reject) => {
    let aborted = false;

    const pump = () => {
      if (aborted) return;
      if (queue.length === 0 && activeWorkers === 0 && pages.length < limit && !sitemapSeeded) {
        seedFromSitemap();
      }
      while (activeWorkers < concurrency && queue.length > 0 && pages.length + activeWorkers < limit) {
        const item = queue.shift();
        activeWorkers++;
        processItem(item)
          .catch((err) => {
            if (err instanceof BlockedAddressError && pages.length === 0) {
              aborted = true;
              reject(err);
            }
          })
          .finally(() => {
            activeWorkers--;
            if (aborted) return;
            if (pages.length >= limit || (queue.length === 0 && activeWorkers === 0)) {
              if (queue.length === 0 && activeWorkers === 0 && pages.length < limit && !sitemapSeeded) {
                seedFromSitemap();
                if (queue.length > 0) {
                  pump();
                  return;
                }
              }
              if (activeWorkers === 0) resolve();
            } else {
              pump();
            }
          });
      }
      if (activeWorkers === 0 && (queue.length === 0 || pages.length >= limit)) {
        resolve();
      }
    };

    async function processItem({ url, depth }) {
      let res;
      try {
        res = await fetchUrl(url, {
          allowPrivate,
          timeoutMs,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        });
      } catch (err) {
        fetchedStatuses.set(url, { status: null, error: err.message });
        if (depth === 0) throw err;
        return;
      }

      fetchedStatuses.set(url, { status: res.status });
      fetchedStatuses.set(res.url, { status: res.status });

      try {
        seenKeys.add(crawlKey(res.url));
      } catch {
        /* ignore */
      }

      const finalOrigin = new URL(res.url).origin;
      if (finalOrigin !== origin && depth > 0) {
        return;
      }

      const contentType = res.headers['content-type'] ?? null;
      const isHtml = isHtmlContentType(contentType);
      const html = isHtml ? decodeBody(res.body, contentType) : '';

      let links = [];
      let nofollowPage = false;
      if (isHtml && html) {
        const parsed = parseLinks(html, res.url, origin);
        links = parsed.links;
        nofollowPage = parsed.nofollowPage;
      }

      if (pages.length >= limit) return;

      const page = {
        url: res.url,
        requestedUrl: res.requestedUrl,
        status: res.status,
        contentType,
        headers: res.headers,
        html,
        depth,
        loadMs: res.loadMs,
        sizeBytes: res.body.length,
        redirectChain: res.redirectChain,
        links,
        fetchedAt: new Date().toISOString(),
      };
      pages.push(page);
      reportProgress();

      if (!nofollowPage && res.status >= 200 && res.status < 400) {
        for (const l of links) {
          if (!isHttpUrl(l.href)) continue;
          if (!linkParent.has(l.href)) {
            linkParent.set(l.href, page.url);
          }
          if (l.internal && !l.nofollow) {
            enqueue(l.href, depth + 1, page.url);
          }
        }
      }
    }

    pump();
  });

  // 4. Verificare linkuri rupte (inclusiv cele deja descărcate cu status >= 400)
  const brokenLinks = [];
  const brokenSeen = new Set();
  const addBroken = (entry) => {
    if (brokenSeen.has(entry.url)) return;
    brokenSeen.add(entry.url);
    brokenLinks.push(entry);
  };

  // Colectează toate linkurile HTTP(S) din pagini
  const candidateLinks = [];
  const candidateSeen = new Set();
  for (const page of pages) {
    for (const l of page.links) {
      if (!isHttpUrl(l.href)) continue;
      let norm;
      try {
        norm = normalizeUrl(l.href, page.url);
      } catch {
        continue;
      }
      if (!linkParent.has(norm)) linkParent.set(norm, page.url);
      const existing = fetchedStatuses.get(norm);
      if (existing) {
        if (existing.status !== null && existing.status >= 400) {
          addBroken({ url: norm, status: existing.status, foundOn: linkParent.get(norm) ?? page.url });
        } else if (existing.status === null && existing.error) {
          addBroken({
            url: norm,
            status: null,
            foundOn: linkParent.get(norm) ?? page.url,
            error: existing.error,
          });
        }
        continue;
      }
      if (candidateSeen.has(norm)) continue;
      // Dacă e link intern blocat de robots.txt, nu îl verificăm
      if (new URL(norm).origin === origin && !robots.isAllowed(norm)) continue;
      candidateSeen.add(norm);
      candidateLinks.push({ url: norm, foundOn: page.url });
    }
  }

  const toCheck = candidateLinks.slice(0, maxBrokenLinkChecks);
  const checkTimeout = Math.min(timeoutMs, 5000);

  await runPool(toCheck, concurrency, async ({ url, foundOn }) => {
    try {
      let res = await fetchUrl(url, {
        method: 'HEAD',
        headersOnly: true,
        allowPrivate,
        timeoutMs: checkTimeout,
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetchUrl(url, {
          method: 'GET',
          headersOnly: true,
          allowPrivate,
          timeoutMs: checkTimeout,
        });
      }
      if (res.status >= 400) {
        addBroken({ url, status: res.status, foundOn });
      }
    } catch (err) {
      if (err instanceof BlockedAddressError) return;
      addBroken({ url, status: null, foundOn, error: err.message });
    }
  });

  return {
    site: {
      rootUrl: normalizedRoot,
      origin,
      robotsTxt,
      sitemapUrls,
      sitemapFound,
      brokenLinks,
    },
    pages,
  };
}
