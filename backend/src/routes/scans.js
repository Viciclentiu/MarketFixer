// Rutele REST pentru scanări, rapoarte, comparare, upload CSV și Overwrite / Auto-Fix.
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
import { computeScoresFromFindings } from '../analyzers/index.js';
import { remediateSite } from '../remediator/index.js';
import { buildZipBuffer } from '../remediator/zip.js';

function normalizeReportScores(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings)) {
    return report;
  }
  const s = report.scores || {};
  const hasZeroOrMissing =
    s.seo === 0 ||
    s.accessibility === 0 ||
    s.ux === 0 ||
    s.content === 0 ||
    s.technical === undefined ||
    s.ai_search === undefined;
  if (hasZeroOrMissing) {
    return {
      ...report,
      scores: computeScoresFromFindings(report.findings, report.lighthouse),
    };
  }
  return report;
}

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
  analyzeSite,
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
    return res.json(normalizeReportScores(report));
  });

  // POST /api/scans/:id/remediate -> Generează fișierele rescrise cu Gemini/OpenAI + Cheerio
  router.post('/:id/remediate', async (req, res) => {
    res.setTimeout(0);
    try {
      const { id } = req.params;
      const rawReport = db.getReport(id);
      if (!rawReport) {
        return res.status(404).json({ error: 'Raportul scanării nu este încă disponibil.' });
      }
      const report = normalizeReportScores(rawReport);
      const snapshot =
        (typeof db.getSnapshot === 'function' ? db.getSnapshot(id) : null) || {
          site: { rootUrl: report.url, origin: new URL(report.url).origin },
          pages: [
            {
              url: report.url,
              requestedUrl: report.url,
              status: 200,
              contentType: 'text/html',
              html: `<!DOCTYPE html><html><head><title></title></head><body><h1>${report.url}</h1></body></html>`,
              depth: 0,
              loadMs: 100,
              sizeBytes: 120,
              redirectChain: [],
              links: [],
            },
          ],
        };

      const apiKey = req.body?.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
      const result = await remediateSite(snapshot, report, { analyzeSite, apiKey });
      if (typeof db.saveFixes === 'function') {
        db.saveFixes(id, result);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err?.message || 'Eroare la generarea fișierelor reparate.' });
    }
  });

  // GET /api/scans/:id/fixes -> Returnează pachetul de fișiere reparate deja generat
  router.get('/:id/fixes', (req, res) => {
    const fixes = typeof db.getFixes === 'function' ? db.getFixes(req.params.id) : null;
    if (!fixes) {
      return res.status(404).json({ error: 'Fișierele reparate nu au fost încă generate pentru această scanare.' });
    }
    return res.json(fixes);
  });

  // GET /api/scans/:id/fixes/download-all -> Descarcă tot directorul cu fișierele reparate ca arhivă .zip
  router.get('/:id/fixes/download-all', (req, res) => {
    const fixes = typeof db.getFixes === 'function' ? db.getFixes(req.params.id) : null;
    if (!fixes || !Array.isArray(fixes.files)) {
      return res.status(404).json({ error: 'Generează întâi fișierele reparate.' });
    }
    let host = 'site';
    try {
      host = new URL(fixes.url).hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
      host = 'site';
    }
    const folderName = `marketfixer-${host}`;
    const zipBuf = buildZipBuffer(fixes.files, folderName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);
    return res.send(zipBuf);
  });

  // GET /api/scans/:id/fixes/download?path=index.html -> Descarcă un fișier individual
  router.get('/:id/fixes/download', (req, res) => {
    const fixes = typeof db.getFixes === 'function' ? db.getFixes(req.params.id) : null;
    if (!fixes) {
      return res.status(404).json({ error: 'Generează întâi fișierele reparate.' });
    }
    const targetPath = req.query.path || 'index.html';
    const file = (fixes.files || []).find((f) => f.path === targetPath);
    if (!file) {
      return res.status(404).json({ error: `Fișierul ${targetPath} nu a fost găsit.` });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.path.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    return res.send(file.fixedContent);
  });

  // GET /api/scans/:id/fixes/preview -> Randează în browser site-ul public cu reparațiile aplicate live
  router.get('/:id/fixes/preview', (req, res) => {
    const fixes = typeof db.getFixes === 'function' ? db.getFixes(req.params.id) : null;
    if (!fixes) {
      return res.status(404).send('Generează întâi fișierele reparate.');
    }
    const htmlFile = (fixes.files || []).find((f) => f.type === 'html') || fixes.files?.[0];
    const cssFile = (fixes.files || []).find((f) => f.path === 'marketfixer-fixes.css');
    const jsFile = (fixes.files || []).find((f) => f.path === 'marketfixer-patch.js');
    if (!htmlFile) {
      return res.status(404).send('Nu există fișier HTML de previzualizat.');
    }

    let previewHtml = htmlFile.fixedContent;
    const baseTag = `<base href="${fixes.url}">`;
    const inlineCss = cssFile ? `<style id="mf-inline-style">${cssFile.fixedContent}</style>` : '';
    const inlineJs = jsFile ? `<script id="mf-inline-script">${jsFile.fixedContent}</script>` : '';

    previewHtml = previewHtml
      .replace(/<link[^>]*href=["']marketfixer-fixes\.css["'][^>]*>/i, inlineCss)
      .replace(/<script[^>]*src=["']marketfixer-patch\.js["'][^>]*><\/script>/i, inlineJs)
      .replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(previewHtml);
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
