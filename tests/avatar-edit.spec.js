const { test, expect } = require('./harness');
const fs = require('fs');

const HEAD = { 'X-Requested-With': 'app-privata' };
const NOVA = 'bbbbbbbbbbbbbbbb';

function seed() {
  return [
    { id: NOVA, name: 'Nova', ready: 'nova-scelta', createdBy: 'nicola', avatar: '/api/avatars/bbbbbbbbbbbbbbbb.jpg', personality: '', style: '', orders: '', requests: '', messages: 4, nicolaMessages: 2, lookHistory: [] },
  ];
}

async function mockApp(page, state) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (path === '/api/characters/options') return json({});
    if (path === '/api/characters' && route.request().method() === 'GET') return json(state.chars);
    if (path.endsWith('/photo-edit') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() || {};
      const loading = true;
      state.edits.push({ prompt: body.prompt, loading });
      if (state.refuse) return json({ error: 'Contenuto rifiutato dal servizio AI' }, 502);
      const id = path.split('/')[3];
      const ch = state.chars.find((c) => c.id === id);
      const next = { ...ch, avatar: '/api/avatars/abcdef0123456789.jpg', avatarSource: 'ai', lookHistory: [{ id: 'h1', at: '2026-11-08T15:00:00.000Z', avatar: ch.avatar, reason: 'foto: ' + body.prompt }, ...(ch.lookHistory || [])] };
      state.chars = state.chars.map((c) => c.id === id ? next : c);
      return json({ character: next });
    }
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (path === '/api/actions') return json({ video: false, adult: false, seconds: 6, catalog: [], gestures: [] });
    if (path === '/api/gestures') return json([]);
    if (path === '/api/solo/prep') return json({ ok: true });
    return json({});
  });
}

test('il campo di modifica sta prima di Aggiorna immagine', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla home. Il campo è verificato su Chromium.');
  const state = { chars: seed(), edits: [], refuse: false };
  await mockApp(page, state);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.solo);
  const placed = await page.evaluate(() => {
    document.getElementById('wa-photo').click();
    const note = document.getElementById('avatar-edit-note');
    const btn = document.getElementById('avatar-edit-go');
    const box = note.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return {
      label: note.getAttribute('placeholder'),
      text: btn.textContent,
      visible: box.height > 30 && b.height >= 44 && getComputedStyle(note).display !== 'none',
      before: !!(note.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
      above: box.bottom <= b.top + 1,
    };
  });
  expect(placed.label).toContain('maglietta rossa');
  expect(placed.text).toBe('Aggiorna immagine');
  expect(placed.visible).toBe(true);
  expect(placed.before).toBe(true);
  expect(placed.above).toBe(true);
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: '/opt/cursor/artifacts/avatar-edit-field.png' });

  const empty = await page.evaluate(async () => {
    document.getElementById('avatar-edit-note').value = '   ';
    await App.solo.editPhoto();
    return document.getElementById('avatar-edit-status').hidden;
  });
  expect(empty).toBe(true);
  expect(state.edits).toEqual([]);

  const ok = await page.evaluate(async () => {
    const note = document.getElementById('avatar-edit-note');
    note.value = 'maglietta rossa';
    let loading = '';
    const orig = App.api;
    App.api = async (...args) => {
      loading = document.getElementById('avatar-edit-status').textContent;
      return orig.apply(App, args);
    };
    await App.solo.editPhoto();
    const ch = App.chars.find((c) => c.id === App.current.id);
    return {
      loading,
      status: document.getElementById('avatar-edit-status').textContent,
      avatar: App.current.avatar,
      kept: ch.lookHistory[0] && ch.lookHistory[0].avatar,
      cleared: note.value,
    };
  });
  expect(ok.loading).toBe('Aggiorno la foto…');
  expect(ok.status).toContain('precedente resta');
  expect(ok.avatar).toBe('/api/avatars/abcdef0123456789.jpg');
  expect(ok.kept).toBe('/api/avatars/bbbbbbbbbbbbbbbb.jpg');
  expect(ok.cleared).toBe('');
  expect(state.edits.map((e) => e.prompt)).toEqual(['maglietta rossa']);

  state.refuse = true;
  const refused = await page.evaluate(async () => {
    const before = App.current.avatar;
    document.getElementById('avatar-edit-note').value = 'capelli corti';
    await App.solo.editPhoto();
    return {
      status: document.getElementById('avatar-edit-status').textContent,
      avatar: App.current.avatar,
      same: App.current.avatar === before,
    };
  });
  expect(refused.status).toBe('Contenuto rifiutato dal servizio AI');
  expect(refused.same).toBe(true);
  expect(state.edits.map((e) => e.prompt)).toEqual(['maglietta rossa', 'capelli corti']);
});

test('un testo vuoto o non consentito non modifica la foto', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const chars = await (await request.get('/api/characters')).json();
  const ch = chars.find((c) => c && c.avatar && String(c.avatar).startsWith('/api/avatars/')) || chars[0];
  expect(ch && ch.id).toBeTruthy();
  const before = JSON.stringify({ avatar: ch.avatar, history: ch.lookHistory || [] });
  const ai = { ...HEAD, 'X-AI-Key': 'xai-test-not-real' };
  const blank = await request.post(`/api/characters/${ch.id}/photo-edit`, { data: { prompt: '   ' }, headers: ai });
  expect(blank.status()).toBe(400);
  expect((await blank.json()).error).toContain('Scrivi');
  const youth = await request.post(`/api/characters/${ch.id}/photo-edit`, { data: { prompt: 'bambina di 10 anni' }, headers: ai });
  expect(youth.status()).toBe(400);
  expect(await youth.json()).toMatchObject({ error: expect.stringContaining('adulti') });
  const again = (await (await request.get('/api/characters')).json()).find((c) => c.id === ch.id);
  expect(JSON.stringify({ avatar: again.avatar, history: again.lookHistory || [] })).toBe(before);
});
