const { test, expect } = require('./harness');

test.skip(({ browserName }) => browserName === 'webkit', 'Il socket finto è verificato su Chromium.');
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

test('response.cancel parte solo tra created e done, e quel errore non è un avviso', async ({ page }) => {
  test.setTimeout(30000);
  const warns = [];
  page.on('console', (msg) => { if (msg.type() === 'warning') warns.push(msg.text()); });
  await page.addInitScript(() => {
    window.__sent = [];
    function WS() {
      this.readyState = 0;
      this.protocol = 'xai-client-secret.t';
      this.binaryType = '';
      window.__ws = this;
    }
    WS.prototype.send = function (d) { window.__sent.push(String(d)); };
    WS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); };
    window.WebSocket = WS;
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/realtime/session') return json({ url: 'wss://example.test/realtime', token: 't', session: { instructions: 'ciao', voice: 'ara' }, adult: false });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: '', style: '', orders: '', requests: '', voice: 'ara' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json({ catalog: [], adult: false, video: false });
    if (p === '/api/gestures') return json([]);
    if (p === '/api/characters/options') return json({});
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.rt && App.rt.start);
  const out = await page.evaluate(async () => {
    const cancels = () => window.__sent.filter((s) => s.includes('"response.cancel"') || s.includes('"type":"response.cancel"')).length;
    const ch = { id: 'bbbbbbbbbbbbbbbb', name: 'Nova', voice: 'ara' };
    const pending = App.rt.start(ch, 'voice', '');
    const t0 = Date.now();
    while (!window.__ws || !window.__ws.onopen) {
      if (Date.now() - t0 > 8000) throw new Error('socket assente');
      await new Promise((r) => setTimeout(r, 20));
    }
    const ws = window.__ws;
    ws.readyState = 1;
    ws.onopen();
    const feed = (ev) => ws.onmessage({ data: JSON.stringify(ev) });
    feed({ type: 'session.created' });
    feed({ type: 'session.updated' });
    await pending;
    feed({ type: 'response.created', response: { id: 'r1' } });
    App.rt.interrupt();
    App.rt.interrupt();
    const during = cancels();
    feed({ type: 'response.done', response: { id: 'r1', status: 'cancelled' } });
    feed({ type: 'response.audio.delta', response_id: 'r2' });
    App.rt.interrupt();
    App.rt.interrupt();
    const after = cancels();
    feed({ type: 'error', error: { message: 'Cancellation failed: no active response found' } });
    const afterBenign = App.rt.lastError || '';
    feed({ type: 'error', error: { message: 'altro errore vero' } });
    return { during, after, afterBenign, real: App.rt.lastError || '', active: !!(App.rt._s() && App.rt._s().responseActive) };
  });
  expect(out.during).toBe(1);
  expect(out.after).toBe(1);
  expect(out.afterBenign).toBe('');
  expect(out.real).toContain('altro errore vero');
  expect(out.active).toBe(false);
  expect(warns.some((w) => /no active response/i.test(w))).toBe(false);
  expect(warns.some((w) => /altro errore vero/.test(w))).toBe(true);
});

test('un rumore breve non manda response.cancel; una frase sostenuta sì', async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    window.__sent = [];
    function WS() { this.readyState = 0; this.protocol = 'xai-client-secret.t'; this.binaryType = ''; window.__ws = this; }
    WS.prototype.send = function (d) { window.__sent.push(String(d)); };
    WS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); };
    window.WebSocket = WS;
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/realtime/session') return json({
      url: 'wss://example.test/realtime', token: 't', adult: false,
      session: { instructions: 'PRESENZA: finisci il pensiero con frasi intere.', voice: 'eve', turn_detection: { type: 'server_vad', threshold: 0.9, silence_duration_ms: 900, prefix_padding_ms: 500 } },
    });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: '', style: '', orders: '', requests: '', voice: 'eve' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json({ catalog: [], adult: false, video: false });
    if (p === '/api/gestures') return json([]);
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.rt && App.rt.start);
  const out = await page.evaluate(async () => {
    const cancels = () => window.__sent.filter((s) => s.includes('response.cancel')).length;
    const ch = { id: 'bbbbbbbbbbbbbbbb', name: 'Nova', voice: 'eve' };
    const pending = App.rt.start(ch, 'video', '');
    const t0 = Date.now();
    while (!window.__ws || !window.__ws.onopen) {
      if (Date.now() - t0 > 8000) throw new Error('socket assente');
      await new Promise((r) => setTimeout(r, 20));
    }
    const ws = window.__ws;
    ws.readyState = 1;
    ws.onopen();
    const feed = (ev) => ws.onmessage({ data: JSON.stringify(ev) });
    feed({ type: 'session.created' });
    feed({ type: 'session.updated' });
    await pending;
    feed({ type: 'response.created', response: { id: 'r9' } });
    feed({ type: 'input_audio_buffer.speech_started' });
    await new Promise((r) => setTimeout(r, 280));
    feed({ type: 'input_audio_buffer.speech_stopped' });
    const blip = cancels();
    feed({ type: 'response.created', response: { id: 'r10' } });
    feed({ type: 'input_audio_buffer.speech_started' });
    feed({ type: 'conversation.item.input_audio_transcription.updated', transcript: 'aspetta un attimo' });
    await new Promise((r) => setTimeout(r, 900));
    const held = cancels();
    const instr = (App.rt._s() && App.rt._s().cfg && App.rt._s().cfg.session && App.rt._s().cfg.session.instructions) || '';
    return { blip, held, steady: /finisci il pensiero/i.test(instr) };
  });
  expect(out.blip).toBe(0);
  expect(out.held).toBe(1);
  expect(out.steady).toBe(true);
});
