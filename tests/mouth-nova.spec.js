const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const jpeg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'greta.jpg')).toString('base64');

test('la bocca di Nova resta sul centro vero, simmetrica e ferma a riposo', async ({ page }) => {
  await page.goto('/');
  const snap = await page.evaluate(async (jpeg) => {
    const vision = await import('/vendor/mediapipe/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const task = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: '/vendor/mediapipe/face_landmarker.task', delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 1,
    });
    const img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error('foto')); im.src = 'data:image/jpeg;base64,' + jpeg; });
    const det = task.detect(img);
    const f = det.faceLandmarks && det.faceLandmarks[0];
    if (!f) return { error: 'viso non trovato' };
    const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2;
    const P = (i) => ({ x: (f[i].x * nw - ox) / s, y: (f[i].y * nh - oy) / s });
    const avg = (ids) => ids.reduce((o, i) => { const p = P(i); o.x += p.x; o.y += p.y; return o; }, { x: 0, y: 0 });
    const nAvg = (ids) => { const o = avg(ids); return { x: o.x / ids.length, y: o.y / ids.length }; };
    let mL = P(61), mR = P(291); if (mL.x > mR.x) [mL, mR] = [mR, mL];
    const lm = { auto: true, v: 3, src: 'greta-check', eyeL: nAvg([33, 133, 159, 145]), eyeR: nAvg([362, 263, 386, 374]), mouth: nAvg([13, 14]), mouthL: mL, mouthR: mR, lipU: P(13), lipL: P(14), mouthW: Math.hypot(mR.x - mL.x, mR.y - mL.y) };
    img._src = 'greta-check';
    document.body.classList.add('solo-mode');
    const prev = document.getElementById('avatar-canvas'); if (prev) prev.id = 'avatar-canvas-app';
    const c = document.createElement('canvas');
    c.id = 'avatar-canvas';
    c.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:354px';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    av.img = img; av.lm = lm; av._trustKey = ''; av.breathOn = false; av.nextBlink = 1e15; av.blinkStart = -1e9;
    av.resize();
    const S = 1000;
    const map = (p) => { const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img)); return { x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit }; };
    const mouth = map(lm.mouth), left = map(lm.mouthL), right = map(lm.mouthR);
    const shoot = (open, wide) => {
      av.mouth = open; av._mh = open; av.speaking = open > 0.02; av.wide = wide; av._drawn = 0;
      av._pose = null; av._last = 8000;
      av.frame(8000);
      return av.ctx.getImageData(0, 0, c.width, c.height);
    };
    const rest = shoot(0, 0.5);
    const plain = shoot(0, 0.5);
    av.lm = lm; av._trustKey = '';
    const opens = [0.3, 0.6, 1];
    const wides = [0.2, 0.55, 0.85];
    const metrics = [];
    const ang = Math.atan2(right.y - left.y, right.x - left.x);
    const toLocal = (x, y) => {
      const dx = x - mouth.x, dy = y - mouth.y;
      return { x: dx * Math.cos(ang) + dy * Math.sin(ang), y: -dx * Math.sin(ang) + dy * Math.cos(ang) };
    };
    const band = (im, side, base) => {
      let sx = 0, sy = 0, w = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const loc = toLocal(x, y);
        if (Math.abs(loc.x) > 36 || loc.y < -16 || loc.y > 42) continue;
        if (side === 'L' && loc.x >= 0) continue;
        if (side === 'R' && loc.x < 0) continue;
        const i = (y * im.width + x) * 4, j = (y * base.width + x) * 4;
        const d = Math.abs(im.data[i] - base.data[j]) + Math.abs(im.data[i + 1] - base.data[j + 1]) + Math.abs(im.data[i + 2] - base.data[j + 2]);
        sx += loc.x * d; sy += loc.y * d; w += d;
      }
      return w > 1 ? { x: sx / w, y: sy / w, w } : null;
    };
    let idle = 0, nIdle = 0;
    const y0 = Math.max(0, Math.floor(mouth.y - 30)), y1 = Math.min(c.height, Math.floor(mouth.y + 40));
    const x0 = Math.max(0, Math.floor(Math.min(left.x, right.x) - 8)), x1 = Math.min(c.width, Math.ceil(Math.max(left.x, right.x) + 8));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * rest.width + x) * 4;
      idle += Math.abs(rest.data[i] - plain.data[i]) + Math.abs(rest.data[i + 1] - plain.data[i + 1]) + Math.abs(rest.data[i + 2] - plain.data[i + 2]);
      nIdle++;
    }
    for (let k = 0; k < opens.length; k++) {
      const im = shoot(opens[k], wides[k]);
      const L = band(im, 'L', rest);
      const R = band(im, 'R', rest);
      const all = band(im, 'all', rest);
      metrics.push({ open: opens[k], wide: wides[k], L, R, all });
    }
    // fluidità: l'apertura non salta
    av.mouth = 0; av._mh = 0; av.speaking = true; av.speakLive(() => 0.8, () => 0.8);
    let now = performance.now(), last = 0, maxStep = 0;
    for (let i = 0; i < 12; i++) { now += 20; av.frame(now); maxStep = Math.max(maxStep, Math.abs(av.mouth - last)); last = av.mouth; }
    return { idle: idle / Math.max(1, nIdle), metrics, maxStep, mouth, left, right, w: c.width, h: c.height };
  }, jpeg);
  expect(snap.error || '').toBe('');
  expect(snap.idle).toBeLessThan(1.5);
  expect(snap.maxStep).toBeLessThan(0.25);
  for (const m of snap.metrics) {
    expect(m.all && m.L && m.R).toBeTruthy();
    expect(Math.abs(m.all.x), 'centro lungo le labbra, apertura ' + m.open).toBeLessThan(6);
    expect(Math.abs(m.L.y - m.R.y), 'altezza dei due lati, apertura ' + m.open).toBeLessThan(10);
    expect(Math.abs(m.L.x + m.R.x), 'simmetria lungo le labbra, apertura ' + m.open).toBeLessThan(8);
    expect(m.L.w).toBeGreaterThan(0);
    expect(m.R.w).toBeGreaterThan(0);
    expect(Math.max(m.L.w, m.R.w) / Math.min(m.L.w, m.R.w)).toBeLessThan(1.8);
  }
});
