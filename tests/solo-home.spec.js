const { test, expect } = require('./harness');

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
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Nova' && document.body.classList.contains('solo-mode') && App.solo && App.solo._bound);
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
    try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch {}
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, writable: true, value: FakeSR });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, writable: true, value: FakeSR });
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
    if (!(window.__srs && window.__srs[0])) App.voice.start({ composer: true });
    const listening = App.voice.isListening();
    const micActive = document.getElementById('dock-mic').classList.contains('active');
    const inCall = document.body.classList.contains('in-call');
    const rec = window.__srs && window.__srs[window.__srs.length - 1];
    if (!rec) throw new Error('riconoscimento non agganciato, ascolto=' + listening);
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

test('la voce in tempo reale resta in chat e un messaggio arriva da xAI', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit chiude il processo nel worklet di questa prova con socket finto. Il labiale con misuratore a zero è verificato in mouth-playback.spec.js anche su WebKit.');
  await mockApp(page);
  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      url: 'wss://example.test/rt',
      token: 'tok',
      adult: false,
      session: { instructions: 'Sei Nova', voice: 'ara', turn_detection: { type: 'server_vad' } },
    }),
  }));
  await page.route('**/api/chats/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Msg-Id': 'u1', 'X-Reply-Id': 'a1' },
      body: 'Ciao, sono Nova.',
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => {
    const b = document.getElementById('solo-rt');
    return document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova' && b && !b.hidden;
  });
  const snap = await page.evaluate(async () => {
    App.ls.set('key', 'sk-test');
    App.ls.set('callEngine', 'realtime');
    const m = document.createElement('div');
    m.id = 'keep-me';
    m.textContent = 'resta';
    document.querySelector('#messages').appendChild(m);
    window.__callStarted = 0;
    App.call.start = () => { window.__callStarted += 1; };
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    try { await ac.resume(); } catch {}
    App.audio.ctx = ac;
    const dest = ac.createMediaStreamDestination();
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    class FakeWS {
      constructor(url, protocols) {
        this.url = url;
        this.protocol = protocols && protocols[0];
        this.readyState = 0;
        window.__ws = this;
        setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'session.created' }) }); }, 0);
      }
      send(raw) {
        let msg = {}; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'session.update') setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: 'session.updated' }) }); }, 0);
      }
      close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
    }
    window.WebSocket = FakeWS;
    const btn = document.getElementById('solo-rt');
    if (btn.hidden) throw new Error('controllo voce nascosto');
    let err = '';
    const toast = App.toast;
    App.toast = (m) => { err = String(m); return toast(m); };
    await App.solo.toggleRt();
    const started = {
      err,
      on: document.body.classList.contains('solo-rt'),
      pressed: btn.getAttribute('aria-pressed'),
      active: !!(App.rt && App.rt.active),
      inCall: document.body.classList.contains('in-call'),
      calls: window.__callStarted,
      kept: document.getElementById('keep-me').textContent,
      title: document.getElementById('title').textContent,
      status: document.getElementById('voice-status').textContent,
    };
    document.getElementById('chat-input').value = 'Ciao Nova';
    await App.chat.send('Ciao Nova');
    const texts = [...document.querySelectorAll('#messages .msg .body')].map((el) => el.textContent);
    await App.solo.toggleRt();
    return {
      started,
      texts,
      kept: document.getElementById('keep-me').textContent,
      off: !document.body.classList.contains('solo-rt'),
      stopped: !(App.rt && App.rt.active),
      inCall: document.body.classList.contains('in-call'),
    };
  });
  expect(snap.started.err || '').toBe('');
  expect(snap.started).toEqual({
    err: '',
    on: true,
    pressed: 'true',
    active: true,
    inCall: false,
    calls: 0,
    kept: 'resta',
    title: 'Nova',
    status: '⚡ In ascolto',
  });
  expect(snap.texts).toContain('Ciao Nova');
  expect(snap.texts).toContain('Ciao, sono Nova.');
  expect(snap.kept).toBe('resta');
  expect(snap.off).toBe(true);
  expect(snap.stopped).toBe(true);
  expect(snap.inCall).toBe(false);
});

test('labiale e movimento della sessione ⚡ seguono l’audio, senza coprire la chat', async ({ page }) => {
  await mockApp(page);
  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'wss://example.test/rt', token: 'tok', adult: false, session: { instructions: 'Sei Nova', voice: 'ara' } }),
  }));
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  const snap = await page.evaluate(async () => {
    const corr = (xs, ys) => {
      const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
      return dx && dy ? num / Math.sqrt(dx * dy) : 0;
    };
    const meanDiff = (a, b, x0, x1, y0, y1) => {
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        n++;
      }
      return s / Math.max(1, n);
    };
    const stage = document.getElementById('stage').getBoundingClientRect();
    const msgs = document.getElementById('messages').getBoundingClientRect();
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;left:0;top:0;width:220px;height:220px;opacity:0;pointer-events:none';
    document.body.appendChild(c);
    const src = document.createElement('canvas'); src.width = src.height = 240;
    const g = src.getContext('2d');
    g.fillStyle = '#e7b89a'; g.fillRect(0, 0, 240, 240);
    g.fillStyle = '#2a211c'; g.fillRect(70, 88, 26, 8); g.fillRect(144, 88, 26, 8);
    g.fillStyle = '#7a3038'; g.fillRect(78, 150, 84, 8);
    const im = new Image(); im.src = src.toDataURL(); await im.decode();
    im._src = 'live-face';
    const av = new TalkingAvatar(c);
    av.img = im;
    av.lm = { auto: true, src: 'live-face', eyeL: { x: 0.34, y: 0.36 }, eyeR: { x: 0.66, y: 0.40 }, mouth: { x: 0.5, y: 0.64 }, mouthL: { x: 0.40, y: 0.64 }, mouthR: { x: 0.60, y: 0.64 }, mouthW: 0.2 };
    av._trustKey = '';
    av.breathOn = false;
    av.resize();
    let lv = 0;
    av.speakLive(() => lv, () => 0.5);
    let now = performance.now();
    const levels = [], mouths = [], plates = [];
    const seq = [0, 0.15, 0.45, 0.85, 0.85, 0.85, 0.35, 0.05, 0];
    for (const v of seq) {
      lv = v;
      for (let k = 0; k < 5; k++) {
        now += 22; av.frame(now);
        levels.push(v); mouths.push(av.mouth);
        if ((v === 0 && k === 4 && levels.length < 8) || (v === 0.85 && k >= 3)) plates.push(av.ctx.getImageData(0, 0, c.width, c.height));
      }
    }
    const closed = plates[0], open = plates[plates.length - 1];
    const y0 = Math.floor(c.height * 0.52), y1 = Math.floor(c.height * 0.78), mid = Math.floor(c.width / 2);
    const diff = meanDiff(closed, open, 0, c.width, y0, y1);
    const left = meanDiff(closed, open, 0, mid, y0, y1);
    const right = meanDiff(closed, open, mid, c.width, y0, y1);
    let jitter = 0, jn = 0, maxStep = 0;
    for (let i = 1; i < plates.length; i++) { jitter += meanDiff(plates[i - 1], plates[i], 0, c.width, y0, y1); jn++; }
    for (let i = 1; i < mouths.length; i++) maxStep = Math.max(maxStep, Math.abs(mouths[i] - mouths[i - 1]));
    c.remove();
    return {
      trusted: av.faceTrusted(), corr: corr(levels, mouths), diff, left, right,
      jitter: jitter / Math.max(1, jn), maxStep,
      inCall: document.body.classList.contains('in-call'),
      chatBelow: stage.bottom <= msgs.top + 8,
      chatH: msgs.height,
      chatShare: msgs.height / window.innerHeight,
    };
  });
  expect(snap.trusted).toBe(true);
  expect(snap.corr).toBeGreaterThan(0.55);
  expect(snap.diff).toBeGreaterThan(1.5);
  expect(snap.left).toBeGreaterThan(0.8);
  expect(snap.right).toBeGreaterThan(0.8);
  expect(Math.max(snap.left, snap.right) / Math.min(snap.left, snap.right)).toBeLessThan(1.8);
  expect(snap.jitter).toBeLessThan(snap.diff * 0.55);
  expect(snap.maxStep).toBeLessThan(0.3);
  expect(snap.inCall).toBe(false);
  expect(snap.chatBelow).toBe(true);
  expect(snap.chatShare).toBeLessThan(0.36);
});

test('il PCM della sessione ⚡ apre e chiude la bocca', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'In questo ambiente WebKit chiude il renderer quando parte un buffer PCM. Il labiale rispetto all’inviluppo è misurato nel test precedente.');
  await mockApp(page);
  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'wss://example.test/rt', token: 'tok', adult: false, session: { instructions: 'Sei Nova', voice: 'ara' } }),
  }));
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  const live = await page.evaluate(async () => {
    App.ls.set('key', 'sk-test');
    App.ls.set('callEngine', 'realtime');
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    try { await ac.resume(); } catch {}
    const dest = ac.createMediaStreamDestination();
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    class FakeWS {
      constructor() {
        this.readyState = 0; window.__ws = this;
        setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: 'session.created' }) }); }, 0);
      }
      send(raw) { let msg = {}; try { msg = JSON.parse(raw); } catch { return; } if (msg.type === 'session.update') setTimeout(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ type: 'session.updated' }) }); }, 0); }
      close() { this.readyState = 3; }
    }
    window.WebSocket = FakeWS;
    let err = '';
    const toast = App.toast; App.toast = (m) => { err = String(m); return toast(m); };
    await App.solo.toggleRt();
    const tone = (amp, n = 2400) => { const b = new Int16Array(n); for (let i = 0; i < n; i++) b[i] = Math.sin(i / 6) * amp * 32767; return b.buffer; };
    window.__ws.onmessage({ data: tone(0.7) });
    await new Promise((r) => setTimeout(r, 40));
    App.avatarConv.frame(performance.now());
    const open = App.avatarConv.mouth;
    await new Promise((r) => setTimeout(r, 280));
    for (let i = 0; i < 6; i++) App.avatarConv.frame(performance.now() + i * 40);
    const shut = App.avatarConv.mouth;
    await App.solo.toggleRt();
    return { err, open, shut, on: document.body.classList.contains('solo-rt'), inCall: document.body.classList.contains('in-call') };
  });
  expect(live.err).toBe('');
  expect(live.open).toBeGreaterThan(0.15);
  expect(live.shut).toBeLessThan(live.open * 0.65);
  expect(live.on).toBe(false);
  expect(live.inCall).toBe(false);
});

test('a schermo intero resta una sola X, quella globale', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  const xs = await page.evaluate(() => {
    App.solo.toggleFull(true);
    const vis = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 2 && r.height > 2;
    };
    return {
      full: document.body.classList.contains('av-full-on'),
      layer: vis(document.getElementById('layer-x')),
      expand: vis(document.getElementById('av-expand')),
      expandText: document.getElementById('av-expand').textContent,
    };
  });
  expect(xs.full).toBe(true);
  expect(xs.layer).toBe(true);
  expect(xs.expand).toBe(false);
  expect(xs.expandText).not.toBe('✕');
  const closed = await page.evaluate(() => {
    document.getElementById('layer-x').click();
    return !document.body.classList.contains('av-full-on');
  });
  expect(closed).toBe(true);
});
