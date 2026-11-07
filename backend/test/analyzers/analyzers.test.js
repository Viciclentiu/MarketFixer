import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSite } from '../../src/analyzers/index.js';
import { analyzePerformance } from '../../src/analyzers/performance.js';

function makePage(overrides = {}) {
  return {
    url: 'https://exemplu.ro/',
    requestedUrl: 'https://exemplu.ro/',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    headers: {},
    html: '<!doctype html><html lang="ro"><head><title>Pagină de test suficient de lungă | Exemplu</title></head><body><h1>Titlu</h1></body></html>',
    depth: 0,
    loadMs: 320,
    sizeBytes: 4096,
    redirectChain: [],
    links: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('analyzeSite — contract și reguli pe categorii', () => {
  it('detectează probleme SEO, tehnice, accesibilitate, UX, conținut și AI search cu evidence validă', async () => {
    const repeatedParagraph =
      'Acest paragraf se repetă identic pe mai multe pagini ale site-ului nostru pentru a testa detecția blocurilor de text duplicate în motorul de analiză.';

    const crawlResult = {
      site: {
        rootUrl: 'http://exemplu.ro/',
        origin: 'http://exemplu.ro',
        robotsTxt: 'User-agent: *\nDisallow: /',
        sitemapUrls: [],
        sitemapFound: false,
        brokenLinks: [
          { url: 'http://exemplu.ro/rupt', status: 404, foundOn: 'http://exemplu.ro/' },
        ],
      },
      pages: [
        makePage({
          url: 'http://exemplu.ro/',
          depth: 0,
          loadMs: 7200,
          sizeBytes: 620 * 1024,
          html: `<!doctype html>
            <html>
              <head>
                <title>Scurt</title>
                <meta name="robots" content="noindex">
                <link rel="canonical" href="https://alt-domeniu.ro/">
              </head>
              <body>
                <h2>Subtitlu fără h1</h2>
                <h4>Salt peste h3</h4>
                <img src="http://exemplu.ro/banner.jpg">
                <form><input type="text" name="email"></form>
                <button></button>
                <a href="/detalii">click aici</a>
                <p>Oferim soluții inovatoare și calitate superioară cu o echipă tânără și dinamică.</p>
                <p>${repeatedParagraph}</p>
                <script type="application/ld+json">{ invalid json </script>
              </body>
            </html>`,
        }),
        makePage({
          url: 'http://exemplu.ro/adanc',
          depth: 4,
          redirectChain: ['http://exemplu.ro/v1', 'http://exemplu.ro/v2', 'http://exemplu.ro/adanc'],
          html: `<!doctype html>
            <html lang="ro">
              <head>
                <title>Scurt</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
              </head>
              <body>
                <nav>
                  <ul>
                    ${Array.from({ length: 12 }, (_, i) => `<li><a href="/p${i}">Meniu ${i}</a></li>`).join('')}
                  </ul>
                </nav>
                <h1>Pertinență</h1>
                <p>${repeatedParagraph}</p>
                <p>${Array.from({ length: 135 }, (_, i) => `cuvant${i}`).join(' ')}.</p>
              </body>
            </html>`,
        }),
      ],
    };

    const progressEvents = [];
    const result = await analyzeSite(crawlResult, {
      onProgress: (ev) => progressEvents.push(ev),
    });

    // Verificare structură AnalysisResult conform shared/CONTRACTS.md
    assert.ok(result.scores);
    for (const key of ['overall', 'seo', 'accessibility', 'ux', 'content']) {
      assert.equal(typeof result.scores[key], 'number');
      assert.ok(result.scores[key] >= 0 && result.scores[key] <= 100, `Scor invalid pentru ${key}`);
    }
    assert.equal(result.scores.technical, undefined, 'technical nu trebuie să aibă câmp separat în scores');
    assert.ok(Array.isArray(result.findings) && result.findings.length > 0);
    assert.equal(result.summary.totalFindings, result.findings.length);
    assert.ok(Array.isArray(result.summary.topPriorities));
    assert.ok(result.summary.topPriorities.length <= 5);
    assert.ok(Array.isArray(result.limitations) && result.limitations.length >= 2);
    assert.equal(progressEvents.length, 6);

    // Fiecare Finding trebuie să aibă evidence.summary și texte în română
    for (const f of result.findings) {
      assert.ok(f.fingerprint && f.ruleId && f.category && f.severity);
      assert.ok(f.evidence && typeof f.evidence.summary === 'string' && f.evidence.summary.length > 0);
      assert.ok(typeof f.title === 'string' && f.title.length > 0);
      assert.ok(typeof f.whyItMatters === 'string' && f.whyItMatters.length > 0);
      assert.ok(typeof f.recommendation === 'string' && f.recommendation.length > 0);
    }

    const ruleIds = new Set(result.findings.map((f) => f.ruleId));

    // SEO
    assert.ok(ruleIds.has('seo.title.too_short'));
    assert.ok(ruleIds.has('seo.title.duplicate'));
    assert.ok(ruleIds.has('seo.meta_description.missing'));
    assert.ok(ruleIds.has('seo.h1.missing'));
    assert.ok(ruleIds.has('seo.headings.skipped_level'));
    assert.ok(ruleIds.has('seo.canonical.invalid'));
    assert.ok(ruleIds.has('seo.noindex'));
    assert.ok(ruleIds.has('seo.img.alt_missing'));

    // Technical
    assert.ok(ruleIds.has('technical.robots.blocks_all'));
    assert.ok(ruleIds.has('technical.sitemap.missing'));
    assert.ok(ruleIds.has('technical.links.broken'));
    assert.ok(ruleIds.has('technical.redirect.chain'));
    assert.ok(ruleIds.has('technical.https.missing'));
    assert.ok(ruleIds.has('technical.viewport.missing'));
    assert.ok(ruleIds.has('technical.lang.missing'));
    assert.ok(ruleIds.has('technical.page.slow'));
    assert.ok(ruleIds.has('technical.page.heavy'));

    // Accessibility (axe-core sau fallback static)
    assert.ok(ruleIds.has('accessibility.image-alt'));
    assert.ok(ruleIds.has('accessibility.label'));
    assert.ok(ruleIds.has('accessibility.button-name'));

    // UX
    assert.ok(ruleIds.has('ux.depth.too_deep'));
    assert.ok(ruleIds.has('ux.orphan.page'));
    assert.ok(ruleIds.has('ux.nav.missing'));
    assert.ok(ruleIds.has('ux.nav.overloaded'));
    assert.ok(ruleIds.has('ux.cta.missing_on_home'));
    assert.ok(ruleIds.has('ux.links.vague_text'));

    // Content
    assert.ok(ruleIds.has('content.thin_content'));
    assert.ok(ruleIds.has('content.paragraphs.too_long'));
    assert.ok(ruleIds.has('content.readability.long_sentences'));
    assert.ok(ruleIds.has('content.generic_phrases'));
    assert.ok(ruleIds.has('content.duplicate_blocks'));

    // AI Search
    assert.ok(ruleIds.has('ai_search.jsonld.invalid'));
    assert.ok(ruleIds.has('ai_search.jsonld.missing'));
    assert.ok(ruleIds.has('ai_search.faq.missing'));
    assert.ok(ruleIds.has('ai_search.contact.incomplete'));
  });
});

describe('analyzePerformance — analiza CSV cu mărimea eșantionului (n)', () => {
  it('detectează dimensiunile și metricile, marchează confidence low pentru n < 5 și include caveat', () => {
    const rows = [
      { canal: 'Organic', conversii: '12', venit: '1200' },
      { canal: 'Organic', conversii: '15', venit: '1500' },
      { canal: 'Organic', conversii: '9', venit: '900' },
      { canal: 'Paid', conversii: '3', venit: '300' },
      { canal: 'Paid', conversii: '5', venit: '500' },
    ];

    const res = analyzePerformance(rows);
    assert.equal(res.rowCount, 5);
    assert.deepEqual(res.columnsDetected.dimensions, ['canal']);
    assert.deepEqual(res.columnsDetected.metrics, ['conversii', 'venit']);
    assert.equal(res.insights.length, 2);

    const convInsight = res.insights.find((i) => i.evidence.metric === 'conversii');
    assert.ok(convInsight);
    assert.equal(convInsight.confidence, 'low');
    assert.ok(convInsight.caveat && convInsight.caveat.includes('n=2'));
    assert.equal(convInsight.evidence.groups[0].name, 'Organic');
    assert.equal(convInsight.evidence.groups[0].n, 3);
    assert.equal(convInsight.evidence.groups[0].mean, 12);
    assert.equal(convInsight.evidence.groups[0].total, 36);
  });

  it('marchează confidence medium/high când grupurile au eșantion suficient', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push({ format: 'Video', clickuri: 100 });
    for (let i = 0; i < 6; i++) rows.push({ format: 'Imagine', clickuri: 40 });

    const res = analyzePerformance(rows);
    assert.equal(res.insights.length, 1);
    assert.equal(res.insights[0].confidence, 'medium');
    assert.equal(res.insights[0].evidence.groups[0].n, 6);
  });
});
