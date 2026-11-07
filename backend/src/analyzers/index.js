// Orchestratorul motorului de analiză MarketFixer.
// Rulează regulile statice pe CrawlResult, adaugă rezultatele Google Lighthouse (dacă există)
// și analiza AI de conținut (dacă e activată), deduplică după fingerprint, sortează după
// severitate + efort și calculează scorurile pe categorii și scorul general.
import * as seo from './seo.js';
import * as technical from './technical.js';
import * as accessibility from './accessibility.js';
import * as ux from './ux.js';
import * as content from './content.js';
import * as aiSearch from './aiSearch.js';
import { lighthouseFindings } from './lighthouse.js';
import { runContentAi } from './contentAi.js';
import { runSerpAnalysis } from './serp.js';
import { CATEGORIES, SEVERITIES, normalizeUrl } from './utils.js';

export const SEVERITY_PENALTIES = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
};

export const CATEGORY_WEIGHTS = {
  seo: 0.25,
  technical: 0.20,
  accessibility: 0.20,
  content: 0.20,
  ux: 0.10,
  ai_search: 0.05,
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const EFFORT_ORDER = { low: 0, medium: 1, high: 2 };

const BASE_LIMITATION =
  'Regulile statice analizează HTML-ul returnat de server (fără execuția JavaScript); conținutul randat exclusiv pe client (SPA) este evaluat doar de Lighthouse, pe pagina auditată.';
const FIELD_DATA_LIMITATION =
  'Metricile Core Web Vitals din teren (date reale de la utilizatori) și traficul nu pot fi măsurate fără Google Search Console / CrUX; Lighthouse măsoară în laborator.';

export const DEFAULT_LIMITATIONS = [
  BASE_LIMITATION,
  ...(accessibility.ACCESSIBILITY_LIMITATIONS ?? []),
  FIELD_DATA_LIMITATION,
];

const MODULES = [
  { category: 'seo', run: seo.run },
  { category: 'technical', run: technical.run },
  { category: 'accessibility', run: accessibility.run },
  { category: 'ux', run: ux.run },
  { category: 'content', run: content.run },
  { category: 'ai_search', run: aiSearch.run },
];

export function scoreCategory(findingsForCategory) {
  if (!Array.isArray(findingsForCategory) || findingsForCategory.length === 0) {
    return 100;
  }

  // Grupăm constatările după ruleId pentru ca aceeași problemă repetată pe 15-20 de subpagini
  // (ex. seo.meta_description.missing, content.thin_content, accessibility.image-alt)
  // să nu multiplice penalizarea de 20 de ori și să ducă scorul la 0.
  const byRule = new Map();
  let anonymousIndex = 0;
  let hasCritical = false;

  for (const f of findingsForCategory) {
    if (!f) continue;
    const base = SEVERITY_PENALTIES[f.severity] ?? 0;
    if (f.severity === 'critical') hasCritical = true;
    const key = f.ruleId ? String(f.ruleId) : `__anon_${anonymousIndex++}`;
    const existing = byRule.get(key);
    if (!existing) {
      byRule.set(key, { maxPenalty: base, count: 1 });
    } else {
      existing.maxPenalty = Math.max(existing.maxPenalty, base);
      existing.count += 1;
    }
  }

  let rawPenalty = 0;
  for (const { maxPenalty, count } of byRule.values()) {
    const extraOccurrences = Math.max(0, count - 1);
    // Paginile suplimentare cu aceeași regulă adaugă cel mult +35% din penalizarea de bază a regulii
    const spreadPenalty = Math.min(maxPenalty * 0.35, extraOccurrences * 0.75);
    rawPenalty += maxPenalty + spreadPenalty;
  }

  // Pentru penalizări mici/moderate (<= 45 pct) păstrăm scăderea liniară exactă (100 - rawPenalty).
  // Peste 45 pct aplicăm o curbă cu randament descrescător ca scorul să reflecte nuanțat gravitatea
  // fără să cadă direct la 0 pe site-uri funcționale cu mai multe constatări medii.
  let effectivePenalty = rawPenalty;
  if (rawPenalty > 45) {
    effectivePenalty = 45 + (rawPenalty - 45) * 0.38;
  }

  const minFloor = hasCritical ? 8 : 15;
  return Math.max(minFloor, Math.min(100, Math.round(100 - effectivePenalty)));
}

export function computeScoresFromFindings(findings = [], lighthouse = null) {
  const findingsByCat = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const f of findings) {
    if (f && findingsByCat[f.category]) {
      findingsByCat[f.category].push(f);
    }
  }

  const catScores = {};
  for (const cat of CATEGORIES) {
    catScores[cat] = scoreCategory(findingsByCat[cat]);
  }

  // Integrăm scorurile reale măsurate de Google Lighthouse (0-100) atunci când sunt disponibile
  const lhScores = lighthouse?.available ? lighthouse.scores : null;
  if (lhScores && typeof lhScores === 'object') {
    if (typeof lhScores.seo === 'number' && lhScores.seo > 0) {
      catScores.seo = Math.round(catScores.seo * 0.55 + lhScores.seo * 0.45);
    }
    if (typeof lhScores.accessibility === 'number' && lhScores.accessibility > 0) {
      catScores.accessibility = Math.round(catScores.accessibility * 0.55 + lhScores.accessibility * 0.45);
    }
    if (typeof lhScores.performance === 'number' && lhScores.performance > 0) {
      catScores.technical = Math.round(catScores.technical * 0.65 + lhScores.performance * 0.35);
    }
  }

  let weightedSum = 0;
  for (const cat of CATEGORIES) {
    weightedSum += catScores[cat] * (CATEGORY_WEIGHTS[cat] ?? 0);
  }
  const overall = Math.max(0, Math.min(100, Math.round(weightedSum)));

  return {
    overall,
    seo: catScores.seo,
    accessibility: catScores.accessibility,
    ux: catScores.ux,
    content: catScores.content,
    technical: catScores.technical,
    ai_search: catScores.ai_search,
  };
}

function compactLighthouse(lh) {
  if (!lh) return null;
  if (!lh.available) return { available: false, error: lh.error ?? 'necunoscut' };
  const { failedAudits, ...rest } = lh;
  return { ...rest, failedAuditsCount: failedAudits?.length ?? 0 };
}

/**
 * @param {object} crawlResult
 * @param {object} [options]
 * @param {Function} [options.onProgress]
 * @param {object|null} [options.lighthouse] rezultatul runLighthouse() (opțional)
 * @param {boolean} [options.contentAi] rulează analiza AI de conținut (necesită cheie API)
 * @param {string} [options.apiKey] cheie Gemini/OpenAI (implicit din .env)
 * @param {Function} [options.generate] client LLM injectabil (pentru teste)
 */
export async function analyzeSite(
  crawlResult,
  { onProgress, lighthouse = null, contentAi = false, apiKey, generate } = {},
) {
  const safeCrawl = crawlResult && typeof crawlResult === 'object' ? crawlResult : { site: {}, pages: [] };
  const totalSteps = MODULES.length + (contentAi ? 1 : 0);
  const report = (done, category) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ phase: 'analyzing', done, total: totalSteps, category });
    } catch {
      // ignore callback errors
    }
  };

  let rawFindings = [];
  for (let i = 0; i < MODULES.length; i++) {
    const mod = MODULES[i];
    const items = await mod.run(safeCrawl);
    if (Array.isArray(items)) rawFindings.push(...items);
    report(i + 1, mod.category);
  }

  const limitations = [BASE_LIMITATION];

  // Google Lighthouse: are prioritate pe pagina auditată (browser real); eliminăm regulile statice redundante.
  if (lighthouse?.available) {
    const { findings: lhFindings, redundantKeys } = lighthouseFindings(lighthouse, safeCrawl);
    rawFindings = rawFindings.filter((f) => !redundantKeys.has(`${f.ruleId}|${normalizeUrl(f.pageUrl)}`));
    rawFindings.push(...lhFindings);
    limitations.push(
      `Google Lighthouse ${lighthouse.lighthouseVersion ?? ''} (${lighthouse.formFactor}) a auditat ${lighthouse.url} într-un Chromium real. Celelalte pagini sunt verificate cu reguli statice.`,
      'Pe paginile fără Lighthouse, contrastul culorilor nu este verificat (JSDOM nu calculează CSS-ul real).',
    );
  } else {
    limitations.push(...(accessibility.ACCESSIBILITY_LIMITATIONS ?? []));
    if (lighthouse && !lighthouse.available) {
      limitations.push(`Google Lighthouse nu a putut rula: ${lighthouse.error}. Auditul tehnic folosește doar reguli statice.`);
    }
  }

  // Analiza AI de conținut și comunicare (Gemini / OpenAI).
  if (contentAi) {
    const ai = await runContentAi(safeCrawl, { apiKey, ...(generate ? { generate } : {}) });
    rawFindings.push(...ai.findings);
    if (ai.limitation) limitations.push(ai.limitation);
    report(totalSteps, 'content_ai');
  }

  // Analiza SerpApi (Google Search + People Also Ask) dacă există SERPAPI_KEY
  let serpData = null;
  if (process.env.SERPAPI_KEY) {
    const serp = await runSerpAnalysis(safeCrawl);
    rawFindings.push(...serp.findings);
    serpData = serp.serpData;
    if (serp.limitation) limitations.push(serp.limitation);
  }

  limitations.push(FIELD_DATA_LIMITATION);

  // Deduplicare după fingerprint
  const seen = new Map();
  for (const f of rawFindings) {
    if (!f || !f.fingerprint) continue;
    if (!seen.has(f.fingerprint)) seen.set(f.fingerprint, f);
  }

  // Sortare: severitate descrescătoare (critical -> low), apoi efort crescător (low -> high)
  const findings = [...seen.values()].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    const effDiff = (EFFORT_ORDER[a.effort] ?? 99) - (EFFORT_ORDER[b.effort] ?? 99);
    if (effDiff !== 0) return effDiff;
    return a.fingerprint.localeCompare(b.fingerprint);
  });

  // Grupare pe categorii și severități
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));

  for (const f of findings) {
    if (byCategory[f.category] !== undefined) byCategory[f.category] += 1;
    if (bySeverity[f.severity] !== undefined) bySeverity[f.severity] += 1;
  }

  const scores = computeScoresFromFindings(findings, lighthouse);

  const summary = {
    totalFindings: findings.length,
    bySeverity,
    byCategory,
    topPriorities: findings.slice(0, 5).map((f) => f.fingerprint),
  };

  return {
    scores,
    findings,
    summary,
    limitations,
    lighthouse: compactLighthouse(lighthouse),
    serp: serpData,
  };
}
