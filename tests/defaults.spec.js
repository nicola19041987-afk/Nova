const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

test('microfono e tempo reale sono i default, una scelta a mano resta', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Il default è verificato su Chromium; WebKit chiude spesso la home.');
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: true, adultChat: false, serverKey: true, solo: true, soloKey: 'greta' });
    if (path === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: '', style: '', orders: '', requests: '' }]);
    if (path === '/api/characters/options') return json({});
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: true, noBrakes: true, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({});
    if (path === '/api/actions') return json({ catalog: [], adult: false, video: false });
    if (path === '/api/gestures') return json([]);
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.applySessionDefaults);
  const fresh = await page.evaluate(async () => {
    ['micOn', 'micPicked', 'callEngine', 'callEnginePick', 'soloRtOff'].forEach((k) => App.ls.del(k));
    App.applySessionDefaults();
    const defaults = { mic: App.ls.get('micOn'), engine: App.ls.get('callEngine', 'realtime'), asked: document.getElementById('adult-ask').hidden };
    App.ls.set('micPicked', true);
    App.ls.set('micOn', false);
    App.ls.set('callEngine', 'classic');
    App.applySessionDefaults();
    const kept = { mic: App.ls.get('micOn'), engine: App.ls.get('callEngine') };
    let gum = 0;
    const tracks = { getTracks: () => [{ stop() {} }] };
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => { gum += 1; return tracks; };
    const ok = await App.armMic(true);
    navigator.mediaDevices.getUserMedia = async () => { const err = new Error('denied'); err.name = 'NotAllowedError'; throw err; };
    let toast = '';
    const prev = App.toast;
    App.toast = (m) => { toast = String(m); };
    const denied = await App.armMic(true);
    App.toast = prev;
    return { defaults, kept, ok, gum, denied, toast };
  });
  expect(fresh.defaults).toEqual({ mic: true, engine: 'realtime', asked: true });
  expect(fresh.kept).toEqual({ mic: false, engine: 'classic' });
  expect(fresh.ok).toBe(true);
  expect(fresh.gum).toBe(1);
  expect(fresh.denied).toBe(false);
  expect(fresh.toast).toContain('Microfono non consentito');
});

test('dopo il consenso la modalità sbloccata è accesa, e si può spegnere a mano', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
  const before = await (await request.get('/api/settings')).json();
  expect(before.adultMode).toBe(false);
  const audio = Buffer.alloc(1200, 7);
  const consent = await request.post('/api/consent', { data: audio, headers: { ...HEAD, 'Content-Type': 'audio/webm' } });
  expect(consent.ok(), await consent.text()).toBeTruthy();
  const on = await (await request.get('/api/settings')).json();
  expect(on.adultMode).toBe(true);
  expect(on.noBrakes).toBe(true);
  const off = await request.put('/api/settings', { data: { adultMode: false, noBrakes: false, adultPicked: false, noBrakesPicked: false, autoSave: false, allowExport: false, videoModel: '', videoDuration: 6 }, headers: HEAD });
  expect(off.ok(), await off.text()).toBeTruthy();
  const kept = await (await request.get('/api/settings')).json();
  expect(kept.adultMode).toBe(false);
  expect(kept.noBrakes).toBe(false);
});
