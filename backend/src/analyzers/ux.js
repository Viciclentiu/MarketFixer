// Reguli UX și arhitectură a informației: adâncime în site, pagini orfane,
// navigație principală (<nav>), CTA pe homepage și texte de link vagi.
import { findHomePage, finding, fold, htmlPages, isHomePage, load, normalizeSpace, normalizeUrl, sameOrigin, snippetOf, truncate } from './utils.js';

export const MAX_RECOMMENDED_DEPTH = 3;
export const MAX_TOP_NAV_LINKS = 10;

const C = 'ux';

const VAGUE_LINK_TEXTS = new Set([
  'click aici',
  'apasati aici',
  'apasa aici',
  'aici',
  'mai mult',
  'mai multe',
  'vezi mai mult',
  'vezi mai multe',
  'citeste mai mult',
  'cititi mai mult',
  'afla mai mult',
  'afla mai multe',
  'detalii',
  'vezi detalii',
  'mai multe detalii',
  'click here',
  'here',
  'read more',
  'more',
  'learn more',
  'link',
]);

const CTA_PATTERNS = /\b(contact(?:eaza|ati)?|cere\s+(?:o\s+)?oferta|solicita\s+(?:o\s+)?oferta|oferta|programeaza|programare|rezerva|rezervare|cumpara|comanda|adauga\s+in\s+cos|inscrie-te|inregistreaza-te|incepe|testeaza|demo| Suna\s+acum|suna-ne|scrie-ne|get\s+started|book\s+now|buy\s+now|contact\s+us|request\s+a\s+quote)\b/i;

function countTopLevelNavLinks($, navEl) {
  const $nav = $(navEl);
  // Dacă există o listă <ul>/<ol>, numărăm itemii de nivel 1
  const topLists = $nav.find('ul, ol').filter((_, ul) => $(ul).parentsUntil(navEl, 'ul, ol').length === 0);
  if (topLists.length > 0) {
    const items = topLists.first().children('li');
    if (items.length > 0) return items.length;
  }
  // Altfel, linkurile care nu sunt în sub-liste
  const topLinks = $nav.find('a[href]').filter((_, a) => $(a).parentsUntil(navEl, 'ul ul, ol ol, [role="menu"]').length === 0);
  return topLinks.length;
}

function hasClearCta($) {
  const candidates = $('a[href], button, input[type="submit"], input[type="button"], [role="button"]').toArray();
  for (const el of candidates) {
    const $el = $(el);
    // Ignorăm linkurile din subsol
    if ($el.closest('footer, [role="contentinfo"]').length) continue;
    const raw = normalizeSpace($el.text() || $el.attr('value') || $el.attr('aria-label') || '');
    const folded = fold(raw);
    const href = ($el.attr('href') || '').trim();
    const cls = `${$el.attr('class') || ''} ${$el.parent().attr('class') || ''}`;
    if (/^(tel:|mailto:)/i.test(href)) return true;
    if (CTA_PATTERNS.test(folded)) return true;
    if (/\b(cta|btn-primary|button-primary|hero-btn)\b/i.test(cls) && folded.length >= 3) return true;
  }
  return false;
}

export function run(crawlResult) {
  const pages = htmlPages(crawlResult);
  const findings = [];
  if (!pages.length) return findings;

  const origin = crawlResult?.site?.origin || crawlResult?.site?.rootUrl || pages[0]?.url || '';

  // ---- 1. Pagini prea adânci (depth > 3)
  const deepPages = pages.filter((p) => Number.isFinite(Number(p.depth)) && Number(p.depth) > MAX_RECOMMENDED_DEPTH);
  for (const page of deepPages) {
    findings.push(finding({
      ruleId: 'ux.depth.too_deep',
      category: C,
      severity: page.depth >= 5 ? 'medium' : 'low',
      pageUrl: page.url,
      title: 'Pagină îngropată prea adânc în structura site-ului',
      evidence: {
        summary: `Pagina se află la ${page.depth} clickuri distanță de pagina principală`,
        value: page.depth,
        expected: `cel mult ${MAX_RECOMMENDED_DEPTH} clickuri de la homepage`,
      },
      whyItMatters: 'Utilizatorii și motoarele de căutare ajung greu la paginile aflate la mai mult de 3 clickuri de pagina principală.',
      recommendation: 'Adaugă linkuri către această pagină din categorii principale, din meniu sau din articole/pagini apropiate de homepage.',
      effort: 'medium',
    }));
  }

  // ---- 2. Pagini orfane (fără niciun link intern primit din altă pagină)
  if (pages.length > 1) {
    const incomingCount = new Map();
    for (const p of pages) {
      const norm = normalizeUrl(p.url);
      if (norm) incomingCount.set(norm, 0);
    }

    for (const p of pages) {
      const fromNorm = normalizeUrl(p.url);
      const seenTargets = new Set();

      // Linkuri raportate de crawler
      const rawLinks = Array.isArray(p.links) ? p.links.map((l) => l?.href) : [];
      // Plus linkurile <a href> din HTML (pentru fixture-uri unde p.links e gol)
      const $ = load(p);
      $('a[href]').each((_, a) => rawLinks.push($(a).attr('href')));

      for (const href of rawLinks) {
        if (!href) continue;
        const targetNorm = normalizeUrl(href, p.url);
        if (!targetNorm || targetNorm === fromNorm) continue;
        if (origin && !sameOrigin(targetNorm, origin)) continue;
        if (seenTargets.has(targetNorm)) continue;
        seenTargets.add(targetNorm);
        if (incomingCount.has(targetNorm)) {
          incomingCount.set(targetNorm, incomingCount.get(targetNorm) + 1);
        }
      }
    }

    for (const p of pages) {
      if (isHomePage(p, crawlResult)) continue;
      const norm = normalizeUrl(p.url);
      if (norm && incomingCount.get(norm) === 0) {
        findings.push(finding({
          ruleId: 'ux.orphan.page',
          category: C,
          severity: 'medium',
          pageUrl: p.url,
          title: 'Pagină orfană (nicio altă pagină nu trimite către ea)',
          evidence: {
            summary: `Nicio pagină analizată nu conține un link intern către ${truncate(p.url, 120)}`,
            value: 0,
            expected: 'cel puțin 1 link intern din altă pagină',
          },
          whyItMatters: 'Paginile orfane nu pot fi descoperite de vizitatori prin navigare normală și primesc foarte puțină autoritate SEO.',
          recommendation: 'Include pagina în meniul relevant, într-o pagină de categorie sau adaugă linkuri contextuale din alte pagini.',
          effort: 'low',
        }));
      }
    }
  }

  // ---- 3. Meniu <nav> și linkuri vagi pe fiecare pagină
  const pagesWithoutNav = [];
  for (const page of pages) {
    const $ = load(page);
    const navs = $('nav, [role="navigation"]');
    if (navs.length === 0) {
      pagesWithoutNav.push(page.url);
    } else {
      const primaryNav = navs.first();
      const topCount = countTopLevelNavLinks($, primaryNav.get(0));
      if (topCount > MAX_TOP_NAV_LINKS) {
        findings.push(finding({
          ruleId: 'ux.nav.overloaded',
          category: C,
          severity: 'low',
          pageUrl: page.url,
          title: 'Meniul principal are prea multe opțiuni de nivel 1',
          evidence: {
            summary: `Meniul <nav> conține ${topCount} elemente de nivel 1`,
            snippet: snippetOf($, primaryNav.get(0), 250),
            value: topCount,
            expected: `5–${MAX_TOP_NAV_LINKS} opțiuni principale`,
          },
          whyItMatters: 'Un meniu supraîncărcat îngreunează alegerea rapidă (paradoxul alegerii) și ocupă prea mult spațiu pe mobil.',
          recommendation: `Grupează paginile secundare în submeniuri sau mută linkurile administrative (Termeni, Politici) în subsol, păstrând cel mult ${MAX_TOP_NAV_LINKS} categorii principale.`,
          effort: 'medium',
        }));
      }
    }

    // ---- 5. Texte de link vagi
    const vagueEls = [];
    $('a[href]').each((_, el) => {
      const $el = $(el);
      const text = normalizeSpace($el.text());
      if (!text) return;
      const folded = fold(text).replace(/[.!?>»→›]+$/g, '').trim();
      if (VAGUE_LINK_TEXTS.has(folded)) {
        vagueEls.push({ el, text });
      }
    });

    if (vagueEls.length > 0) {
      const examples = [...new Set(vagueEls.slice(0, 4).map((v) => `„${v.text}”`))].join(', ');
      findings.push(finding({
        ruleId: 'ux.links.vague_text',
        category: C,
        severity: vagueEls.length >= 3 ? 'medium' : 'low',
        pageUrl: page.url,
        title: 'Linkuri cu text vag („click aici”, „mai mult”, „detalii”)',
        evidence: {
          summary: `${vagueEls.length} link(uri) folosesc formulări generice (${examples})`,
          snippet: snippetOf($, vagueEls[0].el),
          value: vagueEls.length,
          expected: 'text de ancoră descriptiv (ex: „Vezi tarifele de consultanță”)',
        },
        whyItMatters: 'Utilizatorii care scanează vizual pagina nu înțeleg unde duce linkul fără să citească tot paragraful, iar motoarele de căutare pierd contextul despre pagina țintă.',
        recommendation: 'Înlocuiește textele „click aici” / „detalii” cu destinația concretă a linkului (ex: „Descarcă ghidul PDF”, „Vezi portofoliul de proiecte”).',
        effort: 'low',
      }));
    }
  }

  if (pagesWithoutNav.length > 0) {
    findings.push(finding({
      ruleId: 'ux.nav.missing',
      category: C,
      severity: 'medium',
      pageUrl: pagesWithoutNav.length === 1 ? pagesWithoutNav[0] : null,
      affectedPages: pagesWithoutNav,
      title: 'Lipsește elementul de navigare (<nav>)',
      evidence: {
        summary: `${pagesWithoutNav.length} din ${pages.length} pagini nu au niciun element <nav> sau role="navigation"`,
        value: pagesWithoutNav.length,
        expected: 'element <nav> cu meniul principal pe fiecare pagină',
      },
      whyItMatters: 'Fără un meniu clar marcat în <nav>, vizitatorii se orientează greu în site, iar tehnologiile asistive nu pot identifica navigația.',
      recommendation: 'Adaugă un meniu principal încadrat în eticheta semantică <nav> în antetul tuturor paginilor.',
      effort: 'medium',
    }));
  }

  // ---- 4. Lipsa unui CTA clar pe homepage
  const home = findHomePage(crawlResult);
  if (home) {
    const $home = load(home);
    if (!hasClearCta($home)) {
      findings.push(finding({
        ruleId: 'ux.cta.missing_on_home',
        category: C,
        severity: 'high',
        pageUrl: home.url,
        title: 'Pagina principală nu are un îndemn la acțiune (CTA) clar',
        evidence: {
          summary: 'Nu am identificat niciun buton sau link de tip CTA (ex: „Contact”, „Cere ofertă”, „Programează”, număr de telefon apelabil) pe homepage',
          expected: 'buton sau link vizibil cu acțiunea principală dorită de la vizitator',
        },
        whyItMatters: 'Dacă vizitatorul nu vede imediat care este următorul pas (să ceară o ofertă, să sune, să comande), rata de conversie scade drastic.',
        recommendation: 'Adaugă în prima secțiune a paginii principale (hero) și în meniu un buton vizibil cu un verb de acțiune clar (ex: „Cere o ofertă gratuită”, „Programează o discuție”).',
        effort: 'low',
      }));
    }
  }

  return findings;
}
