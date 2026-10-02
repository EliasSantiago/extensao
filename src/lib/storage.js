// Persistência de configurações e conversas em chrome.storage.local
// (local, não sincronizado: chaves de API nunca saem do navegador).

import { PROVIDER_ORDER, PROVIDERS } from './providers.js';

const MAX_CONVERSATIONS = 200;

export const DEFAULT_SETTINGS = {
  providers: Object.fromEntries(
    PROVIDER_ORDER.map((id) => [
      id,
      {
        enabled: ['openai', 'anthropic', 'gemini', 'ollama'].includes(id),
        apiKey: '',
        baseUrl: PROVIDERS[id].defaultBaseUrl,
        models: [],
        label: ''
      }
    ])
  ),
  selected: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  systemPrompt:
    'Você é o Nexo, um assistente útil integrado ao navegador do usuário. Responda em português do Brasil, ' +
    'de forma clara e objetiva, usando Markdown quando ajudar. Quando receber o conteúdo de uma página, ' +
    'baseie-se nele e diga quando a informação não estiver presente.',
  temperature: null,
  maxTokens: null,
  pageCharLimit: 30000,
  agentMode: true,
  maxSteps: 25,
  sendWithEnter: true
};

function merge(defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
  if (defaults && typeof defaults === 'object') {
    const out = { ...defaults };
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        out[key] = key in defaults ? merge(defaults[key], value[key]) : value[key];
      }
    }
    return out;
  }
  return value === undefined ? defaults : value;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return merge(DEFAULT_SETTINGS, settings);
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  return next;
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

export async function listConversations() {
  const { conversations } = await chrome.storage.local.get('conversations');
  return (conversations || []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getConversation(id) {
  return (await listConversations()).find((c) => c.id === id) || null;
}

export async function saveConversation(conversation) {
  const all = await listConversations();
  const idx = all.findIndex((c) => c.id === conversation.id);
  conversation.updatedAt = Date.now();
  if (idx >= 0) all[idx] = conversation;
  else all.unshift(conversation);
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  await chrome.storage.local.set({ conversations: all.slice(0, MAX_CONVERSATIONS) });
}

export async function deleteConversation(id) {
  const all = await listConversations();
  await chrome.storage.local.set({ conversations: all.filter((c) => c.id !== id) });
}

export async function clearConversations() {
  await chrome.storage.local.set({ conversations: [] });
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
