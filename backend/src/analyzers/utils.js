// Utilitare comune pentru modulele de analiză MarketFixer.
import * as cheerio from 'cheerio';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const CATEGORIES = ['seo', 'technical', 'accessibility', 'ux', 'content', 'ai_search'];
const EFFORTS = ['low', 'medium', 'high'];

const parseCache = new WeakMap();

/** Încarcă (cu cache) HTML-ul unei pagini în cheerio. */
export function load(page) {
  if (!page || typeof page !== 'object') return cheerio.load('');
  let $ = parseCache.get(page);
  if (!$) {
    $ = cheerio.load(typeof page.html === 'string' ? page.html : '');
    parseCache.set(page, $);
  }
  return $;
}

/** Pagină HTML analizabilă: răspuns 2xx, conținut HTML nevid. */
export function isHtmlPage(page) {
  if (!page || typeof page.html !== 'string' || page.html.trim() === '') return false;
  if (page.contentType && !/html/i.test(page.contentType)) return false;
  const status = Number(page.status);
  return Number.isFinite(status) ? status >= 200 && status < 300 : true;
}

export function htmlPages(crawlResult) {
  return (crawlResult?.pages ?? []).filter(isHtmlPage);
}

export function truncate(value, max = 300) {
  if (value == null) return undefined;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function normalizeSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Elimină diacriticele (inclusiv ş/ţ cu sedilă) și transformă în litere mici. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[şș]/gi, 's')
    .replace(/[ţț]/gi, 't')
    .toLowerCase();
}

/** Normalizează un URL pentru comparații (fără hash, fără slash final, host lowercase). */
export function normalizeUrl(url, base) {
  try {
    const u = new URL(url, base);
    u.hash = '';
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function sameOrigin(a, b) {
  try {
    return new URL(a).host.toLowerCase().replace(/^www\./, '') === new URL(b).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
}

/** Fragment HTML (outerHTML) trunchiat pentru evidence. */
export function snippetOf($, el, max = 300) {
  try {
    return truncate($.html(el), max);
  } catch {
    return undefined;
  }
}

const BLOCK_TAGS =
  'p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,br,td,th,tr,section,article,header,footer,nav,aside,main,blockquote,dt,dd,figcaption,form,label,option,button';

/**
 * Text vizibil al paginii. Cu `main: true`, încearcă să excludă navigația, antetul și subsolul.
 */
export function extractText($, { main = false } = {}) {
  const body = $('body').length ? $('body').first() : $.root();
  const root = body.clone();
  root.find('script,style,noscript,template,svg,iframe,[hidden],[aria-hidden="true"]').remove();
  root.find(BLOCK_TAGS).each((_, el) => {
    $(el).append('\n');
  });
  if (main) {
    const m = root.find('main, [role="main"]').first();
    if (m.length) return cleanText(m.text());
    root.find('nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]').remove();
  }
  return cleanText(root.text());
}

function cleanText(s) {
  return String(s)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
export function words(text) {
  return (String(text ?? '').match(WORD_RE) || []).filter((w) => /\p{L}/u.test(w));
}

/** Construiește un Finding conform contractului. Aruncă eroare dacă lipsește evidence. */
export function finding({
  ruleId,
  category,
  severity,
  title,
  pageUrl = null,
  detail,
  affectedPages,
  evidence,
  whyItMatters,
  recommendation,
  effort = 'low',
  source = 'rule',
}) {
  if (!ruleId || !CATEGORIES.includes(category)) throw new Error(`Finding invalid: ${ruleId}/${category}`);
  if (!SEVERITIES.includes(severity)) throw new Error(`Severitate invalidă: ${severity}`);
  if (!EFFORTS.includes(effort)) throw new Error(`Efort invalid: ${effort}`);
  if (!evidence || !evidence.summary) throw new Error(`Finding fără evidence: ${ruleId}`);
  const ev = { summary: String(evidence.summary) };
  if (evidence.snippet != null && evidence.snippet !== '') ev.snippet = truncate(evidence.snippet, 300);
  if (evidence.value != null) ev.value = evidence.value;
  if (evidence.expected != null) ev.expected = String(evidence.expected);

  const parts = [ruleId, pageUrl ?? 'site'];
  if (detail != null && detail !== '') parts.push(String(detail).slice(0, 200));
  const f = {
    fingerprint: parts.join('|'),
    ruleId,
    category,
    severity,
    title,
    pageUrl,
    evidence: ev,
    whyItMatters,
    recommendation,
    effort,
    source,
  };
  if (affectedPages && affectedPages.length) f.affectedPages = [...new Set(affectedPages)];
  return f;
}

export function isHomePage(page, crawlResult) {
  if (!page) return false;
  if (page.depth === 0) return true;
  const root = crawlResult?.site?.rootUrl;
  return root ? normalizeUrl(page.url) === normalizeUrl(root) : false;
}

export function findHomePage(crawlResult) {
  const pages = htmlPages(crawlResult);
  return pages.find((p) => isHomePage(p, crawlResult)) ?? pages[0] ?? null;
}
