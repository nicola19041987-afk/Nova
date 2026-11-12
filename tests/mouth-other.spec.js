const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

test('su un altro volto i punti di Nova non deformano, e la bocca vera resta simmetrica', async ({ page }) => {
  await page.goto('/');
  const snap = await page.evaluate(async () => {
    const bmp = document.createElement('canvas');
    bmp.width = 360; bmp.height = 640;
    const g = bmp.getContext('2d');
    g.fillStyle = '#9fd0ea'; g.fillRect(0, 0, 360, 640);
    g.fillStyle = '#e8c56b'; g.fillRect(90, 180, 180, 70);
    g.fillStyle = '#f2c9a0'; g.beginPath(); g.ellipse(180, 360, 100, 120, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 5;
    g.strokeRect(118, 310, 52, 34); g.strokeRect(190, 310, 52, 34);
    g.beginPath(); g.moveTo(170, 327); g.lineTo(190, 327); g.stroke();
    const mx = 0.46 * 360, my = 140 + 0.62 * 360;
    g.fillStyle = '#9a3040'; g.beginPath(); g.ellipse(mx, my, 26, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a3318'; g.fillRect(mx - 3, my + 12, 6, 16);
    const src = bmp.toDataURL('image/png');
    const img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = src; });
    img._src = 'glasses-check';
    const mouth = { x: 0.46, y: 0.62 };
    const good = {
      auto: true, v: 3, src: 'glasses-check',
      eyeL: { x: 0.38, y: 0.48 }, eyeR: { x: 0.54, y: 0.48 },
      mouth, mouthL: { x: 0.40, y: 0.62 }, mouthR: { x: 0.52, y: 0.62 }, mouthW: 0.12,
    };
    const nova = {
      auto: true, v: 3, src: 'nova-portrait',
      eyeL: { x: 0.38, y: 0.42 }, eyeR: { x: 0.62, y: 0.42 },
      mouth: { x: 0.5, y: 0.7 }, mouthL: { x: 0.43, y: 0.7 }, mouthR: { x: 0.57, y: 0.7 }, mouthW: 0.14,
    };
    document.body.classList.add('solo-mode');
    const prev = document.getElementById('avatar-canvas'); if (prev) prev.id = 'avatar-canvas-app';
    const c = document.createElement('canvas');
    c.id = 'avatar-canvas';
    c.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:354px';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    av.img = img; av.breathOn = false; av.nextBlink = 1e15; av.blinkStart = -1e9;
    av.resize();
    const shoot = (lm, open) => {
      av.lm = lm; av._trustKey = ''; av._lmFrom = av._lmTo = null;
      av.mouth = open; av._mh = 0; av.speaking = false; av.wide = 0.5; av._drawn = 0;
      av._pose = null; av._last = 5000;
      av.frame(5000);
      return av.ctx.getImageData(0, 0, c.width, c.height);
    };
    const diffAt = (a, b, x, y, rad) => {
      let m = 0, n = 0;
      for (let yy = Math.max(0, y - rad); yy < Math.min(a.height, y + rad); yy++) {
        for (let xx = Math.max(0, x - rad); xx < Math.min(a.width, x + rad); xx++) {
          const i = (yy * a.width + xx) * 4;
          const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
          if (d > m) m = d; n++;
        }
      }
      return { max: m, n };
    };
    const S = 1000;
    const map = (p) => { const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img)); return { x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit }; };
    const rest = shoot(good, 0);
    const stillWrong = shoot(nova, 0);
    const wrong = shoot(nova, 1);
    const opened = shoot(good, 1);
    const centre = map(mouth);
    const left = map(good.mouthL), right = map(good.mouthR);
    const side = (im, sign) => {
      let sy = 0, w = 0;
      const x0 = Math.floor(Math.min(left.x, right.x) - 6), x1 = Math.ceil(Math.max(left.x, right.x) + 6);
      const y0 = Math.floor(centre.y - 24), y1 = Math.ceil(centre.y + 36);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
        const dx = x - centre.x;
        if (sign < 0 && dx >= 0) continue;
        if (sign > 0 && dx < 0) continue;
        const i = (y * im.width + x) * 4, j = (y * rest.width + x) * 4;
        const d = Math.abs(im.data[i] - rest.data[j]) + Math.abs(im.data[i + 1] - rest.data[j + 1]) + Math.abs(im.data[i + 2] - rest.data[j + 2]);
        sy += (y - centre.y) * d; w += d;
      }
      return w > 1 ? { y: sy / w, w } : null;
    };
    const L = side(opened, -1);
    const R = side(opened, 1);
    const chin = (im, sign) => {
      let sy = 0, sx = 0, w = 0;
      const x0 = Math.floor(centre.x - 40), x1 = Math.ceil(centre.x + 40);
      const y0 = Math.floor(centre.y), y1 = Math.ceil(centre.y + 28);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
        const dx = x - centre.x;
        if (sign < 0 && dx >= -2) continue;
        if (sign > 0 && dx <= 2) continue;
        const i = (y * im.width + x) * 4, j = (y * rest.width + x) * 4;
        const d = Math.abs(im.data[i] - rest.data[j]) + Math.abs(im.data[i + 1] - rest.data[j + 1]) + Math.abs(im.data[i + 2] - rest.data[j + 2]);
        sy += (y - centre.y) * d; sx += dx * d; w += d;
      }
      return w > 1 ? { y: sy / w, x: sx / w, w } : null;
    };
    const cL = chin(opened, -1), cR = chin(opened, 1);
    av.lm = { mouth: { x: 0.5, y: 0.7 } }; av._trustKey = ''; av.speaking = false; av.mouth = 0; av._drawn = 0; av._last = 0;
    av.frame(1000);
    const idleA = av.ctx.getImageData(0, 0, c.width, c.height);
    av._drawn = 0; av._last = 1000;
    av.frame(3400);
    const idleB = av.ctx.getImageData(0, 0, c.width, c.height);
    let idleDiff = 0, idleN = 0;
    for (let i = 0; i < idleA.data.length; i += 16) { idleDiff += Math.abs(idleA.data[i] - idleB.data[i]); idleN++; }
    const crop = (im) => {
      const out = document.createElement('canvas');
      out.width = 120; out.height = 90;
      const ox = Math.max(0, Math.round(centre.x - 60)), oy = Math.max(0, Math.round(centre.y - 30));
      const tmp = document.createElement('canvas'); tmp.width = im.width; tmp.height = im.height;
      tmp.getContext('2d').putImageData(im, 0, 0);
      out.getContext('2d').drawImage(tmp, ox, oy, 120, 90, 0, 0, 120, 90);
      return out.toDataURL('image/png');
    };
    return {
      trustedGood: av.faceTrusted.call({ img, lm: good, _trustKey: '' }) || (av.lm = good, av._trustKey = '', av.faceTrusted()),
      trustedNova: (av.lm = nova, av._trustKey = '', av.faceTrusted()),
      wrongMax: diffAt(wrong, stillWrong, Math.round(centre.x), Math.round(centre.y), 40).max,
      corner: diffAt(opened, rest, 8, 8, 6).max,
      L, R, cL, cR,
      idle: idleDiff / Math.max(1, idleN),
      before: crop(rest),
      after: crop(opened),
    };
  });
  expect(snap.trustedNova).toBe(false);
  expect(snap.trustedGood).toBe(true);
  expect(snap.wrongMax).toBeLessThan(12);
  expect(snap.corner).toBeLessThan(8);
  expect(snap.L && snap.R).toBeTruthy();
  expect(Math.abs(snap.L.y - snap.R.y)).toBeLessThan(8);
  expect(snap.L.w).toBeGreaterThan(0);
  expect(snap.R.w).toBeGreaterThan(0);
  expect(snap.cL && snap.cR).toBeTruthy();
  expect(Math.abs(snap.cL.y - snap.cR.y)).toBeLessThan(6);
  expect(Math.abs(snap.cL.x + snap.cR.x)).toBeLessThan(10);
  // v2d-29: a riposo, senza ammiccare, la foto resta ferma (niente respiro né ondeggiamento).
  expect(snap.idle).toBeLessThan(0.4);
  const dir = path.join(__dirname, '..', 'docs', 'mouth-check', 'glasses');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before.png'), Buffer.from(snap.before.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(dir, 'after.png'), Buffer.from(snap.after.split(',')[1], 'base64'));
});
