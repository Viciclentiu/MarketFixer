// Orchestratorul motorului de analiză MarketFixer.
// Rulează toate modulele pe CrawlResult, deduplică constatările după fingerprint,
// sortează după severitate + efort și calculează scorurile pe categorii și scorul general.
import * as seo from './seo.js';
import * as technical from './technical.js';
import * as accessibility from './accessibility.js';
import * as ux from './ux.js';
import * as content from './content.js';
import * as aiSearch from './aiSearch.js';
import { CATEGORIES, SEVERITIES } from './utils.js';

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

export const DEFAULT_LIMITATIONS = [
  'Analiza se bazează pe HTML-ul returnat de server (fără execuția JavaScript în browser); conținutul randat exclusiv pe client (SPA) nu este evaluat.',
  ...(accessibility.ACCESSIBILITY_LIMITATIONS ?? []),
  'Metricile Core Web Vitals din teren (LCP, INP, CLS) și traficul real nu pot fi măsurate fără date din Google Search Console / CrUX.',
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
  let penalty = 0;
  for (const f of findingsForCategory) {
    penalty += SEVERITY_PENALTIES[f.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export async function analyzeSite(crawlResult, { onProgress } = {}) {
  const safeCrawl = crawlResult && typeof crawlResult === 'object' ? crawlResult : { site: {}, pages: [] };
  const rawFindings = [];

  for (let i = 0; i < MODULES.length; i++) {
    const mod = MODULES[i];
    const items = await mod.run(safeCrawl);
    if (Array.isArray(items)) {
      rawFindings.push(...items);
    }
    if (typeof onProgress === 'function') {
      try {
        onProgress({ phase: 'analyzing', done: i + 1, total: MODULES.length, category: mod.category });
      } catch {
        // ignore callback errors
      }
    }
  }

  // Deduplicare după fingerprint
  const seen = new Map();
  for (const f of rawFindings) {
    if (!f || !f.fingerprint) continue;
    if (!seen.has(f.fingerprint)) {
      seen.set(f.fingerprint, f);
    }
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
  const findingsByCat = Object.fromEntries(CATEGORIES.map((c) => [c, []]));

  for (const f of findings) {
    if (byCategory[f.category] !== undefined) byCategory[f.category] += 1;
    if (bySeverity[f.severity] !== undefined) bySeverity[f.severity] += 1;
    if (findingsByCat[f.category]) findingsByCat[f.category].push(f);
  }

  const catScores = {};
  for (const cat of CATEGORIES) {
    catScores[cat] = scoreCategory(findingsByCat[cat]);
  }

  let weightedSum = 0;
  for (const cat of CATEGORIES) {
    weightedSum += catScores[cat] * (CATEGORY_WEIGHTS[cat] ?? 0);
  }
  const overall = Math.max(0, Math.min(100, Math.round(weightedSum)));

  const scores = {
    overall,
    seo: catScores.seo,
    accessibility: catScores.accessibility,
    ux: catScores.ux,
    content: catScores.content,
  };

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
    limitations: [...DEFAULT_LIMITATIONS],
  };
}
