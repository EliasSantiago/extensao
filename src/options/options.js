import { PROVIDERS, PROVIDER_ORDER, listModels, streamChat, modelsFor } from '../lib/providers.js';
import { getSettings, saveSettings, clearConversations, DEFAULT_SETTINGS } from '../lib/storage.js';
import { icon, hydrateIcons } from '../lib/icons.js';

const $ = (sel) => document.querySelector(sel);
let settings;
const cards = {};

hydrateIcons();
init();

async function init() {
  settings = await getSettings();
  $('#ext-id').textContent = chrome.runtime.id;
  renderProviders();
  fillGeneral();

  $('#btn-save').addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
  $('#btn-clear-history').addEventListener('click', async () => {
    if (!confirm('Apagar todas as conversas salvas? Esta ação não pode ser desfeita.')) return;
    await clearConversations();
    status('Histórico apagado.');
  });
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('Restaurar todas as configurações (incluindo chaves) para o padrão?')) return;
    settings = structuredClone(DEFAULT_SETTINGS);
    await saveSettings(settings);
    renderProviders();
    fillGeneral();
    status('Configurações restauradas.');
  });
  $('#btn-export').addEventListener('click', exportSettings);
}

function renderProviders() {
  $('#cloud-providers').innerHTML = '';
  $('#onprem-providers').innerHTML = '';
  const tpl = $('#provider-tpl');

  for (const id of PROVIDER_ORDER) {
    const p = PROVIDERS[id];
    const cfg = settings.providers[id];
    const node = tpl.content.firstElementChild.cloneNode(true);
    const f = (name) => node.querySelector(`[data-f="${name}"]`);
    hydrateIcons(node);

    node.querySelector('[data-p-icon]').innerHTML = icon(p.location === 'onprem' ? 'server-stack' : 'cloud');
    node.querySelector('[data-name]').textContent = p.name;
    node.querySelector('[data-help]').textContent = p.help;
    const link = node.querySelector('[data-link]');
    if (p.keyUrl) {
      link.href = p.keyUrl;
      link.innerHTML = `${p.needsKey ? 'Obter chave de API' : 'Site oficial'}${icon('arrow-top-right-on-square')}`;
    } else link.remove();

    if (id !== 'custom') node.querySelector('[data-label-field]').remove();
    else f('label').value = cfg.label || '';

    node.querySelector('[data-key-label]').textContent = p.needsKey ? 'Chave de API' : 'Chave de API (opcional)';
    f('enabled').checked = !!cfg.enabled;
    f('apiKey').value = cfg.apiKey || '';
    f('baseUrl').value = cfg.baseUrl || p.defaultBaseUrl;
    f('baseUrl').placeholder = p.defaultBaseUrl;
    f('models').value = (cfg.models || []).join('\n');
    f('models').placeholder = p.defaultModels.join('\n') || 'Clique em "Buscar modelos" ou digite os nomes';

    const syncDisabled = () => node.classList.toggle('disabled', !f('enabled').checked);
    f('enabled').addEventListener('change', syncDisabled);
    syncDisabled();

    const keyBtn = node.querySelector('[data-toggle-key]');
    keyBtn.innerHTML = icon('eye');
    keyBtn.addEventListener('click', () => {
      const show = f('apiKey').type === 'password';
      f('apiKey').type = show ? 'text' : 'password';
      keyBtn.innerHTML = icon(show ? 'eye-slash' : 'eye');
      keyBtn.title = show ? 'Ocultar chave' : 'Mostrar chave';
    });

    const result = node.querySelector('[data-result]');
    const report = (msg, ok) => {
      result.textContent = msg;
      result.className = `small result ${ok ? 'ok' : 'err'}`;
    };

    node.querySelector('[data-fetch]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      report('Buscando…', true);
      try {
        const models = await listModels(id, readCard(id));
        if (!models.length) throw new Error('Nenhum modelo retornado.');
        f('models').value = models.join('\n');
        report(`${models.length} modelos encontrados. Remova os que não quiser e salve.`, true);
      } catch (err) {
        report(err.message, false);
      } finally {
        btn.disabled = false;
      }
    });

    node.querySelector('[data-test]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const cfgNow = readCard(id);
      const model = modelsFor(id, cfgNow)[0];
      if (!model) {
        report('Informe ao menos um modelo.', false);
        btn.disabled = false;
        return;
      }
      report(`Testando ${model}…`, true);
      const started = performance.now();
      try {
        const reply = await streamChat({
          providerId: id,
          config: cfgNow,
          model,
          messages: [{ role: 'user', content: 'Responda apenas com: OK' }],
          maxTokens: 512,
          signal: AbortSignal.timeout(60000)
        });
        const ms = Math.round(performance.now() - started);
        report(`✓ ${model} respondeu em ${ms} ms: “${reply.trim().slice(0, 40)}”`, true);
      } catch (err) {
        report(err.name === 'TimeoutError' ? 'Tempo esgotado.' : err.message, false);
      } finally {
        btn.disabled = false;
      }
    });

    cards[id] = node;
    $(p.location === 'cloud' ? '#cloud-providers' : '#onprem-providers').appendChild(node);
  }
}

function readCard(id) {
  const node = cards[id];
  const f = (name) => node.querySelector(`[data-f="${name}"]`);
  return {
    enabled: f('enabled').checked,
    apiKey: f('apiKey').value.trim(),
    baseUrl: f('baseUrl').value.trim() || PROVIDERS[id].defaultBaseUrl,
    models: [...new Set(f('models').value.split('\n').map((s) => s.trim()).filter(Boolean))],
    label: f('label')?.value.trim() || ''
  };
}

function fillGeneral() {
  $('#systemPrompt').value = settings.systemPrompt || '';
  $('#temperature').value = settings.temperature ?? '';
  $('#maxTokens').value = settings.maxTokens ?? '';
  $('#pageCharLimit').value = settings.pageCharLimit;
  $('#sendWithEnter').checked = !!settings.sendWithEnter;
  $('#agentMode').checked = settings.agentMode !== false;
  $('#agentVision').checked = settings.agentVision !== false;
  $('#maxSteps').value = settings.maxSteps || 25;
}

const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

async function save() {
  for (const id of PROVIDER_ORDER) settings.providers[id] = readCard(id);
  settings.systemPrompt = $('#systemPrompt').value;
  settings.temperature = numOrNull($('#temperature').value);
  settings.maxTokens = numOrNull($('#maxTokens').value);
  settings.pageCharLimit = numOrNull($('#pageCharLimit').value) || DEFAULT_SETTINGS.pageCharLimit;
  settings.sendWithEnter = $('#sendWithEnter').checked;
  settings.agentMode = $('#agentMode').checked;
  settings.agentVision = $('#agentVision').checked;
  settings.maxSteps = Math.min(Math.max(numOrNull($('#maxSteps').value) || 25, 1), 100);

  await saveSettings(settings);
  status('✓ Configurações salvas.');
}

function exportSettings() {
  const copy = structuredClone(settings);
  for (const id of Object.keys(copy.providers)) copy.providers[id].apiKey = '';
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nexo-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let statusTimer;
function status(text) {
  $('#status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($('#status').textContent = ''), 3500);
}
