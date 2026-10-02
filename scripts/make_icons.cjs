// Gera icons/icon{16,32,48,128}.png a partir do ícone "cube-transparent" (Heroicons)
// usando o Chromium do Playwright. Uso: node scripts/make_icons.cjs
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
}
const path = require('path');

const CUBE = 'm21 7.5-2.25-1.313M21 7.5v2.25m0-2.25-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3 2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75 2.25-1.313M12 21.75V19.5m0 2.25-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const stroke = size <= 16 ? 2.4 : size <= 32 ? 2.1 : 1.8;
    const pad = size <= 16 ? 0.14 : 0.2;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:#000;display:grid;place-items:center;box-sizing:border-box;border:${size >= 48 ? Math.round(size / 48) : 0}px solid #2a2a2a">
        <svg viewBox="0 0 24 24" width="${size * (1 - pad * 2)}" height="${size * (1 - pad * 2)}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${CUBE}"/></svg>
      </div></body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'icons', `icon${size}.png`), omitBackground: true });
    console.log(`icons/icon${size}.png`);
  }
  await browser.close();
})();
