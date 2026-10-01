import { PROVIDERS, PROVIDER_ORDER, modelsFor, displayName, streamChat } from '../lib/providers.js';
import { getSettings, updateSettings, listConversations, saveConversation, deleteConversation, newId } from '../lib/storage.js';
import { renderMarkdown } from '../lib/markdown.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  messages: $('#messages'),
  welcome: $('#welcome'),
  input: $('#input'),
  send: $('#btn-send'),
  modelSelect: $('#model-select'),
  usePage: $('#use-page'),
  title: $('#chat-title'),
  chip: $('#context-chip'),
  chipText: $('#context-chip-text'),
  chipClear: $('#context-chip-clear'),
  history: $('#history'),
  historyList: $('#history-list'),
  historySearch: $('#history-search')
};

const state = {
  settings: null,
  conversation: null,
  busy: false,
  abort: null,
  attachedContext: null // { label, text } vindo de uma seleção
};

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

init();

async function init() {
  state.settings = await getSettings();
  state.conversation = blankConversation();
  buildModelSelect();
  bindEvents();
  renderConversation();
  await consumePendingPrompt();
  els.input.focus();
}

function blankConversation() {
  const { provider, model } = state.settings.selected;
  return { id: newId(), title: 'Nova conversa', provider, model, messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}

function bindEvents() {
  els.send.addEventListener('click', () => (state.busy ? stop() : send()));

  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && state.settings.sendWithEnter) {
      e.preventDefault();
      if (!state.busy) send();
    }
  });
  els.input.addEventListener('input', autoResize);

  els.modelSelect.addEventListener('change', async () => {
    const value = els.modelSelect.value;
    if (value === '__manage__') {
      chrome.runtime.openOptionsPage();
      buildModelSelect();
      return;
    }
    const [provider, model] = splitModelValue(value);
    state.conversation.provider = provider;
    state.conversation.model = model;
    state.settings = await updateSettings({ selected: { provider, model } });
  });

  $('#btn-new').addEventListener('click', newChat);
  $('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#btn-history').addEventListener('click', openHistory);
  $('#history-close').addEventListener('click', () => els.history.classList.add('hidden'));
  els.historySearch.addEventListener('input', renderHistory);
  els.chipClear.addEventListener('click', () => setAttachedContext(null));

  document.querySelectorAll('.suggestion').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.dataset.page) els.usePage.checked = true;
      els.input.value = btn.dataset.prompt;
      autoResize();
      if (btn.dataset.prompt.endsWith(': ')) els.input.focus();
      else send();
    })
  );

  // Copiar blocos de código (delegação)
  els.messages.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('code').textContent;
    copyText(code, btn);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.settings) {
      state.settings = await getSettings();
      buildModelSelect();
    }
    if (area === 'session' && changes.pendingPrompt?.newValue) {
      await consumePendingPrompt();
    }
  });
}

// ---------------------------------------------------------------------------
// Seletor de modelos
// ---------------------------------------------------------------------------

function modelValue(provider, model) {
  return `${provider}::${model}`;
}

function splitModelValue(value) {
  const idx = value.indexOf('::');
  return [value.slice(0, idx), value.slice(idx + 2)];
}

function buildModelSelect() {
  const { settings } = state;
  const select = els.modelSelect;
  select.innerHTML = '';
  const available = [];

  for (const id of PROVIDER_ORDER) {
    const cfg = settings.providers[id];
    if (!cfg?.enabled) continue;
    const models = modelsFor(id, cfg);
    if (!models.length) continue;
    const group = document.createElement('optgroup');
    const tag = PROVIDERS[id].location === 'onprem' ? ' · on-premise' : '';
    const warn = PROVIDERS[id].needsKey && !cfg.apiKey ? ' (sem chave)' : '';
    group.label = `${displayName(id, cfg)}${tag}${warn}`;
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = modelValue(id, m);
      opt.textContent = m;
      group.appendChild(opt);
      available.push(opt.value);
    }
    select.appendChild(group);
  }

  const manage = document.createElement('option');
  manage.value = '__manage__';
  manage.textContent = '⚙ Gerenciar provedores e modelos…';
  select.appendChild(manage);

  const conv = state.conversation;
  const wanted = conv ? modelValue(conv.provider, conv.model) : modelValue(settings.selected.provider, settings.selected.model);
  if (available.includes(wanted)) {
    select.value = wanted;
  } else if (available.length) {
    select.value = available[0];
    const [provider, model] = splitModelValue(available[0]);
    if (conv) Object.assign(conv, { provider, model });
  } else {
    select.value = '__manage__';
  }
  els.send.disabled = !available.length;
}

// ---------------------------------------------------------------------------
// Contexto da página e da seleção
// ---------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function readPage(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : await getActiveTab();
  if (!tab?.id) throw new Error('Nenhuma aba ativa encontrada.');
  if (!/^(https?|file):/.test(tab.url || '')) {
    throw new Error('Não é possível ler esta página (páginas internas do Chrome e da Web Store são protegidas).');
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const pick = document.querySelector('article, main, [role="main"]');
      const root = pick && pick.innerText.trim().length > 500 ? pick : document.body;
      return {
        title: document.title,
        url: location.href,
        selection: String(window.getSelection() || '').trim(),
        text: (root?.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
      };
    }
  });
  const limit = state.settings.pageCharLimit || 30000;
  const truncated = result.text.length > limit;
  return { ...result, text: result.text.slice(0, limit) + (truncated ? '\n\n[…conteúdo truncado…]' : '') };
}

function setAttachedContext(ctx) {
  state.attachedContext = ctx;
  if (ctx) {
    els.chipText.textContent = `📎 ${ctx.label}: “${ctx.text.slice(0, 200)}${ctx.text.length > 200 ? '…' : ''}”`;
    els.chip.classList.remove('hidden');
  } else {
    els.chip.classList.add('hidden');
  }
}

async function consumePendingPrompt() {
  const { pendingPrompt } = await chrome.storage.session.get('pendingPrompt');
  if (!pendingPrompt || Date.now() - pendingPrompt.createdAt > 60_000) return;
  await chrome.storage.session.remove('pendingPrompt');

  if (state.busy) stop();
  if (state.conversation.messages.length) newChat();

  if (pendingPrompt.type === 'selection') {
    setAttachedContext({ label: 'Seleção', text: pendingPrompt.text, title: pendingPrompt.title, url: pendingPrompt.url });
    if (pendingPrompt.instruction) {
      els.input.value = pendingPrompt.instruction;
      await send();
    } else {
      els.input.focus();
    }
  } else if (pendingPrompt.type === 'page') {
    els.usePage.checked = true;
    els.input.value = pendingPrompt.instruction;
    await send({ tabId: pendingPrompt.tabId });
  }
}

// ---------------------------------------------------------------------------
// Envio e streaming
// ---------------------------------------------------------------------------

async function send({ tabId } = {}) {
  const text = els.input.value.trim();
  const ctx = state.attachedContext;
  if (state.busy || (!text && !ctx)) return;

  const conv = state.conversation;
  const [provider, model] = splitModelValue(els.modelSelect.value || '');
  if (!PROVIDERS[provider]) {
    chrome.runtime.openOptionsPage();
    return;
  }
  conv.provider = provider;
  conv.model = model;

  const question = text || 'Analise o texto abaixo.';
  const apiParts = [];
  const tags = [];

  if (els.usePage.checked) {
    try {
      const page = await readPage(tabId);
      const attr = (s) => String(s).replace(/"/g, "'");
      apiParts.push(`<pagina titulo="${attr(page.title)}" url="${attr(page.url)}">\n${page.text}\n</pagina>`);
      tags.push(`📄 ${page.title || page.url}`);
    } catch (err) {
      showError(err.message);
      return;
    }
  }
  if (ctx) {
    apiParts.push(`<selecao${ctx.url ? ` url="${ctx.url}"` : ''}>\n${ctx.text}\n</selecao>`);
    tags.push(`📎 ${ctx.text.slice(0, 60)}${ctx.text.length > 60 ? '…' : ''}`);
  }

  const userMsg = {
    role: 'user',
    content: question,
    apiContent: apiParts.length ? `${apiParts.join('\n\n')}\n\n${question}` : undefined,
    tags
  };

  els.input.value = '';
  autoResize();
  setAttachedContext(null);
  els.usePage.checked = false;

  conv.messages.push(userMsg);
  if (conv.title === 'Nova conversa') conv.title = question.slice(0, 60);
  els.title.textContent = conv.title;
  renderConversation();
  await generate();
}

async function generate() {
  const conv = state.conversation;
  const { settings } = state;
  const providerCfg = settings.providers[conv.provider] || {};

  const assistant = { role: 'assistant', content: '', provider: conv.provider, model: conv.model };
  conv.messages.push(assistant);
  const el = appendMessage(assistant, conv.messages.length - 1, { streaming: true });
  const contentEl = el.querySelector('.content');

  setBusy(true);
  state.abort = new AbortController();
  let frame = 0;

  const history = conv.messages
    .slice(0, -1)
    .filter((m) => !m.error && m.content)
    .map((m) => ({ role: m.role, content: m.apiContent || m.content }));

  try {
    await streamChat({
      providerId: conv.provider,
      config: providerCfg,
      model: conv.model,
      messages: history,
      system: settings.systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      signal: state.abort.signal,
      onToken: (_, full) => {
        assistant.content = full;
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            const stick = nearBottom();
            contentEl.innerHTML = renderMarkdown(assistant.content);
            if (stick) scrollToBottom();
          });
        }
      }
    });
    if (!assistant.content) assistant.content = '_(resposta vazia)_';
  } catch (err) {
    if (err.name === 'AbortError') {
      assistant.content += assistant.content ? '\n\n_(interrompido)_' : '_(interrompido)_';
    } else {
      assistant.error = true;
      assistant.content = `⚠️ ${err.message}`;
      el.classList.add('error');
    }
  } finally {
    cancelAnimationFrame(frame);
    contentEl.classList.remove('cursor');
    contentEl.innerHTML = renderMarkdown(assistant.content);
    addMessageTools(el, assistant, conv.messages.length - 1);
    setBusy(false);
    state.abort = null;
    scrollToBottom();
    await saveConversation(conv);
  }
}

function stop() {
  state.abort?.abort();
}

async function regenerate() {
  const conv = state.conversation;
  if (state.busy) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === 'assistant') conv.messages.pop();
  if (!conv.messages.length) return;
  const [provider, model] = splitModelValue(els.modelSelect.value);
  if (PROVIDERS[provider]) Object.assign(conv, { provider, model });
  renderConversation();
  await generate();
}

function setBusy(busy) {
  state.busy = busy;
  els.send.classList.toggle('busy', busy);
  els.send.title = busy ? 'Parar' : 'Enviar';
  els.send.disabled = false;
}

function showError(message) {
  const msg = { role: 'assistant', content: `⚠️ ${message}`, error: true };
  const el = appendMessage(msg, -1);
  el.classList.add('error');
  scrollToBottom();
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

function renderConversation() {
  const conv = state.conversation;
  els.messages.querySelectorAll('.msg').forEach((n) => n.remove());
  els.welcome.classList.toggle('hidden', conv.messages.length > 0);
  els.title.textContent = conv.title;
  conv.messages.forEach((m, i) => appendMessage(m, i));
  scrollToBottom(false);
}

function appendMessage(msg, index, { streaming = false } = {}) {
  els.welcome.classList.add('hidden');
  const el = document.createElement('div');
  el.className = `msg ${msg.role}${msg.error ? ' error' : ''}`;

  if (msg.role === 'user') {
    const wrap = document.createElement('div');
    wrap.className = 'bubble';
    for (const tag of msg.tags || []) {
      const t = document.createElement('div');
      t.className = 'ctx-tag';
      t.textContent = tag;
      wrap.appendChild(t);
      wrap.appendChild(document.createElement('br'));
    }
    wrap.appendChild(document.createTextNode(msg.content));
    el.appendChild(wrap);
  } else {
    if (msg.model) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${displayName(msg.provider, state.settings.providers[msg.provider])} · ${msg.model}`;
      el.appendChild(meta);
    }
    const content = document.createElement('div');
    content.className = 'content' + (streaming ? ' cursor' : '');
    content.innerHTML = renderMarkdown(msg.content);
    el.appendChild(content);
    if (!streaming && index >= 0) addMessageTools(el, msg, index);
  }

  els.messages.appendChild(el);
  if (streaming) scrollToBottom();
  return el;
}

function addMessageTools(el, msg, index) {
  if (el.querySelector('.msg-tools')) return;
  const tools = document.createElement('div');
  tools.className = 'msg-tools';

  const copy = document.createElement('button');
  copy.textContent = 'Copiar';
  copy.addEventListener('click', () => copyText(msg.content, copy));
  tools.appendChild(copy);

  if (index === state.conversation.messages.length - 1) {
    const retry = document.createElement('button');
    retry.textContent = 'Regenerar';
    retry.title = 'Gerar novamente com o modelo selecionado';
    retry.addEventListener('click', regenerate);
    tools.appendChild(retry);
  }
  el.appendChild(tools);
}

function nearBottom() {
  const m = els.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 80;
}

function scrollToBottom(smooth = true) {
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function autoResize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    btn.textContent = 'Falhou';
  }
}

// ---------------------------------------------------------------------------
// Conversas e histórico
// ---------------------------------------------------------------------------

function newChat() {
  if (state.busy) stop();
  state.conversation = blankConversation();
  setAttachedContext(null);
  els.usePage.checked = false;
  buildModelSelect();
  renderConversation();
  els.input.focus();
}

async function openHistory() {
  els.history.classList.remove('hidden');
  els.historySearch.value = '';
  await renderHistory();
  els.historySearch.focus();
}

async function renderHistory() {
  const query = els.historySearch.value.trim().toLowerCase();
  const all = await listConversations();
  const items = query
    ? all.filter((c) => c.title.toLowerCase().includes(query) || c.messages.some((m) => m.content.toLowerCase().includes(query)))
    : all;

  els.historyList.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = query ? 'Nada encontrado.' : 'Nenhuma conversa ainda.';
    els.historyList.appendChild(li);
    return;
  }

  for (const c of items) {
    const li = document.createElement('li');
    if (c.id === state.conversation.id) li.classList.add('active');

    const main = document.createElement('div');
    main.className = 'h-main';
    const title = document.createElement('div');
    title.className = 'h-title';
    title.textContent = c.title;
    const sub = document.createElement('div');
    sub.className = 'h-sub';
    sub.textContent = `${new Date(c.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · ${c.model}`;
    main.append(title, sub);

    const del = document.createElement('button');
    del.className = 'icon-btn h-del';
    del.title = 'Excluir';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Excluir a conversa “${c.title}”?`)) return;
      await deleteConversation(c.id);
      if (c.id === state.conversation.id) newChat();
      renderHistory();
    });

    li.append(main, del);
    li.addEventListener('click', () => {
      if (state.busy) stop();
      state.conversation = c;
      buildModelSelect();
      renderConversation();
      els.history.classList.add('hidden');
    });
    els.historyList.appendChild(li);
  }
}
