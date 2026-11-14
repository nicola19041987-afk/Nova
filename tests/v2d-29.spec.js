const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-29: mentre Nova parla il video idle (muto, bocca chiusa) lascia il posto alla foto col labiale.
// La cornice resta ferma: cambiano solo bocca e occhi. Il video riparte dopo una pausa.
const FACE = '/api/avatars/b10b1a0000000001.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda-landmarks.json'), 'utf8'));
const CLIP = process.env.NOVA_CLIP || '/home/ubuntu/.cursor/projects/workspace/uploads/nova-idle-prova_9669.mp4';
const OUT = process.env.NOVA_EVIDENCE || '/opt/cursor/artifacts';
const MOTION = '/api/motion/aabbccddeeff0011.mp4';

async function mock(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    if (p === MOTION) return route.fulfill({ status: 200, contentType: 'video/mp4', path: CLIP });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-bionda', avatar: FACE, motionVideo: MOTION,
      personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM,
    }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json([]);
    if (p === '/api/gestures') return json([]);
    if (p === '/api/calls') return json({ ok: true });
    return json({});
  });
}

test('mentre parla la bocca si muove sulla foto ferma, il video idle torna dopo', async ({ page }, testInfo) => {
  test.skip(!fs.existsSync(CLIP), 'clip di prova solo in locale, non nel repo');
  test.setTimeout(60000);
  const dir = path.join(OUT, 'v2d-29-' + testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await mock(page);
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => {
    const v = document.getElementById('motion-video');
    return document.body.classList.contains('solo-portrait') && v && !v.hidden && !v.paused && document.getElementById('stage').classList.contains('has-motion');
  }, null, { timeout: 15000 });
  const idle = await page.evaluate(() => ({ transform: document.getElementById('motion-video').style.transform }));
  expect(idle.transform).toBe('');
  await page.locator('#stage').screenshot({ path: path.join(dir, '01-idle-clip.png') });

  await page.evaluate(() => {
    const av = App.avatarConv;
    av.speakLive(() => 0.5 + 0.45 * Math.sin(performance.now() / 70), () => 0.5);
  });
  await page.waitForFunction(() => !document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 2000 });
  const shown = await page.evaluate(() => ({
    canvas: getComputedStyle(document.getElementById('avatar-canvas')).visibility,
    video: getComputedStyle(document.getElementById('motion-video')).display,
  }));
  expect(shown.canvas).toBe('visible');
  expect(shown.video).toBe('none');

  // Fotogrammi del canvas mentre parla: dove cambiano i pixel?
  const frames = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(110);
    if (i < 6) await page.locator('#stage').screenshot({ path: path.join(dir, `02-speak-${String(i).padStart(2, '0')}.png`) });
    frames.push(await page.evaluate(() => {
      const c = document.getElementById('avatar-canvas');
      const im = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      return { w: c.width, h: c.height, d: Array.from(im.data.filter((_, k) => k % 4 === 0 && ((k / 4) % c.width) % 2 === 0 && Math.floor((k / 4) / c.width) % 2 === 0)), mouth: App.avatarConv.mouth, motion: document.getElementById('stage').classList.contains('has-motion') };
    }));
  }
  expect(frames.every((f) => !f.motion)).toBe(true);
  const W = Math.ceil(frames[0].w / 2), H = Math.ceil(frames[0].h / 2);
  let y0 = H, y1 = -1, changed = 0, total = 0;
  const lm = LM;
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1].d, b = frames[f].d;
    for (let k = 0; k < a.length; k++) {
      total++;
      if (Math.abs(a[k] - b[k]) > 24) { changed++; const y = Math.floor(k / W); if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const mouths = frames.map((f) => f.mouth);
  const report = { changedPct: (changed / total) * 100, rows: [y0 / H, y1 / H], mouthMin: Math.min(...mouths), mouthMax: Math.max(...mouths), lmMouthY: lm.mouth.y };
  fs.writeFileSync(path.join(dir, 'speak-report.json'), JSON.stringify(report, null, 2));
  // la bocca si muove davvero
  expect(report.mouthMax - report.mouthMin).toBeGreaterThan(0.2);
  expect(changed).toBeGreaterThan(20);
  // e cambia solo una piccola parte (viso), non l'intera immagine
  expect(report.changedPct).toBeLessThan(1.5);
  expect(report.rows[1] - report.rows[0]).toBeLessThan(0.3);

  // finché parla il video non riparte
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => document.getElementById('stage').classList.contains('has-motion'))).toBe(false);

  await page.evaluate(() => App.avatarConv.stopAudio());
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 12000 });
  await page.locator('#stage').screenshot({ path: path.join(dir, '03-idle-again.png') });
});
