const { test, expect } = require('./harness');

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function mockApp(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    const session = { type: 'auto' };
    navigator.audioSession = session;
    window.__ctxBirths = [];
    window.__gum = [];
    class FakeAC {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
        window.__ctxBirths.push(session.type);
      }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createBuffer() { return { getChannelData: () => new Float32Array(8), sampleRate: 22050, length: 8, duration: 0 }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {}, disconnect() {} }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      decodeAudioData(_b, ok) { const buf = { getChannelData: () => new Float32Array(8), sampleRate: 22050, length: 8, duration: 0 }; if (ok) ok(buf); return Promise.resolve(buf); }
      get audioWorklet() { return { addModule: () => Promise.resolve() }; }
    }
    window.AudioContext = FakeAC;
    window.webkitAudioContext = FakeAC;
    window.AudioWorkletNode = class { constructor() { this.port = {}; } connect() {} disconnect() {} };
    const track = (kind) => ({ kind, readyState: 'live', muted: false, stop() { this.readyState = 'ended'; }, onended: null, onmute: null });
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum.push({ audio: !!c.audio, video: !!c.video, session: session.type, echo: !!(c.audio && c.audio.echoCancellation) });
      const a = c.audio ? track('audio') : null;
      const v = c.video ? track('video') : null;
      return { getAudioTracks: () => a ? [a] : [], getVideoTracks: () => v ? [v] : [], getTracks: () => [a, v].filter(Boolean) };
    };
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/actions') return json({ video: true, adult: false, seconds: 6, catalog: [], gestures: [] });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

test('dettato e videochiamata tengono il microfono acceso, i movimenti di base partono', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo quando parte il grafo audio. Lo stesso percorso è verificato su Chromium.');
  page.on('dialog', (d) => d.accept());
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova' && App.avatarConv && App.avatarConv._drawn > 0);
  await page.evaluate(() => { App.me.serverKey = true; App.ls.set('callEngine', 'classic'); });
  await page.evaluate(() => document.getElementById('dock-mic').click());
  await page.waitForFunction(() => window.__gum.some((g) => g.audio) && App.voice.isListening() && App.audio.micLive());
  const dictated = await page.evaluate(() => {
    const before = App.audio.micLive() && App.callMic.active && App.voice.isListening();
    if (App.avatarConv) App.avatarConv.speaking = true;
    const during = App.audio.micLive() && App.callMic.active && App.voice.isListening();
    if (App.avatarConv) App.avatarConv.speaking = false;
    const after = App.audio.micLive() && App.callMic.active && App.voice.isListening();
    const births = window.__ctxBirths.slice();
    const gum = window.__gum.slice();
    return { before, during, after, births, gum, mode: App.voice.mode(), session: navigator.audioSession.type };
  });
  expect(dictated.before).toBe(true);
  expect(dictated.during).toBe(true);
  expect(dictated.after).toBe(true);
  expect(dictated.mode).toBe('xai');
  expect(dictated.session).toBe('play-and-record');
  expect(dictated.gum.some((g) => g.audio && g.echo && g.session === 'play-and-record')).toBe(true);
  expect(dictated.births[dictated.births.length - 1]).toBe('play-and-record');

  const boot = await page.evaluate(() => ({ loop: !!App.avatarConv._raf, blink: App.avatarConv.nextBlink > 0, drawn: App.avatarConv._drawn }));
  expect(boot.loop).toBe(true);
  expect(boot.blink).toBe(true);
  expect(boot.drawn).toBeGreaterThan(0);

  await page.evaluate(() => App.voice.stop());
  await page.evaluate(async () => { await App.call.start('video'); });
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.audio.micLive() && App.callMic.active);
  const call = await page.evaluate(() => {
    const live = App.audio.micLive();
    if (App.avatarConv) App.avatarConv.speaking = true;
    const during = App.audio.micLive() && (App.callMic.active || (App.rt && App.rt.active));
    if (App.avatarConv) App.avatarConv.speaking = false;
    const after = App.audio.micLive();
    return { live, during, after, inCall: document.body.classList.contains('in-call'), gum: window.__gum.length };
  });
  expect(call.live).toBe(true);
  expect(call.during).toBe(true);
  expect(call.after).toBe(true);
  expect(call.inCall).toBe(true);
  expect(call.gum).toBeGreaterThan(0);

  await page.evaluate(() => App.call.end());
  const motion = await page.evaluate(async () => {
    const av = App.avatarConv;
    document.getElementById('dock-settings').click();
    await new Promise((r) => setTimeout(r, 60));
    const mid = av._drawn;
    document.getElementById('dock-home').click();
    const t0 = performance.now();
    while (av._drawn <= mid && performance.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 40));
    return { loop: !!av._raf, resumed: av._drawn > mid, still: App.actions.queueText() };
  });
  expect(motion.loop).toBe(true);
  expect(motion.resumed).toBe(true);
  expect(motion.still).toContain('Con questa foto Nova usa respiro, sguardo e bocca');
  expect(motion.still).not.toContain('chiave xAI');
});
