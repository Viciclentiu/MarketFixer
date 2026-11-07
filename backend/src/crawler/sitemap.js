// Descoperire sitemap.xml (inclusiv sitemap index și .gz), cu limite stricte.
import zlib from 'node:zlib';
import * as cheerio from 'cheerio';
import { fetchUrl, decodeBody } from './http.js';
import { normalizeUrl } from './url.js';

/**
 * @param {string} origin ex: https://exemplu.ro
 * @param {string[]} robotsSitemaps URL-uri din directivele Sitemap: din robots.txt
 */
export async function discoverSitemaps(
  origin,
  robotsSitemaps = [],
  { allowPrivate = false, timeoutMs, maxSitemaps = 5, maxUrls = 500, maxBytes = 5 * 1024 * 1024 } = {},
) {
  const queue = [];
  const seen = new Set();
  const add = (u) => {
    try {
      const x = new URL(u, origin);
      if (x.protocol !== 'http:' && x.protocol !== 'https:') return;
      x.hash = '';
      if (!seen.has(x.href)) {
        seen.add(x.href);
        queue.push(x.href);
      }
    } catch {
      /* URL invalid, ignorat */
    }
  };
  robotsSitemaps.forEach(add);
  if (!queue.length) add(`${origin}/sitemap.xml`);

  const urls = new Set();
  let found = false;
  let fetched = 0;
  while (queue.length && fetched < maxSitemaps && urls.size < maxUrls) {
    const sm = queue.shift();
    fetched++;
    let res;
    try {
      res = await fetchUrl(sm, {
        allowPrivate,
        timeoutMs,
        maxBytes,
        accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      });
    } catch {
      continue;
    }
    if (res.status < 200 || res.status >= 300) continue;
    let buf = res.body;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      try {
        buf = zlib.gunzipSync(buf, { maxOutputLength: maxBytes });
      } catch {
        continue;
      }
    }
    const xml = decodeBody(buf, res.headers['content-type']);
    let $;
    try {
      $ = cheerio.load(xml, { xml: true });
    } catch {
      continue;
    }
    const indexLocs = $('sitemapindex > sitemap > loc');
    if (indexLocs.length) {
      found = true;
      indexLocs.each((_, el) => add($(el).text().trim()));
      continue;
    }
    if ($('urlset').length) {
      found = true;
      $('urlset > url > loc').each((_, el) => {
        if (urls.size >= maxUrls) return false;
        try {
          urls.add(normalizeUrl($(el).text().trim(), origin));
        } catch {
          /* ignorat */
        }
        return undefined;
      });
    }
  }
  return { sitemapFound: found, sitemapUrls: [...urls] };
}
