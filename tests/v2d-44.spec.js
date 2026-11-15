// v2d-44: punto unico foto/video in chat con modifiche scritte, Impostazioni nel menu, test senza webhook veri.
const { test, expect } = require('./harness');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEAD = { 'X-Requested-With': 'app-privata' };
const JPG = path.join(__dirname, 'fixtures-v2d44', 'foto.jpg');
const OUT = path.join(__dirname, 'fixtures-v2d44', 'tramonto.jpg');
const MP4 = path.join(__dirname, 'fixtures-v2d43', 'sample.mp4');
const SHOTS = process.env.V2D44_SHOTS || '';

// finto servizio xAI: /images/edits risponde con un'immagine; tutto il resto 200 vuoto
function startMockAI(seen) {
  const out = fs.readFileSync(OUT).toString('base64');
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: !!req.headers.authorization, body: body.slice(0, 400000) });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/images/edits')) return res.end(JSON.stringify({ data: [{ b64_json: out }] }));
      res.end('{}');
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
function startServer(dir, aiPort) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-v2d44', NOVA_E2E: '' };
  for (const k of Object.keys(env)) if (/^(NOTES|SISTEMA)_WEBHOOK_|^SIMLI_/.test(k)) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  return { child, port, log: () => log };
}
async function waitUp(s) {
  const t0 = Date.now();
  while (!s.log().includes('App privata avviata')) {
    if (s.child.exitCode != null) throw new Error(s.log() || 'server spento');
    if (Date.now() - t0 > 20000) throw new Error(s.log() || 'avvio lento');
    await new Promise((ok) => setTimeout(ok, 50));
  }
}
async function pinLogin(request, base) {
  const setup = await request.post(base + '/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) { const l = await request.post(base + '/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD }); expect(l.ok()).toBeTruthy(); }
  else expect(setup.ok(), await setup.text()).toBeTruthy();
}

test('v2d-44: i test non vedono i webhook veri (niente appunti finti di Luisa verso chi segue l\'app)', async () => {
  for (const k of Object.keys(process.env)) expect(/^(NOTES|SISTEMA)_WEBHOOK_/.test(k), k).toBeFalsy();
});

test('v2d-44: API modifica foto (xAI edits) e nota sul video', async ({ request }) => {
  test.setTimeout(60000);
  const seen = [], ai = await startMockAI(seen);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d44-api-'));
  const s = startServer(dir, ai.address().port);
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await pinLogin(request, base);
    const up = await request.post(base + '/api/gallery', { data: fs.readFileSync(JPG), headers: { ...HEAD, 'Content-Type': 'image/jpeg', 'X-File-Name': 'foto.jpg' } });
    expect(up.ok(), await up.text()).toBeTruthy();
    const img = (await up.json()).item;
    const empty = await request.post(`${base}/api/gallery/${img.id}/edit`, { data: { instruction: '  ' }, headers: HEAD });
    expect(empty.status()).toBe(400);
    const ed = await request.post(`${base}/api/gallery/${img.id}/edit`, { data: { instruction: 'cielo al tramonto' }, headers: HEAD });
    expect(ed.ok(), await ed.text()).toBeTruthy();
    const j = await ed.json();
    expect(j.edited).toBe(true);
    expect(j.item.kind).toBe('image');
    expect(j.item.id).not.toBe(img.id);
    const call = seen.find((x) => x.url.endsWith('/images/edits'));
    expect(call && call.auth).toBeTruthy();
    expect(call.body).toContain('cielo al tramonto');
    expect(call.body).toContain('data:image/jpeg;base64,');
    const file = await request.get(base + j.item.url);
    expect(file.ok()).toBeTruthy();
    const vu = await request.post(base + '/api/gallery', { data: fs.readFileSync(MP4), headers: { ...HEAD, 'Content-Type': 'video/mp4', 'X-File-Name': 'v.mp4' } });
    const vid = (await vu.json()).item;
    const n = seen.length;
    const ve = await request.post(`${base}/api/gallery/${vid.id}/edit`, { data: { instruction: 'taglia i primi 2 secondi' }, headers: HEAD });
    expect(ve.ok()).toBeTruthy();
    const vj = await ve.json();
    expect(vj).toMatchObject({ kind: 'video', edited: false, noted: true });
    expect(seen.length).toBe(n); // nessuna chiamata all'IA per i video
    const g = await (await request.get(base + '/api/gallery')).json();
    expect(g.items.length).toBe(3); // originale, modificata, video
  } finally { s.child.kill(); ai.close(); }
});

test('v2d-44: in chat un solo «+» per foto e video, testo = modifica, invio -> originale e risultato in chat', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Upload e selettore file: percorso completo su Chromium.');
  test.setTimeout(90000);
  const seen = [], ai = await startMockAI(seen);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d44-ui-'));
  const s = startServer(dir, ai.address().port);
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await pinLogin(request, base);
    await request.post(base + '/api/logout', { headers: HEAD }).catch(() => {});
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/');
    await page.locator('.login-profile', { hasText: 'Nico' }).click();
    for (const n of ['1', '3', '5', '7']) await page.locator(`#pin-pad [data-key="${n}"]`).click();
    await page.waitForFunction(() => document.getElementById('view-login').hidden, null, { timeout: 30000 });
    await page.waitForFunction(() => window.App && App.solo && document.body.classList.contains('solo-mode'), null, { timeout: 30000 });
    // menu: Impostazioni c'è (e la Galleria resta)
    if (!(await page.locator('#nh-list').isVisible().catch(() => false))) await page.evaluate(() => App.solo.showHome());
    const later0 = page.locator('#adult-ask button', { hasText: 'Più tardi' }); // riquadro del consenso del profilo di prova nuovo
    if (await later0.isVisible().catch(() => false)) await later0.click();
    await expect(page.locator('#dock-settings')).toBeVisible();
    await expect(page.locator('#dock-settings')).toContainText('Impostazioni');
    if (SHOTS) { await page.locator('#dock-settings').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, '03-impostazioni-390x844.png') }); }
    await page.evaluate(() => App.solo.showChat());
    await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
    await expect(page.locator('#vn-plus')).toBeVisible();
    const chooserP = page.waitForEvent('filechooser');
    await page.locator('#vn-plus').click();
    const chooser = await chooserP;
    expect(chooser.isMultiple()).toBeTruthy();
    expect(await chooser.element().getAttribute('accept')).toBe('image/*,video/*');
    await chooser.setFiles([JPG]);
    await expect(page.locator('#att-tray .att-item')).toHaveCount(1);
    await expect(page.locator('#chat-form button[type="submit"]')).toBeVisible(); // invio visibile anche col testo vuoto
    await page.locator('#chat-input').fill('metti il cielo al tramonto');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '01-chat-caricamento-390x844.png') });
    await page.locator('#chat-input').press('Enter');
    await expect(page.locator('#messages .msg.has-media')).toHaveCount(2, { timeout: 30000 });
    await expect(page.locator('#messages .msg.has-media').last()).toContainText('Fatto: metti il cielo al tramonto');
    await expect(page.locator('#att-tray')).toBeHidden();
    await expect(page.locator('#chat-input')).toHaveAttribute('required', '');
    expect(seen.filter((x) => x.url.endsWith('/images/edits')).length).toBe(1);
    await page.waitForTimeout(600);
    await page.evaluate(() => App.chat.scroll && App.chat.scroll());
    await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '02-risultato-modifica-390x844.png') });
    // salvati: in chat (server) e in Galleria
    const chat = await page.evaluate(async () => (await App.api(`/api/chats/${App.current.id}`)).messages.filter((m) => m.photo).length);
    expect(chat).toBe(2);
    const g = await page.evaluate(async () => (await App.api('/api/gallery')).items.length);
    expect(g).toBe(2);
    // video: niente IA, nota salvata
    const chooser2P = page.waitForEvent('filechooser');
    await page.locator('#vn-plus').click();
    await (await chooser2P).setFiles([MP4]);
    await expect(page.locator('#att-tray .att-item.vid')).toHaveCount(1);
    await page.locator('#chat-input').fill('accorcialo');
    // il riquadro del consenso (profilo di prova nuovo) copre la barra: «Più tardi», poi il tocco su ➤ come sul telefono
    const later = page.locator('#adult-ask button', { hasText: 'Più tardi' });
    if (await later.isVisible().catch(() => false)) await later.click();
    await page.locator('#chat-form button[type="submit"]').click();
    await expect(page.locator('#messages .msg.has-media')).toHaveCount(3, { timeout: 30000 });
    await expect(page.locator('#toast')).toContainText('nota', { timeout: 10000 });
    expect(seen.filter((x) => x.url.endsWith('/images/edits')).length).toBe(1);
    // composer normale ancora funzionante: testo senza allegati
    await expect(page.locator('#chat-input')).toHaveAttribute('placeholder', 'Messaggio');
  } finally { s.child.kill(); ai.close(); }
});

test('v2d-44: iPhone SE 375x568, il vassoio allegati non copre il campo di testo', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Chromium.');
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 375, height: 568 });
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Eris', ready: 'nova-scelta', avatar: '', motionClips: [], outfits: [], personality: '', style: '', requests: '', voice: 'eve' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/gallery') return json({ items: [], trash: [], trashDays: 30 });
    if (p === '/api/memory') return json([]);
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.attach, null, { timeout: 30000 });
  await page.evaluate(() => App.solo.showChat());
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  const chooserP = page.waitForEvent('filechooser');
  await page.locator('#vn-plus').click();
  await (await chooserP).setFiles([JPG, MP4]);
  await expect(page.locator('#att-tray .att-item')).toHaveCount(2);
  const tray = await page.locator('#att-tray').boundingBox();
  const inp = await page.locator('#chat-input').boundingBox();
  expect(tray.y + tray.height).toBeLessThanOrEqual(inp.y + 1);
  expect(inp.y + inp.height).toBeLessThanOrEqual(568);
  await page.locator('#att-tray .att-x').first().click();
  await expect(page.locator('#att-tray .att-item')).toHaveCount(1);
});

test('v2d-44: mentre parla, di serie la bocca è quella guidata dall\'audio (non i clip «parla» con bocca generata)', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Chromium.');
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const LM = { eyeL: { x: 0.44, y: 0.3 }, eyeR: { x: 0.58, y: 0.3 }, mouth: { x: 0.51, y: 0.42 }, auto: true };
  let withFace = true;
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Eris', ready: 'nova-scelta', avatar: '', landmarks: withFace ? LM : null, motionClips: [], outfits: [], personality: '', style: '', requests: '', voice: 'eve' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/gallery') return json({ items: [], trash: [], trashDays: 30 });
    if (p === '/api/memory') return json([]);
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.talkClipsOn, null, { timeout: 30000 });
  const run = () => page.evaluate(() => {
    if (!App.motionPlayer) App.motionPlayer = { lib: [] };
    App.motionPlayer.lib = [{ kind: 'parla', from: 'home', to: 'home' }, { kind: 'base', from: 'home', to: 'home' }];
    const out = {};
    App.ls.set('motionTalk', ''); out.def = App.talkClipsOn();
    App.ls.set('motionTalk', '1'); out.on = App.talkClipsOn();
    App.ls.set('motionTalk', '0'); out.off = App.talkClipsOn();
    App.ls.set('motionTalk', '');
    return out;
  });
  expect(await run()).toEqual({ def: false, on: true, off: false });
  // senza punti del viso su questa foto: restano i clip «parla» (mai una bocca storta e ferma)
  withFace = false;
  await page.reload();
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.talkClipsOn, null, { timeout: 30000 });
  const r2 = await page.evaluate(() => { if (App.faceLm) { const c = (App.chars || [])[0]; if (c) c.landmarks = null; } return true; });
  expect(r2).toBeTruthy();
  const res = await run();
  expect(res.on).toBe(true);
  expect(res.off).toBe(false);
});

// v2d-44: foto principale = canotta azzurra (una volta sola, la foto di prima resta nello storico dei look)
test('v2d-44: la foto di Eris diventa la canotta azzurra, con bocca e occhi pronti e la foto di prima nello storico', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Chromium.');
  test.setTimeout(120000);
  const CH = '5ce17a0000000001', OLD = 'aaaa0000bbbb0001.jpg';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d44-canotta-'));
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.copyFileSync(process.env.V2D44_BEFORE || JPG, path.join(dir, 'shared', 'avatars', OLD));
  const lmOld = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{ id: CH, name: 'Eris', ready: 'nova-scelta', avatar: '/api/avatars/' + OLD, avatarSource: 'upload', landmarks: { ...lmOld, src: '/api/avatars/' + OLD }, appearance: {}, look: {}, wardrobe: [], personality: '', style: '', orders: '', requests: '', voice: 'eve', lookHistory: [], outfits: [] }]));
  const ai = await startMockAI([]);
  const shot = async (name) => {
    if (!SHOTS) return;
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, name) });
  };
  const enter = async (base) => {
    await page.goto(base + '/');
    await page.locator('.login-profile', { hasText: 'Nico' }).click();
    for (const n of ['1', '3', '5', '7']) await page.locator(`#pin-pad [data-key="${n}"]`).click();
    await page.waitForFunction(() => document.getElementById('view-login').hidden, null, { timeout: 30000 });
    await page.waitForFunction(() => window.App && App.solo && document.body.classList.contains('solo-mode') && App.current, null, { timeout: 30000 });
    const later = page.locator('#adult-ask button', { hasText: 'Più tardi' });
    if (await later.isVisible().catch(() => false)) await later.click();
    if (!(await page.locator('#nh-list').isVisible().catch(() => false))) await page.evaluate(() => App.solo.showHome());
  };
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 390, height: 844 });
  // prima: migrazione segnata come già fatta -> foto vecchia
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({ eris_canotta_v2d44: { at: 'x', skipped: 'prova prima' } }));
  let s = startServer(dir, ai.address().port);
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await pinLogin(request, base);
    await request.post(base + '/api/logout', { headers: HEAD }).catch(() => {});
    await enter(base);
    expect(await page.evaluate(() => App.current.avatar)).toBe('/api/avatars/' + OLD);
    await shot('04-avatar-prima-390x844.png');
  } finally { s.child.kill(); }
  // dopo: migrazione al primo avvio della v2d-44
  const mig = JSON.parse(fs.readFileSync(path.join(dir, 'migrations.json'), 'utf8')); delete mig.eris_canotta_v2d44;
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify(mig));
  s = startServer(dir, ai.address().port);
  try {
    await waitUp(s);
    expect(s.log()).toContain('Foto principale di Eris: canotta azzurra');
    const base = `http://127.0.0.1:${s.port}`;
    await page.context().clearCookies();
    await enter(base);
    const ch = await page.evaluate(() => App.current);
    expect(ch.avatar).toBe('/api/avatars/e44c0a7a00000001.jpg');
    expect(ch.landmarks && ch.landmarks.eyeL && ch.landmarks.mouth).toBeTruthy();
    expect(ch.landmarks.src).toBe(ch.avatar);
    expect((ch.lookHistory || []).some((h) => h.avatar === '/api/avatars/' + OLD)).toBe(true); // si può tornare indietro
    expect(await page.evaluate(() => App.talkClipsOn())).toBe(false); // bocca disegnata e guidata dall'audio
    await page.waitForFunction(() => App.avatarConv && App.avatarConv.img && /e44c0a7a00000001/.test(App.avatarConv.img._src || App.avatarConv.img.src || '') && App.avatarConv.img.naturalWidth > 0, null, { timeout: 20000 });
    await shot('05-avatar-dopo-390x844.png');
    await page.evaluate(() => App.solo.showChat());
    await shot('06-avatar-dopo-chat-390x844.png');
    // secondo avvio: non si ripete
    s.child.kill(); s = startServer(dir, ai.address().port); await waitUp(s);
    expect(s.log()).not.toContain('Foto principale di Eris: canotta azzurra');
  } finally { s.child.kill(); ai.close(); }
});
