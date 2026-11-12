const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const PHOTO = path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));

async function mockApp(page, chatDelayMs) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/5ce17a0000000001.jpg',
      personality: 'x', style: '', orders: '', requests: '', voice: 'eve', landmarks: LM,
    }]);
    if (p === '/api/avatars/5ce17a0000000001.jpg') return route.fulfill({ status: 200, contentType: 'image/jpeg', path: PHOTO });
    if (p === '/api/chats/5ce17a0000000001' && req.method() === 'POST') {
      await new Promise((r) => setTimeout(r, chatDelayMs || 0));
      const body = 'data: {"choices":[{"delta":{"content":"Ciao"}}]}\n\n';
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-msg-id': 'm1', 'x-reply-id': 'r1', 'x-prep-ms': '1' },
        body: body + 'data: {"choices":[{"delta":{"content":" Nova"}}]}\n\n',
      });
    }
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: true });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1' });
    if (p === '/api/gestures') return json([]);
    if (p === '/api/actions') return json({ catalog: [], adult: false, video: false });
    if (p === '/api/avatar-looks') return json({ entries: [], current: null });
    if (p === '/api/nova-notes') return json({ carattere: { entries: [] }, richieste: { entries: [] } });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

test('bolla e sta scrivendo prima del token, senza un giro in più per la parola chiave', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla home con l’avatar. Il tempo è misurato su Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page, 400);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.chat && App.current && (App.kwSet === true || App.kwSet === false));
  const snap = await page.evaluate(async () => {
    const calls = [];
    const orig = App.api;
    App.api = async function (path, opts) {
      calls.push(path);
      return orig.call(App, path, opts);
    };
    const t0 = performance.now();
    const pending = App.chat.send('ciao nova, come va?');
    const painted = {
      ms: Math.round(performance.now() - t0),
      user: !!document.querySelector('#messages .msg.user'),
      typing: !!document.querySelector('#messages .msg.typing'),
      typingText: (document.querySelector('#messages .msg.typing .body') || {}).textContent || '',
    };
    await pending;
    const reply = (document.querySelector('#messages .msg.assistant .body') || {}).textContent || '';
    const keywordBeforeChat = calls.findIndex((p) => String(p).includes('adult-keyword'));
    const chatAt = calls.findIndex((p) => String(p).includes('/api/chats/') && String(p).indexOf('summary') < 0);
    return { painted, reply, paint: App.latency && App.latency.paint, keywordBeforeChat, chatAt, calls };
  });
  expect(snap.painted.user).toBe(true);
  expect(snap.painted.typing).toBe(true);
  expect(snap.painted.ms).toBeLessThan(80);
  expect(snap.paint).toBeLessThan(80);
  expect(snap.keywordBeforeChat).toBe(-1);
  expect(snap.reply).toContain('Ciao');
});

test('la mano sul ritratto si muove e torna, per circa venti secondi', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'La sequenza della mano è registrata su Chromium. WebKit esegue il resto della suite.');
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page, 0);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#back-btn').click();
  await page.locator('#nh-photo').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-portrait') && App.avatarConv && App.avatarConv._handPose);
  const dir = '/opt/cursor/artifacts';
  fs.mkdirSync(dir, { recursive: true });
  const samples = [];
  for (let i = 0; i < 11; i++) {
    if (i) await page.waitForTimeout(2000);
    const shot = path.join(dir, `hand-${String(i).padStart(2, '0')}.png`);
    await page.locator('#stage').screenshot({ path: shot });
    const pose = await page.evaluate(() => {
      const c = document.getElementById('avatar-canvas');
      const ctx = c.getContext('2d');
      const w = c.width, h = c.height;
      const y0 = Math.floor(h * 0.62), y1 = Math.floor(h * 0.9);
      const x0 = Math.floor(w * 0.08), x1 = Math.floor(w * 0.38);
      const im = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      let n = 0, acc = 0;
      for (let k = 0; k < im.data.length; k += 16) { acc += im.data[k] + im.data[k + 1] + im.data[k + 2]; n++; }
      const hp = App.avatarConv._handPose || {};
      return { mean: acc / Math.max(1, n), phase: hp.phase, lift: hp.lift, side: hp.side, idle: hp.idle };
    });
    samples.push({ i, file: shot, ...pose });
  }
  fs.writeFileSync(path.join(dir, 'hand-samples.json'), JSON.stringify(samples, null, 2));
  const means = samples.map((s) => s.mean);
  const spread = Math.max(...means) - Math.min(...means);
  const lifts = samples.map((s) => s.lift);
  expect(Math.max(...lifts)).toBeGreaterThan(0.6);
  expect(lifts.filter((n) => n === 0).length).toBeGreaterThan(0);
  expect(spread).toBeGreaterThan(1.5);
  const idles = samples.map((s) => Number(s.idle).toFixed(2));
  expect(new Set(idles).size).toBeGreaterThan(2);
});
