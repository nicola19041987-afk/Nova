const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

const ROOT = path.join(__dirname, '..');
const FACE = path.join(ROOT, 'assets', 'ready', 'nova-scelta.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
const PHASE = process.env.CROP_PHASE || 'dopo';

test('bocca per vocale e occhi naturali, a metà e a tutto schermo', async ({ page }, testInfo) => {
  test.setTimeout(90000);
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
    av.breathOn = false;
    av.micro.nextBrow = 1e15; av.micro.nextSacc = 1e15; av.micro.nextMicro = 1e15; av.micro.nextSmile = 1e15; av.micro.nextLook = 1e15;
      av.micro.gx = 0; av.micro.gy = 0; av.micro.gtx = 0; av.micro.gty = 0; av.micro.brow = 0; av.micro.smile = 0;
      av.micro.lid = 0; av.micro.lidT = 0; av.micro.nextLid = 1e15;
    const S = 1000;
    const quiet = () => {
      av.nextBlink = 1e15; av.blinkStart = -1e9; av.blinkDur = 220; av.blinkAmp = 1;
      av._pose = { roll: 0, pitch: 0, yaw: 0, lean: 1, torso: 0, breath: 0, tRoll: 0, tPitch: 0, tYaw: 0, tLean: 1, next: 1e15 };
      av.breathOn = false; av.micro.gx = 0; av.micro.gy = 0; av.micro.gtx = 0; av.micro.gty = 0;
    };
    const shoot = (w, h, prep, now) => {
      c.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px`;
      av.resize();
      quiet();
      prep(now);
      av._drawn = 0; av._last = now - 16;
      av.frame(now);
      const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img));
      const map = (p) => ({ x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit });
      return { im: av.ctx.getImageData(0, 0, c.width, c.height), map, dpr: window.devicePixelRatio };
    };
    const crop = (im, x, y, w, h) => {
      const a = Math.max(0, Math.floor(x)), b = Math.max(0, Math.floor(y));
      const ww = Math.max(8, Math.min(im.width - a, Math.ceil(w)));
      const hh = Math.max(8, Math.min(im.height - b, Math.ceil(h)));
      const out = document.createElement('canvas'); out.width = ww; out.height = hh;
      out.getContext('2d').putImageData(im, -a, -b);
      return out.toDataURL('image/png');
    };
    const mean = (im, x0, x1, y0, y1, base) => {
      let s = 0, n = 0;
      x0 = Math.max(0, x0 | 0); x1 = Math.min(im.width, x1 | 0); y0 = Math.max(0, y0 | 0); y1 = Math.min(im.height, y1 | 0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * im.width + x) * 4, j = base ? (y * base.width + x) * 4 : i;
        s += base
          ? Math.abs(im.data[i] - base.data[j]) + Math.abs(im.data[i + 1] - base.data[j + 1]) + Math.abs(im.data[i + 2] - base.data[j + 2])
          : im.data[i] * 0.3 + im.data[i + 1] * 0.59 + im.data[i + 2] * 0.11;
        n++;
      }
      return s / Math.max(1, n);
    };
    const views = [['half', 390, 354], ['full', 390, 844]];
    const vowels = { rest: [0, 0.5], A: [0.85, 0.55], O: [0.72, 0.16], E: [0.62, 0.9] };
    const mouth = {};
    const eyes = {};
    const metrics = {};
    for (const [name, w, h] of views) {
      const rest = shoot(w, h, () => { av.mouth = 0; av._mh = 0; av.wide = 0.5; av.speaking = false; }, 8000);
      const again = shoot(w, h, () => { av.mouth = 0; av._mh = 0; av.wide = 0.5; av.speaking = false; }, 8000);
      const M = rest.map(lm.mouth), L = rest.map(lm.mouthL), R = rest.map(lm.mouthR);
      const eL = rest.map(lm.eyeL), eR = rest.map(lm.eyeR);
      const span = Math.hypot(R.x - L.x, R.y - L.y);
      const ang = Math.atan2(R.y - L.y, R.x - L.x), cos = Math.cos(ang), sin = Math.sin(ang);
      const box = (padX, padY) => {
        const xs = [L.x, R.x, M.x], ys = [L.y, R.y, M.y];
        return [Math.min(...xs) - padX, Math.min(...ys) - padY * 0.6, Math.max(...xs) - Math.min(...xs) + padX * 2, Math.max(...ys) - Math.min(...ys) + padY * 2.2];
      };
      const [mx, my, mw, mh] = box(span * 0.35, span * 0.55);
      mouth[name + '-rest'] = crop(rest.im, mx, my, mw, mh);
      const shape = {};
      for (const [key, spec] of Object.entries(vowels)) {
        if (key === 'rest') continue;
        const cur = shoot(w, h, () => { av.mouth = spec[0]; av._mh = spec[0]; av.wide = spec[1]; av.speaking = true; }, 8000);
        mouth[name + '-' + key] = crop(cur.im, mx, my, mw, mh);
        let coreW = 0, coreH = 0, n = 0, sideL = 0, sideR = 0, nL = 0, nR = 0, corner = 0, nC = 0, center = 0, nK = 0;
        const x0 = Math.max(0, Math.floor(M.x - span)), x1 = Math.min(cur.im.width, Math.ceil(M.x + span));
        const y0 = Math.max(0, Math.floor(M.y - span * 0.7)), y1 = Math.min(cur.im.height, Math.ceil(M.y + span * 0.85));
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y * cur.im.width + x) * 4, j = (y * rest.im.width + x) * 4;
          const d = Math.abs(cur.im.data[i] - rest.im.data[j]) + Math.abs(cur.im.data[i + 1] - rest.im.data[j + 1]) + Math.abs(cur.im.data[i + 2] - rest.im.data[j + 2]);
          const dx = x - M.x, dy = y - M.y;
          const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
          if (Math.abs(lx) > span * 0.62 || ly < -span * 0.28 || ly > span * 0.55) continue;
          if (d > 18) { minX = Math.min(minX, lx); maxX = Math.max(maxX, lx); minY = Math.min(minY, ly); maxY = Math.max(maxY, ly); n++; }
          if (Math.abs(lx) < span * 0.22) { center += d; nK++; }
          else if (Math.abs(lx) > span * 0.46) { corner += d; nC++; }
          if (lx < 0) { sideL += d; nL++; } else { sideR += d; nR++; }
        }
        shape[key] = {
          bw: n ? maxX - minX : 0, bh: n ? maxY - minY : 0,
          corner: corner / Math.max(1, nC), center: center / Math.max(1, nK),
          left: sideL / Math.max(1, nL), right: sideR / Math.max(1, nR),
        };
      }
      const eyeBox = () => {
        const xs = [eL.x, eR.x], ys = [eL.y, eR.y];
        const padX = span * 0.55, padY = span * 0.42;
        return [Math.min(...xs) - padX, Math.min(...ys) - padY, Math.max(...xs) - Math.min(...xs) + padX * 2, Math.max(...ys) - Math.min(...ys) + padY * 2];
      };
      const [ex, ey, ew, eh] = eyeBox();
      const eyeShoot = (blinkAt) => shoot(w, h, (now) => {
        av.mouth = 0; av._mh = 0; av.speaking = false; av.wide = 0.5;
        if (blinkAt == null) { av.blinkStart = -1e9; }
        else { av.blinkDur = 400; av.blinkStart = now - 400 * blinkAt; av.blinkAmp = 1; }
      }, 9000);
      const openE = eyeShoot(null);
      const midE = eyeShoot(0.17);
      const closedE = eyeShoot(0.37);
      eyes[name + '-open'] = crop(openE.im, ex, ey, ew, eh);
      eyes[name + '-mid'] = crop(midE.im, ex, ey, ew, eh);
      eyes[name + '-closed'] = crop(closedE.im, ex, ey, ew, eh);
      const irisR = Math.max(3, Math.hypot(eR.x - eL.x, eR.y - eL.y) * 0.07);
      const iris = (im, e) => mean(im, e.x - irisR, e.x + irisR, e.y - irisR * 0.8, e.y + irisR * 0.8);
      metrics[name] = {
        idle: mean(again.im, M.x - span * 0.4, M.x + span * 0.4, M.y - span * 0.3, M.y + span * 0.4, rest.im),
        shape,
        irisOpen: (iris(openE.im, eL) + iris(openE.im, eR)) / 2,
        irisMid: (iris(midE.im, eL) + iris(midE.im, eR)) / 2,
        irisClosed: (iris(closedE.im, eL) + iris(closedE.im, eR)) / 2,
        lidMid: (mean(midE.im, eL.x - irisR * 1.4, eL.x + irisR * 1.4, eL.y - irisR, eL.y + irisR, openE.im) + mean(midE.im, eR.x - irisR * 1.4, eR.x + irisR * 1.4, eR.y - irisR, eR.y + irisR, openE.im)) / 2,
        lidClosed: (mean(closedE.im, eL.x - irisR * 1.4, eL.x + irisR * 1.4, eL.y - irisR, eL.y + irisR, openE.im) + mean(closedE.im, eR.x - irisR * 1.4, eR.x + irisR * 1.4, eR.y - irisR, eR.y + irisR, openE.im)) / 2,
        eyeEdge: mean(closedE.im, eL.x - span * 0.2, eL.x + span * 0.2, eL.y - span * 0.16, eL.y + span * 0.16, openE.im),
        dpr: rest.dpr,
      };
    }
    av.mouth = 0; av._mh = 0; av.speaking = true; av.speakLive(() => 1, () => 0.9);
    let now = 20000, last = 0, maxStep = 0;
    for (let i = 0; i < 10; i++) { now += 20; av._drawn = 0; av.frame(now); maxStep = Math.max(maxStep, Math.abs(av.mouth - last)); last = av.mouth; }
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const randomWas = Math.random;
    Math.random = rnd;
    const starts = [];
    av.speaking = false; av.mouth = 0; av.nextBlink = 30000; av.blinkStart = -1e9;
    for (let t = 30000; t < 62000; t += 40) { av._drawn = 0; av._last = t - 40; av.frame(t); if (av.blinkStart === t) starts.push(t); }
    Math.random = randomWas;
    const gaps = [];
    for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
    return { mouth, eyes, metrics, maxStep, gaps, starts: starts.length };
  }, { jpeg, lm: LM });
  if (testInfo.project.name === 'chromium') {
    const mouthDir = path.join(ROOT, 'docs', 'mouth-check', PHASE);
    const eyeDir = path.join(ROOT, 'docs', 'eyes-check', PHASE);
    fs.mkdirSync(mouthDir, { recursive: true });
    fs.mkdirSync(eyeDir, { recursive: true });
    for (const [k, png] of Object.entries(snap.mouth)) fs.writeFileSync(path.join(mouthDir, k + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    for (const [k, png] of Object.entries(snap.eyes)) fs.writeFileSync(path.join(eyeDir, k + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  expect(snap.maxStep).toBeLessThan(0.22);
  const doubles = snap.gaps.filter((g) => g < 500);
  const pauses = snap.gaps.filter((g) => g >= 500);
  expect(snap.starts).toBeGreaterThan(4);
  expect(doubles.length).toBeGreaterThan(0);
  for (const g of pauses) expect(g).toBeGreaterThanOrEqual(1900);
  for (const g of pauses) expect(g).toBeLessThanOrEqual(6200);
  for (const name of ['half', 'full']) {
    const m = snap.metrics[name];
    expect(m.dpr, name).toBeGreaterThanOrEqual(2.5);
    expect(m.idle, name).toBeLessThan(1.5);
    expect(m.irisClosed, name).toBeLessThan(m.irisOpen - 8);
    expect(m.lidMid, name).toBeGreaterThan(1.2);
    expect(m.lidClosed, name).toBeGreaterThan(m.lidMid + 1);
    const A = m.shape.A, O = m.shape.O, E = m.shape.E;
    for (const s of [A, O, E]) {
      expect(s.left, name).toBeGreaterThan(0.8);
      expect(s.right, name).toBeGreaterThan(0.8);
      expect(Math.max(s.left, s.right) / Math.min(s.left, s.right), name).toBeLessThan(1.85);
      expect(s.corner, name).toBeLessThan(s.center * 0.55);
    }
    expect(O.bw, name).toBeLessThan(E.bw * 0.92);
    expect(A.bh, name).toBeGreaterThan(E.bh * 1.05);
  }
});
