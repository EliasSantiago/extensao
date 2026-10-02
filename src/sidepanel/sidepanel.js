import { PROVIDERS, PROVIDER_ORDER, modelsFor, displayName, streamChat } from '../lib/providers.js';
import { getSettings, updateSettings, listConversations, saveConversation, deleteConversation, newId } from '../lib/storage.js';
import { renderMarkdown } from '../lib/markdown.js';
import { icon, hydrateIcons } from '../lib/icons.js';

const $ = (sel) => document.querySelector(sel);

// Perguntas que mencionam a aba atual incluem o conteúdo da página automaticamente.
const PAGE_MENTION = /(^|\s)(n?est[ae]|n?ess[ae]|d?est[ae]|d?ess[ae]|d[ao]|n[ao])\s+(p[aá]gina|aba|site|artigo|mat[eé]ria|not[ií]cia|post|texto da p[aá]gina)(?=[\s.,!?;:]|$)/i;

const els = {
  messages: $('#messages'),
  welcome: $('#welcome'),
  input: $('#input'),
  send: $('#btn-send'),
  title: $('#chat-title'),
  chip: $('#context-chip'),
  chipText: $('#context-chip-text'),
  chipClear: $('#context-chip-clear'),
  modelBtn: $('#model-btn'),
  modelBtnIcon: $('#model-btn-icon'),
  modelBtnLabel: $('#model-btn-label'),
  modelMenu: $('#model-menu'),
  modelSearch: $('#model-search'),
  modelList: $('#model-list'),
  history: $('#history'),
  historyList: $('#history-list'),
  historySearch: $('#history-search')
};

const state = {
  settings: null,
  conversation: null,
  busy: false,
  abort: null,
  includePage: false, // definido pelos atalhos / menu de contexto
  attachedContext: null, // { label, text, url } vindo de uma seleção
  available: [] // [{ provider, model }]
};

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

hydrateIcons();
init();

async function init() {
  state.settings = await getSettings();
  state.conversation = blankConversation();
  refreshModels();
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
  els.input.addEventListener('input', () => {
    autoResize();
    updateSendState();
  });

  $('#btn-new').addEventListener('click', newChat);
  $('#btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#btn-history').addEventListener('click', openHistory);
  $('#btn-title').addEventListener('click', openHistory);
  $('#history-close').addEventListener('click', () => els.history.classList.add('hidden'));
  els.historySearch.addEventListener('input', renderHistory);
  els.chipClear.addEventListener('click', () => {
    state.includePage = false;
    setAttachedContext(null);
  });

  // Seletor de modelos
  els.modelBtn.addEventListener('click', () => (els.modelMenu.classList.contains('hidden') ? openModelMenu() : closeModelMenu()));
  els.modelSearch.addEventListener('input', () => renderModelList());
  els.modelSearch.addEventListener('keydown', onModelMenuKey);
  $('#model-manage').addEventListener('click', () => {
    closeModelMenu();
    chrome.runtime.openOptionsPage();
  });
  document.addEventListener('mousedown', (e) => {
    if (!els.modelMenu.classList.contains('hidden') && !e.target.closest('.model-picker')) closeModelMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!els.modelMenu.classList.contains('hidden')) closeModelMenu(true);
    else if (!els.history.classList.contains('hidden')) els.history.classList.add('hidden');
  });

  document.querySelectorAll('.suggestion').forEach((btn) =>
    btn.addEventListener('click', () => {
      els.input.value = btn.dataset.prompt;
      autoResize();
      if (btn.dataset.page) {
        state.includePage = true;
        send();
      } else {
        els.input.focus();
        updateSendState();
      }
    })
  );

  // Copiar blocos de código (delegação)
  els.messages.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
    copyText(btn.closest('.code-block').querySelector('code').textContent, btn);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.settings) {
      state.settings = await getSettings();
      refreshModels();
    }
    if (area === 'session' && changes.pendingPrompt?.newValue) {
      await consumePendingPrompt();
    }
  });
}

// ---------------------------------------------------------------------------
// Seletor de modelos (popover próprio)
// ---------------------------------------------------------------------------

function providerIcon(id) {
  return icon(PROVIDERS[id]?.location === 'onprem' ? 'server-stack' : 'cloud');
}

function refreshModels() {
  const { settings } = state;
  state.available = [];
  for (const id of PROVIDER_ORDER) {
    const cfg = settings.providers[id];
    if (!cfg?.enabled) continue;
    for (const model of modelsFor(id, cfg)) state.available.push({ provider: id, model });
  }

  const conv = state.conversation;
  const has = (p, m) => state.available.some((a) => a.provider === p && a.model === m);
  if (conv && !has(conv.provider, conv.model)) {
    const fallback = has(settings.selected.provider, settings.selected.model) ? settings.selected : state.available[0];
    if (fallback) Object.assign(conv, { provider: fallback.provider, model: fallback.model });
  }
  updateModelButton();
  updateSendState();
  if (!els.modelMenu.classList.contains('hidden')) renderModelList();
}

function updateModelButton() {
  const conv = state.conversation;
  const ok = state.available.some((a) => a.provider === conv?.provider && a.model === conv?.model);
  if (ok) {
    els.modelBtnIcon.innerHTML = providerIcon(conv.provider);
    els.modelBtnLabel.textContent = conv.model;
    els.modelBtn.title = `${displayName(conv.provider, state.settings.providers[conv.provider])} · ${conv.model}`;
  } else {
    els.modelBtnIcon.innerHTML = icon('exclamation-triangle');
    els.modelBtnLabel.textContent = 'Configurar um provedor';
    els.modelBtn.title = 'Nenhum modelo disponível';
  }
}

function openModelMenu() {
  els.modelMenu.classList.remove('hidden');
  els.modelBtn.setAttribute('aria-expanded', 'true');
  els.modelSearch.value = '';
  renderModelList();
  els.modelSearch.focus();
  els.modelList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function closeModelMenu(focusInput = false) {
  els.modelMenu.classList.add('hidden');
  els.modelBtn.setAttribute('aria-expanded', 'false');
  if (focusInput) els.input.focus();
}

function renderModelList() {
  const q = els.modelSearch.value.trim().toLowerCase();
  const conv = state.conversation;
  els.modelList.innerHTML = '';
  let count = 0;

  for (const id of PROVIDER_ORDER) {
    const cfg = state.settings.providers[id];
    if (!cfg?.enabled) continue;
    const name = displayName(id, cfg);
    const items = modelsFor(id, cfg).filter((m) => !q || m.toLowerCase().includes(q) || name.toLowerCase().includes(q));
    if (!items.length) continue;

    const head = document.createElement('div');
    head.className = 'menu-group';
    const missingKey = PROVIDERS[id].needsKey && !cfg.apiKey;
    head.innerHTML = `${providerIcon(id)}<span></span>${missingKey ? '<em>sem chave</em>' : PROVIDERS[id].location === 'onprem' ? '<em>local</em>' : ''}`;
    head.querySelector('span').textContent = name;
    els.modelList.appendChild(head);

    for (const model of items) {
      const selected = conv.provider === id && conv.model === model;
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'menu-item';
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(selected));
      opt.dataset.provider = id;
      opt.dataset.model = model;
      opt.innerHTML = `<span class="mi-name"></span>${selected ? icon('check', 'mi-check') : ''}`;
      opt.querySelector('.mi-name').textContent = model;
      opt.addEventListener('click', () => selectModel(id, model));
      opt.addEventListener('mousemove', () => setActiveItem(opt));
      els.modelList.appendChild(opt);
      count++;
    }
  }

  if (!count) {
    const empty = document.createElement('div');
    empty.className = 'menu-empty';
    empty.textContent = q ? 'Nenhum modelo encontrado.' : 'Nenhum provedor ativo. Abra as configurações.';
    els.modelList.appendChild(empty);
  }
  setActiveItem(els.modelList.querySelector('[aria-selected="true"]') || els.modelList.querySelector('.menu-item'));
}

function setActiveItem(el) {
  els.modelList.querySelectorAll('.menu-item.active').forEach((n) => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

function onModelMenuKey(e) {
  const items = [...els.modelList.querySelectorAll('.menu-item')];
  const idx = items.findIndex((n) => n.classList.contains('active'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = items[(idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    setActiveItem(next);
    next?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    items[idx]?.click();
  }
}

async function selectModel(provider, model) {
  Object.assign(state.conversation, { provider, model });
  updateModelButton();
  updateSendState();
  closeModelMenu(true);
  state.settings = await updateSettings({ selected: { provider, model } });
}

// ---------------------------------------------------------------------------
// Contexto da página e da seleção
// ---------------------------------------------------------------------------

async function readPage(tabId) {
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id) throw new Error('Nenhuma aba ativa encontrada.');
  if (!/^(https?|file):/.test(tab.url || '')) {
    throw new Error('Não é possível ler esta aba (páginas internas do Chrome e da Web Store são protegidas).');
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const pick = document.querySelector('article, main, [role="main"]');
      const root = pick && pick.innerText.trim().length > 500 ? pick : document.body;
      return {
        title: document.title,
        url: location.href,
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
  renderChip();
}

function renderChip() {
  const ctx = state.attachedContext;
  if (ctx) {
    els.chipText.textContent = `${ctx.label}: “${ctx.text.slice(0, 200)}${ctx.text.length > 200 ? '…' : ''}”`;
  } else if (state.includePage) {
    els.chipText.textContent = 'Conteúdo da aba atual será enviado';
  }
  els.chip.classList.toggle('hidden', !ctx && !state.includePage);
  updateSendState();
}

async function consumePendingPrompt() {
  const { pendingPrompt } = await chrome.storage.session.get('pendingPrompt');
  if (!pendingPrompt || Date.now() - pendingPrompt.createdAt > 60_000) return;
  await chrome.storage.session.remove('pendingPrompt');

  if (state.busy) stop();
  if (state.conversation.messages.length) newChat();

  if (pendingPrompt.type === 'selection') {
    setAttachedContext({ label: 'Seleção', text: pendingPrompt.text, url: pendingPrompt.url });
    if (pendingPrompt.instruction) {
      els.input.value = pendingPrompt.instruction;
      await send();
    } else {
      els.input.focus();
    }
  } else if (pendingPrompt.type === 'page') {
    state.includePage = true;
    els.input.value = pendingPrompt.instruction;
    await send({ tabId: pendingPrompt.tabId });
  }
}

// ---------------------------------------------------------------------------
// Envio e streaming
// ---------------------------------------------------------------------------

function currentModelAvailable() {
  const conv = state.conversation;
  return state.available.some((a) => a.provider === conv.provider && a.model === conv.model);
}

function updateSendState() {
  if (state.busy) {
    els.send.disabled = false;
    return;
  }
  const hasInput = els.input.value.trim() || state.attachedContext;
  els.send.disabled = !hasInput || !currentModelAvailable();
}

async function send({ tabId } = {}) {
  const text = els.input.value.trim();
  const ctx = state.attachedContext;
  if (state.busy || (!text && !ctx)) return;

  const conv = state.conversation;
  if (!currentModelAvailable()) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const question = text || 'Analise o texto abaixo.';
  const includePage = state.includePage || PAGE_MENTION.test(question);
  const apiParts = [];
  const tags = [];

  if (includePage) {
    try {
      const page = await readPage(tabId);
      const attr = (s) => String(s).replace(/"/g, "'");
      apiParts.push(`<pagina titulo="${attr(page.title)}" url="${attr(page.url)}">\n${page.text}\n</pagina>`);
      tags.push({ icon: 'globe-alt', text: page.title || page.url });
    } catch (err) {
      state.includePage = false;
      renderChip();
      showError(err.message);
      return;
    }
  }
  if (ctx) {
    apiParts.push(`<selecao${ctx.url ? ` url="${ctx.url}"` : ''}>\n${ctx.text}\n</selecao>`);
    tags.push({ icon: 'paper-clip', text: ctx.text.slice(0, 80) });
  }

  const userMsg = {
    role: 'user',
    content: question,
    apiContent: apiParts.length ? `${apiParts.join('\n\n')}\n\n${question}` : undefined,
    tags
  };

  els.input.value = '';
  autoResize();
  state.includePage = false;
  setAttachedContext(null);

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
            contentEl.classList.remove('thinking');
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
      assistant.content = err.message;
      el.classList.add('error');
    }
  } finally {
    cancelAnimationFrame(frame);
    contentEl.classList.remove('cursor', 'thinking');
    renderContent(contentEl, assistant);
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
  if (!conv.messages.length || !currentModelAvailable()) return;
  renderConversation();
  await generate();
}

function setBusy(busy) {
  state.busy = busy;
  els.send.classList.toggle('busy', busy);
  els.send.title = busy ? 'Parar' : 'Enviar';
  els.send.setAttribute('aria-label', els.send.title);
  updateSendState();
}

function showError(message) {
  const el = appendMessage({ role: 'assistant', content: message, error: true }, -1);
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
  updateModelButton();
  scrollToBottom(false);
}

function renderContent(contentEl, msg) {
  if (msg.error) {
    contentEl.innerHTML = `${icon('exclamation-triangle', 'err-icon')}<div class="err-text"></div>`;
    contentEl.querySelector('.err-text').textContent = msg.content.replace(/^⚠️\s*/, '');
  } else {
    contentEl.innerHTML = renderMarkdown(msg.content);
  }
}

function appendMessage(msg, index, { streaming = false } = {}) {
  els.welcome.classList.add('hidden');
  const el = document.createElement('div');
  el.className = `msg ${msg.role}${msg.error ? ' error' : ''}`;

  if (msg.role === 'user') {
    const col = document.createElement('div');
    col.className = 'user-col';
    for (const tag of msg.tags || []) {
      const t = document.createElement('div');
      t.className = 'ctx-tag';
      // compatível com conversas antigas (tags como string)
      const data = typeof tag === 'string' ? { icon: 'paper-clip', text: tag } : tag;
      t.innerHTML = `${icon(data.icon)}<span></span>`;
      t.querySelector('span').textContent = data.text;
      col.appendChild(t);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.content;
    col.appendChild(bubble);
    el.appendChild(col);
  } else {
    if (msg.model) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="avatar">${icon('sparkles')}</span><b></b><span class="prov"></span>`;
      meta.querySelector('b').textContent = msg.model;
      meta.querySelector('.prov').textContent = displayName(msg.provider, state.settings.providers[msg.provider]);
      el.appendChild(meta);
    }
    const content = document.createElement('div');
    content.className = 'content' + (streaming ? ' cursor thinking' : '');
    if (streaming) content.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    else renderContent(content, msg);
    el.appendChild(content);
    if (!streaming && index >= 0) addMessageTools(el, msg, index);
  }

  els.messages.appendChild(el);
  if (streaming) scrollToBottom();
  return el;
}

function toolButton(iconName, label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(iconName);
  b.addEventListener('click', onClick);
  return b;
}

function addMessageTools(el, msg, index) {
  if (el.querySelector('.msg-tools') || msg.error && index < 0) return;
  const tools = document.createElement('div');
  tools.className = 'msg-tools';
  if (!msg.error) {
    const copy = toolButton('clipboard-document', 'Copiar resposta', () => copyText(msg.content, copy, true));
    tools.appendChild(copy);
  }
  if (index === state.conversation.messages.length - 1) {
    tools.appendChild(toolButton('arrow-path', 'Gerar novamente com o modelo selecionado', regenerate));
  }
  if (tools.children.length) el.appendChild(tools);
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

async function copyText(text, btn, iconOnly = false) {
  const original = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
    btn.innerHTML = iconOnly ? icon('check') : `${icon('check')}Copiado`;
  } catch {
    btn.innerHTML = iconOnly ? icon('x-mark') : `${icon('x-mark')}Falhou`;
  }
  btn.classList.add('done');
  setTimeout(() => {
    btn.innerHTML = original;
    btn.classList.remove('done');
  }, 1400);
}

// ---------------------------------------------------------------------------
// Conversas e histórico
// ---------------------------------------------------------------------------

function newChat() {
  if (state.busy) stop();
  state.conversation = blankConversation();
  state.includePage = false;
  setAttachedContext(null);
  els.history.classList.add('hidden');
  refreshModels();
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

    const del = toolButton('trash', 'Excluir conversa', async (e) => {
      e.stopPropagation();
      if (!confirm(`Excluir a conversa “${c.title}”?`)) return;
      await deleteConversation(c.id);
      if (c.id === state.conversation.id) newChat();
      els.history.classList.remove('hidden');
      renderHistory();
    });
    del.classList.add('h-del');

    li.append(main, del);
    li.addEventListener('click', () => {
      if (state.busy) stop();
      state.conversation = c;
      refreshModels();
      renderConversation();
      els.history.classList.add('hidden');
    });
    els.historyList.appendChild(li);
  }
}
