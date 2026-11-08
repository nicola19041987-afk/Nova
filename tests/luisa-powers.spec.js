const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };
const MARA = 'cccccccccccccccc';
const FIORE = 'dddddddddddddddd';
const NOVA = 'bbbbbbbbbbbbbbbb';

async function session(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test('Luisa ha i poteri di Nicola e il consenso adulti resta suo', async ({ request }) => {
  await session(request, 'luisa', '4321');
  const me = await request.get('/api/me');
  expect(me.ok()).toBeTruthy();
  const who = await me.json();
  expect(who.user).toBe('luisa');
  expect(who.admin).toBe(true);
  expect(who.editor).toBe(true);
  expect(who.serverKey).toBe(false);

  const adult = await request.put('/api/settings', { data: { adultMode: true, autoSave: false, allowExport: false, videoModel: '', videoDuration: 6, noBrakes: false }, headers: HEAD });
  expect(adult.status()).toBe(403);

  const privacy = await request.put('/api/settings', { data: { adultMode: false, autoSave: true, allowExport: false, videoModel: '', videoDuration: 6, noBrakes: true }, headers: HEAD });
  expect(privacy.ok(), await privacy.text()).toBeTruthy();
  expect((await privacy.json()).autoSave).toBe(true);

  const rules = await request.put('/api/rules', { data: { text: 'Regola di Luisa' }, headers: HEAD });
  expect(rules.ok(), await rules.text()).toBeTruthy();
  const memory = await request.post('/api/memory', { data: { text: 'Luisa ricorda il lago' }, headers: HEAD });
  expect(memory.ok(), await memory.text()).toBeTruthy();
  const recovery = await request.get('/api/recovery');
  expect(recovery.status()).not.toBe(403);
  const trash = await request.get('/api/trash/characters');
  expect(trash.ok(), await trash.text()).toBeTruthy();

  const made = await request.post('/api/characters', { data: { name: 'Prova Luisa', avatar: '🌸', personality: 'Ciao', style: 'Calda' }, headers: HEAD });
  expect(made.ok(), await made.text()).toBeTruthy();
  const character = await made.json();
  const removed = await request.delete('/api/characters/' + character.id, { headers: HEAD });
  expect(removed.ok(), await removed.text()).toBeTruthy();

  await session(request, 'nicola', '1111');
  const nico = await request.get('/api/me');
  expect((await nico.json()).user).toBe('nicola');
  expect((await nico.json()).admin).toBe(true);
  const luisaStill = await request.post('/api/login', { data: { user: 'luisa', pin: '4321' }, headers: HEAD });
  expect(luisaStill.ok()).toBeTruthy();
});

async function ui(page, user) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user, name: user === 'luisa' ? 'Luisa' : 'Nico', admin: true, editor: true, activated: false, consent: null, adult: false, adultChat: false, serverKey: true, solo: true, soloKey: 'greta' });
    if (path === '/api/characters') return json([
      { id: NOVA, name: 'Nova', ready: 'nova-unico', avatar: '🍷', personality: '', style: '', orders: '', requests: '' },
      { id: MARA, name: 'Mara', createdBy: 'nicola', avatar: 'M', personality: 'x', style: '', archived: true },
      { id: FIORE, name: 'Fiore', createdBy: 'luisa', avatar: 'F', personality: 'x', style: '', archived: true },
    ]);
    if (path === '/api/characters/options') return json({});
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({});
    if (path === '/api/actions') return json({ catalog: [], adult: false, video: false });
    return json({});
  });
}

test('dopo il PIN Luisa è in Home, senza consenso né coda Prepara, e vede solo Nova', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE) chiude il processo al click sul foglio avatar. Il foglio è verificato su Chromium.');
  await ui(page, 'luisa');
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  await expect(page.locator('#view-activate')).toBeHidden();
  await expect(page.locator('#view-login')).toBeHidden();
  const gate = await page.evaluate(() => ({
    locked: document.body.classList.contains('not-admin'),
    admin: App.isAdmin(),
    edit: App.canEdit(),
    keyHidden: document.getElementById('key-warning').hidden,
    prep: !!(document.getElementById('auto-prep') && !document.getElementById('auto-prep').hidden),
  }));
  expect(gate).toEqual({ locked: false, admin: true, edit: true, keyHidden: true, prep: false });
  await page.locator('#wa-photo').click();
  await expect(page.locator('#avatar-sheet-list')).toContainText('Nova');
  await expect(page.locator('#avatar-sheet-list')).not.toContainText('Mara');
  await expect(page.locator('#avatar-sheet-list')).not.toContainText('Fiore');
});
