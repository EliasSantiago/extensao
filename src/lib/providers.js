// Catálogo de provedores e adaptadores de API.
// Cada provedor usa um "kind" (formato de API): openai | anthropic | gemini | ollama.

export const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    location: 'cloud',
    needsKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    help: 'Crie uma chave em platform.openai.com.'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    kind: 'anthropic',
    location: 'cloud',
    needsKey: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    help: 'Crie uma chave em console.anthropic.com.'
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    location: 'cloud',
    needsKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
    help: 'Crie uma chave no Google AI Studio.'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'ollama',
    location: 'onprem',
    needsKey: false,
    defaultBaseUrl: 'http://localhost:11434',
    defaultModels: ['llama3.1', 'qwen2.5', 'mistral'],
    keyUrl: 'https://ollama.com/download',
    help: 'Inicie o Ollama com OLLAMA_ORIGINS="chrome-extension://*" para liberar o acesso da extensão.'
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'openai',
    location: 'onprem',
    needsKey: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModels: [],
    keyUrl: 'https://lmstudio.ai',
    help: 'Ative o "Local Server" no LM Studio (com CORS habilitado) e clique em "Buscar modelos".'
  },
  custom: {
    id: 'custom',
    name: 'OpenAI-compatível (vLLM, LocalAI, llama.cpp…)',
    kind: 'openai',
    location: 'onprem',
    needsKey: false,
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModels: [],
    keyUrl: '',
    help: 'Qualquer servidor com /v1/chat/completions: vLLM, LocalAI, llama.cpp server, TGI, LiteLLM, Open WebUI, OpenRouter, Groq, Azure (via proxy)…'
  }
};

export const PROVIDER_ORDER = ['openai', 'anthropic', 'gemini', 'ollama', 'lmstudio', 'custom'];

/** Modelos visíveis para um provedor (configurados pelo usuário ou padrão). */
export function modelsFor(providerId, config) {
  const list = (config?.models || []).map((m) => m.trim()).filter(Boolean);
  return list.length ? list : PROVIDERS[providerId].defaultModels;
}

export function displayName(providerId, config) {
  if (providerId === 'custom' && config?.label) return config.label;
  return PROVIDERS[providerId]?.name || providerId;
}

function baseUrl(providerId, config) {
  return (config?.baseUrl || PROVIDERS[providerId].defaultBaseUrl).replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Utilidades de rede
// ---------------------------------------------------------------------------

async function httpError(res, providerId) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json.error?.message || json.error || json.message || json.detail || text;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      detail = text;
    }
  } catch {
    /* ignora */
  }
  let hint = '';
  if (res.status === 401 || res.status === 403) {
    hint = PROVIDERS[providerId].location === 'onprem'
      ? ' — verifique a liberação de CORS/origem no servidor local.'
      : ' — verifique a chave de API nas configurações.';
  } else if (res.status === 404) {
    hint = ' — verifique a URL base e o nome do modelo.';
  } else if (res.status === 429) {
    hint = ' — limite de uso/cota atingido.';
  }
  const error = new Error(`HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 500)}` : ''}${hint}`);
  error.status = res.status;
  error.detail = String(detail || '');
  return error;
}

async function request(providerId, url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const local = PROVIDERS[providerId].location === 'onprem';
    throw new Error(
      `Não foi possível conectar a ${url}.` +
        (local ? ' O servidor local está rodando e com CORS liberado?' : ' Verifique sua conexão.')
    );
  }
  if (!res.ok) throw await httpError(res, providerId);
  return res;
}

async function* readLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

async function* sseData(response) {
  for await (const line of readLines(response)) {
    if (line.startsWith('data:')) yield line.slice(5).trimStart();
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}


function newCallId() {
  return `call_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (!raw) return {};
  const parsed = parseJSON(raw);
  return parsed && typeof parsed === 'object' ? parsed : { _raw: String(raw) };
}

// ---------------------------------------------------------------------------
// Formato de mensagens unificado
//
//   { role: 'user', content }
//   { role: 'assistant', content, toolCalls?: [{ id, name, args, signature? }] }
//   { role: 'tool', toolCallId, name, content, isError? }
//
// Ferramentas: [{ name, description, parameters (JSON Schema) }]
// Cada adaptador converte para o formato do seu provedor e devolve
// { toolCalls } — o texto é entregue por onToken durante o streaming.
// ---------------------------------------------------------------------------

/** Junta mensagens consecutivas do mesmo papel (exigência da Anthropic/Gemini). */
function pushMerged(list, msg, key) {
  const last = list[list.length - 1];
  if (last && last.role === msg.role) {
    last[key] = [...last[key], ...msg[key]];
  } else {
    list.push(msg);
  }
}

const adapters = {
  openai: {
    toMessages(messages, system) {
      const out = system ? [{ role: 'system', content: system }] : [];
      for (const m of messages) {
        if (m.role === 'tool') {
          out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
        } else if (m.role === 'assistant' && m.toolCalls?.length) {
          out.push({
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.args || {}) }
            }))
          });
        } else {
          out.push({ role: m.role, content: m.content });
        }
      }
      return out;
    },
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken, tools }) {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const body = { model, stream: true, messages: this.toMessages(messages, system) };
      if (isNum(temperature)) body.temperature = temperature;
      if (isNum(maxTokens)) {
        // A API oficial da OpenAI usa max_completion_tokens; servidores compatíveis usam max_tokens.
        if (providerId === 'openai') body.max_completion_tokens = maxTokens;
        else body.max_tokens = maxTokens;
      }
      if (tools?.length) {
        body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
      const res = await request(providerId, `${baseUrl(providerId, config)}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      });
      const calls = [];
      for await (const data of sseData(res)) {
        if (data === '[DONE]') break;
        const json = parseJSON(data);
        if (!json) continue;
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        const delta = json.choices?.[0]?.delta || json.choices?.[0]?.message;
        if (!delta) continue;
        if (delta.content) onToken(delta.content);
        (delta.tool_calls || []).forEach((tc, i) => {
          const idx = tc.index ?? i;
          const c = (calls[idx] ||= { id: '', name: '', args: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) {
            c.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          }
        });
      }
      return {
        toolCalls: calls.filter((c) => c && c.name).map((c) => ({ id: c.id || newCallId(), name: c.name, args: parseArgs(c.args) }))
      };
    },
    async listModels({ providerId, config }) {
      const headers = {};
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await request(providerId, `${baseUrl(providerId, config)}/models`, { headers });
      const json = await res.json();
      let ids = (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
      if (providerId === 'openai') {
        ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding)/.test(id));
      }
      return ids.sort();
    }
  },

  anthropic: {
    headers(config) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey || '',
        'anthropic-version': '2023-06-01',
        // Necessário para chamar a API diretamente do navegador.
        'anthropic-dangerous-direct-browser-access': 'true'
      };
    },
    toMessages(messages) {
      const out = [];
      for (const m of messages) {
        if (m.role === 'tool') {
          pushMerged(out, {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '(vazio)', ...(m.isError ? { is_error: true } : {}) }]
          }, 'content');
        } else if (m.role === 'assistant') {
          const blocks = [];
          if (m.content) blocks.push({ type: 'text', text: m.content });
          for (const c of m.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
          if (blocks.length) pushMerged(out, { role: 'assistant', content: blocks }, 'content');
        } else {
          const last = out[out.length - 1];
          if (last?.role === 'user') last.content.push({ type: 'text', text: m.content });
          else out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
        }
      }
      // Mantém o formato simples (string) quando a mensagem é só texto.
      return out.map((m) =>
        m.content.length === 1 && m.content[0].type === 'text' ? { role: m.role, content: m.content[0].text } : m
      );
    },
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken, tools }) {
      const body = {
        model,
        stream: true,
        max_tokens: isNum(maxTokens) ? maxTokens : 8192,
        messages: this.toMessages(messages)
      };
      if (system) body.system = system;
      if (isNum(temperature)) body.temperature = temperature;
      if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      const res = await request(providerId, `${baseUrl(providerId, config)}/messages`, {
        method: 'POST',
        headers: this.headers(config),
        body: JSON.stringify(body),
        signal
      });
      const blocks = {};
      for await (const data of sseData(res)) {
        const json = parseJSON(data);
        if (!json) continue;
        if (json.type === 'error') throw new Error(json.error?.message || 'Erro na API da Anthropic');
        if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
          blocks[json.index] = { id: json.content_block.id, name: json.content_block.name, args: '' };
        }
        if (json.type === 'content_block_delta') {
          if (json.delta?.type === 'text_delta') onToken(json.delta.text);
          if (json.delta?.type === 'input_json_delta' && blocks[json.index]) blocks[json.index].args += json.delta.partial_json;
        }
        if (json.type === 'message_stop') break;
      }
      return {
        toolCalls: Object.keys(blocks)
          .sort((a, b) => a - b)
          .map((k) => ({ id: blocks[k].id, name: blocks[k].name, args: parseArgs(blocks[k].args) }))
      };
    },
    async listModels({ providerId, config }) {
      const res = await request(providerId, `${baseUrl(providerId, config)}/models?limit=100`, {
        headers: this.headers(config)
      });
      const json = await res.json();
      return (json.data || []).map((m) => m.id);
    }
  },

  gemini: {
    toContents(messages) {
      const out = [];
      for (const m of messages) {
        if (m.role === 'tool') {
          pushMerged(out, { role: 'user', parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] }, 'parts');
        } else if (m.role === 'assistant') {
          const parts = [];
          if (m.content) parts.push({ text: m.content });
          for (const c of m.toolCalls || []) {
            parts.push({ functionCall: { name: c.name, args: c.args || {} }, ...(c.signature ? { thoughtSignature: c.signature } : {}) });
          }
          if (parts.length) pushMerged(out, { role: 'model', parts }, 'parts');
        } else {
          pushMerged(out, { role: 'user', parts: [{ text: m.content }] }, 'parts');
        }
      }
      return out;
    },
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken, tools }) {
      const body = { contents: this.toContents(messages) };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const generationConfig = {};
      if (isNum(temperature)) generationConfig.temperature = temperature;
      if (isNum(maxTokens)) generationConfig.maxOutputTokens = maxTokens;
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
      if (tools?.length) {
        body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
      }

      const url = `${baseUrl(providerId, config)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const res = await request(providerId, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey || '' },
        body: JSON.stringify(body),
        signal
      });
      const toolCalls = [];
      for await (const data of sseData(res)) {
        const json = parseJSON(data);
        if (!json) continue;
        if (json.error) throw new Error(json.error.message || 'Erro na API do Gemini');
        const parts = json.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        if (text) onToken(text);
        for (const p of parts) {
          if (p.functionCall) {
            toolCalls.push({
              id: p.functionCall.id || newCallId(),
              name: p.functionCall.name,
              args: p.functionCall.args || {},
              ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {})
            });
          }
        }
        const reason = json.promptFeedback?.blockReason;
        if (reason) throw new Error(`Bloqueado pelo Gemini: ${reason}`);
      }
      return { toolCalls };
    },
    async listModels({ providerId, config }) {
      const res = await request(providerId, `${baseUrl(providerId, config)}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': config.apiKey || '' }
      });
      const json = await res.json();
      return (json.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((id) => /gemini|gemma/.test(id))
        .sort()
        .reverse();
    }
  },

  ollama: {
    toMessages(messages, system) {
      const out = system ? [{ role: 'system', content: system }] : [];
      for (const m of messages) {
        if (m.role === 'tool') out.push({ role: 'tool', content: m.content, tool_name: m.name });
        else if (m.role === 'assistant' && m.toolCalls?.length) {
          out.push({
            role: 'assistant',
            content: m.content || '',
            tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args || {} } }))
          });
        } else out.push({ role: m.role, content: m.content });
      }
      return out;
    },
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken, tools }) {
      const options = {};
      if (isNum(temperature)) options.temperature = temperature;
      if (isNum(maxTokens)) options.num_predict = maxTokens;
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const body = { model, stream: true, messages: this.toMessages(messages, system), options };
      if (tools?.length) {
        body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      }
      const res = await request(providerId, `${baseUrl(providerId, config)}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      });
      const toolCalls = [];
      for await (const line of readLines(res)) {
        if (!line.trim()) continue;
        const json = parseJSON(line);
        if (!json) continue;
        if (json.error) throw new Error(json.error);
        if (json.message?.content) onToken(json.message.content);
        for (const tc of json.message?.tool_calls || []) {
          toolCalls.push({ id: tc.id || newCallId(), name: tc.function?.name, args: parseArgs(tc.function?.arguments) });
        }
        if (json.done) break;
      }
      return { toolCalls: toolCalls.filter((c) => c.name) };
    },
    async listModels({ providerId, config }) {
      const headers = {};
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await request(providerId, `${baseUrl(providerId, config)}/api/tags`, { headers });
      const json = await res.json();
      return (json.models || []).map((m) => m.name).sort();
    }
  }
};

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

function cleanMessages(messages) {
  return messages.map((m) => {
    const out = { role: m.role, content: m.content ?? '' };
    if (m.toolCalls?.length) out.toolCalls = m.toolCalls;
    if (m.role === 'tool') Object.assign(out, { toolCallId: m.toolCallId, name: m.name, isError: !!m.isError });
    return out;
  });
}

/**
 * Um turno do modelo: envia a conversa (com ferramentas opcionais), entrega o texto
 * por onToken durante o streaming e devolve { text, toolCalls }.
 */
export async function chatTurn({ providerId, config = {}, model, messages, system, temperature, maxTokens, signal, onToken, tools }) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Provedor desconhecido: ${providerId}`);
  if (provider.needsKey && !config.apiKey) {
    throw new Error(`Configure a chave de API de ${provider.name} nas configurações.`);
  }
  let text = '';
  const { toolCalls = [] } = await adapters[provider.kind].stream({
    providerId,
    config,
    model,
    messages: cleanMessages(messages),
    system,
    temperature,
    maxTokens,
    signal,
    tools,
    onToken: (t) => {
      text += t;
      onToken?.(t, text);
    }
  });
  return { text, toolCalls };
}

/** Atalho sem ferramentas: devolve só o texto da resposta. */
export async function streamChat(opts) {
  const { text } = await chatTurn({ ...opts, tools: undefined });
  return text;
}

/** Erro típico de modelo/servidor que não aceita ferramentas (function calling). */
export function isToolsUnsupportedError(err) {
  const msg = `${err?.message || ''} ${err?.detail || ''}`.toLowerCase();
  return (
    (err?.status === 400 || err?.status === 404 || err?.status === 422 || err?.status === 500) &&
    /(tool|function).{0,40}(support|not|unsupported|invalid|unknown|não)|does not support tools|tools? (is|are) not supported/.test(msg)
  );
}

/** Lista os modelos disponíveis no provedor. */
export async function listModels(providerId, config = {}) {
  const provider = PROVIDERS[providerId];
  if (provider.needsKey && !config.apiKey) throw new Error('Informe a chave de API primeiro.');
  return adapters[provider.kind].listModels({ providerId, config });
}
