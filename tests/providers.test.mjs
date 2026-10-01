// Testes dos adaptadores (fetch simulado) e do Markdown. Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChat, listModels } from '../src/lib/providers.js';
import { renderMarkdown } from '../src/lib/markdown.js';

function streamResponse(chunks, status = 200) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    }
  });
  return new Response(body, { status });
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null });
    return handler(url, opts);
  };
  return calls;
}

const msgs = [{ role: 'user', content: 'Oi' }];

test('openai: SSE com chunks quebrados no meio da linha', async () => {
  const calls = mockFetch(() =>
    streamResponse(['data: {"choices":[{"delta":{"content":"Ol"}}]}\n\nda', 'ta: {"choices":[{"delta":{"content":"á!"}}]}\n\n', 'data: [DONE]\n\n'])
  );
  const out = await streamChat({ providerId: 'openai', config: { apiKey: 'k' }, model: 'gpt-5', messages: msgs, system: 'S', maxTokens: 10 });
  assert.equal(out, 'Olá!');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer k');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.max_completion_tokens, 10);
  assert.equal('temperature' in calls[0].body, false);
});

test('anthropic: content_block_delta + headers de navegador', async () => {
  const calls = mockFetch(() =>
    streamResponse([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Oi"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" você"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
  );
  const out = await streamChat({ providerId: 'anthropic', config: { apiKey: 'k' }, model: 'claude-sonnet-5-5', messages: msgs, system: 'S', temperature: 0.3 });
  assert.equal(out, 'Oi você');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].opts.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(calls[0].body.system, 'S');
  assert.equal(calls[0].body.temperature, 0.3);
  assert.ok(calls[0].body.max_tokens > 0);
});

test('gemini: mapeia papéis e ignora partes de pensamento', async () => {
  const calls = mockFetch(() =>
    streamResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"pensando","thought":true},{"text":"Bom"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" dia"}]}}]}\r\n\r\n'
    ])
  );
  const out = await streamChat({
    providerId: 'gemini', config: { apiKey: 'g' }, model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], system: 'S'
  });
  assert.equal(out, 'Bom dia');
  assert.match(calls[0].url, /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/);
  assert.deepEqual(calls[0].body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'S');
});

test('ollama: NDJSON', async () => {
  const calls = mockFetch(() =>
    streamResponse(['{"message":{"content":"Lo"},"done":false}\n{"message":{"con', 'tent":"cal"},"done":false}\n{"done":true}\n'])
  );
  const out = await streamChat({ providerId: 'ollama', config: {}, model: 'llama3.1', messages: msgs, temperature: 0.5 });
  assert.equal(out, 'Local');
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
  assert.equal(calls[0].body.options.temperature, 0.5);
});

test('custom openai-compatível usa max_tokens e URL configurada', async () => {
  const calls = mockFetch(() => streamResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n']));
  await streamChat({ providerId: 'custom', config: { baseUrl: 'http://srv:8000/v1/' }, model: 'm', messages: msgs, maxTokens: 5 });
  assert.equal(calls[0].url, 'http://srv:8000/v1/chat/completions');
  assert.equal(calls[0].body.max_tokens, 5);
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('erros HTTP trazem a mensagem do provedor', async () => {
  mockFetch(() => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
  await assert.rejects(
    streamChat({ providerId: 'anthropic', config: { apiKey: 'bad' }, model: 'm', messages: msgs }),
    /HTTP 401: invalid x-api-key — verifique a chave/
  );
});

test('sem chave de API falha antes da requisição', async () => {
  const calls = mockFetch(() => { throw new Error('não deveria chamar'); });
  await assert.rejects(streamChat({ providerId: 'openai', config: {}, model: 'm', messages: msgs }), /Configure a chave/);
  assert.equal(calls.length, 0);
});

test('falha de rede em servidor local sugere CORS', async () => {
  mockFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(streamChat({ providerId: 'lmstudio', config: {}, model: 'm', messages: msgs }), /CORS/);
});

test('listModels de cada formato', async () => {
  mockFetch((url) => {
    if (url.includes('/api/tags')) return Response.json({ models: [{ name: 'qwen2.5' }, { name: 'llama3.1' }] });
    if (url.includes('googleapis')) return Response.json({ models: [
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] });
    if (url.includes('anthropic')) return Response.json({ data: [{ id: 'claude-opus-5-5' }] });
    return Response.json({ data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-realtime-preview' }, { id: 'o3' }] });
  });
  assert.deepEqual(await listModels('ollama', {}), ['llama3.1', 'qwen2.5']);
  assert.deepEqual(await listModels('gemini', { apiKey: 'g' }), ['gemini-2.5-pro']);
  assert.deepEqual(await listModels('anthropic', { apiKey: 'a' }), ['claude-opus-5-5']);
  assert.deepEqual(await listModels('openai', { apiKey: 'o' }), ['gpt-5', 'o3']);
  assert.deepEqual(await listModels('custom', {}), ['gpt-4o-realtime-preview', 'gpt-5', 'o3', 'text-embedding-3-small']);
});

test('markdown: escapa HTML e renderiza elementos', () => {
  const html = renderMarkdown('# Título\n\nTexto **forte** e *itálico* com `code` <script>x</script>\n\n- a\n- b\n\n1. um\n2. dois\n\n```js\nconst a = "<b>";\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[link](https://ex.com) [mau](javascript:alert(1))');
  assert.match(html, /<h2>Título<\/h2>/);
  assert.match(html, /<strong>forte<\/strong>/);
  assert.match(html, /<em>itálico<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>um<\/li><li>dois<\/li><\/ol>/);
  assert.match(html, /const a = &quot;&lt;b&gt;&quot;;/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<a href="https:\/\/ex.com"/);
  assert.ok(!html.includes('href="javascript'));
});

test('markdown: bloco de código aberto durante streaming', () => {
  const html = renderMarkdown('Veja:\n```py\nprint(1)');
  assert.match(html, /print\(1\)/);
});
