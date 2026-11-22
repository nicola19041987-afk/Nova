// v2d-53: PNG dell'icona e degli splash IRA dagli SVG di scripts/make-icons-ira.py (Chromium di Playwright).
// Uso: node scripts/render-icons-ira.js <cartella-svg> <cartella-public>
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const [SRC, OUT] = [process.argv[2], process.argv[3] || 'public'];
const jobs = [
  ['icons/ira-icon.svg', 'icons/icon-1024.png', 1024], ['icons/ira-icon.svg', 'icons/icon-512.png', 512],
  ['icons/ira-icon.svg', 'icons/icon-192.png', 192], ['icons/ira-icon.svg', 'icons/icon-180.png', 180],
  ['icons/ira-icon-maskable.svg', 'icons/icon-maskable-512.png', 512],
  ['icons/ira-favicon-small.svg', 'icons/favicon-64.png', 64], ['icons/ira-favicon-small.svg', 'icons/favicon-32.png', 32],
];
for (const f of fs.readdirSync(path.join(SRC, 'splash-src'))) {
  const s = fs.readFileSync(path.join(SRC, 'splash-src', f), 'utf8'); const m = /width="(\d+)" height="(\d+)"/.exec(s);
  jobs.push([`splash-src/${f}`, `splash/${f.replace(/\.svg$/, '.png')}`, +m[1], +m[2]]);
}
(async () => {
  const b = await chromium.launch();
  for (const [src, dst, w, h0] of jobs) {
    const h = h0 || w;
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const svg = fs.readFileSync(path.join(SRC, src), 'utf8').replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}" preserveAspectRatio="none"`);
    await p.setContent(`<html><body style="margin:0;background:#000">${svg}</body></html>`);
    fs.mkdirSync(path.dirname(path.join(OUT, dst)), { recursive: true });
    await p.screenshot({ path: path.join(OUT, dst), clip: { x: 0, y: 0, width: w, height: h } });
    await p.close(); console.log(dst, w + 'x' + h);
  }
  await b.close();
})();
