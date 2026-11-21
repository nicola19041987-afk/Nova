// v2d-61: elenco e chat scuri (nero, grigio, fucsia), niente Impostazioni/casa/chiamata vocale,
// videochiamata immediata dal tasto video. La pagina PIN non cambia.
const { test, expect } = require('./harness');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const JPG = path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg');

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

async function disableSw(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
}

const vis = (id) => {
  const el = document.getElementById(id);
  if (!el || el.hidden) return false;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
};

test('v2d-61: cache e tema scuro dell’elenco, chat inattive in grigio, niente Impostazioni', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(62|63)'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-61'");

  await disableSw(page);
  await loginNicola(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id]');
  await page.waitForSelector('#char-list li.chat-ph');

  const skin = await page.evaluate(() => {
    const rgb = (el) => el ? getComputedStyle(el).backgroundColor : null;
    const col = (el) => el ? getComputedStyle(el).color : null;
    const ira = document.querySelector('#char-list li[data-id]');
    const ph = document.querySelector('#char-list li.chat-ph');
    const visId = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    return {
      tab: rgb(document.getElementById('tab-chat')),
      list: rgb(document.getElementById('char-list')),
      row: rgb(ira),
      name: col(ira && ira.querySelector('b')),
      preview: col(ira && ira.querySelector('.grow span')),
      phName: col(ph && ph.querySelector('b')),
      phSub: col(ph && ph.querySelector('.grow span')),
      header: rgb(document.querySelector('.topbar')),
      title: col(document.getElementById('title')),
      titleText: document.getElementById('title') && document.getElementById('title').textContent,
      dock: visId('solo-dock'),
      homeDock: visId('dock-home'),
      callsDock: visId('dock-calls'),
      house: visId('wa-home'),
      voice: visId('wa-voice'),
      names: [...document.querySelectorAll('#char-list li b')].map((b) => b.textContent),
    };
  });
  const black = (v) => v === 'rgb(0, 0, 0)' || v === 'rgba(0, 0, 0, 0)';
  expect(black(skin.tab) && (skin.tab === 'rgb(0, 0, 0)' || skin.list === 'rgb(0, 0, 0)')).toBe(true);
  expect(skin.list).toBe('rgb(0, 0, 0)');
  expect(skin.row).toBe('rgb(26, 26, 26)');
  expect(skin.name).toBe('rgb(255, 255, 255)');
  expect(skin.preview).toBe('rgb(179, 179, 179)');
  expect(skin.phName).toBe('rgb(179, 179, 179)');
  expect(skin.phSub).toBe('rgb(138, 138, 138)');
  expect(skin.header).toBe('rgb(0, 0, 0)');
  expect(skin.title).toBe('rgb(255, 255, 255)');
  expect(skin.titleText).toBe('Chat');
  expect(skin.dock).toBe(false);
  expect(skin.homeDock).toBe(false);
  expect(skin.callsDock).toBe(false);
  expect(skin.house).toBe(false);
  expect(skin.voice).toBe(false);
  expect(skin.names).toEqual(['IRA', 'MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']);

  const unreachable = () => {
    const visId = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    return {
      home: document.body.classList.contains('solo-home') || visId('nh-list') || visId('tab-account'),
      list: document.body.classList.contains('solo-list'),
      calls: document.body.classList.contains('solo-calls') || visId('tab-calls'),
    };
  };
  await page.evaluate(() => App.solo.showHome());
  const afterHome = await page.evaluate(unreachable);
  expect(afterHome.home).toBe(false);
  expect(afterHome.list).toBe(true);
  await page.evaluate(() => App.solo.showCalls());
  const afterCalls = await page.evaluate(unreachable);
  expect(afterCalls.calls).toBe(false);
});

test('v2d-61: chat Ira scura senza bianco, niente casa, il tasto video apre subito la videochiamata', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  await disableSw(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c && c.video) { const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; return cv.captureStream(1); }
      const a = new AudioContext(); return a.createMediaStreamDestination().stream;
    };
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p.startsWith('/api/avatars/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPG });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Ira', ready: 'nova-scelta', avatar: '/api/avatars/a1fa460000000001.jpg', personality: 'x', style: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory' || p === '/api/gestures' || p === '/api/actions') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/calls') return json({ calls: [] });
    if (p === '/api/simli/session') return json({ error: 'Simli non configurato', fallback: true });
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && App.chars && App.chars.length > 0);
  await page.evaluate(() => { if (App.solo && App.solo.showChat) App.solo.showChat(); });
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current);

  const chat = await page.evaluate(() => {
    const rgb = (el) => el ? getComputedStyle(el).backgroundColor : null;
    const col = (el) => el ? getComputedStyle(el).color : null;
    const visId = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    return {
      header: rgb(document.querySelector('.topbar')),
      messages: rgb(document.getElementById('messages')),
      form: rgb(document.getElementById('chat-form')),
      input: rgb(document.getElementById('chat-input')),
      inputFg: col(document.getElementById('chat-input')),
      house: visId('wa-home'),
      cbHome: visId('cb-home'),
      voice: visId('wa-voice'),
      video: visId('wa-video'),
      cbVideo: visId('cb-video'),
      dock: visId('solo-dock'),
    };
  });
  expect(chat.header).toBe('rgb(0, 0, 0)');
  expect(chat.messages).toBe('rgb(0, 0, 0)');
  expect(chat.form).toBe('rgb(0, 0, 0)');
  expect(chat.input).toBe('rgb(26, 26, 26)');
  expect(chat.inputFg).toBe('rgb(255, 255, 255)');
  expect(chat.house).toBe(false);
  expect(chat.cbHome).toBe(false);
  expect(chat.voice).toBe(false);
  expect(chat.video).toBe(true);
  expect(chat.dock).toBe(false);

  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.mode === 'video');
  const call = await page.evaluate(() => {
    const visId = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0;
    };
    return {
      mode: App.call.mode,
      kind: document.getElementById('call-kind') && document.getElementById('call-kind').textContent,
      ui: visId('call-ui') || !document.getElementById('call-ui').hidden,
      voiceToggle: visId('call-videotoggle'),
      toVideo: visId('call-tovideo'),
      hangup: visId('call-hangup'),
      mute: visId('call-mute'),
      cam: visId('call-cam'),
      form: visId('call-text'),
    };
  });
  expect(call.mode).toBe('video');
  expect(call.kind).toBe('Videochiamata');
  expect(call.ui).toBe(true);
  expect(call.voiceToggle).toBe(false);
  expect(call.toVideo).toBe(false);
  expect(call.hangup).toBe(false);
  expect(call.mute).toBe(true);
  expect(call.cam).toBe(true);
  expect(call.form).toBe(true);
});
