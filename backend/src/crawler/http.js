// Client HTTP minimal (node:http/https) cu: timeout total, limită de mărime,
// decompresie, redirecționări manuale și verificare SSRF la conectare.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { assertHostnameAllowed, safeLookup } from './ssrf.js';

export const USER_AGENT = 'MarketFixerBot/0.1';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function flattenHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

function timeoutError(ms) {
  const e = new Error(`Timeout după ${ms} ms`);
  e.code = 'ETIMEDOUT';
  return e;
}

function requestOnce(url, { method, timeoutMs, maxBytes, allowPrivate, headersOnly, accept }) {
  return new Promise((resolve, reject) => {
    if (!allowPrivate) {
      try {
        assertHostnameAllowed(url.hostname);
      } catch (e) {
        reject(e);
        return;
      }
    }
    const mod = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!mod) {
      reject(new Error(`Protocol nepermis: ${url.protocol}`));
      return;
    }

    let settled = false;
    let req;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      const e = timeoutError(timeoutMs);
      finish(reject, e);
      req?.destroy(e);
    }, timeoutMs);

    req = mod.request(
      url,
      {
        method,
        agent: false,
        lookup: allowPrivate ? undefined : safeLookup,
        headers: {
          'user-agent': USER_AGENT,
          accept: accept ?? '*/*',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'ro,en;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = flattenHeaders(res.headers);
        res.on('error', (e) => finish(reject, e));

        if (method === 'HEAD' || headersOnly || REDIRECT_CODES.has(status)) {
          finish(resolve, { status, headers, body: Buffer.alloc(0), truncated: false });
          res.destroy();
          return;
        }

        let stream = res;
        const enc = (headers['content-encoding'] ?? '').trim().toLowerCase();
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        if (stream !== res) stream.on('error', (e) => finish(reject, e));

        const chunks = [];
        let size = 0;
        stream.on('data', (chunk) => {
          if (settled) return;
          const room = maxBytes - size;
          if (chunk.length >= room) {
            if (room > 0) chunks.push(chunk.subarray(0, room));
            size += Math.max(room, 0);
            const truncated = chunk.length > room;
            finish(resolve, { status, headers, body: Buffer.concat(chunks, size), truncated });
            res.destroy();
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        stream.on('end', () =>
          finish(resolve, { status, headers, body: Buffer.concat(chunks, size), truncated: false }),
        );
      },
    );
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

/**
 * Descarcă un URL urmând redirecționările (max 5). Fiecare hop trece prin verificarea SSRF.
 * @returns {Promise<{url:string, requestedUrl:string, status:number, headers:Record<string,string>,
 *   body:Buffer, truncated:boolean, redirectChain:string[], loadMs:number}>}
 */
export async function fetchUrl(input, opts = {}) {
  const o = {
    method: 'GET',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: DEFAULT_MAX_BYTES,
    allowPrivate: false,
    headersOnly: false,
    maxRedirects: 5,
    ...opts,
  };
  const started = performance.now();
  const requestedUrl = new URL(input);
  requestedUrl.hash = '';
  let url = requestedUrl;
  const redirectChain = [];
  for (let hop = 0; ; hop++) {
    const remaining = Math.round(o.timeoutMs - (performance.now() - started));
    if (remaining <= 0) throw timeoutError(o.timeoutMs);
    const res = await requestOnce(url, { ...o, timeoutMs: remaining });
    if (REDIRECT_CODES.has(res.status) && res.headers.location) {
      if (hop >= o.maxRedirects) throw new Error('Prea multe redirecționări.');
      let next;
      try {
        next = new URL(res.headers.location, url);
      } catch {
        throw new Error(`Redirecționare invalidă: ${res.headers.location}`);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error(`Redirecționare către protocol nepermis: ${next.protocol}`);
      }
      next.hash = '';
      redirectChain.push(url.href);
      url = next;
      if (res.status === 303 && o.method !== 'HEAD') o.method = 'GET';
      continue;
    }
    return {
      url: url.href,
      requestedUrl: requestedUrl.href,
      status: res.status,
      headers: res.headers,
      body: res.body,
      truncated: res.truncated,
      redirectChain,
      loadMs: Math.round(performance.now() - started),
    };
  }
}

/** Decodează corpul răspunsului după charset (header sau <meta charset>), implicit UTF-8. */
export function decodeBody(buf, contentType) {
  let charset = /charset=["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}
