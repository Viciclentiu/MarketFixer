// Stocare SQLite (node:sqlite DatabaseSync) cu fallback automat in-memory Map
// dacă versiunea de Node nu expune node:sqlite.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUrl } from '../crawler/url.js';

let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite');
  DatabaseSync = sqliteMod.DatabaseSync ?? sqliteMod.default?.DatabaseSync ?? null;
} catch {
  DatabaseSync = null;
}

const DEFAULT_DB_PATH = fileURLToPath(new URL('../../data/marketfixer.db', import.meta.url));

function formatScanRow(row) {
  if (!row) return null;
  let progress;
  try {
    progress = typeof row.progress === 'string' ? JSON.parse(row.progress) : row.progress;
  } catch {
    progress = { phase: row.status, done: 0, total: 0 };
  }
  const out = {
    scanId: row.id,
    url: row.url,
    status: row.status,
    progress,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  };
  if (row.error) {
    out.error = row.error;
  }
  return out;
}

function normalizeFilterUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  try {
    return normalizeUrl(url.trim());
  } catch {
    return url.trim();
  }
}

function createMemoryStore() {
  const scans = new Map();
  const reports = new Map();
  const snapshots = new Map();
  const fixes = new Map();

  return {
    backend: 'memory',

    createScan({ id = crypto.randomUUID(), url, maxPages = 20 } = {}) {
      const now = new Date().toISOString();
      const row = {
        id,
        url,
        status: 'queued',
        progress: { phase: 'queued', done: 0, total: Number(maxPages) || 20 },
        created_at: now,
        finished_at: null,
        error: null,
      };
      scans.set(id, row);
      return formatScanRow(row);
    },

    updateScan(scanId, patch = {}) {
      const row = scans.get(scanId);
      if (!row) return null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.progress !== undefined) {
        row.progress = { ...row.progress, ...patch.progress };
      }
      if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
      if (patch.error !== undefined) row.error = patch.error;
      return formatScanRow(row);
    },

    getScan(scanId) {
      return formatScanRow(scans.get(scanId));
    },

    listScans(urlFilter) {
      const norm = normalizeFilterUrl(urlFilter);
      const raw = typeof urlFilter === 'string' ? urlFilter.trim() : null;
      const all = [...scans.values()]
        .filter((r) => {
          if (!raw) return true;
          return r.url === raw || r.url === norm;
        })
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      return all.map(formatScanRow);
    },

    saveReport(scanId, report) {
      const copy = structuredClone(report);
      reports.set(scanId, copy);
      return copy;
    },

    getReport(scanId) {
      const r = reports.get(scanId);
      return r ? structuredClone(r) : null;
    },

    attachPerformance(scanId, performanceResult) {
      const r = reports.get(scanId);
      if (!r) return null;
      r.performance = structuredClone(performanceResult);
      reports.set(scanId, r);
      return structuredClone(r);
    },

    saveSnapshot(scanId, crawlResult) {
      snapshots.set(scanId, structuredClone(crawlResult));
    },

    getSnapshot(scanId) {
      const s = snapshots.get(scanId);
      return s ? structuredClone(s) : null;
    },

    saveFixes(scanId, fixesResult) {
      fixes.set(scanId, structuredClone(fixesResult));
      return fixesResult;
    },

    getFixes(scanId) {
      const f = fixes.get(scanId);
      return f ? structuredClone(f) : null;
    },

    close() {},
  };
}

function createSqliteStore(dbPath) {
  const target = dbPath ?? DEFAULT_DB_PATH;
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      progress TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scans_url_created ON scans (url, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scans_created ON scans (created_at DESC);
    CREATE TABLE IF NOT EXISTS reports (
      scan_id TEXT PRIMARY KEY,
      report_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      scan_id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS fixes (
      scan_id TEXT PRIMARY KEY,
      fixes_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
    );
  `);

  const insertScanStmt = db.prepare(`
    INSERT INTO scans (id, url, status, progress, created_at, finished_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getScanStmt = db.prepare(`SELECT * FROM scans WHERE id = ?`);
  const listAllStmt = db.prepare(`SELECT * FROM scans ORDER BY created_at DESC, rowid DESC`);
  const listByUrlStmt = db.prepare(
    `SELECT * FROM scans WHERE url = ? OR url = ? ORDER BY created_at DESC, rowid DESC`,
  );
  const upsertReportStmt = db.prepare(`
    INSERT INTO reports (scan_id, report_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(scan_id) DO UPDATE SET
      report_json = excluded.report_json,
      updated_at = excluded.updated_at
  `);
  const getReportStmt = db.prepare(`SELECT report_json FROM reports WHERE scan_id = ?`);
  const upsertSnapshotStmt = db.prepare(`
    INSERT INTO snapshots (scan_id, snapshot_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(scan_id) DO UPDATE SET
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at
  `);
  const getSnapshotStmt = db.prepare(`SELECT snapshot_json FROM snapshots WHERE scan_id = ?`);
  const upsertFixesStmt = db.prepare(`
    INSERT INTO fixes (scan_id, fixes_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(scan_id) DO UPDATE SET
      fixes_json = excluded.fixes_json,
      updated_at = excluded.updated_at
  `);
  const getFixesStmt = db.prepare(`SELECT fixes_json FROM fixes WHERE scan_id = ?`);

  return {
    backend: 'sqlite',

    createScan({ id = crypto.randomUUID(), url, maxPages = 20 } = {}) {
      const now = new Date().toISOString();
      const progress = { phase: 'queued', done: 0, total: Number(maxPages) || 20 };
      insertScanStmt.run(id, url, 'queued', JSON.stringify(progress), now, null, null);
      return this.getScan(id);
    },

    updateScan(scanId, patch = {}) {
      const current = getScanStmt.get(scanId);
      if (!current) return null;
      let progress;
      try {
        progress = JSON.parse(current.progress);
      } catch {
        progress = { phase: current.status, done: 0, total: 0 };
      }
      const nextStatus = patch.status !== undefined ? patch.status : current.status;
      const nextProgress =
        patch.progress !== undefined ? { ...progress, ...patch.progress } : progress;
      const nextFinished =
        patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at;
      const nextError = patch.error !== undefined ? patch.error : current.error;

      db.prepare(
        `UPDATE scans SET status = ?, progress = ?, finished_at = ?, error = ? WHERE id = ?`,
      ).run(nextStatus, JSON.stringify(nextProgress), nextFinished, nextError, scanId);

      return this.getScan(scanId);
    },

    getScan(scanId) {
      const row = getScanStmt.get(scanId);
      return formatScanRow(row);
    },

    listScans(urlFilter) {
      if (urlFilter && String(urlFilter).trim()) {
        const raw = String(urlFilter).trim();
        const norm = normalizeFilterUrl(raw) ?? raw;
        return listByUrlStmt.all(raw, norm).map(formatScanRow);
      }
      return listAllStmt.all().map(formatScanRow);
    },

    saveReport(scanId, report) {
      const now = new Date().toISOString();
      upsertReportStmt.run(scanId, JSON.stringify(report), now);
      return report;
    },

    getReport(scanId) {
      const row = getReportStmt.get(scanId);
      if (!row) return null;
      return JSON.parse(row.report_json);
    },

    attachPerformance(scanId, performanceResult) {
      const existing = this.getReport(scanId);
      if (!existing) return null;
      const updated = { ...existing, performance: performanceResult };
      this.saveReport(scanId, updated);
      return updated;
    },

    saveSnapshot(scanId, crawlResult) {
      const now = new Date().toISOString();
      upsertSnapshotStmt.run(scanId, JSON.stringify(crawlResult), now);
    },

    getSnapshot(scanId) {
      const row = getSnapshotStmt.get(scanId);
      if (!row) return null;
      return JSON.parse(row.snapshot_json);
    },

    saveFixes(scanId, fixesResult) {
      const now = new Date().toISOString();
      upsertFixesStmt.run(scanId, JSON.stringify(fixesResult), now);
      return fixesResult;
    },

    getFixes(scanId) {
      const row = getFixesStmt.get(scanId);
      if (!row) return null;
      return JSON.parse(row.fixes_json);
    },

    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function createDb(dbPath) {
  if (DatabaseSync) {
    try {
      return createSqliteStore(dbPath);
    } catch {
      return createMemoryStore();
    }
  }
  return createMemoryStore();
}
