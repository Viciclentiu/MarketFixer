// Client minimal pentru LLM-uri (Gemini sau OpenAI) care returnează JSON.
// Folosit de analiza de conținut (analyzers/contentAi.js) și de remediator.
// Cheia vine din parametru sau din GEMINI_API_KEY / OPENAI_API_KEY (.env).

const DEFAULT_TIMEOUT_MS = 30_000;

export function resolveApiKey(explicitKey) {
  return String(explicitKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
}

function parseJsonText(text) {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(cleaned);
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
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const endpoints = key.startsWith('AQ.')
    ? [
        {
          url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          headers: { 'Content-Type': 'application/json' },
        },
        {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          headers: { 'Content-Type': 'application/json' },
        },
      ]
    : [
        {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        },
      ];

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
        lastErr = new Error(`Gemini a răspuns cu ${res.status}: ${(await res.text()).slice(0, 200)}`);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return { data: parseJsonText(text), provider: `gemini:${model}` };
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
