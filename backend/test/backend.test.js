// Teste de unitate și integrare pentru backend-ul MarketFixer (node --test).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  crawlSite,
  normalizeUrl,
  InvalidUrlError,
  BlockedAddressError,
  isBlockedIp,
  assertHostnameAllowed,
  createRobotsMatcher,
} from '../src/crawler/index.js';
import { createDb } from '../src/db/index.js';
import { compareReports } from '../src/compare.js';
import { createApp } from '../src/app.js';

function startFixtureServer() {
  let baseUrl = '';
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, baseUrl);
    if (u.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`User-agent: *\nDisallow: /secret\nSitemap: ${baseUrl}/sitemap.xml\n`);
      return;
    }
    if (u.pathname === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>${baseUrl}/</loc></url>
          <url><loc>${baseUrl}/despre</loc></url>
          <url><loc>${baseUrl}/contact</loc></url>
        </urlset>`,
      );
      return;
    }
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
        <html lang="ro">
          <head><title>Acasă - Exemplu</title></head>
          <body>
            <h1>Bine ați venit</h1>
            <a href="/despre">Despre noi</a>
            <a href="/secret">Zonă privată</a>
            <a href="/link-rupt">Link inexistent</a>
          </body>
        </html>`);
      return;
    }
    if (u.pathname === '/despre') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
        <html lang="ro">
          <head><title>Despre - Exemplu</title></head>
          <body>
            <h1>Despre echipă</h1>
            <a href="/contact">Contact</a>
          </body>
        </html>`);
      return;
    }
    if (u.pathname === '/contact') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
        <html lang="ro">
          <head><title>Contact - Exemplu</title></head>
          <body><h1>Contactează-ne</h1></body>
        </html>`);
      return;
    }
    if (u.pathname === '/secret') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><body>Nu ar trebui scanat</body></html>`);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>404 Nu a fost găsit</body></html>');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe('URL și protecție SSRF', () => {
  it('normalizează URL-urile http/https și adaugă https implicit', () => {
    assert.equal(normalizeUrl('exemplu.ro/ Despre#sectiune'), 'https://exemplu.ro/%20Despre');
    assert.equal(normalizeUrl('http://exemplu.ro/test#top'), 'http://exemplu.ro/test');
    assert.throws(() => normalizeUrl('javascript:alert(1)'), InvalidUrlError);
    assert.throws(() => normalizeUrl('ftp://exemplu.ro/fisier'), InvalidUrlError);
    assert.throws(() => normalizeUrl(''), InvalidUrlError);
  });

  it('blochează localhost și IP-urile private sau rezervate', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.5'), true);
    assert.equal(isBlockedIp('172.16.5.4'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
    assert.equal(isBlockedIp('::1'), true);
    assert.equal(isBlockedIp('93.184.216.34'), false);

    assert.throws(() => assertHostnameAllowed('localhost'), BlockedAddressError);
    assert.throws(() => assertHostnameAllowed('sub.localhost'), BlockedAddressError);
    assert.throws(() => assertHostnameAllowed('127.0.0.1'), BlockedAddressError);
    assert.throws(() => assertHostnameAllowed('169.254.169.254'), BlockedAddressError);
    assert.doesNotThrow(() => assertHostnameAllowed('exemplu.ro'));
  });

  it('crawlSite refuză implicit țintele locale (protecție SSRF)', async () => {
    await assert.rejects(
      () => crawlSite('http://127.0.0.1:9999/'),
      (err) => err instanceof BlockedAddressError,
    );
  });
});

describe('Parser robots.txt', () => {
  it('respectă regulile Allow/Disallow și extrage directivele Sitemap', () => {
    const matcher = createRobotsMatcher(
      `
      User-agent: *
      Disallow: /admin
      Allow: /admin/public
      Sitemap: https://exemplu.ro/sitemap.xml
      `,
      'MarketFixerBot',
    );
    assert.equal(matcher.isAllowed('https://exemplu.ro/'), true);
    assert.equal(matcher.isAllowed('https://exemplu.ro/admin/secret'), false);
    assert.equal(matcher.isAllowed('https://exemplu.ro/admin/public/info'), true);
    assert.deepEqual(matcher.sitemaps, ['https://exemplu.ro/sitemap.xml']);
  });
});

describe('Crawler (crawlSite)', () => {
  let fixture;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await fixture?.close();
  });

  it('scanează paginile permise, citește sitemap.xml și detectează linkurile rupte', async () => {
    const progressEvents = [];
    const result = await crawlSite(fixture.baseUrl, {
      maxPages: 10,
      allowPrivate: true,
      onProgress: (p) => progressEvents.push(p),
    });

    assert.equal(result.site.origin, fixture.baseUrl);
    assert.equal(result.site.sitemapFound, true);
    assert.equal(result.site.sitemapUrls.length, 3);
    assert.ok(result.site.robotsTxt?.includes('Disallow: /secret'));

    const crawledPaths = result.pages.map((p) => new URL(p.url).pathname).sort();
    assert.ok(crawledPaths.includes('/'));
    assert.ok(crawledPaths.includes('/despre'));
    assert.ok(crawledPaths.includes('/contact'));
    assert.ok(!crawledPaths.includes('/secret'), 'Nu trebuie să scaneze căile blocate în robots.txt');

    assert.ok(result.site.brokenLinks.length >= 1);
    const broken = result.site.brokenLinks.find((b) => b.url.endsWith('/link-rupt'));
    assert.ok(broken, 'Linkul /link-rupt trebuie raportat ca rupt');
    assert.equal(broken.status, 404);
    assert.ok(progressEvents.length > 0);
  });
});

describe('DB și Comparare rapoarte', () => {
  it('stochează scanări, rapoarte și date de performanță', () => {
    const db = createDb(':memory:');
    const s1 = db.createScan({ url: 'https://exemplu.ro/', maxPages: 15 });
    assert.equal(s1.status, 'queued');

    db.updateScan(s1.scanId, {
      status: 'done',
      progress: { phase: 'done', done: 3, total: 3 },
      finishedAt: new Date().toISOString(),
    });

    const report = {
      scanId: s1.scanId,
      url: 'https://exemplu.ro/',
      generatedAt: new Date().toISOString(),
      pagesAnalyzed: 3,
      scores: { overall: 80, seo: 75, accessibility: 85, ux: 80, content: 80 },
      findings: [],
      summary: {
        totalFindings: 0,
        bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
        byCategory: { seo: 0, technical: 0, accessibility: 0, ux: 0, content: 0, ai_search: 0 },
        topPriorities: [],
      },
      limitations: [],
    };
    db.saveReport(s1.scanId, report);
    assert.equal(db.getReport(s1.scanId).pagesAnalyzed, 3);

    const perf = {
      rowCount: 10,
      columnsDetected: { dimensions: ['channel'], metrics: ['clicks'] },
      insights: [],
      warnings: [],
    };
    const updated = db.attachPerformance(s1.scanId, perf);
    assert.equal(updated.performance.rowCount, 10);
    assert.equal(db.listScans('exemplu.ro').length, 1);
    db.close();
  });

  it('compară două rapoarte după fingerprint (resolved, new, remaining, scoreDelta)', () => {
    const fOld = { fingerprint: 'seo.meta|https://exemplu.ro/', ruleId: 'seo.meta', title: 'Meta lipsă' };
    const fCommon = { fingerprint: 'seo.h1|https://exemplu.ro/', ruleId: 'seo.h1', title: 'H1 multiplu' };
    const fNew = { fingerprint: 'ux.cta|https://exemplu.ro/', ruleId: 'ux.cta', title: 'CTA neclar' };

    const prevReport = {
      scores: { overall: 65, seo: 60, accessibility: 70, ux: 65, content: 65 },
      findings: [fOld, fCommon],
    };
    const currentReport = {
      scores: { overall: 78, seo: 80, accessibility: 75, ux: 75, content: 82 },
      findings: [fCommon, fNew],
    };

    const diff = compareReports(currentReport, prevReport);
    assert.deepEqual(diff.resolved, [fOld]);
    assert.deepEqual(diff.new, [fNew]);
    assert.deepEqual(diff.remaining, [fCommon]);
    assert.equal(diff.scoreDelta.overall, 13);
    assert.equal(diff.scoreDelta.seo, 20);
  });
});

describe('REST API (/api/*)', () => {
  let fixture;
  let apiServer;
  let apiBase;
  let app;
  let scanCounter = 0;

  before(async () => {
    fixture = await startFixtureServer();

    const stubAnalyzeSite = async (crawlResult) => {
      scanCounter++;
      const findings =
        scanCounter === 1
          ? [
              {
                fingerprint: `seo.title|${crawlResult.site.rootUrl}`,
                ruleId: 'seo.title.short',
                category: 'seo',
                severity: 'medium',
                title: 'Titlu prea scurt',
                pageUrl: crawlResult.site.rootUrl,
                evidence: { summary: 'Titlul are 15 caractere', value: 15, expected: '30–60 caractere' },
                whyItMatters: 'Titlurile scurte reduc relevanța în motoarele de căutare.',
                recommendation: 'Extinde titlul paginii principale.',
                effort: 'low',
                source: 'rule',
              },
            ]
          : [];

      const overall = scanCounter === 1 ? 75 : 92;
      return {
        scores: { overall, seo: overall, accessibility: 90, ux: 85, content: 88 },
        findings,
        summary: {
          totalFindings: findings.length,
          bySeverity: { critical: 0, high: 0, medium: findings.length, low: 0 },
          byCategory: {
            seo: findings.length,
            technical: 0,
            accessibility: 0,
            ux: 0,
            content: 0,
            ai_search: 0,
          },
          topPriorities: findings.map((f) => f.fingerprint),
        },
        limitations: ['JavaScript nu este executat în timpul scanării statice.'],
      };
    };

    const stubAnalyzePerformance = (rows) => ({
      rowCount: rows.length,
      columnsDetected: {
        dimensions: ['campanie'],
        metrics: ['conversii'],
      },
      insights: [
        {
          statement: `S-au analizat ${rows.length} rânduri din CSV.`,
          evidence: {
            metric: 'conversii',
            groups: [{ name: 'Organic', n: rows.length, mean: 12.5, total: 25 }],
          },
          confidence: rows.length >= 5 ? 'medium' : 'low',
          caveat: rows.length < 5 ? `Eșantion mic (n=${rows.length}), nu generaliza` : undefined,
        },
      ],
      warnings: [],
    });

    app = createApp({
      dbPath: ':memory:',
      analyzeSite: stubAnalyzeSite,
      analyzePerformance: stubAnalyzePerformance,
      allowPrivate: true,
    });

    await new Promise((resolve) => {
      apiServer = app.listen(0, '127.0.0.1', () => {
        const { port } = apiServer.address();
        apiBase = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((r) => apiServer?.close(r));
    app?.locals?.db?.close?.();
    await fixture?.close();
  });

  it('GET /api/health returnează { status: "ok" }', async () => {
    const res = await fetch(`${apiBase}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });
  });

  it('rulează fluxul complet: POST /api/scans -> status -> report -> compare -> performance CSV', async () => {
    // Scanarea 1
    const create1 = await fetch(`${apiBase}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: fixture.baseUrl, maxPages: 5 }),
    });
    assert.equal(create1.status, 202);
    const { scanId: scanId1 } = await create1.json();
    assert.ok(scanId1);

    await app.locals.queue.onIdle();

    const status1Res = await fetch(`${apiBase}/api/scans/${scanId1}`);
    assert.equal(status1Res.status, 200);
    const status1 = await status1Res.json();
    assert.equal(status1.status, 'done');
    assert.ok(status1.finishedAt);

    const report1Res = await fetch(`${apiBase}/api/scans/${scanId1}/report`);
    assert.equal(report1Res.status, 200);
    const report1 = await report1Res.json();
    assert.equal(report1.scanId, scanId1);
    assert.equal(report1.findings.length, 1);

    // Scanarea 2 (pentru comparare)
    const create2 = await fetch(`${apiBase}/api/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: fixture.baseUrl, maxPages: 5 }),
    });
    const { scanId: scanId2 } = await create2.json();
    await app.locals.queue.onIdle();

    // Istoric scanări
    const listRes = await fetch(
      `${apiBase}/api/scans?url=${encodeURIComponent(fixture.baseUrl)}`,
    );
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 2);

    // Comparare scanId2 vs scanId1
    const cmpRes = await fetch(`${apiBase}/api/scans/${scanId2}/compare/${scanId1}`);
    assert.equal(cmpRes.status, 200);
    const cmp = await cmpRes.json();
    assert.equal(cmp.resolved.length, 1);
    assert.equal(cmp.new.length, 0);
    assert.equal(cmp.scoreDelta.overall, 17);

    // Upload CSV de performanță
    const csvContent = 'campanie,conversii\nOrganic,10\nOrganic,15\n';
    const form = new FormData();
    form.append('file', new Blob([csvContent], { type: 'text/csv' }), 'performanta.csv');

    const perfRes = await fetch(`${apiBase}/api/scans/${scanId2}/performance`, {
      method: 'POST',
      body: form,
    });
    assert.equal(perfRes.status, 200);
    const perfBody = await perfRes.json();
    assert.equal(perfBody.rowCount, 2);

    // Verificăm că performance a fost salvat în raport
    const report2Res = await fetch(`${apiBase}/api/scans/${scanId2}/report`);
    const report2 = await report2Res.json();
    assert.equal(report2.performance.rowCount, 2);
  });
});
