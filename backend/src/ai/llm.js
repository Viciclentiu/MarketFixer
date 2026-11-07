// Client minimal pentru LLM-uri (Gemini sau OpenAI) care returnează JSON.
// Folosit de analiza de conținut (analyzers/contentAi.js) și de remediator.
// Cheia vine din parametru sau din GEMINI_API_KEY / OPENAI_API_KEY (.env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from 'undici';

// Încarcă automat .env din rădăcina proiectului sau din backend/ dacă nu a fost încărcat deja
(function loadEnvAutomatically() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && !process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {
      // ignore env read errors
    }
  }
})();

const DEFAULT_TIMEOUT_MS = 30_000;

// Elimină și limitele HTTP implicite, inclusiv când fetch transmite propriile valori.
class UnlimitedResponseAgent extends Agent {
  dispatch(options, handler) {
    return super.dispatch({ ...options, headersTimeout: 0, bodyTimeout: 0 }, handler);
  }
}
const unlimitedResponseAgent = new UnlimitedResponseAgent();

function requestTiming(timeoutMs) {
  return timeoutMs === null
    ? { dispatcher: unlimitedResponseAgent }
    : { signal: AbortSignal.timeout(timeoutMs) };
}

export class AiGenerationError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'AiGenerationError';
    this.status = status;
  }
}

async function apiError(res, provider) {
  // Nu expune răspunsul brut: poate conține cheia, URL-uri sau date ale proiectului.
  const payload = await res.json().catch(() => null);
  const error = payload?.error;
  const disabled = error?.details?.some?.((detail) => detail.reason === 'SERVICE_DISABLED')
    || /has not been used.*or it is disabled|API.*is disabled/i.test(error?.message || '');
  let message;
  if (disabled) {
    message = `${provider}: API-ul este dezactivat în proiectul Google Cloud asociat cheii. Activează API-ul ${provider === 'Vertex AI' ? 'Vertex AI (aiplatform.googleapis.com)' : 'Gemini (generativelanguage.googleapis.com)'}, așteaptă câteva minute și încearcă din nou.`;
  } else if (res.status === 401 || (res.status === 400 && /API.?key/i.test(error?.message || ''))) {
    message = `${provider}: cheia API este invalidă sau expirată. Actualizează cheia configurată și încearcă din nou.`;
  } else if (res.status === 403) {
    message = `${provider}: acces refuzat. Verifică permisiunile și restricțiile cheii API în proiectul asociat.`;
  } else if (res.status === 429) {
    message = `${provider}: limita de cereri sau cota disponibilă a fost depășită. Verifică cota și facturarea contului înainte de a reîncerca.`;
  } else if (res.status === 404) {
    message = `${provider}: modelul configurat nu este disponibil. Verifică setarea ${provider === 'OpenAI' ? 'OPENAI_MODEL' : 'GEMINI_MODEL'}.`;
  } else if (res.status >= 500) {
    message = `${provider}: serviciul este temporar indisponibil. Încearcă din nou mai târziu.`;
  } else {
    message = `${provider}: cererea de generare a fost respinsă (HTTP ${res.status}). Verifică modelul și configurația API.`;
  }
  return new AiGenerationError(message, { status: res.status });
}

export function resolveApiKey(explicitKey) {
  return String(explicitKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
}

function parseJsonText(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Răspunsul LLM nu conține JSON valid.');
  }
}

async function callOpenAi(key, prompt, timeoutMs) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    ...requestTiming(timeoutMs),
  });
  if (!res.ok) {
    throw await apiError(res, 'OpenAI');
  }
  const data = await res.json();
  return { data: parseJsonText(data.choices?.[0]?.message?.content), provider: `openai:${model}` };
}

async function callGemini(key, prompt, timeoutMs) {
  // AI Studio emite și chei AQ.; prefixul nu identifică serviciul Google.
  // Vertex Express se activează explicit prin GEMINI_API_BACKEND=vertex.
  const useVertex = process.env.GEMINI_API_BACKEND === 'vertex';
  const defaultModel = useVertex ? 'gemini-2.5-flash' : 'gemini-flash-latest';
  const preferredModel = process.env.GEMINI_MODEL || defaultModel;
  const models = Array.from(new Set([preferredModel, defaultModel]));

  const endpoints = [];
  if (useVertex) {
    for (const m of models) {
      endpoints.push({
        model: m,
        url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      });
      endpoints.push({
        model: m,
        url: `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${m}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      });
    }
  } else {
    for (const m of models) {
      endpoints.push({
        model: m,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      });
    }
  }

  let lastErr = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: ep.headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
        ...requestTiming(timeoutMs),
      });
      if (!res.ok) {
        lastErr = await apiError(res, useVertex ? 'Vertex AI' : 'Gemini');
        if (res.status !== 404 && res.status < 500) throw lastErr;
        continue;
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const nonThoughtParts = parts.filter((p) => !p?.thought && typeof p?.text === 'string');
      const text = (nonThoughtParts.length ? nonThoughtParts : parts)
        .map((p) => p?.text ?? '')
        .join('\n');
      return { data: parseJsonText(text), provider: `gemini:${ep.model}` };
    } catch (err) {
      if (err instanceof AiGenerationError && err.status !== 404 && err.status < 500) throw err;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('Apelul Gemini a eșuat.');
}

/**
 * Trimite promptul și returnează { data, provider }. Aruncă eroare dacă nu există cheie
 * sau dacă API-ul eșuează (apelantul decide fallback-ul).
 * timeoutMs: null așteaptă răspunsul fără limită; implicit, analiza rămâne limitată.
 */
export async function generateJson({ prompt, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const key = resolveApiKey(apiKey);
  if (!key) throw new Error('Nu există cheie API (GEMINI_API_KEY sau OPENAI_API_KEY).');
  try {
    return await (key.startsWith('sk-') ? callOpenAi(key, prompt, timeoutMs) : callGemini(key, prompt, timeoutMs));
  } catch (cause) {
    if (cause instanceof AiGenerationError) throw cause;
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') {
      throw new AiGenerationError('Serviciul AI nu a răspuns în timpul disponibil. Încearcă din nou.', { cause });
    }
    if (cause instanceof TypeError) {
      throw new AiGenerationError('Conexiunea la serviciul AI a eșuat. Verifică accesul la internet și încearcă din nou.', { cause });
    }
    throw new AiGenerationError('Serviciul AI nu a returnat JSON valid pentru generare. Încearcă din nou.', { cause });
  }
}
