// Rulează Google Lighthouse (librăria Node `lighthouse` + `chrome-launcher`) pe o pagină.
// Lighthouse folosește un Chromium real (headless): execută JavaScript/React și aplică CSS,
// deci măsoară performanța (Core Web Vitals), accesibilitatea (inclusiv contrastul),
// best practices și SEO tehnic exact cum le vede un browser.
//
// Returnează un rezumat compact (nu tot LHR-ul) ca să poată fi salvat în raport.
import fs from 'node:fs';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const METRICS = {
  lcp: 'largest-contentful-paint',
  fcp: 'first-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbt: 'total-blocking-time',
  si: 'speed-index',
};
const SCORED_MODES = new Set(['binary', 'numeric', 'metricSavings']);
const PASS_THRESHOLD = 0.9;

// Lighthouse e greu (un Chromium per rulare): rulăm câte una pe rând.
let chain = Promise.resolve();

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  // undefined => chrome-launcher caută singur un Chrome instalat (ex: pe Windows).
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function toScore(value) {
  return typeof value === 'number' ? Math.round(value * 100) : null;
}

function firstSnippet(details) {
  const item = details?.items?.[0];
  if (!item) return undefined;
  const node = item.node ?? item;
  return node?.snippet || node?.selector || item.url || item.source?.url || undefined;
}

function summarize(lhr) {
  const auditCategory = new Map();
  for (const cat of CATEGORIES) {
    for (const ref of lhr.categories?.[cat]?.auditRefs ?? []) {
      if (!auditCategory.has(ref.id)) auditCategory.set(ref.id, { category: cat, weight: ref.weight ?? 0 });
    }
  }

  const failedAudits = [];
  for (const [id, info] of auditCategory) {
    const audit = lhr.audits?.[id];
    if (!audit || !SCORED_MODES.has(audit.scoreDisplayMode)) continue;
    if (typeof audit.score !== 'number' || audit.score >= PASS_THRESHOLD) continue;
    failedAudits.push({
      id,
      category: info.category,
      weight: info.weight,
      title: audit.title,
      description: audit.description,
      score: audit.score,
      displayValue: audit.displayValue ?? null,
      numericValue: typeof audit.numericValue === 'number' ? audit.numericValue : null,
      snippet: firstSnippet(audit.details),
    });
  }

  const metrics = {};
  for (const [key, auditId] of Object.entries(METRICS)) {
    const a = lhr.audits?.[auditId];
    if (a) metrics[key] = { value: a.numericValue ?? null, display: a.displayValue ?? null, score: toScore(a.score) };
  }

  return {
    available: true,
    url: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl,
    fetchedAt: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    formFactor: lhr.configSettings?.formFactor ?? 'mobile',
    scores: {
      performance: toScore(lhr.categories?.performance?.score),
      accessibility: toScore(lhr.categories?.accessibility?.score),
      bestPractices: toScore(lhr.categories?.['best-practices']?.score),
      seo: toScore(lhr.categories?.seo?.score),
    },
    metrics,
    failedAudits,
    runtimeError: lhr.runtimeError?.message ?? null,
  };
}

async function runOnce(url, { timeoutMs }) {
  let lighthouse;
  let chromeLauncher;
  try {
    lighthouse = (await import('lighthouse')).default;
    chromeLauncher = await import('chrome-launcher');
  } catch {
    return { available: false, error: 'Pachetele lighthouse / chrome-launcher nu sunt instalate.' };
  }

  let chrome;
  let timer;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: findChrome(),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      logLevel: 'silent',
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Lighthouse a depășit ${timeoutMs / 1000}s`)), timeoutMs);
    });
    const result = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        locale: 'ro',
        onlyCategories: CATEGORIES,
      }),
      timeout,
    ]);
    if (!result?.lhr) return { available: false, error: 'Lighthouse nu a returnat niciun rezultat.' };
    return summarize(result.lhr);
  } catch (err) {
    return { available: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
    try {
      await chrome?.kill();
    } catch {
      /* ignorat */
    }
  }
}

/** Rulează Lighthouse pe `url`. Nu aruncă niciodată: la eșec returnează { available: false, error }. */
export function runLighthouse(url, { timeoutMs = 90_000 } = {}) {
  const job = chain.then(() => runOnce(url, { timeoutMs }));
  chain = job.catch(() => {});
  return job;
}
