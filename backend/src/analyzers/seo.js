// Reguli SEO on-page: title, meta description, h1, ierarhie headings, canonical, noindex, alt, Open Graph.
import { finding, htmlPages, load, normalizeSpace, normalizeUrl, sameOrigin, snippetOf, truncate, isHomePage } from './utils.js';

export const TITLE_MIN = 30;
export const TITLE_MAX = 60;
export const DESC_MIN = 70;
export const DESC_MAX = 160;

const C = 'seo';

export function run(crawlResult) {
  const pages = htmlPages(crawlResult);
  const findings = [];
  const titles = new Map(); // titlu normalizat -> { text, pages[] }
  const descs = new Map();
  const ogMissing = { 'og:title': [], 'og:description': [], 'og:image': [] };
  const crawledStatus = new Map(
    (crawlResult?.pages ?? []).map((p) => [normalizeUrl(p.url), p.status]),
  );
  const broken = new Set((crawlResult?.site?.brokenLinks ?? []).map((b) => normalizeUrl(b.url)));

  for (const page of pages) {
    const $ = load(page);
    const url = page.url;

    // ---- Title
    const titleEls = $('head title').length ? $('head title') : $('title');
    const title = normalizeSpace(titleEls.first().text());
    if (!title) {
      findings.push(finding({
        ruleId: 'seo.title.missing', category: C, severity: 'high', pageUrl: url,
        title: 'Pagina nu are titlu (<title>)',
        evidence: { summary: titleEls.length ? 'Elementul <title> există, dar este gol' : 'Nu există niciun element <title> în <head>', snippet: titleEls.length ? snippetOf($, titleEls.get(0)) : undefined, expected: `${TITLE_MIN}–${TITLE_MAX} caractere` },
        whyItMatters: 'Titlul este textul principal afișat în rezultatele Google și în tab-ul browserului. Fără el, motorul de căutare îl generează singur, de obicei prost.',
        recommendation: `Adaugă un <title> unic de ${TITLE_MIN}–${TITLE_MAX} caractere care descrie pagina și include cuvântul-cheie principal (ex: „Serviciu – Oraș | Nume firmă”).`,
        effort: 'low',
      }));
    } else {
      const len = [...title].length;
      if (len < TITLE_MIN) {
        findings.push(finding({
          ruleId: 'seo.title.too_short', category: C, severity: 'medium', pageUrl: url,
          title: 'Titlul paginii este prea scurt',
          evidence: { summary: `Titlul are ${len} caractere`, snippet: title, value: len, expected: `${TITLE_MIN}–${TITLE_MAX} caractere` },
          whyItMatters: 'Un titlu foarte scurt nu spune nici utilizatorului, nici motorului de căutare despre ce este pagina și irosește spațiul din rezultate.',
          recommendation: 'Extinde titlul cu serviciul/produsul principal, localitatea (dacă e relevantă) și numele firmei.',
          effort: 'low',
        }));
      } else if (len > TITLE_MAX) {
        findings.push(finding({
          ruleId: 'seo.title.too_long', category: C, severity: 'medium', pageUrl: url,
          title: 'Titlul paginii este prea lung',
          evidence: { summary: `Titlul are ${len} caractere și va fi trunchiat în Google`, snippet: title, value: len, expected: `${TITLE_MIN}–${TITLE_MAX} caractere` },
          whyItMatters: 'Google afișează aproximativ 60 de caractere. Restul este tăiat, iar informația importantă de la final se pierde.',
          recommendation: `Scurtează titlul la maximum ${TITLE_MAX} de caractere și pune cuvintele importante la început.`,
          effort: 'low',
        }));
      }
      const key = title.toLowerCase();
      if (!titles.has(key)) titles.set(key, { text: title, pages: [] });
      titles.get(key).pages.push(url);
    }

    // ---- Meta description
    const descEl = $('meta[name="description" i]').first();
    const desc = normalizeSpace(descEl.attr('content'));
    if (!desc) {
      findings.push(finding({
        ruleId: 'seo.meta_description.missing', category: C, severity: 'medium', pageUrl: url,
        title: 'Lipsește meta description',
        evidence: { summary: descEl.length ? 'Meta description există, dar este goală' : 'Nu există <meta name="description">', snippet: descEl.length ? snippetOf($, descEl.get(0)) : undefined, expected: `${DESC_MIN}–${DESC_MAX} caractere` },
        whyItMatters: 'Descrierea apare adesea sub titlu în rezultatele de căutare și influențează dacă oamenii dau click.',
        recommendation: `Scrie o descriere unică de ${DESC_MIN}–${DESC_MAX} caractere care rezumă beneficiul paginii și se încheie cu un îndemn (ex: „Cere o ofertă gratuită”).`,
        effort: 'low',
      }));
    } else {
      const len = [...desc].length;
      if (len < DESC_MIN || len > DESC_MAX) {
        const short = len < DESC_MIN;
        findings.push(finding({
          ruleId: short ? 'seo.meta_description.too_short' : 'seo.meta_description.too_long', category: C, severity: 'low', pageUrl: url,
          title: short ? 'Meta description este prea scurtă' : 'Meta description este prea lungă',
          evidence: { summary: `Descrierea are ${len} caractere`, snippet: desc, value: len, expected: `${DESC_MIN}–${DESC_MAX} caractere` },
          whyItMatters: short
            ? 'O descriere prea scurtă nu convinge și Google o poate înlocui cu un fragment aleatoriu din pagină.'
            : 'Textul peste ~160 de caractere este trunchiat în rezultate, iar mesajul se pierde.',
          recommendation: `Rescrie descrierea la ${DESC_MIN}–${DESC_MAX} caractere, cu beneficiul principal la început.`,
          effort: 'low',
        }));
      }
      const key = desc.toLowerCase();
      if (!descs.has(key)) descs.set(key, { text: desc, pages: [] });
      descs.get(key).pages.push(url);
    }

    // ---- H1
    const h1s = $('h1');
    if (h1s.length === 0) {
      findings.push(finding({
        ruleId: 'seo.h1.missing', category: C, severity: 'medium', pageUrl: url,
        title: 'Pagina nu are titlu principal (h1)',
        evidence: { summary: 'Nu există niciun element <h1> pe pagină', value: 0, expected: 'exact 1 element <h1>' },
        whyItMatters: 'H1 le spune vizitatorilor și motoarelor de căutare care este subiectul principal al paginii.',
        recommendation: 'Adaugă un singur <h1> vizibil la începutul conținutului, care descrie clar pagina.',
        effort: 'low',
      }));
    } else if (h1s.length > 1) {
      const texts = h1s.toArray().map((el) => `<h1>${truncate($(el).text(), 60)}</h1>`).slice(0, 4).join(' ');
      findings.push(finding({
        ruleId: 'seo.h1.multiple', category: C, severity: 'low', pageUrl: url,
        title: 'Pagina are mai multe titluri h1',
        evidence: { summary: `Pagina are ${h1s.length} elemente <h1>`, snippet: texts, value: h1s.length, expected: 'exact 1 element <h1>' },
        whyItMatters: 'Mai multe h1 diluează subiectul principal și fac structura paginii mai greu de înțeles.',
        recommendation: 'Păstrează un singur <h1> pentru subiectul principal și transformă celelalte în <h2>.',
        effort: 'low',
      }));
    }

    // ---- Ierarhia headings
    const headings = $('h1,h2,h3,h4,h5,h6').toArray();
    let prev = 0;
    const skips = [];
    for (const el of headings) {
      const level = Number((el.tagName || el.name).slice(1));
      if (prev > 0 && level > prev + 1) skips.push({ from: prev, to: level, el });
      prev = level;
    }
    if (skips.length) {
      const first = skips[0];
      findings.push(finding({
        ruleId: 'seo.headings.skipped_level', category: C, severity: 'low', pageUrl: url,
        title: 'Ierarhia titlurilor sare peste niveluri',
        evidence: {
          summary: `${skips.length} salt(uri) de nivel; primul: h${first.from} → h${first.to}`,
          snippet: snippetOf($, first.el, 200),
          value: skips.length,
          expected: 'niveluri consecutive (h1 → h2 → h3)',
        },
        whyItMatters: 'O structură logică de titluri ajută motoarele de căutare și cititoarele de ecran să înțeleagă organizarea conținutului.',
        recommendation: `Folosește niveluri consecutive: după h${first.from} urmează h${first.from + 1}. Stilul vizual se schimbă din CSS, nu prin nivelul titlului.`,
        effort: 'low',
      }));
    }

    // ---- Canonical
    const canonEls = $('link[rel~="canonical" i]');
    if (canonEls.length === 0) {
      findings.push(finding({
        ruleId: 'seo.canonical.missing', category: C, severity: 'low', pageUrl: url,
        title: 'Lipsește URL-ul canonic',
        evidence: { summary: 'Nu există <link rel="canonical"> în pagină', expected: `<link rel="canonical" href="${truncate(url, 120)}">` },
        whyItMatters: 'Fără canonical, variantele aceleiași pagini (cu parametri, cu/fără www) pot concura între ele în Google.',
        recommendation: 'Adaugă în <head> un <link rel="canonical"> care indică URL-ul absolut preferat al paginii.',
        effort: 'low',
      }));
    } else if (canonEls.length > 1) {
      findings.push(finding({
        ruleId: 'seo.canonical.multiple', category: C, severity: 'medium', pageUrl: url,
        title: 'Pagina are mai multe URL-uri canonice',
        evidence: { summary: `Pagina are ${canonEls.length} elemente rel="canonical"`, snippet: canonEls.toArray().map((el) => snippetOf($, el, 140)).join(' '), value: canonEls.length, expected: 'un singur canonical' },
        whyItMatters: 'Când există mai multe canonical-uri, Google le ignoră pe toate.',
        recommendation: 'Păstrează un singur <link rel="canonical"> (verifică dacă tema și un plugin SEO îl adaugă amândouă).',
        effort: 'low',
      }));
    } else {
      const href = normalizeSpace(canonEls.first().attr('href'));
      const snippet = snippetOf($, canonEls.get(0));
      const abs = href ? normalizeUrl(href, url) : null;
      let problem = null;
      if (!abs) problem = { detail: 'invalid', summary: 'Atributul href al canonical lipsește sau nu este un URL valid' };
      else if (!sameOrigin(abs, url)) problem = { detail: 'cross_domain', summary: `Canonical indică alt domeniu: ${truncate(abs, 120)}` };
      else if (broken.has(abs) || (crawledStatus.has(abs) && crawledStatus.get(abs) >= 400)) {
        problem = { detail: 'broken', summary: `Canonical indică o pagină care răspunde cu eroare: ${truncate(abs, 120)}` };
      } else if (abs.startsWith('http:') && url.startsWith('https:')) {
        problem = { detail: 'http', summary: 'Canonical indică varianta HTTP a unei pagini servite pe HTTPS' };
      }
      if (problem) {
        findings.push(finding({
          ruleId: 'seo.canonical.invalid', category: C, severity: problem.detail === 'broken' ? 'high' : 'medium', pageUrl: url, detail: problem.detail,
          title: 'URL-ul canonic este greșit',
          evidence: { summary: problem.summary, snippet, value: href || '(gol)', expected: 'URL absolut, pe același domeniu, care răspunde cu 200' },
          whyItMatters: 'Un canonical greșit îi spune lui Google să indexeze altă pagină decât cea dorită, iar pagina curentă poate dispărea din rezultate.',
          recommendation: 'Corectează href-ul canonical astfel încât să indice URL-ul HTTPS valid al paginii (de obicei chiar URL-ul ei).',
          effort: 'low',
        }));
      }
    }

    // ---- Noindex (meta robots sau X-Robots-Tag)
    const robotsMeta = $('meta[name="robots" i], meta[name="googlebot" i]').toArray().find((el) => /noindex|none/i.test($(el).attr('content') || ''));
    const headerKey = Object.keys(page.headers || {}).find((k) => k.toLowerCase() === 'x-robots-tag');
    const headerVal = headerKey ? String(page.headers[headerKey]) : '';
    if (robotsMeta || /noindex|none/i.test(headerVal)) {
      const home = isHomePage(page, crawlResult);
      findings.push(finding({
        ruleId: 'seo.noindex', category: C, severity: home ? 'critical' : 'high', pageUrl: url,
        title: home ? 'Pagina principală este blocată de la indexare (noindex)' : 'Pagina este blocată de la indexare (noindex)',
        evidence: {
          summary: robotsMeta ? 'Meta robots conține „noindex”' : `Header-ul X-Robots-Tag conține „${truncate(headerVal, 60)}”`,
          snippet: robotsMeta ? snippetOf($, robotsMeta) : `X-Robots-Tag: ${headerVal}`,
        },
        whyItMatters: 'Paginile cu noindex nu apar deloc în Google. Dacă e o pagină importantă, pierzi tot traficul organic către ea.',
        recommendation: 'Dacă pagina trebuie să apară în căutări, elimină „noindex” din meta robots / X-Robots-Tag (verifică setările de vizibilitate din CMS).',
        effort: 'low',
      }));
    }

    // ---- Alt lipsă pe imagini
    const noAlt = $('img').toArray().filter((el) => {
      const $el = $(el);
      if ($el.attr('alt') !== undefined) return false;
      if (/^(presentation|none)$/i.test($el.attr('role') || '')) return false;
      if ($el.attr('aria-hidden') === 'true') return false;
      return true;
    });
    if (noAlt.length) {
      const total = $('img').length;
      findings.push(finding({
        ruleId: 'seo.img.alt_missing', category: C, severity: noAlt.length >= 5 ? 'medium' : 'low', pageUrl: url,
        title: 'Imagini fără text alternativ (alt)',
        evidence: { summary: `${noAlt.length} din ${total} imagini nu au atributul alt`, snippet: snippetOf($, noAlt[0]), value: noAlt.length, expected: 'alt descriptiv pe imaginile cu conținut; alt="" pe cele decorative' },
        whyItMatters: 'Google folosește textul alt pentru a înțelege imaginile (inclusiv în Google Imagini), iar persoanele nevăzătoare depind de el.',
        recommendation: 'Adaugă alt descriptiv (ce arată imaginea, în context) pe fiecare imagine cu conținut și alt="" pe cele pur decorative.',
        effort: noAlt.length > 15 ? 'medium' : 'low',
      }));
    }

    // ---- Open Graph (agregat la nivel de site)
    for (const prop of Object.keys(ogMissing)) {
      const v = $(`meta[property="${prop}"]`).attr('content');
      if (!normalizeSpace(v)) ogMissing[prop].push(url);
    }
  }

  // ---- Duplicate (agregate)
  for (const { text, pages: dupPages } of titles.values()) {
    if (dupPages.length < 2) continue;
    findings.push(finding({
      ruleId: 'seo.title.duplicate', category: C, severity: 'medium', pageUrl: null, detail: text.toLowerCase().slice(0, 80), affectedPages: dupPages,
      title: 'Același titlu pe mai multe pagini',
      evidence: { summary: `${dupPages.length} pagini au exact același titlu`, snippet: text, value: dupPages.length, expected: 'titlu unic pe fiecare pagină' },
      whyItMatters: 'Titlurile identice fac paginile să concureze între ele și îngreunează alegerea rezultatului potrivit în Google.',
      recommendation: 'Scrie un titlu unic pentru fiecare pagină, care reflectă conținutul ei specific.',
      effort: dupPages.length > 5 ? 'medium' : 'low',
    }));
  }
  for (const { text, pages: dupPages } of descs.values()) {
    if (dupPages.length < 2) continue;
    findings.push(finding({
      ruleId: 'seo.meta_description.duplicate', category: C, severity: 'low', pageUrl: null, detail: text.toLowerCase().slice(0, 80), affectedPages: dupPages,
      title: 'Aceeași meta description pe mai multe pagini',
      evidence: { summary: `${dupPages.length} pagini au exact aceeași descriere`, snippet: text, value: dupPages.length, expected: 'descriere unică pe fiecare pagină' },
      whyItMatters: 'Descrierile duplicate nu ajută utilizatorul să aleagă pagina potrivită, iar Google tinde să le ignore.',
      recommendation: 'Scrie o descriere unică pentru fiecare pagină, care rezumă conținutul ei specific.',
      effort: dupPages.length > 5 ? 'medium' : 'low',
    }));
  }

  for (const [prop, missing] of Object.entries(ogMissing)) {
    if (!missing.length) continue;
    findings.push(finding({
      ruleId: 'seo.opengraph.missing', category: C, severity: 'low', pageUrl: null, detail: prop, affectedPages: missing,
      title: `Lipsește eticheta Open Graph ${prop}`,
      evidence: { summary: `${missing.length} din ${pages.length} pagini nu au <meta property="${prop}">`, value: missing.length, expected: `<meta property="${prop}" content="…">` },
      whyItMatters: 'Etichetele Open Graph controlează cum arată linkul când e distribuit pe Facebook, LinkedIn sau WhatsApp. Fără ele, previzualizarea poate fi goală sau greșită.',
      recommendation: `Adaugă <meta property="${prop}"> pe fiecare pagină (majoritatea pluginurilor SEO o fac automat)${prop === 'og:image' ? ', cu o imagine de cel puțin 1200×630 px' : ''}.`,
      effort: 'low',
    }));
  }

  return findings;
}
