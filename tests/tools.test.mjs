// Testes de chamada de ferramentas (function calling) em cada formato de API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatTurn, isToolsUnsupportedError } from '../src/lib/providers.js';
import { BROWSER_TOOLS, describeToolCall } from '../src/lib/tools.js';

function streamResponse(chunks) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((ch) => c.enqueue(enc.encode(ch))); c.close(); } }));
}
function mockFetch(chunks) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return streamResponse(chunks);
  };
  return calls;
}

// Conversa com um ciclo completo de ferramenta, usada para checar a conversão de histórico.
const history = [
  { role: 'user', content: 'Busque camisas na loja' },
  { role: 'assistant', content: 'Vou abrir o site.', toolCalls: [{ id: 'c1', name: 'navigate', args: { url: 'https://loja.com' } }] },
  { role: 'tool', toolCallId: 'c1', name: 'navigate', content: 'URL: https://loja.com' }
];
const tools = BROWSER_TOOLS.slice(0, 2);

test('openai: tool_calls em pedaços e histórico com role=tool', async () => {
  const calls = mockFetch([
    'data: {"choices":[{"delta":{"content":"Ok"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"search_web","arguments":"{\\"que"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\\":\\"camisa premium\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n'
  ]);
  const res = await chatTurn({ providerId: 'openai', config: { apiKey: 'k' }, model: 'gpt-4o-mini', messages: history, tools });
  assert.equal(res.text, 'Ok');
  assert.deepEqual(res.toolCalls, [{ id: 'call_9', name: 'search_web', args: { query: 'camisa premium' } }]);
  const body = calls[0].body;
  assert.equal(body.tools[0].type, 'function');
  assert.equal(body.tools[0].function.name, 'navigate');
  assert.equal(body.messages[1].tool_calls[0].function.arguments, '{"url":"https://loja.com"}');
  assert.deepEqual(body.messages[2], { role: 'tool', tool_call_id: 'c1', content: 'URL: https://loja.com' });
});

test('anthropic: tool_use com input_json_delta e tool_result no histórico', async () => {
  const calls = mockFetch([
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Abrindo"}}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"navigate","input":{}}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"url\\": \\"https://"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"br.shein.com\\"}"}}\n\n',
    'data: {"type":"message_stop"}\n\n'
  ]);
  const res = await chatTurn({ providerId: 'anthropic', config: { apiKey: 'k' }, model: 'claude-sonnet-5-5', messages: history, tools });
  assert.equal(res.text, 'Abrindo');
  assert.deepEqual(res.toolCalls, [{ id: 'toolu_1', name: 'navigate', args: { url: 'https://br.shein.com' } }]);
  const body = calls[0].body;
  assert.equal(body.tools[0].input_schema.type, 'object');
  assert.deepEqual(body.messages[1].content[1], { type: 'tool_use', id: 'c1', name: 'navigate', input: { url: 'https://loja.com' } });
  assert.equal(body.messages[2].role, 'user');
  assert.equal(body.messages[2].content[0].type, 'tool_result');
  assert.equal(body.messages[2].content[0].tool_use_id, 'c1');
});

test('anthropic: resultados de várias ferramentas viram uma só mensagem de usuário', async () => {
  const calls = mockFetch(['data: {"type":"message_stop"}\n\n']);
  await chatTurn({
    providerId: 'anthropic', config: { apiKey: 'k' }, model: 'm', tools,
    messages: [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_page', args: {} }, { id: 'b', name: 'find', args: { query: 'q' } }] },
      { role: 'tool', toolCallId: 'a', name: 'read_page', content: 'r1' },
      { role: 'tool', toolCallId: 'b', name: 'find', content: 'r2', isError: true },
      { role: 'user', content: 'continue' }
    ]
  });
  const m = calls[0].body.messages;
  assert.equal(m.length, 3);
  assert.deepEqual(m[2].content.map((c) => c.type), ['tool_result', 'tool_result', 'text']);
  assert.equal(m[2].content[1].is_error, true);
  assert.equal(m[1].content.length, 2); // sem bloco de texto vazio
});

test('gemini: functionCall com thoughtSignature e functionResponse no histórico', async () => {
  const calls = mockFetch([
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"click","args":{"ref":3}},"thoughtSignature":"sig=="}]}}]}\n\n'
  ]);
  const res = await chatTurn({ providerId: 'gemini', config: { apiKey: 'g' }, model: 'gemini-2.5-flash', messages: history, tools });
  assert.equal(res.toolCalls[0].name, 'click');
  assert.deepEqual(res.toolCalls[0].args, { ref: 3 });
  assert.equal(res.toolCalls[0].signature, 'sig==');
  const body = calls[0].body;
  assert.equal(body.tools[0].functionDeclarations.length, 2);
  assert.deepEqual(body.contents[1].parts[1], { functionCall: { name: 'navigate', args: { url: 'https://loja.com' } } });
  assert.deepEqual(body.contents[2], { role: 'user', parts: [{ functionResponse: { name: 'navigate', response: { result: 'URL: https://loja.com' } } }] });
});

test('ollama: tool_calls no NDJSON e role=tool no histórico', async () => {
  const calls = mockFetch([
    '{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"type","arguments":{"ref":5,"text":"camisa","submit":true}}}]},"done":false}\n',
    '{"done":true}\n'
  ]);
  const res = await chatTurn({ providerId: 'ollama', config: {}, model: 'qwen2.5', messages: history, tools });
  assert.equal(res.toolCalls[0].name, 'type');
  assert.deepEqual(res.toolCalls[0].args, { ref: 5, text: 'camisa', submit: true });
  assert.ok(res.toolCalls[0].id);
  const body = calls[0].body;
  assert.equal(body.tools[0].function.name, 'navigate');
  assert.deepEqual(body.messages[1].tool_calls[0], { function: { name: 'navigate', arguments: { url: 'https://loja.com' } } });
  assert.deepEqual(body.messages[2], { role: 'tool', content: 'URL: https://loja.com', tool_name: 'navigate' });
});

test('sem ferramentas o corpo não leva "tools"', async () => {
  const calls = mockFetch(['data: [DONE]\n\n']);
  await chatTurn({ providerId: 'custom', config: { baseUrl: 'http://x/v1' }, model: 'm', messages: [{ role: 'user', content: 'oi' }] });
  assert.equal('tools' in calls[0].body, false);
});

test('detecta modelo sem suporte a ferramentas', () => {
  const e = Object.assign(new Error('HTTP 400: registry.ollama.ai/library/gemma:2b does not support tools'), { status: 400 });
  assert.equal(isToolsUnsupportedError(e), true);
  assert.equal(isToolsUnsupportedError(Object.assign(new Error('HTTP 401: invalid key'), { status: 401 })), false);
});

test('rótulos das ações do agente', () => {
  assert.equal(describeToolCall({ name: 'navigate', args: { url: 'https://br.shein.com/x' } }).label, 'Abrindo br.shein.com');
  assert.equal(describeToolCall({ name: 'type', args: { text: 'camisa', submit: true } }).label, 'Digitando “camisa” e enviando');
  for (const t of BROWSER_TOOLS) {
    assert.equal(t.parameters.type, 'object', t.name);
    assert.ok(t.description.length > 20, t.name);
  }
});

// ---------------------------------------------------------------- capturas de tela
const IMG = { mediaType: 'image/jpeg', data: 'QUJD' };
const shotHistory = [
  { role: 'user', content: 'veja a página' },
  { role: 'assistant', content: '', toolCalls: [{ id: 's1', name: 'screenshot', args: {} }] },
  { role: 'tool', toolCallId: 's1', name: 'screenshot', content: 'Captura de tela (1280x800px)', image: IMG }
];

test('openai: captura vai numa mensagem de usuário com image_url após o resultado', async () => {
  const calls = mockFetch(['data: [DONE]\n\n']);
  await chatTurn({ providerId: 'openai', config: { apiKey: 'k' }, model: 'gpt-4o-mini', messages: shotHistory, tools });
  const m = calls[0].body.messages;
  assert.equal(m[2].role, 'tool');
  assert.equal(m[3].role, 'user');
  assert.equal(m[3].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

test('anthropic: captura dentro do tool_result', async () => {
  const calls = mockFetch(['data: {"type":"message_stop"}\n\n']);
  await chatTurn({ providerId: 'anthropic', config: { apiKey: 'k' }, model: 'm', messages: shotHistory, tools });
  const tr = calls[0].body.messages[2].content[0];
  assert.equal(tr.type, 'tool_result');
  assert.deepEqual(tr.content[1], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
});

test('gemini: captura como inlineData junto da functionResponse', async () => {
  const calls = mockFetch(['data: {"candidates":[]}\n\n']);
  await chatTurn({ providerId: 'gemini', config: { apiKey: 'g' }, model: 'gemini-2.5-flash', messages: shotHistory, tools });
  const parts = calls[0].body.contents[2].parts;
  assert.ok(parts[0].functionResponse);
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
});

test('ollama: captura em "images" numa mensagem de usuário', async () => {
  const calls = mockFetch(['{"done":true}\n']);
  await chatTurn({ providerId: 'ollama', config: {}, model: 'qwen2.5vl', messages: shotHistory, tools });
  const m = calls[0].body.messages;
  assert.equal(m[2].role, 'tool');
  assert.deepEqual(m[3].images, ['QUJD']);
});

test('detecta modelo sem visão', async () => {
  const { isVisionUnsupportedError } = await import('../src/lib/providers.js');
  assert.equal(isVisionUnsupportedError(Object.assign(new Error('HTTP 400: Image input is not supported for this model'), { status: 400 })), true);
  assert.equal(isVisionUnsupportedError(Object.assign(new Error('HTTP 400: model does not support images'), { status: 400 })), true);
  assert.equal(isVisionUnsupportedError(Object.assign(new Error('HTTP 429: rate limit'), { status: 429 })), false);
});
