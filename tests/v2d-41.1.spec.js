const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-41: si arriva sulla Home, il menu entra nello schermo dell'iPhone, descrizione del look intera, elenco dei Gesti con
// contatore, stato della chiamata visibile (Ti ascolto, tempo, ⚡/Classica), nuovo look come foto principale con labiale.
const CH = '5ce17a0000000001';
const NEW = '/api/avatars/0000000000000def.jpg'; // foto attuale (di prova): il look di Nova NON cambia in v2d-41
const READY = path.join(__dirname, '..', 'assets', 'ready');
const LM = { ...JSON.parse(fs.readFileSync(path.join(READY, 'nova-scelta-landmarks.json'), 'utf8')), src: NEW };
const HEAD = { 'X-Requested-With': 'app-privata' };
function wav(sec) {
  const R = 24000, n = Math.round(R * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(R, 24); b.writeUInt32LE(R * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / R; const e = Math.max(0, Math.sin(Math.PI * 5 * t)) ** 0.6; b.writeInt16LE(Math.round(e * (0.5 * Math.sin(2 * Math.PI * 190 * t) + 0.25 * Math.sin(2 * Math.PI * 570 * t)) * 20000), 44 + i * 2); }
  return b;
}
const LONG = 'In spiaggia alle Maldive, laguna turchese: costume intero blu e camicia di lino '; // 80 caratteri, tagliato sul server
async function mock(page, opts = {}) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  const outfits = opts.outfit ? [{ key: 'nova_maldive', style: 'comoda', label: LONG, avatar: '/api/avatars/0000000000000abc.jpg', landmarks: null, words: [] }] : [];
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === NEW || p === '/api/avatars/0000000000000abc.jpg') return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(READY, 'nova-scelta.jpg') });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Nova', ready: 'nova-scelta', avatar: NEW, motionClips: [], outfits, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM}]);
    if (p === `/api/chats/${CH}` && req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Eccomi! [umore: allegra]' });
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/actions' || p === '/api/gestures') return json([]);
    if (p === '/api/tts') return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(2.4) });
    if (p === '/api/stt') return json({ text: '' });
    return json({});
  });
}
async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.current && App.solo && App.solo._bound, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
}

for (const vp of [{ w: 390, h: 664, n: 'iPhone 14 (Safari)' }, { w: 390, h: 844, n: 'iPhone 14 (app)' }, { w: 375, h: 568, n: 'iPhone SE' }]) {
  test(`v2d-41: dopo l'accesso si arriva sulla Home e tutto il menu entra nello schermo (${vp.n})`, async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await mock(page); await boot(page);
    expect(await page.evaluate(() => document.body.classList.contains('solo-home') && !document.body.classList.contains('solo-chat'))).toBe(true);
    await expect(page.locator('#nh-list')).toBeVisible();
    const r = await page.evaluate(() => [...document.querySelectorAll('#nh-list button')].filter((b) => b.offsetParent).map((b) => ({ t: b.textContent.trim().slice(0, 20), bottom: b.getBoundingClientRect().bottom })));
    const H = await page.evaluate(() => innerHeight);
    for (const name of ['Videochiamata', 'Fotocamera', 'Voce', 'Impostazioni']) {
      const b = r.find((x) => x.t.includes(name)); expect(b, name).toBeTruthy(); expect(b.bottom, name).toBeLessThanOrEqual(H);
    }
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
    await expect(page.locator('#nh-look')).toBeHidden(); // v2d-41: il look di Nova non cambia (nessuna descrizione nuova)
    // la chat resta a un tocco
    await page.click('#nh-q-chat');
    await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
    await expect(page.locator('#chat-form')).toBeVisible();
  });
}

test('v2d-41: la descrizione del look va a capo e non finisce a metà parola', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Home: verificata su Chromium.');
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, { outfit: true }); await boot(page);
  await page.evaluate(() => { App.ls.set('outfit:' + App.current.id, { scene: '', seen: Date.now(), visitAt: Date.now(), key: 'nova_maldive', by: 'chat', until: Date.now() + 3600e3, v37: true }); App.solo.showHome(); });
  await page.waitForTimeout(300);
  const t = await page.locator('#nh-look').textContent();
  expect(t).toBe('In spiaggia alle Maldive, laguna turchese: costume intero blu e camicia di lino');
  const st = await page.evaluate(() => { const e = document.getElementById('nh-look'); const cs = getComputedStyle(e); return { ws: cs.whiteSpace, over: e.scrollWidth > e.clientWidth + 1 }; });
  expect(st.ws).toBe('normal'); expect(st.over).toBe(false);
});

test('v2d-41: Gesti mostra l elenco dei gesti con quante volte sono stati usati', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Home: verificata su Chromium.');
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => { localStorage.setItem('nova:gestiUso', JSON.stringify({ 'cenno-si': 3 })); });
  await mock(page); await boot(page);
  await page.click('[data-nh-open="gesti"]');
  await expect(page.locator('#motion-lib-menu')).toHaveText('Movimenti della foto: 648');
  await expect(page.locator('#motion-lib-list li')).toHaveCount(24);
  const li = page.locator('#motion-lib-list li[data-gesto="cenno-si"]');
  await expect(li).toBeVisible();
  await expect(li.locator('.ml-use')).toHaveText(/usato (3|[4-9]|\d\d+) volte/);
  await expect(li).toContainText('27 varianti');
  // il contatore sale mentre la foto si muove
  const n = await page.evaluate(() => { const L = window.MotionLib; const p = L.PRESETS.find((x) => x.base === 'sorriso'); L.noteUse(p); L.noteUse(p); return L.usage().sorriso; });
  expect(n).toBeGreaterThanOrEqual(2);
});

test('v2d-41: in chiamata si vedono «Ti ascolto», il tempo e il tipo di collegamento, senza sottotitoli', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Chiamata: verificata su Chromium.');
  await page.setViewportSize({ width: 390, height: 664 });
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const d = c.createMediaStreamDestination(); return d.stream; }; });
  await mock(page); await boot(page);
  await page.evaluate(() => { App.rt.classicOnly = true; App.hasAi = () => true; });
  await page.click('#nh-q-voice');
  await page.waitForFunction(() => App.call.active, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  const v = await page.evaluate(() => { const f = (q) => { const e = document.querySelector(q); const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { t: e.textContent, on: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.top >= 0 && r.bottom < innerHeight }; }; return { st: f('#call-state'), tm: f('#call-timer'), bd: f('#call-badge'), cap: getComputedStyle(document.getElementById('call-caption')).display }; });
  expect(v.st.on).toBe(true); expect(v.tm.on).toBe(true); expect(v.bd.on).toBe(true);
  expect(v.tm.t).toMatch(/^\d\d:\d\d$/);
  expect(v.bd.t).toMatch(/Tempo reale|Classica|Collegamento/);
  expect(v.cap).toBe('none'); // niente sottotitoli
  await page.evaluate(() => App.call.end());
});

// ---------- v2d-41 (richieste di Nicola delle 16:35) ----------
async function fakeCam(page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = async (c) => {
      if (c && c.video) { const cv = document.createElement('canvas'); cv.width = 48; cv.height = 64; const g = cv.getContext('2d'); g.fillStyle = '#090'; g.fillRect(0, 0, 48, 64); window.__camAsks = (window.__camAsks || 0) + 1; return cv.captureStream(5); }
      const ac = new AudioContext(); return ac.createMediaStreamDestination().stream;
    };
  });
}
test('v2d-41: barra in basso: chat scritta con nota vocale e foto dentro, poi videocamera, poi Home', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Home su questo WebKit: vedi sopra.');
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page); await boot(page);
  await page.evaluate(() => App.solo.showChat());
  const r = await page.evaluate(() => {
    const box = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { x: b.left, r: b.right, y: b.top, b: b.bottom, vis: !!e.offsetParent && b.width > 0 }; };
    const pill = document.getElementById('cb-pill');
    return { pill: box('cb-pill'), video: box('cb-video'), home: box('cb-home'), H: innerHeight, inside: ['vn-plus', 'chat-input', 'vn-mic'].map((id) => pill.contains(document.getElementById(id))) };
  });
  expect(r.inside).toEqual([true, true, true]);
  expect(r.video.vis && r.home.vis).toBe(true);
  expect(r.pill.r).toBeLessThanOrEqual(r.video.x + 1);
  expect(r.video.r).toBeLessThanOrEqual(r.home.x + 1);
  expect(r.home.b).toBeLessThanOrEqual(r.H);
  await page.click('#cb-home');
  await page.waitForFunction(() => document.body.classList.contains('solo-home'));
});
test('v2d-41: in videochiamata la fotocamera si accende da sola, subito, con il tasto per girarla', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Home su questo WebKit: vedi sopra.');
  await fakeCam(page); await mock(page); await boot(page);
  expect(await page.evaluate(() => App.ls.get('camOn', false) === true)).toBe(true); // tutto aperto
  await page.evaluate(() => { App.rt.classicOnly = true; App.hasAi = () => true; window.__t0 = performance.now(); });
  await page.click('#nh-q-video');
  await page.waitForFunction(() => { const v = document.getElementById('call-self'); return App.call.active && v && !v.hidden && v.srcObject; }, null, { timeout: 5000 });
  const ms = await page.evaluate(() => performance.now() - window.__t0);
  expect(ms).toBeLessThan(2500);
  await expect(page.locator('#call-flip')).toBeVisible();
  await page.evaluate(() => App.call.end());
});
test('v2d-41: «fammi vedere la maglietta che avevi preso» -> look al volo con dissolvenza al nero, sulla foto principale', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Home su questo WebKit: vedi sopra.');
  await mock(page);
  const NOW = '/api/avatars/a1f0000000000001.jpg'; let asked = null;
  await page.route('**/api/avatars/a1f0000000000001.jpg', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(READY, 'nova-scelta.jpg') }));
  await page.route(`**/api/characters/${CH}/look-now`, async (route) => { asked = JSON.parse(route.request().postData() || '{}'); await new Promise((z) => setTimeout(z, 600)); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: NOW, label: 'maglietta che avevi preso' }) }); });
  await boot(page);
  await page.evaluate(() => { App.hasAi = () => true; App.solo.showChat(); });
  await page.fill('#chat-input', 'fammi vedere la maglietta che avevi preso');
  await page.press('#chat-input', 'Enter');
  await page.waitForFunction(() => { const f = document.getElementById('look-fade'); return f && f.classList.contains('on'); }, null, { timeout: 15000 });
  await page.waitForFunction((u) => App.outfits.key(App.current) === 'al_volo' && App.faceSrc(App.current) === u, NOW, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('look-fade').classList.contains('on'), null, { timeout: 5000 });
  expect(asked && asked.text).toContain('maglietta');
  // «torna come prima» -> foto principale
  await page.evaluate(() => App.outfits.hear(App.current, 'torna come prima'));
  expect(await page.evaluate((n) => App.faceSrc(App.current) === n, NEW)).toBe(true);
});
test('v2d-41: server: niente memoria visiva, look al volo mai intimo, Nova prende l iniziativa', async ({ request }) => {
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) { const l = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD }); expect(l.ok(), await l.text()).toBeTruthy(); }
  for (const t of ['maglia rossa e jeans', 'felpa grigia']) { const r = await request.post('/api/avatar-looks', { data: { characterId: CH, text: t }, headers: HEAD }); expect(r.ok(), await r.text()).toBe(true); }
  const al = await (await request.get(`/api/avatar-looks?character=${CH}`, { headers: HEAD })).json();
  expect(al.entries.length).toBe(0);
  expect(al.current && al.current.text).toBe('felpa grigia');
  const no = await request.post(`/api/characters/${CH}/look-now`, { data: { text: 'mettiti la lingerie' }, headers: { ...HEAD, 'X-AI-Key': 'xai-test-0000000000' } });
  expect(no.status()).toBe(422);
  const ins = await (await request.post('/api/realtime/instructions', { data: { characterId: CH, mode: 'video' }, headers: HEAD })).json();
  expect(ins.instructions).toContain("PRENDE L'INIZIATIVA");
  expect(ins.instructions).toContain('dammi un minuto');
});
