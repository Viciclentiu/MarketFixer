// Rutele REST pentru scanări, rapoarte, comparare și upload CSV de performanță.
import express from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  normalizeUrl,
  InvalidUrlError,
  BlockedAddressError,
  assertHostnameAllowed,
  assertPublicUrl,
} from '../crawler/index.js';
import { compareReports } from '../compare.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

export function createScansRouter({
  db,
  queue,
  analyzePerformance,
  allowPrivate = false,
  skipDnsCheck = false,
} = {}) {
  const router = express.Router();

  // POST /api/scans -> 202 { scanId, status }
  router.post('/', async (req, res) => {
    try {
      const rawUrl = req.body?.url;
      const normalizedUrl = normalizeUrl(rawUrl);
      const parsed = new URL(normalizedUrl);

      if (!allowPrivate) {
        assertHostnameAllowed(parsed.hostname);
        if (!skipDnsCheck) {
          await assertPublicUrl(parsed);
        }
      }

      let maxPages = 20;
      if (req.body?.maxPages !== undefined && req.body?.maxPages !== null) {
        const n = Number(req.body.maxPages);
        if (!Number.isFinite(n) || n < 1) {
          return res
            .status(400)
            .json({ error: 'Parametrul maxPages trebuie să fie un număr pozitiv.' });
        }
        maxPages = Math.min(50, Math.floor(n));
      }

      const scan = db.createScan({ url: normalizedUrl, maxPages });
      queue.enqueue({ scanId: scan.scanId, url: normalizedUrl, maxPages });

      return res.status(202).json({
        scanId: scan.scanId,
        status: scan.status,
      });
    } catch (err) {
      if (
        err instanceof InvalidUrlError ||
        err instanceof BlockedAddressError ||
        err?.status === 400
      ) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err?.message || 'Eroare internă la pornirea scanării.' });
    }
  });

  // GET /api/scans?url= -> listă scanări (istoric), cele mai noi primele
  router.get('/', (req, res) => {
    const urlFilter = typeof req.query.url === 'string' ? req.query.url : undefined;
    const scans = db.listScans(urlFilter);
    return res.json(scans);
  });

  // GET /api/scans/:id/compare/:prevId -> { resolved, new, remaining, scoreDelta }
  router.get('/:id/compare/:prevId', (req, res) => {
    const { id, prevId } = req.params;
    const currentReport = db.getReport(id);
    const prevReport = db.getReport(prevId);
    if (!currentReport || !prevReport) {
      return res.status(404).json({
        error: 'Unul sau ambele rapoarte necesare pentru comparare nu au fost găsite.',
      });
    }
    const comparison = compareReports(currentReport, prevReport);
    return res.json(comparison);
  });

  // GET /api/scans/:id/report -> Report (404 dacă nu e gata)
  router.get('/:id/report', (req, res) => {
    const report = db.getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Raportul nu este disponibil încă.' });
    }
    return res.json(report);
  });

  // POST /api/scans/:id/performance -> PerformanceResult (salvat și în raport)
  router.post(
    '/:id/performance',
    (req, res, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ error: `Eroare la încărcarea fișierului: ${err.message}` });
        }
        return next();
      });
    },
    async (req, res) => {
      try {
        const { id } = req.params;
        const existingReport = db.getReport(id);
        if (!existingReport) {
          return res
            .status(404)
            .json({ error: 'Raportul scanării nu a fost găsit sau nu este finalizat.' });
        }

        let csvText = '';
        if (req.file?.buffer) {
          csvText = req.file.buffer.toString('utf-8');
        } else if (typeof req.body?.csv === 'string') {
          csvText = req.body.csv;
        } else if (typeof req.body === 'string') {
          csvText = req.body;
        }

        if (!csvText || !csvText.trim()) {
          return res.status(400).json({ error: 'Fișierul CSV lipsește sau este gol.' });
        }

        let rows;
        try {
          rows = parseCsv(csvText, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relax_column_count: true,
          });
        } catch (parseErr) {
          return res.status(400).json({ error: `CSV invalid: ${parseErr.message}` });
        }

        if (!Array.isArray(rows) || rows.length === 0) {
          return res.status(400).json({ error: 'Fișierul CSV nu conține rânduri de date.' });
        }

        let columns = undefined;
        if (req.body?.columns) {
          try {
            columns =
              typeof req.body.columns === 'string'
                ? JSON.parse(req.body.columns)
                : req.body.columns;
          } catch {
            columns = undefined;
          }
        }

        const performanceResult = await analyzePerformance(rows, { columns });
        db.attachPerformance(id, performanceResult);

        return res.json(performanceResult);
      } catch (err) {
        return res
          .status(500)
          .json({ error: err?.message || 'Eroare la analizarea fișierului CSV.' });
      }
    },
  );

  // GET /api/scans/:id -> status + progress
  router.get('/:id', (req, res) => {
    const scan = db.getScan(req.params.id);
    if (!scan) {
      return res.status(404).json({ error: 'Scanarea nu a fost găsită.' });
    }
    return res.json(scan);
  });

  return router;
}
