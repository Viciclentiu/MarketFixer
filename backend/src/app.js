// Aplicația Express MarketFixer (exportată pentru testare și server).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createDb } from './db/index.js';
import { createScanQueue } from './jobs/queue.js';
import { crawlSite as defaultCrawlSite } from './crawler/index.js';
import { createScansRouter } from './routes/scans.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function defaultAnalyzeSite(crawlResult, options) {
  const mod = await import('./analyzers/index.js');
  return mod.analyzeSite(crawlResult, options);
}

async function defaultAnalyzePerformance(rows, options) {
  const mod = await import('./analyzers/performance.js');
  return mod.analyzePerformance(rows, options);
}

export function createApp({
  db: providedDb,
  dbPath,
  queue: providedQueue,
  crawlSite = defaultCrawlSite,
  analyzeSite = defaultAnalyzeSite,
  analyzePerformance = defaultAnalyzePerformance,
  allowPrivate = false,
  skipDnsCheck = false,
  concurrency = 2,
} = {}) {
  const db = providedDb ?? createDb(dbPath);
  const queue =
    providedQueue ??
    createScanQueue({
      db,
      crawlSite,
      analyzeSite,
      concurrency,
      crawlOptions: { allowPrivate },
    });

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));

  app.locals.db = db;
  app.locals.queue = queue;

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/api/scans',
    createScansRouter({
      db,
      queue,
      analyzePerformance,
      allowPrivate,
      skipDnsCheck,
    }),
  );

  app.use((err, _req, res, _next) => {
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Eroare internă de server.' });
  });

  return app;
}
