const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

const ROOT = path.join(__dirname, '..');
const FACE = path.join(ROOT, 'assets', 'ready', 'nova-scelta.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));

test('la bocca a risoluzione iPhone resta sulla linea delle labbra, in metà e a tutto schermo', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const jpeg = fs.readFileSync(FACE).toString('base64');
  await page.goto('/');
  const snap = await page.evaluate(async ({ jpeg, lm }) => {
    const img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error('foto')); im.src = 'data:image/jpeg;base64,' + jpeg; });
    img._src = lm.src;
    document.body.classList.add('solo-mode');
    const prev = document.getElementById('avatar-canvas'); if (prev) prev.id = 'avatar-canvas-app';
    const c = document.createElement('canvas');
    c.id = 'avatar-canvas';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    av.img = img; av.lm = JSON.parse(JSON.stringify(lm)); av._trustKey = '';
    av.nextBlink = 1e15; av.blinkStart = -1e9;
    av.micro.nextBrow = 1e15; av.micro.nextSacc = 1e15; av.micro.nextMicro = 1e15; av.micro.nextSmile = 1e15;
    const S = 1000;
    const shoot = (open, w, h) => {
      c.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px`;
      av.resize();
      av.mouth = open; av._mh = open; av.speaking = open > 0.02; av.wide = 0.5; av._drawn = 0;
      av._pose = null; av._last = 8000 - 16; av.breathOn = false; av.nextBlink = 1e15;
      av.frame(8000);
      const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img));
      const map = (p) => ({ x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit });
      return { im: av.ctx.getImageData(0, 0, c.width, c.height), mouth: map(lm.mouth), left: map(lm.mouthL), right: map(lm.mouthR), dpr: window.devicePixelRatio, cw: c.width, ch: c.height };
    };
    const views = [
      ['half', 390, 354],
      ['full', 390, 844],
    ];
    const out = {};
    for (const [name, w, h] of views) {
      const rest = shoot(0, w, h);
      for (const [label, open] of [['mid', 0.55], ['open', 1]]) {
        const cur = shoot(open, w, h);
        const ang = Math.atan2(cur.right.y - cur.left.y, cur.right.x - cur.left.x);
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const span = Math.hypot(cur.right.x - cur.left.x, cur.right.y - cur.left.y);
        let sx = 0, sy = 0, sw = 0, core = [], edge = [];
        const x0 = Math.max(0, Math.floor(cur.mouth.x - span * 0.9));
        const x1 = Math.min(cur.im.width, Math.ceil(cur.mouth.x + span * 0.9));
        const y0 = Math.max(0, Math.floor(cur.mouth.y - span * 0.55));
        const y1 = Math.min(cur.im.height, Math.ceil(cur.mouth.y + span * 0.7));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y * cur.im.width + x) * 4;
          const d = Math.abs(cur.im.data[i] - rest.im.data[i]) + Math.abs(cur.im.data[i + 1] - rest.im.data[i + 1]) + Math.abs(cur.im.data[i + 2] - rest.im.data[i + 2]);
          if (d < 12) continue;
          const dx = x - cur.mouth.x, dy = y - cur.mouth.y;
          const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
          sx += x * d; sy += y * d; sw += d;
          const lum = cur.im.data[i] * 0.3 + cur.im.data[i + 1] * 0.5 + cur.im.data[i + 2] * 0.2;
          if (Math.abs(lx) < span * 0.22 && ly > span * 0.02 && ly < span * 0.28) core.push(lum);
          if (Math.abs(lx) > span * 0.38 && Math.abs(lx) < span * 0.62) edge.push(d);
        }
        const mean = core.length ? core.reduce((a, b) => a + b, 0) / core.length : 0;
        const variance = core.length ? core.reduce((a, b) => a + (b - mean) * (b - mean), 0) / core.length : 0;
        const edgeMean = edge.length ? edge.reduce((a, b) => a + b, 0) / edge.length : 0;
        const cx0 = Math.max(0, Math.floor(cur.mouth.x - span * 1.3));
        const cy0 = Math.max(0, Math.floor(cur.mouth.y - span * 1.15));
        const cw = Math.min(cur.im.width - cx0, Math.ceil(span * 2.6));
        const ch = Math.min(cur.im.height - cy0, Math.ceil(span * 2.3));
        const crop = document.createElement('canvas'); crop.width = cw; crop.height = ch;
        crop.getContext('2d').putImageData(cur.im, -cx0, -cy0);
        out[name + '-' + label] = {
          png: crop.toDataURL('image/png'),
          offset: sw ? Math.hypot(sx / sw - cur.mouth.x, sy / sw - cur.mouth.y) / Math.max(1, span) : 99,
          variance, edgeMean, span, dpr: cur.dpr, cw: cur.cw, ch: cur.ch,
        };
      }
    }
    return out;
  }, { jpeg, lm: LM });
  const dir = path.join(ROOT, 'docs', 'mouth-check', 'scelta-iphone');
  if (testInfo.project.name === 'chromium') fs.mkdirSync(dir, { recursive: true });
  for (const [name, part] of Object.entries(snap)) {
    expect(part.dpr, name).toBeGreaterThanOrEqual(2.5);
    expect(part.offset, name).toBeLessThan(0.35);
    expect(part.variance, name).toBeGreaterThan(18);
    expect(part.edgeMean, name).toBeLessThan(part.variance * 4 + 40);
    if (testInfo.project.name === 'chromium') {
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(part.png.split(',')[1], 'base64'));
    }
  }
});
