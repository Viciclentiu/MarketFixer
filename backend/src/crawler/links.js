// Extragerea linkurilor dintr-o pagină HTML (cheerio).
import * as cheerio from 'cheerio';

const MAX_TEXT = 200;

/**
 * @param {string} html
 * @param {string} pageUrl URL-ul final al paginii
 * @param {string} origin originea site-ului scanat
 * @returns {{ links: {href:string,text:string,internal:boolean,nofollow:boolean}[], nofollowPage: boolean }}
 */
export function parseLinks(html, pageUrl, origin) {
  const $ = cheerio.load(html ?? '');
  let base = pageUrl;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      /* <base> invalid, ignorat */
    }
  }

  const links = [];
  const seen = new Set();
  $('a[href], area[href]').each((_, el) => {
    const $el = $(el);
    const raw = ($el.attr('href') ?? '').trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return;
    let u;
    try {
      u = new URL(raw, base);
    } catch {
      return;
    }
    let internal = false;
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      u.hash = '';
      internal = u.origin === origin;
    } else if (u.protocol !== 'mailto:' && u.protocol !== 'tel:') {
      return;
    }
    const href = u.href;
    const rel = ($el.attr('rel') ?? '').toLowerCase().split(/\s+/);
    const text = (
      $el.text().replace(/\s+/g, ' ').trim() ||
      $el.attr('aria-label') ||
      $el.find('img[alt]').first().attr('alt') ||
      $el.attr('title') ||
      ''
    )
      .trim()
      .slice(0, MAX_TEXT);
    const key = `${href}\u0000${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ href, text, internal, nofollow: rel.includes('nofollow') });
  });

  const robotsMeta = $('meta[name]')
    .filter((_, el) => /^(robots|marketfixerbot)$/i.test($(el).attr('name') ?? ''))
    .map((_, el) => $(el).attr('content') ?? '')
    .get()
    .join(',')
    .toLowerCase();

  return { links, nofollowPage: /\b(nofollow|none)\b/.test(robotsMeta) };
}

export function extractLinks(html, pageUrl, origin) {
  return parseLinks(html, pageUrl, origin).links;
}
