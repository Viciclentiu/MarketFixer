// Transformă rezultatul Lighthouse în Finding-uri conforme cu shared/CONTRACTS.md
// și decide ce reguli statice devin redundante (Lighthouse are prioritate pe pagina auditată,
// pentru că rulează într-un browser real).
import { finding, normalizeUrl, truncate } from './utils.js';

const CATEGORY_MAP = {
  performance: 'technical',
  'best-practices': 'technical',
  accessibility: 'accessibility',
  seo: 'seo',
};

const WHY = {
  performance:
    'Paginile lente pierd vizitatori înainte să vadă oferta, mai ales pe mobil, iar Google folosește Core Web Vitals în clasare.',
  'best-practices':
    'Problemele tehnice (erori în consolă, resurse nesigure, API-uri depreciate) scad încrederea browserului și a motoarelor de căutare în site.',
  accessibility:
    'O parte din vizitatori folosesc cititoare de ecran sau navighează de la tastatură. Dacă pagina nu e accesibilă, îi pierzi și riști neconformitate legală.',
  seo: 'Motoarele de căutare (inclusiv cele bazate pe AI) au nevoie de aceste semnale ca să înțeleagă și să indexeze corect pagina.',
};

// Audit Lighthouse -> reguli statice echivalente (aceeași problemă, aceeași pagină).
const EQUIVALENT_RULES = {
  viewport: ['technical.viewport.missing'],
  'html-has-lang': ['technical.lang.missing', 'accessibility.html-has-lang'],
  'image-alt': ['seo.img.alt_missing', 'accessibility.image-alt'],
  'document-title': ['seo.title.missing'],
  'meta-description': ['seo.meta_description.missing'],
  'link-text': ['ux.links.vague_text'],
  'is-on-https': ['technical.https.missing', 'technical.https.page_http'],
  canonical: ['seo.canonical.missing', 'seo.canonical.multiple', 'seo.canonical.invalid'],
  'robots-txt': ['technical.robots.missing', 'technical.robots.blocks_all'],
  'is-crawlable': ['seo.noindex'],
};

function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function learnMoreUrl(text) {
  return /\((https?:[^)]+)\)/.exec(String(text ?? ''))?.[1] ?? null;
}

function severityFor(audit) {
  if (audit.score < 0.5 && audit.weight >= 5) return 'high';
  if (audit.score < 0.5 || audit.weight >= 3) return 'medium';
  return 'low';
}

/**
 * @param {object|null} lh rezultatul runLighthouse()
 * @param {object} crawlResult
 * @returns {{ findings: object[], redundantKeys: Set<string> }}
 *   redundantKeys conține `${ruleId}|${pageUrlNormalizat}` pentru regulile statice acoperite de Lighthouse.
 */
export function lighthouseFindings(lh, crawlResult) {
  const findings = [];
  const redundantKeys = new Set();
  if (!lh?.available) return { findings, redundantKeys };

  // Atribuim constatările paginii din crawl care corespunde URL-ului auditat (de regulă homepage-ul).
  const lhUrl = normalizeUrl(lh.url);
  const pages = crawlResult?.pages ?? [];
  const page =
    pages.find((p) => normalizeUrl(p.url) === lhUrl) ?? pages.find((p) => p.depth === 0) ?? pages[0];
  const pageUrl = page?.url ?? lh.url;
  const pageKey = normalizeUrl(pageUrl);

  for (const audit of lh.failedAudits ?? []) {
    const category = CATEGORY_MAP[audit.category];
    if (!category) continue;

    for (const ruleId of EQUIVALENT_RULES[audit.id] ?? []) redundantKeys.add(`${ruleId}|${pageKey}`);
    // Auditurile de accesibilitate Lighthouse folosesc aceleași ID-uri ca axe-core.
    if (audit.category === 'accessibility') redundantKeys.add(`accessibility.${audit.id}|${pageKey}`);

    const scorePct = Math.round(audit.score * 100);
    const docs = learnMoreUrl(audit.description);
    findings.push(
      finding({
        ruleId: `lighthouse.${audit.id}`,
        category,
        severity: severityFor(audit),
        title: audit.title,
        pageUrl,
        evidence: {
          summary: `Lighthouse (${lh.formFactor}): audit „${audit.id}” cu scorul ${scorePct}/100${
            audit.displayValue ? ` – ${audit.displayValue}` : ''
          }`,
          snippet: audit.snippet ? truncate(audit.snippet, 300) : undefined,
          value: audit.numericValue != null ? Math.round(audit.numericValue * 100) / 100 : scorePct,
          expected: 'scor ≥ 90/100',
        },
        whyItMatters: WHY[audit.category],
        recommendation: `${stripMarkdown(audit.description)}${docs ? ` Detalii: ${docs}` : ''}`,
        effort: audit.category === 'performance' ? 'medium' : 'low',
        source: 'lighthouse',
      }),
    );
  }

  return { findings, redundantKeys };
}
