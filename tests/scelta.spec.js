const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FACE = path.join(ROOT, 'assets', 'ready', 'nova-scelta.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));

test('la foto scelta apre la bocca lungo le labbra e il movimento di base c’è', async ({ page }, testInfo) => {
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
    c.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:700px';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    av.img = img; av.lm = lm; av._trustKey = '';
    av.nextBlink = 1e15; av.blinkStart = -1e9; av.blinkDur = 160;
    av.micro.nextBrow = 1e15; av.micro.nextSacc = 1e15; av.micro.nextMicro = 1e15; av.micro.nextSmile = 1e15;
    av.resize();
    const S = 1000;
    const map = (p) => { const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img)); return { x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit }; };
    const meanDiff = (a, b, x0, x1, y0, y1) => {
      let s = 0, n = 0;
      x0 = Math.max(0, x0); x1 = Math.min(a.width, x1); y0 = Math.max(0, y0); y1 = Math.min(a.height, y1);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        n++;
      }
      return s / Math.max(1, n);
    };
    const shoot = (open, now) => {
      av.mouth = open; av._mh = open; av.speaking = open > 0.02; av.wide = 0.55; av._drawn = 0;
      av._pose = null; av._last = now - 16; av.breathOn = false;
      av.nextBlink = 1e15; av.blinkStart = -1e9;
      av.frame(now);
      return av.ctx.getImageData(0, 0, c.width, c.height);
    };
    const rest = shoot(0, 8000);
    const mid = shoot(0.55, 8000);
    const opened = shoot(1, 8000);
    const mouth = map(lm.mouth), left = map(lm.mouthL), right = map(lm.mouthR);
    const ang = Math.atan2(right.y - left.y, right.x - left.x);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const span = Math.hypot(right.x - left.x, right.y - left.y);
    const side = (im) => {
      let L = 0, R = 0, nL = 0, nR = 0;
      const x0 = Math.max(0, Math.floor(Math.min(left.x, right.x, mouth.x) - 18));
      const x1 = Math.min(im.width, Math.ceil(Math.max(left.x, right.x, mouth.x) + 18));
      const y0 = Math.max(0, Math.floor(Math.min(left.y, right.y, mouth.y) - 18));
      const y1 = Math.min(im.height, Math.ceil(Math.max(left.y, right.y, mouth.y) + 40));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const dx = x - mouth.x, dy = y - mouth.y;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        if (Math.abs(lx) > span * 0.62 || ly < -10 || ly > 32) continue;
        const i = (y * im.width + x) * 4;
        const d = Math.abs(im.data[i] - rest.data[i]) + Math.abs(im.data[i + 1] - rest.data[i + 1]) + Math.abs(im.data[i + 2] - rest.data[i + 2]);
        if (lx < 0) { L += d; nL++; } else { R += d; nR++; }
      }
      return { left: L / Math.max(1, nL), right: R / Math.max(1, nR) };
    };
    const midS = side(mid), openS = side(opened);
    const ratio = (s) => Math.max(s.left, s.right) / Math.min(s.left, s.right);
    const cropOf = (im) => {
      const box = [lm.browL, lm.browR, lm.eyeL, lm.eyeR, lm.mouthL, lm.mouthR, lm.mouth].map(map);
      const xs = box.map((p) => p.x), ys = box.map((p) => p.y);
      const a = Math.max(0, Math.floor(Math.min(...xs) - 36));
      const b = Math.max(0, Math.floor(Math.min(...ys) - 40));
      const w = Math.max(8, Math.min(c.width - a, Math.ceil(Math.max(...xs) + 36) - a));
      const h = Math.max(8, Math.min(c.height - b, Math.ceil(Math.max(...ys) + 64) - b));
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d').putImageData(im, -a, -b);
      return out.toDataURL('image/png');
    };
    const T = 60000 / 13.5;
    const low = shoot(0, T * 0.75);
    const high = shoot(0, T * 0.25);
    const eye = map(lm.eyeL);
    const breath = meanDiff(low, high, 0, c.width, Math.max(0, Math.floor(eye.y - 20)), Math.min(c.height, Math.floor(mouth.y - 8)));
    av.blinkStart = 9000 - 40; av.blinkDur = 160; av.nextBlink = 1e15; av._last = 9000 - 16; av._drawn = 0; av._pose = null;
    av.mouth = 0; av._mh = 0; av.speaking = false; av.breathOn = false;
    av.frame(9000);
    const blinked = av.ctx.getImageData(0, 0, c.width, c.height);
    const blink = meanDiff(rest, blinked, Math.floor(eye.x - 20), Math.floor(eye.x + 20), Math.floor(eye.y - 14), Math.floor(eye.y + 14));
    av.micro.gtx = 1; av.micro.gx = 0; av.micro.nextSacc = 1e15; av.micro.nextMicro = 1e15;
    av.blinkStart = -1e9; av._pose = null;
    let gazeNow = 10000;
    for (let i = 0; i < 8; i++) { gazeNow += 40; av._last = gazeNow - 16; av._drawn = 0; av.mouth = 0; av.speaking = false; av.frame(gazeNow); }
    const gazed = av.ctx.getImageData(0, 0, c.width, c.height);
    const gaze = meanDiff(rest, gazed, Math.floor(eye.x - 24), Math.floor(eye.x + 24), Math.floor(eye.y - 16), Math.floor(eye.y + 16));
    const gx = av.micro.gx;
    av.micro.browT = 0.9; av.micro.browUntil = 1e15; av.micro.nextBrow = 1e15; av.micro.brow = 0;
    av.micro.gtx = 0; av.micro.gx = 0; av.blinkStart = -1e9; av._pose = null;
    let browNow = 12000;
    for (let i = 0; i < 6; i++) { browNow += 40; av._last = browNow - 16; av._drawn = 0; av.mouth = 0; av.speaking = false; av.frame(browNow); }
    const browIm = av.ctx.getImageData(0, 0, c.width, c.height);
    const brow = meanDiff(rest, browIm, Math.floor(map(lm.browL).x - 10), Math.floor(map(lm.browR).x + 10), Math.max(0, Math.floor(map(lm.browL).y - 12)), Math.floor(eye.y - 6));
    av.speakLive(() => 0.85, () => 0.5); av.speaking = true; av._pose = null; av.breathOn = true;
    let pitchNow = 14000;
    for (let i = 0; i < 12; i++) { pitchNow += 50; av.frame(pitchNow); }
    const pitched = av.ctx.getImageData(0, 0, c.width, c.height);
    const pitchDiff = meanDiff(rest, pitched, 0, c.width, Math.max(0, Math.floor(eye.y - 36)), Math.floor(eye.y - 4));
    return {
      trusted: av.faceTrusted(),
      mid: midS, open: openS, midRatio: ratio(midS), openRatio: ratio(openS),
      cornerDy: Math.abs(lm.mouthL.y - lm.mouthR.y),
      breath, blink, gaze, gx, brow, browV: av.micro.brow,
      pitch: av._pose && av._pose.pitch, pitchDiff,
      rest: cropOf(rest), midPng: cropOf(mid), openPng: cropOf(opened),
    };
  }, { jpeg, lm: LM });
  if (testInfo.project.name === 'chromium') {
    const out = path.join(ROOT, 'docs', 'mouth-check', 'scelta');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'rest.png'), Buffer.from(snap.rest.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(out, 'mid.png'), Buffer.from(snap.midPng.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(out, 'open.png'), Buffer.from(snap.openPng.split(',')[1], 'base64'));
  }
  expect(snap.trusted).toBe(true);
  expect(Math.abs(snap.cornerDy)).toBeLessThan(0.04);
  for (const part of [snap.mid, snap.open]) {
    expect(part.left).toBeGreaterThan(0.8);
    expect(part.right).toBeGreaterThan(0.8);
  }
  expect(snap.midRatio).toBeLessThan(2.4);
  expect(snap.openRatio).toBeLessThan(2.4);
  expect(snap.breath).toBeGreaterThan(0.4);
  expect(snap.blink).toBeGreaterThan(0.4);
  expect(Math.abs(snap.gx)).toBeGreaterThan(0.05);
  expect(snap.gaze).toBeGreaterThan(0.15);
  expect(snap.browV).toBeGreaterThan(0.2);
  expect(snap.brow).toBeGreaterThan(0.15);
  expect(Math.abs(snap.pitch)).toBeGreaterThan(0.001);
  expect(snap.pitchDiff).toBeGreaterThan(0.15);
});
