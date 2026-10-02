// Teste ponta a ponta: carrega a extensão no Chromium (Playwright) com um servidor
// OpenAI-compatível simulado em localhost:8765.
// Uso: npm i -D playwright && npx playwright install chromium && node tests/e2e.cjs
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
}
const http = require('http');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, '..', 'dist', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

const EXT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<title>Página Teste</title><main><h1>Olá</h1><p>' + 'conteúdo '.repeat(100) + '</p></main>'); }
  if (req.url.endsWith('/models')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'mock-llm' }] })); }
  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    const last = j.messages[j.messages.length - 1].content;
    const hasPage = last.includes('<pagina');
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const parts = ['## Resposta\n\n', 'Você disse: **', last.slice(-20), '**\n\n', hasPage ? 'PAGINA_RECEBIDA\n\n' : '', '```js\nconsole.log(1)\n```'];
    let i = 0;
    const t = setInterval(() => {
      if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(t); }
    }, 30);
  });
});

(async () => {
  await new Promise((r) => server.listen(8765, r));
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const errors = [];
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = sw.url().split('/')[2];
  console.log('extension id', id);

  // a extensão abre as opções sozinha na instalação; espera essa aba para evitar corrida de navegação
  const optUrl = `chrome-extension://${id}/src/options/options.html`;
  for (let i = 0; i < 20 && !ctx.pages().some((p) => p.url() === optUrl); i++) await new Promise((r) => setTimeout(r, 100));

  const site = await ctx.newPage();
  await site.goto('http://localhost:8765/page');

  // options
  const opt = ctx.pages().find((p) => p.url() === optUrl) || (await ctx.newPage());
  opt.on('pageerror', (e) => errors.push('options: ' + e.message));
  opt.on('console', (m) => m.type() === 'error' && errors.push('options console: ' + m.text()));
  await opt.goto(optUrl);
  await opt.waitForSelector('.provider');
  console.log('provider cards:', await opt.locator('.provider').count());
  const custom = opt.locator('.provider').nth(5);
  await custom.locator('[data-f="enabled"]').check();
  await custom.locator('[data-f="baseUrl"]').fill('http://localhost:8765/v1');
  await custom.locator('[data-f="label"]').fill('Mock Local');
  await custom.locator('[data-fetch]').click();
  await opt.waitForFunction(() => document.querySelectorAll('[data-result]')[5].textContent.includes('encontrados'));
  console.log('fetch result:', await custom.locator('[data-result]').textContent());
  await custom.locator('[data-test]').click();
  await opt.waitForFunction(() => document.querySelectorAll('[data-result]')[5].textContent.includes('✓'), null, { timeout: 10000 });
  console.log('test result:', await custom.locator('[data-result]').textContent());
  await opt.click('#btn-save');
  await opt.screenshot({ path: path.join(OUT, 'options.png'), fullPage: true });

  // sidepanel
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 420, height: 760 });
  sp.on('pageerror', (e) => errors.push('sidepanel: ' + e.message));
  sp.on('console', (m) => m.type() === 'error' && errors.push('sidepanel console: ' + m.text()));
  await sp.goto(`chrome-extension://${id}/src/sidepanel/sidepanel.html`);
  await sp.screenshot({ path: path.join(OUT, 'sidepanel-welcome.png') });
  await sp.click('#model-btn');
  const options = await sp.$$eval('#model-list .menu-item', (o) => o.map((x) => `${x.dataset.provider}::${x.dataset.model}`));
  console.log('model options:', options.length, options.slice(-2));
  await sp.fill('#model-search', 'mock');
  await sp.screenshot({ path: path.join(OUT, 'sidepanel-models.png') });
  await sp.keyboard.press('Enter');
  console.log('selected model:', await sp.locator('#model-btn-label').textContent());
  await sp.fill('#input', 'Qual é a capital do Brasil?');
  await sp.keyboard.press('Enter');
  await sp.waitForSelector('.msg.assistant .code-block', { timeout: 10000 });
  await sp.waitForFunction(() => !document.querySelector('#btn-send').classList.contains('busy'));
  console.log('assistant text:', (await sp.locator('.msg.assistant .content').innerText()).replace(/\n/g, ' | '));

  // conversa salva
  const convs = await sp.evaluate(async () => (await chrome.storage.local.get('conversations')).conversations.length);
  console.log('saved conversations:', convs);

  // "usar página": aba ativa precisa ser a página de teste
  const pageRes = await sp.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.title === 'Página Teste');
    return t ? { id: t.id, url: t.url } : null;
  });
  console.log('test tab', pageRes);
  await sp.evaluate((tabId) => chrome.storage.session.set({ pendingPrompt: { type: 'page', instruction: 'Resuma esta página.', tabId, createdAt: Date.now() } }), pageRes.id);
  await sp.waitForFunction(() => document.querySelector('.msg.assistant .content')?.textContent.includes('PAGINA_RECEBIDA'), null, { timeout: 10000 });
  await sp.waitForFunction(() => !document.querySelector('#btn-send').classList.contains('busy'));
  await sp.screenshot({ path: path.join(OUT, 'sidepanel-chat.png') });
  console.log('page flow ok:', await sp.locator('.ctx-tag').first().textContent());
  await sp.screenshot({ path: path.join(OUT, 'sidepanel-chat.png') });

  // pending prompt (menu de contexto) de seleção
  await sp.evaluate(() => chrome.storage.session.set({ pendingPrompt: { type: 'selection', instruction: 'Resuma o texto abaixo.', text: 'Texto selecionado de exemplo', url: 'https://ex.com', title: 'Ex', createdAt: Date.now() } }));
  await sp.waitForFunction(() => document.querySelectorAll('.msg.assistant').length === 1 && document.querySelector('.ctx-tag')?.textContent.includes('Texto selecionado'), null, { timeout: 10000 });
  await sp.waitForFunction(() => !document.querySelector('#btn-send').classList.contains('busy'));
  console.log('selection flow ok:', await sp.locator('.ctx-tag').first().textContent());

  // histórico
  await sp.click('#btn-history');
  console.log('history items:', await sp.locator('#history-list li').count());
  await sp.screenshot({ path: path.join(OUT, 'sidepanel-history.png') });

  console.log('ERRORS:', errors);
  if (errors.length) process.exitCode = 1;
  await ctx.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
