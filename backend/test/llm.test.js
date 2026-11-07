import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiGenerationError, generateJson } from '../src/ai/llm.js';
import { callAiDesigner } from '../src/remediator/index.js';
import { Agent } from 'undici';

for (const apiKey of ['AQ.test-ai-studio', 'sk-test']) {
  test(`generarea fără limită dezactivează timeout-urile pentru ${apiKey.startsWith('sk-') ? 'OpenAI' : 'Gemini'}`, async (t) => {
    let dispatches = 0;
    t.mock.method(Agent.prototype, 'dispatch', (options) => {
      dispatches++;
      assert.equal(options.headersTimeout, 0);
      assert.equal(options.bodyTimeout, 0);
      return true;
    });
    t.mock.method(AbortSignal, 'timeout', () => assert.fail('Generarea nelimitată nu trebuie să creeze un timer de anulare'));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.signal, undefined);
      options.dispatcher.dispatch({ headersTimeout: 300_000, bodyTimeout: 300_000 }, {});
      const text = '{"ok":true}';
      return Response.json(apiKey.startsWith('sk-')
        ? { choices: [{ message: { content: text } }] }
        : { candidates: [{ content: { parts: [{ text }] } }] });
    });
    const result = await generateJson({ apiKey, prompt: '{}', timeoutMs: null });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(dispatches, 1);
  });
}

test('analiza cu timeout explicit păstrează semnalul de anulare', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (duration) => {
    assert.equal(duration, 30_000);
    return controller.signal;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.dispatcher, undefined);
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  });
  await generateJson({ apiKey: 'AQ.test', prompt: '{}' });
});

function setEnv(t, name, value) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
}

test('cheile AQ din AI Studio folosesc Gemini API implicit', async (t) => {
  setEnv(t, 'GEMINI_API_BACKEND', undefined);
  setEnv(t, 'GEMINI_MODEL', undefined);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'generativelanguage.googleapis.com');
    assert.equal(new URL(url).pathname, '/v1beta/models/gemini-flash-latest:generateContent');
    assert.equal(options.headers['x-goog-api-key'], 'AQ.test-ai-studio');
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  });
  const result = await generateJson({ apiKey: 'AQ.test-ai-studio', prompt: '{}' });
  assert.deepEqual(result.data, { ok: true });
});

test('redesign-ul explică API-ul dezactivat, fără reîncercări sau expunerea cheii', async (t) => {
  setEnv(t, 'GEMINI_API_BACKEND', 'vertex');
  const key = 'AQ.test-secret';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(new URL(url).hostname, 'aiplatform.googleapis.com');
    assert.equal(new URL(url).search, '');
    assert.equal(options.headers['x-goog-api-key'], key);
    return Response.json({ error: {
      message: `Private diagnostic ${key}`,
      details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'aiplatform.googleapis.com' } }],
    } }, { status: 403 });
  });
  await assert.rejects(callAiDesigner({
    pageUrl: 'https://example.com/', extractedContent: { siteName: 'Exemplu', headings: [], textBlocks: [] },
    navigation: [], assets: [], brandSignals: {}, existingInteractions: [], auditFindings: [],
  }, { apiKey: key }), (error) => {
    assert.match(error.message, /Generarea designului.*API-ul este dezactivat/);
    assert.match(error.message, /aiplatform.googleapis.com/);
    assert.ok(!error.message.includes(key));
    assert.ok(error.cause instanceof AiGenerationError);
    return true;
  });
  assert.equal(calls, 1);
});

for (const [status, message, expected] of [
  [400, 'API key not valid', /cheia API este invalidă/],
  [401, 'Unauthorized', /cheia API este invalidă/],
  [403, 'Forbidden', /acces refuzat/],
  [429, 'Quota exceeded', /cota disponibilă/],
]) {
  test(`oprește cererile la HTTP ${status} și explică problema`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return Response.json({ error: { message } }, { status });
    });
    await assert.rejects(generateJson({ apiKey: 'AIza-test', prompt: '{}' }), expected);
    assert.equal(calls, 1);
  });
}

test('încearcă următorul model dacă primul nu există', async (t) => {
  setEnv(t, 'GEMINI_MODEL', 'missing-model');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return Response.json({ error: {} }, { status: 404 });
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  });
  const result = await generateJson({ apiKey: 'AIza-test', prompt: '{}' });
  assert.deepEqual(result.data, { ok: true });
  assert.equal(calls, 2);
});

test('timeout-ul oprește cererile și este afișat separat', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new DOMException('Timeout', 'TimeoutError');
  });
  await assert.rejects(generateJson({ apiKey: 'AIza-test', prompt: '{}' }), /timpul disponibil/);
  assert.equal(calls, 1);
});

test('erorile OpenAI nu expun răspunsul brut', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'secret-in-response' } }, { status: 403 }));
  await assert.rejects(generateJson({ apiKey: 'sk-test', prompt: '{}' }), (error) => {
    assert.match(error.message, /OpenAI: acces refuzat/);
    assert.doesNotMatch(error.message, /secret-in-response/);
    return true;
  });
});
