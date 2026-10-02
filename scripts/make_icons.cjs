// Gera icons/icon{16,32,48,128}.png com a marca do Nexo
// usando o Chromium do Playwright. Uso: node scripts/make_icons.cjs
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
}
const path = require('path');

// Marca do Nexo (mesma de src/lib/icons.js): rota ligando nós, início e fim vazados.
const mark = (sw, r) =>
  `<path d="M6.5 17.5V6.5l11 11V6.5" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="6.5" cy="17.5" r="${r}" fill="#000" stroke="#fff" stroke-width="${sw}"/>` +
  `<circle cx="6.5" cy="6.5" r="${r}" fill="#fff"/>` +
  `<circle cx="17.5" cy="17.5" r="${r}" fill="#fff"/>` +
  `<circle cx="17.5" cy="6.5" r="${r}" fill="#000" stroke="#fff" stroke-width="${sw}"/>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const stroke = size <= 16 ? 2.3 : size <= 32 ? 2 : 1.7;
    const radius = size <= 16 ? 2.6 : 2.4;
    const pad = size <= 16 ? 0.08 : 0.16;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:#000;display:grid;place-items:center;box-sizing:border-box;border:${size >= 48 ? Math.round(size / 48) : 0}px solid #2a2a2a">
        <svg viewBox="0 0 24 24" width="${size * (1 - pad * 2)}" height="${size * (1 - pad * 2)}" fill="none" fill="none">${mark(stroke, radius)}</svg>
      </div></body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'icons', `icon${size}.png`), omitBackground: true });
    console.log(`icons/icon${size}.png`);
  }
  await browser.close();
})();
