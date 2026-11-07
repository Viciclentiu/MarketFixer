// Client minimal pentru LLM-uri (Gemini sau OpenAI) care returnează JSON.
// Folosit de analiza de conținut (analyzers/contentAi.js) și de remediator.
// Cheia vine din parametru sau din GEMINI_API_KEY / OPENAI_API_KEY (.env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`OpenAI a răspuns cu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return { data: parseJsonText(data.choices?.[0]?.message?.content), provider: `openai:${model}` };
}

async function callGemini(key, prompt, timeoutMs) {
  const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const models = Array.from(new Set([preferredModel, 'gemini-2.0-flash', 'gemini-1.5-flash']));

  const endpoints = [];
  if (key.startsWith('AQ.')) {
    for (const m of models) {
      endpoints.push({
        model: m,
        url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/json' },
      });
      endpoints.push({
        model: m,
        url: `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/json' },
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new Error(`Gemini (${ep.model}) a răspuns cu ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
      lastErr = err;
    }
  }
  throw lastErr || new Error('Apelul Gemini a eșuat.');
}

/**
 * Trimite promptul și returnează { data, provider }. Aruncă eroare dacă nu există cheie
 * sau dacă API-ul eșuează (apelantul decide fallback-ul).
 */
export async function generateJson({ prompt, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const key = resolveApiKey(apiKey);
  if (!key) throw new Error('Nu există cheie API (GEMINI_API_KEY sau OPENAI_API_KEY).');
  return key.startsWith('sk-') ? callOpenAi(key, prompt, timeoutMs) : callGemini(key, prompt, timeoutMs);
}
