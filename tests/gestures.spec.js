const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

test('il catalogo ha solo saluto e capelli', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const list = await (await request.get('/api/gestures')).json();
  expect(list.map((g) => g.id).sort()).toEqual(['capelli', 'saluto']);
  expect(list.every((g) => g.full === false)).toBe(true);
  const vid = await request.get('/api/gestures/saluto');
  expect(vid.ok()).toBeTruthy();
  expect(vid.headers()['content-type'] || '').toContain('video');
  expect((await request.get('/api/gestures/bere')).status()).toBe(404);
  expect((await request.get('/api/gestures/stiracchiarsi')).status()).toBe(404);
});

async function mockApp(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/actions') return json({ video: false, adult: false, seconds: 6, catalog: [], gestures: [] });
    if (p === '/api/gestures') return json([
      { id: 'saluto', label: 'Saluta con la mano', emoji: '👋', full: false, keys: ['ciao con la mano', 'salut'], url: '/api/gestures/saluto' },
      { id: 'capelli', label: 'Si sistema i capelli', emoji: '💇‍♀️', full: false, keys: ['pettin', 'capell'], url: '/api/gestures/capelli' },
    ]);
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

test('un gesto non copre la bocca mentre parla e torna alla foto alla fine', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla home con l’avatar. Il flusso è verificato su Chromium.');
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.gestures);
  const snap = await page.evaluate(async () => {
    const v = document.getElementById('stage-video');
    v.play = () => Promise.resolve();
    v.load = () => {};
    let fakeSrc = '';
    Object.defineProperty(v, 'src', { configurable: true, get() { return fakeSrc; }, set(u) { fakeSrc = u; queueMicrotask(() => { if (v.oncanplay) v.oncanplay(); }); } });
    await App.gestures.load();
    const words = {
      saluta: App.gestures.match('mi saluti con la mano'),
      ciao: App.gestures.match('ciao'),
      mano: App.gestures.match('ciao con la mano'),
      capelli: App.gestures.match('sistemati i capelli'),
      pettina: App.gestures.match('pettinati'),
      bere: App.gestures.match('bevi un sorso'),
      stira: App.gestures.match('stiracchiati'),
    };
    App.avatarConv.speaking = true;
    const whileTalk = App.gestures.hear('salutami');
    const hiddenWhile = v.hidden;
    App.gestures.pump();
    const stillHidden = v.hidden;
    App.avatarConv.speaking = false;
    App.chat.busy = false;
    App.gestures._quiet(1000);
    App.gestures.pump();
    await Promise.resolve();
    await new Promise((r) => requestAnimationFrame(r));
    const shown = !v.hidden && v.classList.contains('gesture-on') && String(v.src || '').includes('saluto');
    const dbg = { hidden: v.hidden, cls: v.className, src: v.getAttribute('src'), pending: App.gestures.state().pending, playing: App.gestures.state().playing, speak: App.avatarConv.speaking, busy: App.chat.busy, ss: !!(window.speechSynthesis && window.speechSynthesis.speaking) };
    v.onended();
    const back = v.hidden && !v.classList.contains('gesture-on');
    App.current = App.current || { id: 'bbbbbbbbbbbbbbbb', actions: {} };
    if (App.actions) App.actions.render();
    document.body.classList.add('simli-on');
    const blocked = App.gestures.hear('pettinati');
    document.body.classList.remove('simli-on');
    return { words, whileTalk, hiddenWhile, stillHidden, shown, back, blocked, dbg, menu: document.getElementById('act-list').textContent };
  });
  expect(snap.words).toEqual({ saluta: 'saluto', ciao: null, mano: 'saluto', capelli: 'capelli', pettina: 'capelli', bere: null, stira: null });
  expect(snap.whileTalk).toBe('queued');
  expect(snap.hiddenWhile).toBe(true);
  expect(snap.stillHidden).toBe(true);
  expect(snap.shown, JSON.stringify(snap.dbg)).toBe(true);
  expect(snap.back).toBe(true);
  expect(snap.blocked).toBe(null);
  expect(snap.menu).toContain('Saluta');
  expect(snap.menu).toContain('capelli');
});
