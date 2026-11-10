const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const FACE = '/api/avatars/406a5539c61fafa9.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const CLIP = '/home/ubuntu/.cursor/projects/workspace/uploads/nova-idle-prova_9669.mp4';

function tinyMp4() {
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 4, 'ascii');
  buf.write('isom', 8, 4, 'ascii');
  return buf;
}

test('solo il proprietario carica il video, e il GET richiede la sessione e i Range', async ({ request }) => {
  const bare = await request.post('/api/characters/5ce17a0000000001/motion-video', { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: tinyMp4() });
  expect(bare.status()).toBe(401);
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const luisa = await request.post('/api/pin/setup', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
  if (luisa.status() === 409) {
    const again = await request.post('/api/login', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
    expect(again.ok(), await again.text()).toBeTruthy();
  } else expect(luisa.ok(), await luisa.text()).toBeTruthy();
  const denied = await request.post('/api/characters/5ce17a0000000001/motion-video', { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: tinyMp4() });
  expect(denied.status()).toBe(403);
  const back = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(back.ok(), await back.text()).toBeTruthy();
  const bad = await request.post('/api/characters/5ce17a0000000001/motion-video', { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: Buffer.from('not-a-video') });
  expect(bad.status()).toBe(400);
  const up = await request.post('/api/characters/5ce17a0000000001/motion-video', { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: tinyMp4() });
  expect(up.ok(), await up.text()).toBeTruthy();
  const body = await up.json();
  expect(body.motionVideo).toMatch(/^\/api\/motion\/[a-f0-9]{16}\.mp4$/);
  expect(body.character.motionVideo).toBe(body.motionVideo);
  expect(body.character.avatar).not.toBe(body.motionVideo);
  const file = path.join('/tmp/nova-e2e-empty/shared/avatars', path.basename(body.motionVideo));
  expect(fs.existsSync(file)).toBe(true);
  const { request: playwrightRequest } = require('@playwright/test');
  const fresh = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:8766' });
  const locked = await fresh.get(body.motionVideo);
  expect(locked.status()).toBe(401);
  await fresh.dispose();
  const part = await request.get(body.motionVideo, { headers: { Range: 'bytes=0-7' } });
  expect(part.status()).toBe(206);
  expect(part.headers()['content-type'] || '').toContain('video/mp4');
  expect(part.headers()['content-range'] || '').toMatch(/^bytes 0-7\//);
  expect(part.headers()['accept-ranges']).toBe('bytes');
  expect((await part.body()).length).toBe(8);
});

test('in chiamata e nel ritratto il video gira, la testata resta la foto', async ({ page }) => {
  test.skip(!fs.existsSync(CLIP), 'clip di prova solo in locale, non nel repo');
  const motion = '/api/motion/aabbccddeeff0011.mp4';
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    if (p === motion) return route.fulfill({ status: 200, contentType: 'video/mp4', path: CLIP });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: FACE, motionVideo: motion,
      personality: 'x', style: '', requests: '',
      landmarks: { auto: true, src: FACE, eyeL: { x: 0.36, y: 0.32 }, eyeR: { x: 0.64, y: 0.32 }, mouth: { x: 0.5, y: 0.48 } },
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
    if (p === '/api/calls') return json({ ok: true });
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current);
  const chat = await page.evaluate(() => {
    const v = document.getElementById('motion-video');
    const face = document.querySelector('#wa-photo img');
    return { hidden: v.hidden, src: v.getAttribute('src') || '', face: face && face.dataset.src };
  });
  expect(chat.hidden).toBe(true);
  expect(chat.src).toBe('');
  expect(chat.face).toBe(FACE);
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => {
    const v = document.getElementById('motion-video');
    return document.body.classList.contains('solo-portrait') && v && !v.hidden && v.readyState >= 2 && document.getElementById('stage').classList.contains('has-motion');
  });
  const portrait = await page.evaluate(() => {
    const v = document.getElementById('motion-video');
    const s = getComputedStyle(v);
    const box = v.getBoundingClientRect();
    return {
      muted: v.muted, loop: v.loop, inline: v.playsInline, fit: s.objectFit,
      w: box.width, h: box.height, canvas: getComputedStyle(document.getElementById('avatar-canvas')).visibility,
      face: document.querySelector('#wa-photo img').dataset.src,
    };
  });
  expect(portrait.muted).toBe(true);
  expect(portrait.loop).toBe(true);
  expect(portrait.inline).toBe(true);
  expect(portrait.fit).toBe('cover');
  expect(portrait.w).toBeGreaterThanOrEqual(388);
  expect(portrait.h).toBeGreaterThan(800);
  expect(portrait.canvas).toBe('hidden');
  expect(portrait.face).toBe(FACE);
  await page.locator('#back-btn').click();
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && document.getElementById('stage').classList.contains('has-motion'));
  const call = await page.evaluate(() => {
    const v = document.getElementById('motion-video');
    const box = v.getBoundingClientRect();
    App.avatarConv.speaking = true;
    document.getElementById('stage').classList.add('speaking');
    return {
      paused: v.paused, hidden: v.hidden, w: box.width, h: box.height,
      mute: !!document.getElementById('call-mute'),
      end: !!document.getElementById('call-end'),
      name: document.getElementById('call-name').textContent,
    };
  });
  expect(call.paused).toBe(false);
  expect(call.hidden).toBe(false);
  expect(call.w).toBeGreaterThanOrEqual(388);
  expect(call.h).toBeGreaterThan(800);
  expect(call.mute && call.end).toBe(true);
  expect(call.name).toBe('Nova');
});
