// Normalizarea URL-urilor folosite de crawler și de API.

export class InvalidUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidUrlError';
    this.code = 'ERR_INVALID_URL';
    this.status = 400;
  }
}

const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga)$/i;

const SKIPPABLE_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|json|xml|rss|atom|txt|csv|zip|rar|7z|gz|tgz|tar|mp4|m4v|mp3|wav|ogg|avi|mov|webm|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|odt|ods|exe|msi|dmg|apk)$/i;

/**
 * Normalizează un URL: doar http/https, fără fragment și fără credențiale.
 * Dacă nu există schemă (ex: "exemplu.ro"), se presupune https.
 * @param {string} input
 * @param {string} [base] URL de bază pentru linkuri relative
 * @returns {string}
 */
export function normalizeUrl(input, base) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new InvalidUrlError('URL lipsă.');
  }
  let s = input.trim();
  if (base === undefined && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // "javascript:..." sau "mailto:..." nu sunt acceptate; "exemplu.ro:8080" este.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:/]+:\d/.test(s)) {
      throw new InvalidUrlError('Sunt permise doar URL-uri http și https.');
    }
    s = `https://${s}`;
  }
  let u;
  try {
    u = base === undefined ? new URL(s) : new URL(s, base);
  } catch {
    throw new InvalidUrlError(`URL invalid: ${input}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new InvalidUrlError('Sunt permise doar URL-uri http și https.');
  }
  if (!u.hostname) throw new InvalidUrlError(`URL invalid: ${input}`);
  u.hash = '';
  u.username = '';
  u.password = '';
  return u.href;
}

/**
 * Cheia folosită pentru deduplicare în crawl: URL normalizat, fără parametri de tracking.
 */
export function crawlKey(input, base) {
  const u = new URL(normalizeUrl(input, base));
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => TRACKING_PARAM.test(k))) {
    for (const k of keys) if (TRACKING_PARAM.test(k)) u.searchParams.delete(k);
  }
  return u.href;
}

export function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resurse care sigur nu sunt pagini HTML (după extensie). */
export function isSkippableResource(url) {
  try {
    return SKIPPABLE_EXT.test(new URL(url).pathname);
  } catch {
    return true;
  }
}
