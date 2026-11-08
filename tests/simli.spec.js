const { test, expect, request: apiRequest } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HEAD = { 'X-Requested-With': 'app-privata' };
const ROOT = path.join(__dirname, '..');

test('senza chiave Simli la sessione risponde 503 e non rivela segreti', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  const bare = await request.post('/api/simli/session', { headers: HEAD, data: {} });
  expect(bare.status()).toBe(401);
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '2468' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '2468' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const r = await request.post('/api/simli/session', { headers: HEAD, data: {} });
  expect(r.status()).toBe(503);
  const body = await r.text();
  expect(body).not.toMatch(/x-simli-api-key|SIMLI_API_KEY|session_token/i);
  const j = JSON.parse(body);
  expect(j.fallback).toBe(true);
});

test('chiavi di soli spazi contano come assenti: Simli torna alla foto e xAI usa il file salvato', async ({ browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  test.setTimeout(20000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-blank-key-'));
  fs.writeFileSync(path.join(dir, 'server-ai-key.json'), JSON.stringify({ key: 'xai-dal-file' }));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), XAI_API_KEY: '   ', AI_KEY: ' \n ', SIMLI_API_KEY: '   ' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${port}` });
  try {
    const ready = Date.now();
    while (!log.includes('App privata avviata')) {
      if (child.exitCode != null) throw new Error(log || 'server spento');
      if (Date.now() - ready > 15000) throw new Error(log || 'avvio lento');
      await new Promise((ok) => setTimeout(ok, 50));
    }
    const pin = await api.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(pin.ok(), await pin.text()).toBeTruthy();
    const key = await (await api.get('/api/server-key')).json();
    expect(key.stored).toBe(true);
    expect(key.fromEnv).toBe(false);
    const simli = await api.post('/api/simli/session', { headers: HEAD, data: {} });
    expect(simli.status()).toBe(503);
    expect((await simli.json()).fallback).toBe(true);
  } finally {
    await api.dispose();
    child.kill();
  }
});

test('la chiave Simli si salva, lo stato non la mostra, e la sessione la usa se l’ambiente è vuoto', async ({ browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  test.setTimeout(40000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-simli-key-'));
  const port = 22000 + Math.floor(Math.random() * 20000);
  const secret = 'simli-secret-not-in-json-9f3a';
  const face = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), SIMLI_API_KEY: '   ', SIMLI_FACE_ID: '  ' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${port}` });
  try {
    const ready = Date.now();
    while (!log.includes('App privata avviata')) {
      if (child.exitCode != null) throw new Error(log || 'server spento');
      if (Date.now() - ready > 15000) throw new Error(log || 'avvio lento');
      await new Promise((ok) => setTimeout(ok, 50));
    }
    const anon = await api.get('/api/simli/key/status');
    expect(anon.status()).toBe(401);
    const pin = await api.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(pin.ok(), await pin.text()).toBeTruthy();
    const before = await (await api.get('/api/simli/key/status')).json();
    expect(before).toEqual({ configured: false, fromEnv: false, stored: false });
    const none = await api.post('/api/simli/session', { headers: HEAD, data: {} });
    expect(none.status()).toBe(503);
    expect((await none.json()).fallback).toBe(true);
    const bad = await api.post('/api/simli/key', { headers: HEAD, data: { key: secret, faceId: 'nope' } });
    expect(bad.status()).toBe(400);
    const saved = await api.post('/api/simli/key', { headers: HEAD, data: { key: secret, faceId: face } });
    const savedText = await saved.text();
    expect(saved.ok(), savedText).toBeTruthy();
    expect(savedText).not.toContain(secret);
    const statusRes = await api.get('/api/simli/key/status');
    const statusText = await statusRes.text();
    expect(statusText).not.toContain(secret);
    expect(JSON.parse(statusText)).toEqual({ configured: true, fromEnv: false, stored: true });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'server-simli-key.json'), 'utf8'));
    expect(onDisk.key).toBe(secret);
    expect(onDisk.faceId).toBe(face);
    const session = await api.post('/api/simli/session', { headers: HEAD, data: {} });
    expect(session.status()).not.toBe(503);
    const sessionText = await session.text();
    expect(sessionText).not.toContain(secret);
    expect(sessionText).not.toMatch(/x-simli-api-key|SIMLI_API_KEY/i);
    expect(log).not.toContain(secret);
  } finally {
    await api.dispose();
    child.kill();
  }
});

test('la videochiamata usa Simli se il token c’è e torna alla foto se manca', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    window.__ws = [];
    window.__simliMode = 'ok';
    class FakeWS {
      constructor(url) { this.url = String(url); this.readyState = 0; this.binary = []; this.texts = []; window.__ws.push(this); setTimeout(() => { this.readyState = 1; this._open && this._open(); }, 0); }
      addEventListener(type, fn) { if (type === 'open') this._open = fn; if (type === 'message') this._msg = fn; if (type === 'close') this._close = fn; if (type === 'error') this._err = fn; }
      send(d) {
        if (typeof d === 'string') this.texts.push(d);
        else { const u = d instanceof Uint8Array ? d : new Uint8Array(d); this.binary.push(u.byteLength); }
      }
      close() { this.readyState = 3; if (this._close) this._close(); }
    }
    class FakePC {
      constructor(cfg) { this.cfg = cfg; this.iceGatheringState = 'complete'; this.connectionState = 'new'; this.localDescription = null; }
      addTransceiver() {}
      addEventListener() {}
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0' }); }
      setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
      setRemoteDescription() { return Promise.resolve(); }
      close() { this.connectionState = 'closed'; }
    }
    window.WebSocket = FakeWS;
    window.RTCPeerConnection = FakePC;
  });
  let simliDown = false;
  const json = (route, o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/me') return json(route, { user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json(route, [{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json(route, { epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json(route, { autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json(route, { set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json(route, { set: false });
    if (p === '/api/rules') return json(route, { text: '' });
    if (p === '/api/memory') return json(route, []);
    if (p === '/api/notes') return json(route, { text: '', toAI: false });
    if (p === '/api/sync') return json(route, { chars: '1', memory: '1', adultChat: false });
    if (p === '/api/actions') return json(route, { video: false, adult: false, seconds: 6, catalog: [], gestures: [] });
    if (p === '/api/e2e/reset-login-limit') return json(route, { ok: true });
    return json(route, {});
  });
  await page.route('**/api/simli/session', async (route) => {
    if (simliDown) return json(route, { error: 'Simli non configurato', fallback: true }, 503);
    return json(route, { session_token: 'tok-test', iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], fallback: false });
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && window.App && App.simli);
  const up = await page.evaluate(async () => {
    App.call.active = true; App.call.mode = 'video';
    if (App.avatar3d) await App.avatar3d.apply('video');
    const started = await App.simli.start();
    const ws = window.__ws[0];
    const waiting = document.getElementById('simli-status').textContent;
    ws._msg({ data: JSON.stringify({ destination: 'edge', session_id: 'abc' }) });
    ws._msg({ data: JSON.stringify({ video_metadata: { width: 768, height: 768, fps: 25 } }) });
    ws._msg({ data: 'SILENT' });
    const alive = App.simli.active();
    ws._msg({ data: 'START' });
    const buf = new ArrayBuffer(240 * 2);
    App.simli.feedPcm24(buf);
    const video = document.getElementById('simli-video');
    const before = document.body.classList.contains('simli-on');
    video.srcObject = new MediaStream();
    video.dispatchEvent(new Event('playing'));
    let lines = '';
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) if (r.selectorText && r.selectorText.includes('#chat-input') && r.style && r.style.maxHeight) lines = r.style.maxHeight;
    }
    const on = document.body.classList.contains('simli-on') && video && !video.hidden;
    const logged = App.simli.log().map((x) => x.line).join(' ');
    window.dispatchEvent(new Event('pagehide'));
    return { started, waiting, alive, before, on, url: ws.url, texts: ws.texts.slice(), bytes: ws.binary.slice(), closed: !App.simli.active(), lines, key: JSON.stringify(ws.texts).includes('SIMLI'), logged };
  });
  expect(up.started).toBe(true);
  expect(up.waiting).toBe('Connessione video…');
  expect(up.alive).toBe(true);
  expect(up.before).toBe(false);
  expect(up.on).toBe(true);
  expect(up.logged).not.toContain('tok-test');
  expect(up.url).toContain('wss://api.simli.ai/compose/webrtc/p2p');
  expect(up.url).toContain('session_token=tok-test');
  expect(up.texts[0]).toContain('"type":"offer"');
  expect(up.bytes.reduce((a, b) => a + b, 0)).toBe(320);
  expect(up.closed).toBe(true);
  expect(up.lines).toContain('2');
  expect(up.key).toBe(false);

  simliDown = true;
  const down = await page.evaluate(async () => {
    App.call.active = true; App.call.mode = 'video';
    const started = await App.simli.start();
    return { started, on: document.body.classList.contains('simli-on'), canvas: !!document.getElementById('avatar-canvas') };
  });
  expect(down.started).toBe(false);
  expect(down.on).toBe(false);
  expect(down.canvas).toBe(true);
});
