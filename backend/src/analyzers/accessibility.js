// Analiză de accesibilitate: axe-core rulat pe JSDOM (fără color-contrast)
// + reguli statice pe cheerio ca bază deterministă / fallback.
import { finding, htmlPages, load, normalizeSpace, snippetOf, truncate } from './utils.js';

const C = 'accessibility';

export const ACCESSIBILITY_LIMITATIONS = [
  'Contrastul culorilor (color-contrast) este dezactivat deoarece JSDOM nu calculează stilurile CSS și layout-ul vizual real.',
];

const IMPACT_TO_SEVERITY = {
  critical: 'critical',
  serious: 'high',
  moderate: 'medium',
  minor: 'low',
};

const AXE_TRANSLATIONS = {
  'image-alt': {
    title: 'Imagini fără text alternativ pentru cititoarele de ecran',
    whyItMatters: 'Utilizatorii de cititoare de ecran nu pot înțelege conținutul imaginilor dacă lipsește atributul alt.',
    recommendation: 'Adaugă un atribut alt descriptiv pe imaginile informative sau alt="" pe cele pur decorative.',
  },
  label: {
    title: 'Câmpuri de formular fără etichetă (<label>) asociată',
    whyItMatters: 'Fără etichetă asociată, utilizatorii care navighează cu tastatura sau cititorul de ecran nu știu ce trebuie să completeze în câmp.',
    recommendation: 'Asociază fiecărui <input>, <select> și <textarea> un <label for="id"> vizibil sau atributul aria-label.',
  },
  'select-name': {
    title: 'Listă déroulantă (<select>) fără nume accesibil',
    whyItMatters: 'Cititoarele de ecran nu pot anunța scopul listei de selecție fără o etichetă asociată.',
    recommendation: 'Adaugă un <label for="…"> asociat elementului <select> sau atributul aria-label.',
  },
  'button-name': {
    title: 'Buton fără text sau nume accesibil',
    whyItMatters: 'Un buton care conține doar o pictogramă fără text este anunțat doar ca „buton” de cititoarele de ecran.',
    recommendation: 'Adaugă text vizibil în <button> sau atributul aria-label care descrie acțiunea (ex: aria-label="Închide meniul").',
  },
  'link-name': {
    title: 'Link fără text accesibil',
    whyItMatters: 'Linkurile goale sau care conțin doar imagini fără alt nu comunică destinația utilizatorilor de tehnologii asistive.',
    recommendation: 'Adaugă text descriptiv în interiorul elementului <a> sau aria-label / alt pe imaginea din link.',
  },
  'html-has-lang': {
    title: 'Elementul <html> nu are atributul lang',
    whyItMatters: 'Cititoarele de ecran au nevoie de atributul lang pentru a folosi sinteza vocală în limba corectă.',
    recommendation: 'Adaugă lang="ro" (sau codul limbii paginii) pe eticheta <html>.',
  },
  'html-lang-valid': {
    title: 'Atributul lang de pe <html> nu este un cod de limbă valid',
    whyItMatters: 'Un cod de limbă invalid împiedică cititoarele de ecran să selecteze pronunția corectă.',
    recommendation: 'Folosește un cod ISO 639-1 valid, de exemplu lang="ro" sau lang="en".',
  },
  'landmark-one-main': {
    title: 'Pagina nu are o regiune principală (<main>)',
    whyItMatters: 'Elementul <main> permite utilizatorilor de cititoare de ecran să sară direct la conținutul principal al paginii.',
    recommendation: 'Încadrează conținutul principal al paginii într-un singur element <main>.',
  },
  'region': {
    title: 'Conținut în afara regiunilor semantice (landmarks)',
    whyItMatters: 'Regiunile semantice (<header>, <nav>, <main>, <footer>) ajută la navigarea rapidă cu tehnologii asistive.',
    recommendation: 'Organizează secțiunile paginii în elemente semantice HTML5 (<header>, <nav>, <main>, <footer>).',
  },
  'aria-roles': {
    title: 'Atribut ARIA role cu valoare invalidă',
    whyItMatters: 'Rolurile ARIA invalide sunt ignorate sau interpretate greșit de tehnologiile asistive.',
    recommendation: 'Verifică ortografia atributului role și folosește doar roluri definite în specificația WAI-ARIA.',
  },
  'aria-valid-attr': {
    title: 'Atribut ARIA necunoscut sau scris greșit',
    whyItMatters: 'Atributele ARIA invalide nu oferă informațiile așteptate cititoarelor de ecran.',
    recommendation: 'Corectează numele atributului conform specificației WAI-ARIA (ex: aria-label, aria-expanded).',
  },
  'aria-required-attr': {
    title: 'Element cu rol ARIA căruia îi lipsesc atributele obligatorii',
    whyItMatters: 'Unele roluri ARIA necesită atribute de stare (ex: aria-checked, aria-expanded) pentru a funcționa cu cititoarele de ecran.',
    recommendation: 'Adaugă atributele ARIA obligatorii pentru rolul folosit sau înlocuiește-l cu elementul HTML nativ echivalent.',
  },
  'duplicate-id-aria': {
    title: 'ID duplicat folosit în referințe ARIA sau etichete',
    whyItMatters: 'ID-urile duplicate fac ca <label for="…"> sau aria-labelledby să se lege de elementul greșit.',
    recommendation: 'Asigură-te că fiecare atribut id este unic în cadrul paginii.',
  },
  'frame-title': {
    title: 'Element <iframe> fără atribut title',
    whyItMatters: 'Fără title pe <iframe>, utilizatorii de cititoare de ecran nu știu ce conține cadrul încorporat (hartă, video, formular).',
    recommendation: 'Adaugă un atribut title descriptiv pe fiecare <iframe> (ex: title="Hartă sediu").',
  },
};

let axeModPromise = null;
async function loadAxeAndJsdom() {
  if (!axeModPromise) {
    axeModPromise = Promise.all([import('jsdom'), import('axe-core')])
      .then(([jsdomMod, axeMod]) => ({
        JSDOM: jsdomMod.JSDOM ?? jsdomMod.default?.JSDOM,
        axe: axeMod.default ?? axeMod,
      }))
      .catch(() => null);
  }
  return axeModPromise;
}

async function runAxeOnPage(page, tools) {
  if (!tools?.JSDOM || !tools?.axe?.source) return null;
  let dom;
  try {
    dom = new tools.JSDOM(page.html, {
      url: page.url || 'https://exemplu.ro/',
      runScripts: 'outside-only',
    });
    dom.window.eval(tools.axe.source);
    const results = await dom.window.axe.run(dom.window.document.documentElement, {
      resultTypes: ['violations'],
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    return results?.violations ?? [];
  } catch {
    return null;
  } finally {
    try {
      dom?.window?.close();
    } catch {
      // ignore close errors
    }
  }
}

function hasAccessibleName($, el) {
  const $el = $(el);
  if (normalizeSpace($el.text())) return true;
  if (normalizeSpace($el.attr('aria-label'))) return true;
  if (normalizeSpace($el.attr('title'))) return true;
  const labelledBy = normalizeSpace($el.attr('aria-labelledby'));
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      if (id && normalizeSpace($(`[id="${id.replace(/"/g, '')}"]`).text())) return true;
    }
  }
  const imgAlt = $el.find('img[alt]').toArray().some((img) => normalizeSpace($(img).attr('alt')).length > 0);
  if (imgAlt) return true;
  const svgTitle = $el.find('svg title').toArray().some((t) => normalizeSpace($(t).text()).length > 0);
  return svgTitle;
}

function runStaticChecks(page, coveredRules = new Set()) {
  const $ = load(page);
  const url = page.url;
  const out = [];

  // 1. Imagini fără alt
  if (!coveredRules.has('image-alt')) {
    const missingAlt = $('img').toArray().filter((el) => {
      const $el = $(el);
      if ($el.attr('alt') !== undefined) return false;
      if ($el.attr('aria-hidden') === 'true') return false;
      if (/^(presentation|none)$/i.test($el.attr('role') || '')) return false;
      return true;
    });
    if (missingAlt.length > 0) {
      out.push(finding({
        ruleId: 'accessibility.image-alt',
        category: C,
        severity: missingAlt.length >= 3 ? 'high' : 'medium',
        pageUrl: url,
        title: AXE_TRANSLATIONS['image-alt'].title,
        evidence: {
          summary: `${missingAlt.length} element(e) <img> nu au atributul alt`,
          snippet: snippetOf($, missingAlt[0]),
          value: missingAlt.length,
          expected: 'atribut alt prezent pe toate elementele <img>',
        },
        whyItMatters: AXE_TRANSLATIONS['image-alt'].whyItMatters,
        recommendation: AXE_TRANSLATIONS['image-alt'].recommendation,
        effort: 'low',
        source: 'rule',
      }));
    }
  }

  // 2. Input / select / textarea fără label
  if (!coveredRules.has('label') && !coveredRules.has('select-name')) {
    const unlabeled = $('input, select, textarea').toArray().filter((el) => {
      const $el = $(el);
      const tag = (el.tagName || el.name || '').toLowerCase();
      if (tag === 'input') {
        const type = ($el.attr('type') || 'text').toLowerCase();
        if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return false;
      }
      if ($el.attr('aria-hidden') === 'true' || $el.attr('hidden') !== undefined) return false;
      if (normalizeSpace($el.attr('aria-label')) || normalizeSpace($el.attr('aria-labelledby')) || normalizeSpace($el.attr('title'))) return false;
      if ($el.closest('label').length && normalizeSpace($el.closest('label').text())) return false;
      const id = normalizeSpace($el.attr('id'));
      if (id && $(`label[for="${id.replace(/"/g, '')}"]`).length) return false;
      return true;
    });
    if (unlabeled.length > 0) {
      out.push(finding({
        ruleId: 'accessibility.label',
        category: C,
        severity: 'high',
        pageUrl: url,
        title: AXE_TRANSLATIONS.label.title,
        evidence: {
          summary: `${unlabeled.length} câmp(uri) de formular nu au etichetă <label> sau aria-label`,
          snippet: snippetOf($, unlabeled[0]),
          value: unlabeled.length,
          expected: '<label for="id"> sau aria-label pe fiecare câmp',
        },
        whyItMatters: AXE_TRANSLATIONS.label.whyItMatters,
        recommendation: AXE_TRANSLATIONS.label.recommendation,
        effort: 'low',
        source: 'rule',
      }));
    }
  }

  // 3. Butoane goale
  if (!coveredRules.has('button-name')) {
    const emptyButtons = $('button, [role="button"], input[type="button"], input[type="submit"]').toArray().filter((el) => {
      const $el = $(el);
      if ($el.attr('aria-hidden') === 'true' || $el.attr('hidden') !== undefined) return false;
      const tag = (el.tagName || el.name || '').toLowerCase();
      if (tag === 'input') return !normalizeSpace($el.attr('value')) && !normalizeSpace($el.attr('aria-label')) && !normalizeSpace($el.attr('title'));
      return !hasAccessibleName($, el);
    });
    if (emptyButtons.length > 0) {
      out.push(finding({
        ruleId: 'accessibility.button-name',
        category: C,
        severity: 'high',
        pageUrl: url,
        title: AXE_TRANSLATIONS['button-name'].title,
        evidence: {
          summary: `${emptyButtons.length} buton/butoane fără text sau atribut aria-label`,
          snippet: snippetOf($, emptyButtons[0]),
          value: emptyButtons.length,
          expected: 'text vizibil sau aria-label descriptiv',
        },
        whyItMatters: AXE_TRANSLATIONS['button-name'].whyItMatters,
        recommendation: AXE_TRANSLATIONS['button-name'].recommendation,
        effort: 'low',
        source: 'rule',
      }));
    }
  }

  // 4. Linkuri goale
  if (!coveredRules.has('link-name')) {
    const emptyLinks = $('a[href]').toArray().filter((el) => {
      const $el = $(el);
      if ($el.attr('aria-hidden') === 'true' || $el.attr('hidden') !== undefined) return false;
      return !hasAccessibleName($, el);
    });
    if (emptyLinks.length > 0) {
      out.push(finding({
        ruleId: 'accessibility.link-name',
        category: C,
        severity: 'high',
        pageUrl: url,
        title: AXE_TRANSLATIONS['link-name'].title,
        evidence: {
          summary: `${emptyLinks.length} link(uri) <a> fără text sau nume accesibil`,
          snippet: snippetOf($, emptyLinks[0]),
          value: emptyLinks.length,
          expected: 'text în <a>, aria-label sau alt pe imaginea din link',
        },
        whyItMatters: AXE_TRANSLATIONS['link-name'].whyItMatters,
        recommendation: AXE_TRANSLATIONS['link-name'].recommendation,
        effort: 'low',
        source: 'rule',
      }));
    }
  }

  // 5. html[lang] lipsă
  if (!coveredRules.has('html-has-lang')) {
    const lang = normalizeSpace($('html').attr('lang'));
    if (!lang) {
      out.push(finding({
        ruleId: 'accessibility.html-has-lang',
        category: C,
        severity: 'medium',
        pageUrl: url,
        title: AXE_TRANSLATIONS['html-has-lang'].title,
        evidence: {
          summary: 'Elementul <html> nu are atributul lang definit',
          snippet: truncate(page.html.match(/<html[^>]*>/i)?.[0] ?? '<html>', 120),
          expected: '<html lang="ro">',
        },
        whyItMatters: AXE_TRANSLATIONS['html-has-lang'].whyItMatters,
        recommendation: AXE_TRANSLATIONS['html-has-lang'].recommendation,
        effort: 'low',
        source: 'rule',
      }));
    }
  }

  return out;
}

export async function run(crawlResult) {
  const pages = htmlPages(crawlResult);
  const findings = [];
  const tools = await loadAxeAndJsdom();

  for (const page of pages) {
    const coveredByAxe = new Set();
    const violations = await runAxeOnPage(page, tools);

    if (Array.isArray(violations)) {
      for (const v of violations) {
        if (!v?.id || v.id === 'color-contrast') continue;
        coveredByAxe.add(v.id);
        const nodes = Array.isArray(v.nodes) ? v.nodes : [];
        const firstNode = nodes[0];
        const tr = AXE_TRANSLATIONS[v.id];
        const severity = IMPACT_TO_SEVERITY[v.impact] || 'medium';
        findings.push(finding({
          ruleId: `accessibility.${v.id}`,
          category: C,
          severity,
          pageUrl: page.url,
          title: tr?.title ?? `Problemă de accesibilitate: ${truncate(v.help || v.id, 100)}`,
          evidence: {
            summary: `${nodes.length || 1} element(e) afectat(e) pe pagină (${v.id})`,
            snippet: truncate(firstNode?.html || firstNode?.target?.join(', ') || '', 300),
            value: nodes.length || 1,
            expected: tr ? undefined : truncate(v.help, 140),
          },
          whyItMatters: tr?.whyItMatters ?? `${normalizeSpace(v.description || v.help || 'Elementul nu respectă regulile WCAG de accesibilitate.')}`,
          recommendation: tr?.recommendation ?? `Corectează elementele semnalate conform regulii WCAG „${v.id}” (${normalizeSpace(v.help || '')}).`,
          effort: nodes.length > 10 ? 'medium' : 'low',
          source: 'axe-core',
        }));
      }
    }

    // Completează cu verificările statice pentru regulile neacoperite (sau ca fallback complet)
    findings.push(...runStaticChecks(page, coveredByAxe));
  }

  return findings;
}
