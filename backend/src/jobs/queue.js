// Coadă in-memory asincronă pentru joburile de scanare și analiză.
import { crawlSite as defaultCrawlSite } from '../crawler/index.js';

export function createScanQueue({
  db,
  crawlSite = defaultCrawlSite,
  analyzeSite,
  runLighthouse = null,
  contentAi = false,
  concurrency = 2,
  crawlOptions = {},
} = {}) {
  if (!db) throw new Error('createScanQueue necesită o instanță db.');
  if (typeof analyzeSite !== 'function') {
    throw new Error('createScanQueue necesită funcția analyzeSite.');
  }

  const pending = [];
  let active = 0;
  const idleWaiters = [];

  function notifyIfIdle() {
    if (active === 0 && pending.length === 0) {
      while (idleWaiters.length) {
        const resolve = idleWaiters.shift();
        resolve();
      }
    }
  }

  async function runJob(job) {
    const { scanId, url, maxPages = 20 } = job;
    try {
      db.updateScan(scanId, {
        status: 'crawling',
        progress: { phase: 'crawling', done: 0, total: maxPages },
      });

      const crawlResult = await crawlSite(url, {
        maxPages,
        ...crawlOptions,
        onProgress(progress) {
          db.updateScan(scanId, {
            status: 'crawling',
            progress: {
              phase: 'crawling',
              done: progress?.done ?? 0,
              total: progress?.total ?? maxPages,
            },
          });
        },
      });

      if (!crawlResult?.pages?.length) {
        throw new Error('Nu s-a putut descărca nicio pagină de la URL-ul specificat.');
      }

      if (typeof db.saveSnapshot === 'function') {
        db.saveSnapshot(scanId, crawlResult);
      }

      const pagesCount = crawlResult.pages.length;

      // Google Lighthouse pe pagina principală (browser real). Nu blochează scanarea dacă eșuează.
      let lighthouse = null;
      if (typeof runLighthouse === 'function') {
        db.updateScan(scanId, {
          status: 'analyzing',
          progress: { phase: 'lighthouse', done: 0, total: 1 },
        });
        try {
          lighthouse = await runLighthouse(crawlResult.site?.rootUrl ?? url);
        } catch (err) {
          lighthouse = { available: false, error: err?.message || String(err) };
        }
      }

      db.updateScan(scanId, {
        status: 'analyzing',
        progress: { phase: 'analyzing', done: 0, total: pagesCount },
      });

      const analysisResult = await analyzeSite(crawlResult, {
        lighthouse,
        contentAi,
        onProgress(progress) {
          db.updateScan(scanId, {
            status: 'analyzing',
            progress: {
              phase: 'analyzing',
              done: progress?.done ?? 0,
              total: progress?.total ?? pagesCount,
            },
          });
        },
      });

      const report = {
        ...analysisResult,
        scanId,
        url: crawlResult.site?.rootUrl ?? url,
        generatedAt: new Date().toISOString(),
        pagesAnalyzed: pagesCount,
      };

      db.saveReport(scanId, report);
      db.updateScan(scanId, {
        status: 'done',
        progress: { phase: 'done', done: pagesCount, total: pagesCount },
        finishedAt: new Date().toISOString(),
      });
    } catch (err) {
      db.updateScan(scanId, {
        status: 'failed',
        progress: { phase: 'failed', done: 0, total: 0 },
        finishedAt: new Date().toISOString(),
        error: err?.message || String(err),
      });
    }
  }

  function pump() {
    while (active < concurrency && pending.length > 0) {
      const next = pending.shift();
      active++;
      Promise.resolve()
        .then(() => runJob(next))
        .finally(() => {
          active--;
          pump();
          notifyIfIdle();
        });
    }
  }

  return {
    enqueue({ scanId, url, maxPages = 20 }) {
      pending.push({ scanId, url, maxPages });
      queueMicrotask(pump);
    },

    get size() {
      return pending.length + active;
    },

    onIdle() {
      if (active === 0 && pending.length === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
