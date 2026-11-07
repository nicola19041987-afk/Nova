const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function session(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
  return pin;
}

test('Luisa crea, modifica, cancella e cambia solo il suo PIN', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  const pin = await session(request, 'luisa', '4321');
  const me = await request.get('/api/me');
  expect(me.ok()).toBeTruthy();
  const who = await me.json();
  expect(who.user).toBe('luisa');
  expect(who.admin).toBe(true);
  expect(who.editor).toBe(true);

  const adult = await request.put('/api/settings', { data: { adultMode: true, autoSave: false, allowExport: false, videoModel: '', videoDuration: 6, noBrakes: false }, headers: HEAD });
  expect(adult.status()).toBe(403);

  const made = await request.post('/api/characters', { data: { name: 'Prova Luisa', avatar: '🌸', personality: 'Ciao', style: 'Calda' }, headers: HEAD });
  expect(made.ok(), await made.text()).toBeTruthy();
  const character = await made.json();
  const rules = await request.put('/api/rules', { data: { text: 'Regola di Luisa' }, headers: HEAD });
  expect(rules.ok(), await rules.text()).toBeTruthy();
  const removed = await request.delete('/api/characters/' + character.id, { headers: HEAD });
  expect(removed.ok(), await removed.text()).toBeTruthy();

  const bad = await request.post('/api/pin/change', { data: { current: '0000', pin: '9999' }, headers: HEAD });
  expect(bad.status()).toBe(401);
  const still = await request.get('/api/me', { headers: HEAD });
  expect(still.ok()).toBeTruthy();
  const next = pin === '4321' ? '4322' : '4321';
  const changed = await request.post('/api/pin/change', { data: { current: pin, pin: next }, headers: HEAD });
  expect(changed.ok()).toBeTruthy();
  await session(request, 'nicola', '1111');
  const nico = await request.get('/api/me', { headers: HEAD });
  expect((await nico.json()).user).toBe('nicola');
  const luisaOld = await request.post('/api/login', { data: { user: 'luisa', pin }, headers: HEAD });
  expect(luisaOld.ok()).toBeFalsy();
});

test('l’appunto si salva e non butta fuori', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium: il limite PIN è per dispositivo');
  await session(request, 'luisa', '4322');
  const r = await request.post('/api/support-notes', { data: { text: 'Il microfono non parte' }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
  const body = await r.json();
  expect(body.ok).toBe(true);
  expect(body.delivered).toBe(false);
  const me = await request.get('/api/me');
  expect(me.ok()).toBeTruthy();
  const file = path.join('/tmp/nova-e2e-empty', 'notes.json');
  const notes = JSON.parse(fs.readFileSync(file, 'utf8'));
  const note = notes.find((n) => n.text === 'Il microfono non parte');
  expect(note.author).toBe('Luisa');
  expect(note.time).toBeTruthy();
  expect(note.delivered).toBe(false);
  expect(note.reply.text).toBe('Prendo in considerazione e vi aggiorno appena è pronto.');
  expect(body.note.status).toBe('in attesa');
  expect(body.note.reply.author).toBe('Nova');
  const hist = await request.get('/api/support-notes', { headers: HEAD });
  const mine = (await hist.json()).notes;
  expect(mine.some((n) => n.text === 'Il microfono non parte' && n.status === 'in attesa')).toBeTruthy();
  await session(request, 'nicola', '1111');
  const other = await request.get('/api/support-notes', { headers: HEAD });
  expect((await other.json()).notes.some((n) => n.text === 'Il microfono non parte')).toBeFalsy();
});

async function ui(page, user) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user, name: user === 'luisa' ? 'Luisa' : 'Nico', admin: true, editor: true, activated: user !== 'fresh', consent: user === 'fresh' ? null : { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, serverKey: true, solo: true, soloKey: 'greta' });
    if (path === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '', messages: 1 }, { id: 'ffffffffffffffff', name: 'Mara', createdBy: 'luisa', avatar: 'M', messages: 3 }]);
    if (path === '/api/characters/options') return json({});
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({});
    if (path === '/api/support-notes' && route.request().method() === 'GET') return json({ notes: [] });
    if (path === '/api/support-notes' && route.request().method() === 'POST') {
      const b = route.request().postDataJSON();
      if (!b.text) return json({ error: 'Scrivi un appunto' }, 400);
      const delivered = b.text === 'fallo arrivare';
      return json({ ok: true, delivered, note: { id: 'n1', author: user === 'luisa' ? 'Luisa' : 'Nicola', text: b.text, time: '2026-11-06T09:00:00.000Z', delivered, status: delivered ? 'inviato' : 'in attesa', reply: { author: 'Nova', text: 'Prendo in considerazione e vi aggiorno appena è pronto.', time: '2026-11-06T09:00:00.000Z' } } });
    }
    return json({});
  });
}

test('Luisa vede gli stessi comandi e Aggiorna ricarica senza uscire', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WPE chiude la pagina quando parte l’avatar');
  await ui(page, 'luisa');
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await expect(page.locator('#app-refresh')).toBeVisible();
  const powers = await page.evaluate(() => ({
    locked: document.body.classList.contains('not-admin'),
    edit: App.canEdit(),
    admin: App.isAdmin(),
    refresh: !!document.getElementById('app-refresh'),
  }));
  expect(powers).toEqual({ locked: false, edit: true, admin: true, refresh: true });
  await page.evaluate(() => {
    sessionStorage.setItem('nova-refresh', '1');
    navigator.serviceWorker.getRegistration = async () => ({
      update: async () => { sessionStorage.setItem('nova-sw', 'update'); },
      waiting: { postMessage: (m) => sessionStorage.setItem('nova-swmsg', m.type) },
      installing: null,
    });
  });
  await page.locator('#app-refresh').click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#app-refresh')).toBeVisible();
  const sw = await page.evaluate(() => sessionStorage.getItem('nova-swmsg'));
  expect(sw).toBe('SKIP_WAITING');
});

test('Luisa entra nella Home senza consenso né chiave sul telefono', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WPE chiude la pagina quando parte l’avatar');
  await ui(page, 'fresh');
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await expect(page.locator('#view-activate')).toBeHidden();
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#app-refresh')).toBeVisible();
  await expect(page.locator('#key-warning')).toBeHidden();
  await expect(page.locator('#toast')).not.toHaveText(/chiave/i);
});

test('Invia salva l’appunto e Chiudi chiude il foglio', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WPE chiude la pagina quando parte l’avatar');
  await ui(page, 'nicola');
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('support-note-btn'));
  await page.locator('#support-note-btn').click();
  await expect(page.locator('#support-thread')).toContainText('Nessun appunto');
  await page.locator('#support-text').fill('fallo arrivare');
  await page.locator('#support-send').click();
  await expect(page.locator('#toast')).toHaveText('Inviato');
  await expect(page.locator('#support-dialog')).toBeVisible();
  await expect(page.locator('#support-thread')).toContainText('Prendo in considerazione e vi aggiorno appena è pronto.');
  await expect(page.locator('#support-thread')).toContainText('inviato');
  await expect(page.locator('#support-text')).toHaveValue('');
  await page.locator('#support-dialog .layer-x').click();
  await expect(page.locator('#support-dialog')).toBeHidden();
  await page.locator('#support-note-btn').click();
  await expect(page.locator('#support-thread')).toContainText('Nessun appunto');
  await page.locator('#support-text').fill('questo fallisce');
  await page.route('**/api/support-notes', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Salvataggio non riuscito' }) }));
  await page.locator('#support-send').click();
  await expect(page.locator('#support-text')).toHaveValue('questo fallisce');
  await expect(page.locator('#support-dialog')).toBeVisible();
  await page.locator('#support-cancel').click();
  await expect(page.locator('#support-dialog')).toBeHidden();
});
