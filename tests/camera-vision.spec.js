const { test, expect } = require('./harness');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata', 'X-AI-Key': 'xai-e2e-sight', 'X-E2E-Vision': '1' };

function grayFrame() {
  const b64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(96, 0x88)]).toString('base64');
  return 'data:image/jpeg;base64,' + b64;
}

test('il fotogramma entra nella richiesta di visione e non resta in chat', async ({ request }, testInfo) => {
  const pin = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (pin.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(pin.ok(), await pin.text()).toBeTruthy();
  const chars = await (await request.get('/api/characters')).json();
  const nova = chars.find((c) => c && c.id);
  expect(nova && nova.id).toBeTruthy();
  const frame = grayFrame();
  const hash = crypto.createHash('sha256').update(frame).digest('hex');

  const noAi = await request.post('/api/chats/' + nova.id, {
    data: { message: 'solo testo', noAI: true, sight: frame }, headers: HEAD,
  });
  expect(noAi.ok(), await noAi.text()).toBeTruthy();
  const bad = await request.post('/api/chats/' + nova.id, {
    data: { message: 'no', sight: 'data:image/gif;base64,' + 'A'.repeat(80) }, headers: HEAD,
  });
  expect(bad.status()).toBe(400);

  const sent = await request.post('/api/chats/' + nova.id, {
    data: { message: 'Guarda il riquadro grigio ' + testInfo.project.name, sight: frame }, headers: HEAD,
  });
  const sentBody = await sent.text();
  expect(sent.ok(), sentBody).toBeTruthy();
  expect(sentBody).toContain('Vedo un riquadro grigio.');
  const seen = await (await request.get('/api/e2e/last-vision')).json();
  expect(seen.hasImage).toBe(true);
  expect(seen.kind).toBe('chat');
  expect(seen.continuous).toBe(false);
  expect(seen.cadenceMs).toBe(8000);
  expect(seen.detail).toBe('low');
  expect(seen.parts).toEqual(['text', 'image_url']);
  expect(seen.hint).toBe(true);
  expect(seen.endpoint).toBe('/v1/chat/completions');
  expect(seen.sha256).toBe(hash);
  expect(String(seen.model || '')).toMatch(/grok-/);

  const voice = await request.post('/api/chats/' + nova.id + '/sight', { data: { image: frame }, headers: HEAD });
  const voiceBody = await voice.json();
  expect(voice.ok(), JSON.stringify(voiceBody)).toBeTruthy();
  expect(voiceBody.note).toBe('Vedo un riquadro grigio.');
  expect(voiceBody.continuous).toBe(false);
  const seenVoice = await (await request.get('/api/e2e/last-vision')).json();
  expect(seenVoice.kind).toBe('sight');
  expect(seenVoice.hasImage).toBe(true);
  expect(seenVoice.sha256).toBe(hash);

  const chat = await (await request.get('/api/chats/' + nova.id)).json();
  const raw = JSON.stringify(chat);
  expect(raw.includes('base64')).toBe(false);
  expect(raw.includes('data:image')).toBe(false);
  const mine = chat.messages.filter((m) => m.content === 'Guarda il riquadro grigio ' + testInfo.project.name);
  expect(mine.length).toBe(1);
  expect(mine[0].sightSeen).toBe(true);
  expect(mine[0].content).toBe('Guarda il riquadro grigio ' + testInfo.project.name);
  const file = path.join('/tmp/nova-e2e-empty/shared/chats', nova.id + '.json');
  const disk = fs.readFileSync(file, 'utf8');
  expect(disk.includes('base64')).toBe(false);
  expect(disk.includes(frame.slice(0, 40))).toBe(false);
});

async function mockApp(page) {
  const posts = [];
  const sightPosts = [];
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    const g = canvas.getContext('2d');
    const paint = () => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 48);
      g.fillStyle = '#2266aa'; g.fillRect(8, 8, 24, 16);
      requestAnimationFrame(paint);
    };
    paint();
    const stream = canvas.captureStream(8);
    window.__fakeCam = stream;
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum = (window.__gum || 0) + 1;
      window.__gumAudio = !!(c && c.audio);
      return stream;
    };
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (route.request().method() === 'POST' && /^\/api\/chats\/[^/]+\/sight$/.test(p)) {
      const body = route.request().postDataJSON();
      sightPosts.push({ image: String(body.image || '').slice(0, 30), len: String(body.image || '').length, full: body.image });
      return json({ note: 'Vedo un riquadro grigio.', cadenceMs: 8000, continuous: false });
    }
    if (route.request().method() === 'POST' && /^\/api\/chats\/[^/]+$/.test(p)) {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'text/plain', headers: { 'X-Msg-Id': 'm1', 'X-Reply-Id': 'm2' }, body: 'Vedo un riquadro grigio.' });
    }
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
  return { posts, sightPosts };
}

test('il tasto Camera invia un fotogramma e lo stop ferma la ripresa', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'il flusso camera usa captureStream di Chromium');
  const bag = await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('dock-cam'));
  const before = await page.evaluate(() => ({
    on: document.getElementById('dock-cam').getAttribute('aria-pressed'),
    hidden: document.getElementById('sight-status').hidden,
    gum: window.__gum || 0,
    live: App.sight.tracksLive(),
  }));
  expect(before.on).toBe('false');
  expect(before.hidden).toBe(true);
  expect(before.gum).toBe(0);
  expect(before.live).toBe(0);

  const lineOff = await page.evaluate(() => {
    const line = document.querySelector('#dock-cam .cam-off-line');
    const s = getComputedStyle(line);
    return { h: line.getBoundingClientRect().height, color: s.backgroundColor, shown: s.display !== 'none' };
  });
  expect(lineOff.shown).toBe(true);
  expect(lineOff.h).toBeGreaterThan(0);
  expect(lineOff.h).toBeLessThan(8);
  expect(lineOff.color).toBe('rgb(226, 59, 59)');
  await page.locator('#dock-cam').click();
  await page.waitForFunction(() => App.sight.active() && document.getElementById('sight-preview').videoWidth > 0);
  const on = await page.evaluate(() => ({
    pressed: document.getElementById('dock-cam').getAttribute('aria-pressed'),
    statusHidden: document.getElementById('sight-status').hidden,
    liveHidden: document.getElementById('sight-live').hidden,
    toastHidden: document.getElementById('toast').hidden,
    line: getComputedStyle(document.querySelector('#dock-cam .cam-off-line')).display,
    preview: !document.getElementById('sight-preview').hidden,
    live: App.sight.tracksLive(),
    audio: window.__gumAudio,
  }));
  expect(on.pressed).toBe('true');
  expect(on.statusHidden).toBe(true);
  expect(on.liveHidden).toBe(true);
  expect(on.toastHidden).toBe(true);
  expect(on.line).toBe('none');
  expect(on.preview).toBe(true);
  expect(on.live).toBe(1);
  expect(on.audio).toBe(false);
  await page.evaluate(() => App.sight.sample());
  expect(bag.posts.length).toBe(0);
  expect(bag.sightPosts.length).toBe(0);
  const lay = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const form = document.getElementById('chat-form').getBoundingClientRect();
    const dock = document.querySelector('.solo-dock').getBoundingClientRect();
    return { wide: stage.width >= window.innerWidth - 2, formAbove: form.bottom <= dock.top + 2 };
  });
  expect(lay.wide).toBe(true);
  expect(lay.formAbove).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/sight-on-390.png' });
  await page.evaluate(() => App.sight.sample());
  expect(await page.evaluate(() => document.getElementById('toast').hidden)).toBe(true);

  await page.locator('#chat-input').fill('Guarda il riquadro');
  await page.locator('#chat-form').locator('button[type="submit"]').click();
  await expect.poll(() => bag.posts.length).toBe(1);
  const post = bag.posts[0];
  expect(post.message).toBe('Guarda il riquadro');
  expect(post.sight.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(post.sight.length).toBeGreaterThan(100);
  expect(JSON.stringify(post).includes('nsfw')).toBe(false);

  expect(await page.evaluate(() => window.__fakeCam.getVideoTracks()[0].readyState)).toBe('live');
  await page.setViewportSize({ width: 473, height: 1024 });
  await page.screenshot({ path: '/opt/cursor/artifacts/sight-on-473.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sight-preview').click();
  await page.waitForFunction(() => !App.sight.active());
  const off = await page.evaluate(() => ({
    pressed: document.getElementById('dock-cam').getAttribute('aria-pressed'),
    hidden: document.getElementById('sight-status').hidden,
    liveHidden: document.getElementById('sight-live').hidden,
    ready: window.__fakeCam.getVideoTracks()[0].readyState,
    live: App.sight.tracksLive(),
    frame: App.sight.takeFrame(),
  }));
  expect(off.pressed).toBe('false');
  expect(off.hidden).toBe(true);
  expect(off.liveHidden).toBe(true);
  expect(off.ready).toBe('ended');
  expect(off.live).toBe(0);
  expect(off.frame).toBe(null);

  await page.locator('#chat-input').fill('senza camera');
  await page.locator('#chat-form').locator('button[type="submit"]').click();
  await expect.poll(() => bag.posts.length).toBe(2);
  const second = bag.posts[1];
  expect(second.message).toBe('senza camera');
  expect(second.sight).toBeFalsy();
  await page.screenshot({ path: '/opt/cursor/artifacts/sight-off-390.png' });
});

test('l’anteprima spegne la camera e la riga rossa torna', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'il flusso camera usa captureStream di Chromium');
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#dock-cam .cam-off-line')).display)).not.toBe('none');
  await page.locator('#dock-cam').click();
  await page.waitForFunction(() => App.sight.active() && !document.getElementById('sight-preview').hidden);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#dock-cam .cam-off-line')).display)).toBe('none');
  expect(await page.evaluate(() => document.getElementById('toast').hidden)).toBe(true);
  await page.locator('#sight-preview').click();
  await page.waitForFunction(() => !App.sight.active());
  expect(await page.evaluate(() => document.getElementById('sight-preview').hidden)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#dock-cam .cam-off-line')).display)).not.toBe('none');
  await page.locator('#dock-cam').click();
  await page.waitForFunction(() => App.sight.active());
  expect(await page.evaluate(() => document.getElementById('sight-status').hidden)).toBe(true);
  expect(await page.evaluate(() => document.getElementById('sight-live').hidden)).toBe(true);
});

test('permesso negato e nessuna fotocamera restano spenti', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'il flusso camera usa captureStream di Chromium');
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, solo: true, soloKey: 'greta', serverKey: true, adult: false, adultChat: false });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1' });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  await page.locator('#dock-cam').click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById('toast').hidden)).toBe(true);
  expect(await page.evaluate(() => App.sight.active())).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#dock-cam .cam-off-line')).display)).not.toBe('none');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' }));
  });
  await page.locator('#dock-cam').click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById('toast').hidden)).toBe(true);
  expect(await page.evaluate(() => App.sight.active())).toBe(false);
});

test('la voce in tempo reale manda il fotogramma al modello di visione', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'il flusso camera usa captureStream di Chromium');
  const bag = await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await page.locator('#dock-cam').click();
  await page.waitForFunction(() => App.current && App.current.id && App.sight.active() && document.getElementById('sight-preview').videoWidth > 0);
  await page.evaluate(() => {
    window.__rtSent = [];
    App.rt._s = () => ({
      closed: false, userSpeaking: false, responseActive: true, resp: { text: '' },
      ws: { readyState: 1, send(raw) { window.__rtSent.push(JSON.parse(raw)); } },
    });
  });
  await page.evaluate(() => App.sight.onUtterance());
  await expect.poll(() => bag.sightPosts.length).toBe(1);
  await page.waitForFunction(() => (window.__rtSent || []).length >= 1);
  const pack = await page.evaluate(() => ({ sent: window.__rtSent }));
  pack.image = bag.sightPosts[0].image;
  pack.len = bag.sightPosts[0].len;
  expect(pack.image.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(pack.len).toBeGreaterThan(100);
  expect(pack.sent[0].type).toBe('conversation.item.create');
  expect(pack.sent[0].item.content[0].text).toContain('riquadro grigio');
  expect(pack.sent[0].item.content[0].text).toContain('non un video');
  const beforeStop = bag.sightPosts.length;
  await page.evaluate(() => App.sight.stop());
  await page.evaluate(() => App.sight.onUtterance());
  expect(bag.sightPosts.length).toBe(beforeStop);
  expect(await page.evaluate(() => window.__fakeCam.getVideoTracks()[0].readyState)).toBe('ended');
});
