const { test, expect } = require('@playwright/test');

const CHIARA = 'aaaaaaaaaaaaaaaa';
const NOVA = 'bbbbbbbbbbbbbbbb';

function characters() {
  return [
    { id: CHIARA, name: 'Chiara', ready: 'chiara', avatar: '🌿', personality: 'x', style: '', orders: '', requests: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: NOVA, name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
}

async function mockApp(page) {
  // Il service worker, una volta attivo, fa le fetch fuori dal mock e il 401 riporta al login.
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (path === '/api/characters/options') return json({});
    if (path === '/api/characters') return json(characters());
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (path === '/api/images' || path === '/api/videos' || path === '/api/feed' || path === '/api/actions') return json([]);
    if (path === '/api/solo/prep') return json({ ok: true });
    return json({});
  });
}

test('login resta visibile e non si blocca', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('.login-wordmark')).toHaveText('Nova');
  await expect(page.locator('#profile-pick')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('#view-login')).toBeVisible();
  expect(errors).toEqual([]);
});

test('la home è solo Nova (id greta), non la lista e non Chiara', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  const snap = await page.evaluate(async () => {
    const shown = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    document.getElementById('tab-chat').hidden = false;
    const r = document.querySelector('#avatar-canvas').getBoundingClientRect();
    const current = App.current && { id: App.current.id, ready: App.current.ready, name: App.current.name };
    const m = document.createElement('div');
    m.id = 'keep-me';
    m.textContent = 'resta';
    document.querySelector('#messages').appendChild(m);
    App.api = async (path) => {
      if (path === '/api/characters') return [
        { id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '' },
      ];
      return {};
    };
    await App.loadChars();
    await App.solo.boot();
    return {
      loginHidden: document.getElementById('view-login').hidden,
      title: document.getElementById('title').textContent,
      tab: document.body.dataset.tab,
      conv: shown('tab-conv'),
      dock: shown('solo-dock'),
      canvas: shown('avatar-canvas'),
      form: shown('chat-form'),
      mic: shown('dock-mic'),
      list: shown('tab-chat'),
      w: r.width,
      h: r.height,
      current,
      kept: document.getElementById('keep-me').textContent,
      accountHidden: document.getElementById('tab-account').hidden,
    };
  });
  expect(snap.loginHidden).toBe(true);
  expect(snap.title).toBe('Nova');
  expect(snap.tab).toBe('conv');
  expect(snap.conv && snap.dock && snap.canvas && snap.form && snap.mic).toBe(true);
  expect(snap.list).toBe(false);
  expect(snap.w).toBeGreaterThan(200);
  expect(snap.h).toBeGreaterThan(100);
  expect(snap.current).toEqual({ id: NOVA, ready: 'greta', name: 'Nova' });
  expect(snap.kept).toBe('resta');
  expect(snap.accountHidden).toBe(true);
});

test('il microfono del dock detta nel composer e Home non svuota il thread', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeSR {
      constructor() { (window.__srs || (window.__srs = [])).push(this); }
      start() {}
      stop() {}
      abort() {}
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
  });
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Nova' && document.body.classList.contains('solo-mode'));
  const snap = await page.evaluate(() => {
    const m = document.createElement('div');
    m.id = 'keep-me';
    m.textContent = 'resta';
    document.querySelector('#messages').appendChild(m);
    window.__opens = 0;
    window.__sent = [];
    window.__callStarted = 0;
    const orig = App.chat.open.bind(App.chat);
    App.chat.open = async (...args) => { window.__opens += 1; return orig(...args); };
    const send = App.chat.send.bind(App.chat);
    App.chat.send = (text, ...rest) => { window.__sent.push(text); return send(text, ...rest); };
    App.call.start = () => { window.__callStarted += 1; };
    class FakeSR {
      constructor() { (window.__srs || (window.__srs = [])).push(this); }
      start() {}
      stop() {}
      abort() {}
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    document.getElementById('dock-settings').click();
    const onSettings = !document.getElementById('tab-account').hidden && document.getElementById('tab-conv').hidden;
    document.getElementById('dock-home').click();
    const afterHome = {
      conv: !document.getElementById('tab-conv').hidden,
      kept: document.getElementById('keep-me').textContent,
      title: document.getElementById('title').textContent,
      opens: window.__opens,
    };
    document.getElementById('dock-mic').click();
    const listening = App.voice.isListening();
    const micActive = document.getElementById('dock-mic').classList.contains('active');
    const inCall = document.body.classList.contains('in-call');
    const rec = window.__srs && window.__srs[0];
    rec.onresult({
      resultIndex: 0,
      results: { 0: { isFinal: true, 0: { transcript: 'ciao nova' }, length: 1 }, length: 1 },
    });
    const drafted = document.getElementById('chat-input').value;
    document.getElementById('dock-mic').click();
    return {
      onSettings,
      afterHome,
      listening,
      micActive,
      inCall,
      calls: window.__callStarted,
      sent: window.__sent.slice(),
      drafted,
      kept: document.getElementById('keep-me').textContent,
      still: document.getElementById('chat-input').value,
      stopped: !App.voice.isListening(),
      micOff: !document.getElementById('dock-mic').classList.contains('active'),
      inCallAfter: document.body.classList.contains('in-call'),
    };
  });
  expect(snap.onSettings).toBe(true);
  expect(snap.afterHome).toEqual({ conv: true, kept: 'resta', title: 'Nova', opens: 0 });
  expect(snap.listening).toBe(true);
  expect(snap.micActive).toBe(true);
  expect(snap.inCall).toBe(false);
  expect(snap.calls).toBe(0);
  expect(snap.sent).toEqual([]);
  expect(snap.drafted).toBe('ciao nova');
  expect(snap.kept).toBe('resta');
  expect(snap.still).toBe('ciao nova');
  expect(snap.stopped).toBe(true);
  expect(snap.micOff).toBe(true);
  expect(snap.inCallAfter).toBe(false);
});
