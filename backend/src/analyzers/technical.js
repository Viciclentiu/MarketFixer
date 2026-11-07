// Reguli tehnice: robots.txt, sitemap, linkuri rupte, coduri de status, redirecturi,
// viewport, lang, viteză, greutate, HTTPS și mixed content.
import { finding, htmlPages, isHtmlPage, load, normalizeUrl, sameOrigin, snippetOf, truncate } from './utils.js';

export const SLOW_MS = 3000;
export const VERY_SLOW_MS = 6000;
export const HEAVY_BYTES = 500 * 1024;
export const VERY_HEAVY_BYTES = 1.5 * 1024 * 1024;

const C = 'technical';

function kb(bytes) {
  return `${Math.round(bytes / 1024)} KB`;
}

/** Verifică dacă robots.txt blochează tot site-ul pentru User-agent: *. */
export function robotsBlocksAll(robotsTxt) {
  if (!robotsTxt) return false;
  let inStar = false;
  let groupHasRules = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (groupHasRules) { inStar = false; groupHasRules = false; }
      if (val === '*') inStar = true;
    } else {
      groupHasRules = true;
      if (inStar && key === 'disallow' && val === '/') return true;
    }
  }
  return false;
}

export function run(crawlResult) {
  const site = crawlResult?.site ?? {};
  const allPages = crawlResult?.pages ?? [];
  const pages = htmlPages(crawlResult);
  const findings = [];
  const origin = site.origin || site.rootUrl || allPages[0]?.url || '';

  // ---- robots.txt
  if (site.robotsTxt == null) {
    findings.push(finding({
      ruleId: 'technical.robots.missing', category: C, severity: 'medium',
      title: 'Lipsește fișierul robots.txt',
      evidence: { summary: `Nu am găsit ${truncate(origin, 80)}/robots.txt`, expected: 'fișier robots.txt la rădăcina domeniului' },
      whyItMatters: 'robots.txt le spune motoarelor de căutare ce pot accesa și unde găsesc sitemap-ul. Lipsa lui generează erori în Google Search Console.',
      recommendation: 'Creează un fișier robots.txt la rădăcina site-ului, cu cel puțin „User-agent: *”, „Allow: /” și linia „Sitemap: <URL sitemap>”.',
      effort: 'low',
    }));
  } else if (robotsBlocksAll(site.robotsTxt)) {
    findings.push(finding({
      ruleId: 'technical.robots.blocks_all', category: C, severity: 'critical',
      title: 'robots.txt blochează tot site-ul',
      evidence: { summary: 'robots.txt conține „Disallow: /” pentru User-agent: *', snippet: truncate(site.robotsTxt, 300) },
      whyItMatters: 'Cu această regulă, Google nu are voie să acceseze nicio pagină, deci site-ul dispare treptat din căutări.',
      recommendation: 'Elimină „Disallow: /” din grupul „User-agent: *” (de obicei rămâne activ după lansarea unui site de test).',
      effort: 'low',
    }));
  }

  // ---- sitemap
  if (!site.sitemapFound) {
    findings.push(finding({
      ruleId: 'technical.sitemap.missing', category: C, severity: 'medium',
      title: 'Lipsește sitemap-ul XML',
      evidence: { summary: 'Nu am găsit un sitemap.xml (nici la adresa standard, nici în robots.txt)', expected: '/sitemap.xml cu toate paginile indexabile' },
      whyItMatters: 'Sitemap-ul ajută motoarele de căutare să descopere rapid toate paginile, mai ales pe cele noi sau slab legate intern.',
      recommendation: 'Generează un sitemap.xml (din CMS sau dintr-un plugin SEO), adaugă-l în robots.txt și trimite-l în Google Search Console.',
      effort: 'low',
    }));
  } else if (site.robotsTxt && !/^\s*sitemap\s*:/im.test(site.robotsTxt)) {
    findings.push(finding({
      ruleId: 'technical.sitemap.not_in_robots', category: C, severity: 'low',
      title: 'Sitemap-ul nu este declarat în robots.txt',
      evidence: { summary: 'robots.txt nu conține nicio linie „Sitemap:”', snippet: truncate(site.robotsTxt, 200) },
      whyItMatters: 'Declararea sitemap-ului în robots.txt îl face vizibil pentru toate motoarele de căutare, nu doar pentru cele unde l-ai trimis manual.',
      recommendation: 'Adaugă în robots.txt linia „Sitemap: https://domeniul-tau/sitemap.xml”.',
      effort: 'low',
    }));
  }

  // ---- Linkuri rupte (grupate după URL-ul țintă)
  const brokenByUrl = new Map();
  for (const b of site.brokenLinks ?? []) {
    if (!b?.url) continue;
    if (!brokenByUrl.has(b.url)) brokenByUrl.set(b.url, { ...b, foundOnAll: [] });
    if (b.foundOn) brokenByUrl.get(b.url).foundOnAll.push(b.foundOn);
  }
  for (const [url, b] of brokenByUrl) {
    const internal = origin ? sameOrigin(url, origin) : true;
    const statusTxt = b.status ? `status ${b.status}` : `eroare: ${b.error || 'fără răspuns'}`;
    findings.push(finding({
      ruleId: 'technical.links.broken', category: C, severity: internal ? 'high' : 'medium',
      pageUrl: b.foundOnAll[0] ?? null, detail: url, affectedPages: b.foundOnAll,
      title: internal ? 'Link intern rupt' : 'Link extern rupt',
      evidence: { summary: `Linkul către ${truncate(url, 150)} răspunde cu ${statusTxt} (apare pe ${b.foundOnAll.length || 1} pagină/pagini)`, snippet: url, value: b.status ?? (b.error || 'fără răspuns') },
      whyItMatters: 'Linkurile rupte frustrează vizitatorii, irosesc bugetul de crawl și transmit un semnal de site neîngrijit.',
      recommendation: internal
        ? 'Corectează linkul către pagina existentă sau pune un redirect 301 de la vechiul URL către cel nou.'
        : 'Actualizează sau elimină linkul extern care nu mai funcționează.',
      effort: 'low',
    }));
  }

  // ---- Status 4xx / 5xx pe paginile crawl-uite
  for (const p of allPages) {
    const s = Number(p.status);
    if (!(s >= 400)) continue;
    const is5 = s >= 500;
    findings.push(finding({
      ruleId: is5 ? 'technical.status.5xx' : 'technical.status.4xx', category: C, severity: is5 ? 'critical' : 'high', pageUrl: p.url,
      title: is5 ? 'Pagina returnează o eroare de server (5xx)' : 'Pagina returnează o eroare (4xx)',
      evidence: { summary: `Răspuns HTTP ${s} pentru ${truncate(p.url, 150)}`, value: s, expected: '200' },
      whyItMatters: is5
        ? 'Erorile de server fac pagina inaccesibilă pentru vizitatori și Google. Dacă persistă, pagina este scoasă din index.'
        : 'Paginile inexistente la care trimit linkuri interne înseamnă vizitatori pierduți și semnale negative pentru SEO.',
      recommendation: is5
        ? 'Verifică logurile serverului pentru această pagină și remediază eroarea (plugin defect, limită de memorie, bază de date).'
        : 'Restaurează pagina sau redirecționează (301) URL-ul către cea mai apropiată pagină existentă și actualizează linkurile interne.',
      effort: is5 ? 'medium' : 'low',
    }));
  }

  // ---- Lanțuri de redirect
  for (const p of allPages) {
    const chain = Array.isArray(p.redirectChain) ? p.redirectChain : [];
    const finalN = normalizeUrl(p.url);
    const hops = [...new Set(chain.map((u) => normalizeUrl(u) ?? u))].filter((u) => u && u !== finalN);
    if (hops.length < 2) continue;
    const path = [...hops, finalN].map((u) => truncate(u, 80)).join(' → ');
    findings.push(finding({
      ruleId: 'technical.redirect.chain', category: C, severity: hops.length >= 3 ? 'high' : 'medium', pageUrl: p.url,
      title: 'Lanț de redirecturi',
      evidence: { summary: `Pagina este atinsă după ${hops.length} redirecturi succesive`, snippet: path, value: hops.length, expected: 'cel mult 1 redirect' },
      whyItMatters: 'Fiecare redirect suplimentar încetinește încărcarea și poate face Google să renunțe la urmărirea linkului.',
      recommendation: `Redirecționează direct (301) URL-ul inițial către ${truncate(p.url, 120)} și actualizează linkurile interne să indice URL-ul final.`,
      effort: 'low',
    }));
  }

  // ---- HTTPS la nivel de site
  const rootIsHttp = /^http:/i.test(site.rootUrl || origin || '');
  if (rootIsHttp) {
    findings.push(finding({
      ruleId: 'technical.https.missing', category: C, severity: 'critical',
      title: 'Site-ul nu folosește HTTPS',
      evidence: { summary: `Site-ul este servit pe HTTP: ${truncate(site.rootUrl || origin, 120)}`, value: site.rootUrl || origin, expected: 'https://' },
      whyItMatters: 'Browserele marchează site-urile HTTP ca „Nesigur”, ceea ce alungă vizitatorii; HTTPS este și un factor de clasare Google.',
      recommendation: 'Instalează un certificat SSL (gratuit prin Let’s Encrypt sau din panoul de hosting) și redirecționează permanent (301) tot traficul HTTP către HTTPS.',
      effort: 'medium',
    }));
  }

  for (const page of pages) {
    const $ = load(page);
    const url = page.url;

    if (!rootIsHttp && /^http:/i.test(url)) {
      findings.push(finding({
        ruleId: 'technical.https.page_http', category: C, severity: 'high', pageUrl: url,
        title: 'Pagină servită pe HTTP',
        evidence: { summary: `Pagina este accesibilă doar pe HTTP: ${truncate(url, 150)}`, value: url, expected: 'https://' },
        whyItMatters: 'Paginile HTTP sunt marcate „Nesigur” de browser și pot fi interceptate sau modificate.',
        recommendation: 'Redirecționează (301) această pagină către varianta HTTPS și actualizează linkurile interne.',
        effort: 'low',
      }));
    }

    // Viewport
    const vp = $('meta[name="viewport" i]').first();
    if (!vp.length || !/width\s*=/i.test(vp.attr('content') || '')) {
      findings.push(finding({
        ruleId: 'technical.viewport.missing', category: C, severity: 'high', pageUrl: url,
        title: 'Lipsește meta viewport (pagina nu e adaptată pentru mobil)',
        evidence: { summary: vp.length ? 'Meta viewport există, dar nu definește width' : 'Nu există <meta name="viewport">', snippet: vp.length ? snippetOf($, vp.get(0)) : undefined, expected: '<meta name="viewport" content="width=device-width, initial-scale=1">' },
        whyItMatters: 'Fără viewport, pe telefon pagina apare micșorată și greu de folosit. Google indexează în primul rând versiunea mobilă.',
        recommendation: 'Adaugă în <head>: <meta name="viewport" content="width=device-width, initial-scale=1">.',
        effort: 'low',
      }));
    }

    // Lang
    const lang = ($('html').attr('lang') || '').trim();
    if (!lang) {
      findings.push(finding({
        ruleId: 'technical.lang.missing', category: C, severity: 'medium', pageUrl: url,
        title: 'Limba paginii nu este declarată',
        evidence: { summary: 'Elementul <html> nu are atributul lang', snippet: truncate(page.html.match(/<html[^>]*>/i)?.[0] ?? '(fără tag <html> explicit)', 120), expected: '<html lang="ro">' },
        whyItMatters: 'Atributul lang ajută cititoarele de ecran să pronunțe corect textul și motoarele de căutare să servească pagina publicului potrivit.',
        recommendation: 'Adaugă lang="ro" (sau limba corectă) pe elementul <html>.',
        effort: 'low',
      }));
    }

    // Mixed content
    if (/^https:/i.test(url)) {
      const active = [];
      const passive = [];
      $('script[src], link[rel~="stylesheet" i][href], iframe[src], object[data], embed[src]').each((_, el) => {
        const v = $(el).attr('src') || $(el).attr('href') || $(el).attr('data') || '';
        if (/^http:\/\//i.test(v.trim())) active.push(el);
      });
      $('img[src], audio[src], video[src], source[src], img[srcset], source[srcset]').each((_, el) => {
        const v = `${$(el).attr('src') || ''} ${$(el).attr('srcset') || ''}`;
        if (/(^|\s|,)http:\/\//i.test(v)) passive.push(el);
      });
      if (active.length || passive.length) {
        const first = active[0] ?? passive[0];
        findings.push(finding({
          ruleId: 'technical.mixed_content', category: C, severity: active.length ? 'high' : 'medium', pageUrl: url,
          title: 'Conținut mixt (resurse HTTP pe o pagină HTTPS)',
          evidence: { summary: `${active.length} resurse active (script/CSS/iframe) și ${passive.length} resurse pasive (imagini/media) se încarcă prin HTTP`, snippet: snippetOf($, first), value: active.length + passive.length, expected: 'toate resursele prin https://' },
          whyItMatters: active.length
            ? 'Browserele blochează scripturile și stilurile încărcate prin HTTP, deci pagina se poate afișa sau funcționa greșit; în plus, lacătul de securitate dispare.'
            : 'Resursele HTTP elimină lacătul de securitate din browser și pot fi blocate în viitor.',
          recommendation: 'Schimbă adresele resurselor în https:// (sau în adrese relative) și verifică dacă furnizorul le oferă prin HTTPS.',
          effort: 'low',
        }));
      }
    }
  }

  // ---- Viteză și greutate (doar paginile HTML cu răspuns 2xx)
  for (const page of pages) {
    const ms = Number(page.loadMs);
    if (Number.isFinite(ms) && ms > SLOW_MS) {
      const very = ms > VERY_SLOW_MS;
      findings.push(finding({
        ruleId: 'technical.page.slow', category: C, severity: very ? 'high' : 'medium', pageUrl: page.url,
        title: 'Pagina se încarcă lent',
        evidence: { summary: `Documentul HTML a fost primit complet în ${(ms / 1000).toFixed(1)} s`, value: Math.round(ms), expected: `sub ${SLOW_MS / 1000} s` },
        whyItMatters: 'Vizitatorii abandonează paginile lente, mai ales pe mobil; viteza este și un factor de clasare (Core Web Vitals).',
        recommendation: 'Activează cache-ul paginilor (plugin de cache / CDN), verifică timpul de răspuns al serverului și ia în calcul un hosting mai performant.',
        effort: 'medium',
      }));
    }
    const size = Number(page.sizeBytes);
    if (Number.isFinite(size) && size > HEAVY_BYTES) {
      const very = size > VERY_HEAVY_BYTES;
      findings.push(finding({
        ruleId: 'technical.page.heavy', category: C, severity: very ? 'high' : 'medium', pageUrl: page.url,
        title: 'Documentul HTML este foarte mare',
        evidence: { summary: `HTML-ul paginii are ${kb(size)}`, value: size, expected: `sub ${kb(HEAVY_BYTES)}` },
        whyItMatters: 'Un HTML foarte mare se descarcă și se procesează greu pe telefoane și conexiuni slabe.',
        recommendation: 'Elimină CSS/JS inline voluminos, imaginile încorporate în base64 și blocurile de cod duplicate generate de page-builder.',
        effort: 'medium',
      }));
    }
  }

  return findings;
}
