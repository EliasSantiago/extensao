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
  return new Error(`HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 500)}` : ''}${hint}`);
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

// ---------------------------------------------------------------------------
// Adaptadores
// ---------------------------------------------------------------------------

const adapters = {
  openai: {
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken }) {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const body = {
        model,
        stream: true,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages]
      };
      if (isNum(temperature)) body.temperature = temperature;
      if (isNum(maxTokens)) {
        // A API oficial da OpenAI usa max_completion_tokens; servidores compatíveis usam max_tokens.
        if (providerId === 'openai') body.max_completion_tokens = maxTokens;
        else body.max_tokens = maxTokens;
      }
      const res = await request(providerId, `${baseUrl(providerId, config)}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      });
      for await (const data of sseData(res)) {
        if (data === '[DONE]') break;
        const json = parseJSON(data);
        if (!json) continue;
        if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onToken(delta);
      }
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
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken }) {
      const body = {
        model,
        stream: true,
        max_tokens: isNum(maxTokens) ? maxTokens : 8192,
        messages
      };
      if (system) body.system = system;
      if (isNum(temperature)) body.temperature = temperature;
      const res = await request(providerId, `${baseUrl(providerId, config)}/messages`, {
        method: 'POST',
        headers: this.headers(config),
        body: JSON.stringify(body),
        signal
      });
      for await (const data of sseData(res)) {
        const json = parseJSON(data);
        if (!json) continue;
        if (json.type === 'error') throw new Error(json.error?.message || 'Erro na API da Anthropic');
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') onToken(json.delta.text);
        if (json.type === 'message_stop') break;
      }
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
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken }) {
      const body = {
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const generationConfig = {};
      if (isNum(temperature)) generationConfig.temperature = temperature;
      if (isNum(maxTokens)) generationConfig.maxOutputTokens = maxTokens;
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

      const url = `${baseUrl(providerId, config)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
      const res = await request(providerId, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey || '' },
        body: JSON.stringify(body),
        signal
      });
      for await (const data of sseData(res)) {
        const json = parseJSON(data);
        if (!json) continue;
        if (json.error) throw new Error(json.error.message || 'Erro na API do Gemini');
        const parts = json.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        if (text) onToken(text);
        const reason = json.promptFeedback?.blockReason;
        if (reason) throw new Error(`Bloqueado pelo Gemini: ${reason}`);
      }
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
    async stream({ providerId, config, model, messages, system, temperature, maxTokens, signal, onToken }) {
      const options = {};
      if (isNum(temperature)) options.temperature = temperature;
      if (isNum(maxTokens)) options.num_predict = maxTokens;
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const res = await request(providerId, `${baseUrl(providerId, config)}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          stream: true,
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
          options
        }),
        signal
      });
      for await (const line of readLines(res)) {
        if (!line.trim()) continue;
        const json = parseJSON(line);
        if (!json) continue;
        if (json.error) throw new Error(json.error);
        if (json.message?.content) onToken(json.message.content);
        if (json.done) break;
      }
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

/**
 * Envia a conversa ao provedor e chama onToken a cada trecho recebido.
 * @returns {Promise<string>} texto completo da resposta
 */
export async function streamChat({ providerId, config = {}, model, messages, system, temperature, maxTokens, signal, onToken }) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Provedor desconhecido: ${providerId}`);
  if (provider.needsKey && !config.apiKey) {
    throw new Error(`Configure a chave de API de ${provider.name} nas configurações.`);
  }
  let full = '';
  await adapters[provider.kind].stream({
    providerId,
    config,
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    system,
    temperature,
    maxTokens,
    signal,
    onToken: (t) => {
      full += t;
      onToken?.(t, full);
    }
  });
  return full;
}

/** Lista os modelos disponíveis no provedor. */
export async function listModels(providerId, config = {}) {
  const provider = PROVIDERS[providerId];
  if (provider.needsKey && !config.apiKey) throw new Error('Informe a chave de API primeiro.');
  return adapters[provider.kind].listModels({ providerId, config });
}
