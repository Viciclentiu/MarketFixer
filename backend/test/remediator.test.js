import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { callAiDesigner, loadDesignSkills, remediateSite } from '../src/remediator/index.js';

const pageUrl = 'https://atelier.example/';
const sourceImage = `${pageUrl}atelier.jpg`;
const sourceLinks = [
  { label: 'Acasă', href: pageUrl },
  { label: 'Proiecte', href: `${pageUrl}proiecte` },
  { label: 'Contact', href: `${pageUrl}contact` },
];

function designerInput() {
  return {
    pageUrl,
    extractedContent: {
      siteName: 'Atelier',
      title: 'Atelier de arhitectură',
      metaDescription: 'Proiecte de arhitectură și amenajare interioară.',
      headings: [{ tag: 'h1', text: 'Atelier de arhitectură' }],
      textBlocks: ['Proiectăm locuințe și spații de lucru.', 'Discută cu echipa despre proiectul tău.'],
      prices: [],
      contacts: { phones: [], emails: [] },
    },
    navigation: sourceLinks,
    assets: [{ url: sourceImage, role: 'content_image', alt: 'Atelierul nostru' }],
    brandSignals: { siteName: 'Atelier', observedHexColors: ['#123456'] },
    existingInteractions: [],
    auditFindings: [],
  };
}

function designResponse() {
  return {
    seo: { title: 'Atelier de arhitectură', metaDescription: 'Proiecte de arhitectură și amenajare interioară.' },
    design: {
      colors: { background: '#eef4f8', text: '#123456', primary: '#234567' },
      typography: {
        displayFont: 'Archivo', bodyFont: 'Lato', utilityFont: 'IBM Plex Mono',
        bodySize: '18px', bodyLineHeight: '1.75', headingScale: ['3.5rem', '2.25rem', '1.5rem'],
      },
      layout: { maxContentWidth: '1088px', borderRadius: '6px', spacingScale: ['10px', '22px', '44px', '88px'] },
      customCss: '#proiecte-realizate { border-inline-start: 7px solid #234567; }',
    },
    navigation: { items: [sourceLinks[2], sourceLinks[1]] },
    sections: [
      { id: 'proiecte-realizate', type: 'portfolio', heading: 'Proiecte realizate', body: 'Proiectăm locuințe și spații de lucru.',
        items: [{ title: 'Atelierul nostru', body: 'Spațiu pentru echipă', image: sourceImage,
          action: { label: 'Vezi proiectele', href: sourceLinks[1].href } }],
        actions: [], assets: [], layout: { variant: 'grid', columns: 3 } },
      { id: 'despre-atelier', type: 'about', heading: 'Despre atelier', body: 'Proiectăm locuințe și spații de lucru.',
        items: [], actions: [{ label: 'Contactează echipa', href: sourceLinks[2].href }],
        assets: [{ url: sourceImage, alt: 'Atelierul nostru' }], layout: { variant: 'split' } },
      { id: 'proces', type: 'process', heading: 'Discutăm proiectul', body: 'Discută cu echipa despre proiectul tău.',
        items: [], actions: [], assets: [], layout: { variant: 'editorial' } },
    ],
  };
}

function crawlFixture() {
  return {
    site: { rootUrl: pageUrl, origin: new URL(pageUrl).origin, robotsTxt: null, sitemapFound: false, sitemapUrls: [], brokenLinks: [] },
    pages: [{ url: pageUrl, requestedUrl: pageUrl, status: 200, contentType: 'text/html',
      html: `<!doctype html><html lang="ro"><head><title>Atelier de arhitectură</title></head><body>
        <header><nav>${sourceLinks.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')}</nav></header>
        <main><h1>Atelier de arhitectură</h1><p>Proiectăm locuințe și spații de lucru.</p>
        <p>Discută cu echipa despre proiectul tău.</p><img src="${sourceImage}" alt="Atelierul nostru"></main>
      </body></html>`,
      depth: 0, loadMs: 10, sizeBytes: 500, redirectChain: [], links: [], headers: {}, fetchedAt: '2026-01-01T00:00:00Z' }],
  };
}

const report = { scanId: 'design-test', url: pageUrl, findings: [], scores: { overall: 60, seo: 60, accessibility: 60, ux: 60, content: 60 } };

function outputFile(result, name) {
  const file = result.files.find((entry) => entry.path === name);
  assert.ok(file, `Fișierul ${name} trebuie inclus în pachet`);
  return file.fixedContent;
}

test('trimite skill-urile integrale și cheia Google generatorului și păstrează structura propusă', async () => {
  const skills = loadDesignSkills();
  assert.ok(skills.some((skill) => skill.name === 'frontend-design'));
  const response = designResponse();
  let calls = 0;
  const spec = await callAiDesigner(designerInput(), {
    apiKey: 'AIza-test-only',
    generate: async ({ prompt, apiKey, timeoutMs }) => {
      calls++;
      assert.equal(timeoutMs, null);
      assert.equal(apiKey, 'AIza-test-only');
      for (const skill of skills) assert.ok(prompt.includes(skill.content), `Lipsește conținutul skill-ului ${skill.name}`);
      return { data: response, provider: 'gemini:test' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(spec.sections.map((section) => section.id), response.sections.map((section) => section.id));
  assert.deepEqual(spec.sections.map((section) => section.type), ['portfolio', 'about', 'process']);
  assert.equal(spec.sections[0].items[0].title, 'Atelierul nostru');
  assert.equal(spec.sections[1].assets[0].url, sourceImage);
  assert.equal(spec.sections[1].actions[0].href, sourceLinks[2].href);
  assert.deepEqual(spec.navigation.items.slice(0, 2).map((item) => item.href), [sourceLinks[2].href, sourceLinks[1].href]);
  for (const link of sourceLinks) assert.ok(spec.navigation.items.some((item) => item.href === link.href));
});

test('aplică secțiunile, stilurile și conținutul proiectului în HTML și exportul React', async () => {
  const result = await remediateSite(crawlFixture(), report, {
    apiKey: 'AIza-test-only', generate: async () => ({ data: designResponse(), provider: 'gemini:test' }),
  });
  const html = outputFile(result, 'index.html');
  const $ = cheerio.load(html);
  const showcase = $('#mf-ai-showcase');
  assert.equal(showcase.length, 1);
  assert.deepEqual(showcase.find('main section[id]').map((_, el) => $(el).attr('id')).get(), ['proiecte-realizate', 'despre-atelier', 'proces']);
  assert.ok($('#proiecte-realizate').hasClass('mf-section--grid'));
  assert.match($('#proiecte-realizate').attr('style'), /--mf-columns:\s*3(?:;|$)/);
  assert.ok($('#despre-atelier').hasClass('mf-section--split'));
  assert.ok($('#proces').hasClass('mf-section--editorial'));
  assert.ok(showcase.text().includes('Spațiu pentru echipă'));
  assert.ok(showcase.find(`a[href="${sourceLinks[1].href}"]`).length > 0);
  assert.ok(showcase.find(`img[src="${sourceImage}"]`).length > 0);
  assert.doesNotMatch(showcase.text(), /categorii meniu|comandă telefonic|vezi meniul/i);
  const css = outputFile(result, 'marketfixer-fixes.css');
  for (const token of ['1088px', '6px', '18px', '1.75', '3.5rem', '2.25rem', '1.5rem', '44px', 'Archivo', 'Lato']) {
    assert.ok(css.includes(token), `Tokenul ${token} trebuie aplicat în CSS`);
  }
  assert.ok(css.includes(designResponse().design.customCss));
  const jsx = outputFile(result, 'MarketFixerComponents.jsx');
  assert.ok(jsx.includes('proiecte-realizate'));
  assert.ok(jsx.includes('Spațiu pentru echipă'));
  // Un export care include doar specificația și un header nu este o pagină implementată.
  const layoutComponent = jsx.slice(jsx.indexOf('export function AdaptivePageLayout'));
  assert.ok(/<section\b|<main\b|dangerouslySetInnerHTML/.test(layoutComponent));
});

test('acceptă o structură editorială distinctă, fără a reintroduce secțiuni de restaurant', async () => {
  const data = designResponse();
  data.sections = [
    { id: 'cuprins', type: 'table_of_contents', heading: 'Cuprins', items: [], assets: [],
      actions: [{ label: 'Citește ghidul', href: '#ghid' }], layout: { variant: 'stack' } },
    { id: 'ghid', type: 'article', heading: 'Ghid pentru amenajare', body: 'Proiectăm locuințe și spații de lucru.',
      items: [], actions: [], assets: [], layout: { variant: 'editorial' } },
  ];
  const result = await remediateSite(crawlFixture(), report, {
    generate: async () => ({ data, provider: 'gemini:test' }),
  });
  const $ = cheerio.load(outputFile(result, 'index.html'));
  assert.deepEqual($('#mf-ai-showcase main section[id]').map((_, el) => $(el).attr('id')).get(), ['cuprins', 'ghid']);
  assert.equal($('#cuprins a[href="#ghid"]').text(), 'Citește ghidul');
  assert.ok($('#ghid').text().includes('Ghid pentru amenajare'));
});

test('respinge răspunsurile AI invalide și propagă eșecurile, fără fallback ascuns', async () => {
  for (const data of [null, {}, { sections: [] }, { sections: 'invalid' }]) {
    await assert.rejects(callAiDesigner(designerInput(), {
      apiKey: 'AIza-test-only', generate: async () => ({ data, provider: 'gemini:test' }),
    }));
  }
  await assert.rejects(callAiDesigner(designerInput(), {
    apiKey: 'AIza-test-only', generate: async () => { throw new Error('Serviciul Google este indisponibil'); },
  }), /Google|AI|design|gener/i);
});

test('fără cheie produce o variantă neutră bazată pe sursă, fără apeluri externe', async (t) => {
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Nu trebuie apelat API-ul fără cheie'); });
  try {
    const spec = await callAiDesigner(designerInput());
    assert.ok(spec.sections.length > 0);
    assert.doesNotMatch(JSON.stringify(spec), /categorii meniu|experiență culinară|comandă telefonic|vezi meniul/i);
    assert.deepEqual(spec.skillsApplied ?? [], []);
    for (const link of sourceLinks) assert.ok(spec.navigation.items.some((item) => item.href === link.href));
  } finally {
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAi;
  }
});

test('nu transformă textul în HTML și elimină destinațiile sau imaginile neverificate', async () => {
  const data = designResponse();
  data.sections[0].heading = '<img src=x onerror=alert(1)> Proiecte';
  data.sections[0].actions = [
    { label: 'Nesigur', href: 'javascript:alert(1)' },
    { label: 'Inventat', href: 'https://invented.example/checkout' },
    { label: 'Sursă', href: sourceLinks[1].href },
  ];
  data.sections[0].assets = [
    { url: 'https://invented.example/photo.jpg', alt: 'Imagine inventată' },
    { url: sourceImage, alt: 'Atelierul nostru' },
  ];
  const result = await remediateSite(crawlFixture(), report, {
    generate: async () => ({ data, provider: 'gemini:test' }),
  });
  const $ = cheerio.load(outputFile(result, 'index.html'));
  const showcase = $('#mf-ai-showcase');
  assert.equal(showcase.find('[onerror]').length, 0);
  assert.ok(showcase.text().includes('<img src=x onerror=alert(1)> Proiecte'));
  assert.equal(showcase.find('[href^="javascript:"]').length, 0);
  assert.equal(showcase.find('[href*="invented.example"], [src*="invented.example"]').length, 0);
  assert.ok(showcase.find(`a[href="${sourceLinks[1].href}"]`).length > 0);
});

test('exportul React poate fi compilat ca JSX', async (t) => {
  let transform;
  try {
    ({ transform } = createRequire(new URL('../../frontend/package.json', import.meta.url))('esbuild'));
  } catch {
    t.skip('Compilatorul JSX este disponibil după instalarea dependențelor frontend.');
    return;
  }
  const result = await remediateSite(crawlFixture(), report, {
    generate: async () => ({ data: designResponse(), provider: 'gemini:test' }),
  });
  const compiled = await transform(outputFile(result, 'MarketFixerComponents.jsx'), {
    loader: 'jsx', format: 'esm', sourcefile: 'MarketFixerComponents.jsx',
  });
  assert.ok(compiled.code.includes('AdaptivePageLayout'));
});

test('runtime-ul păstrează paginile secundare fără redesign în aspectul original', async () => {
  const crawl = crawlFixture();
  crawl.pages.push({ ...crawl.pages[0], url: `${pageUrl}contact`, requestedUrl: `${pageUrl}contact`,
    html: '<!doctype html><html><head><title>Contact</title><style id="original-style">body{color:green}</style></head><body class="contact-page"><h1>Contact</h1><form><input name="message"><button>Trimite</button></form></body></html>' });
  const result = await remediateSite(crawl, report, {
    generate: async () => ({ data: designResponse(), provider: 'gemini:test' }),
  });
  const dom = new JSDOM(outputFile(result, 'contact.html'), { runScripts: 'outside-only', url: `${pageUrl}contact` });
  try {
    dom.window.eval(outputFile(result, 'marketfixer-patch.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.equal(dom.window.document.getElementById('mf-ai-showcase'), null);
    assert.equal(dom.window.document.body.className, 'contact-page');
    assert.equal(Boolean(dom.window.document.getElementById('original-style').disabled), false);
    assert.equal(dom.window.document.querySelector('h1').textContent, 'Contact');
    assert.equal(dom.window.document.querySelector('form input').name, 'message');
  } finally {
    dom.window.close();
  }
});

test('clientul Google real transmite skill-urile prin cererea generateContent', async (t) => {
  const skills = loadDesignSkills();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.match(new URL(url).pathname, /:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'AIza-integration-test-only');
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;
    for (const skill of skills) assert.ok(prompt.includes(skill.content));
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(designResponse()) }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  const spec = await callAiDesigner(designerInput(), { apiKey: 'AIza-integration-test-only' });
  assert.equal(calls, 1);
  assert.match(spec.provider, /^gemini:/);
  assert.equal(spec.sections[0].id, 'proiecte-realizate');
});
