const { test, expect } = require('./harness');
const pw = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const O = require('../public/js/outfits.js');
const G = require('../public/js/motion-graph.js');
const NET = require('../public/js/net.js');
const PR = require('../public/js/presence.js');

// v2d-36: Nova senza lavoro (ospedale ritirato, non cancellato), palestra e saluto che se ne va, clip leggeri secondo
// la rete, niente barra in basso, chat ripartite da zero nella vista (dati intatti), ospiti amici di Nico e Luisa.
const HEAD = { 'X-Requested-With': 'app-privata' };
const DATA = process.env.NOVA_E2E_DATA || '/tmp/nova-e2e-empty';
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d36/evidence';
const CH = '5ce17a0000000001';
const BASE = '/api/avatars/5ce17a0000000001.jpg';
const DIR = process.env.NOVA_V36_LIB || '/workspace/nova-motion/v2d36/library'; // foto e clip privati: solo in locale
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
const hex = (n) => String(n).padStart(15, '0');
const HAS_LIB = fs.existsSync(path.join(DIR, 'library.json'));

async function loginNicola(request) {
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
}
async function novaId(request) {
  const list = await (await request.get('/api/characters')).json();
  const nova = list.find((c) => /nova/i.test(c.name || '')) || list[0];
  return nova.id;
}

test('look ritirati: l ospedale resta sul server ma non entra più nelle scene; un look senza punti del viso non usa quelli della base', () => {
  const store = {};
  globalThis.App = { ls: { get: (k, d) => (k in store ? JSON.parse(store[k]) : d), set: (k, v) => { store[k] = JSON.stringify(v); }, del: (k) => { delete store[k]; } } };
  try {
    const mk = (key, extra = {}) => ({ key, style: 'scena', label: key, words: [], avatar: `/api/avatars/${'a'.repeat(15)}${key.length % 10}.jpg`, ...extra });
    const ch = { id: CH, outfits: [mk('nova_ospedale', { disabled: true }), mk('nova_palestra'), mk('nova_studio')],
      motionClips: ['nova_ospedale', 'nova_palestra', 'nova_studio'].map((o, i) => ({ id: 'c' + i, url: `/api/motion/c${hex(i + 1)}.mp4`, kind: 'base', from: 'petto', to: 'petto', outfit: o })) };
    const keys = O.scenes(ch).map((o) => o.key);
    expect(keys).not.toContain('nova_ospedale');
    expect(keys).toEqual(expect.arrayContaining(['nova_palestra', 'nova_studio']));
    for (let i = 0; i < 20; i++) expect(O.pickScene(ch, '', () => i / 20)).not.toBe('nova_ospedale');
    expect(O.list(ch).map((o) => o.key)).not.toContain('nova_ospedale');
  } finally { delete globalThis.App; }
});

test('rete: clip normali, leggeri o solo foto; mai i leggeri con la rete buona, mai clip con la rete lentissima', () => {
  const lib = [
    { id: 'a', quality: '' }, { id: 'b', quality: '' }, { id: 'al', quality: 'lite' }, { id: 'bl', quality: 'lite' },
  ];
  NET.reset();
  expect(NET.mode()).toBe('std');
  expect(NET.pick(lib).map((c) => c.id)).toEqual(['a', 'b']);
  NET.sample(1000000, 2000); // 1 MB in 2 s = 4000 kbps: resta normale
  expect(NET.mode()).toBe('std');
  NET.reset();
  NET.sample(600000, 6000); // 800 kbps: leggeri
  expect(NET.mode()).toBe('lite');
  expect(NET.pick(lib).map((c) => c.id)).toEqual(['al', 'bl']);
  expect(NET.pick(lib.slice(0, 2)).map((c) => c.id)).toEqual(['a', 'b']); // look senza leggeri: i normali
  NET.sample(300000, 12000); NET.sample(300000, 12000); // 200 kbps: solo foto (con respiro)
  expect(NET.mode()).toBe('still');
  expect(NET.pick(lib)).toEqual([]);
  NET.sample(5000000, 1000); // la qualità non risale a metà visita (niente su e giù)
  expect(NET.mode()).toBe('still');
  NET.reset();
  NET.stall(); NET.stall();
  expect(NET.mode()).toBe('lite');
  NET.reset();
  // libreria: il campo quality arriva dal server
  const L = G.libraryOf({ motionClips: [{ id: 'x', url: '/api/motion/0123456789abcdef.mp4', kind: 'base', from: 'petto', to: 'petto', quality: 'lite' }] });
  expect(L[0].quality).toBe('lite');
});

test('saluto: «ok ciao ciao» a conversazione avviata la fa andare via, «ciao» d arrivo no, «dai aspetta ancora un attimo» la fa restare', () => {
  expect(PR.classify('ok ciao ciao').byeWord).toBe(true);
  expect(PR.classify('ciao').byeWord).toBe(true);
  expect(PR.classify('a dopo!').byeWord).toBe(true);
  expect(PR.classify('Ciao Nova, come va oggi?').byeWord).toBeFalsy();
  expect(PR.classify('dai aspetta ancora un attimo').stay).toBe(true);
  expect(PR.classify('resta ancora un po\'').stay).toBe(true);
  expect(PR.LEAVING.test('se tu hai finito io me ne vado')).toBe(true);
  expect(PR.LEAVING.test('io dopo vado in palestra, quando attacco con te')).toBe(true);
});

test('tono v2d-36: vita sua (palestra), viscidata scherzosa senza rancore, conoscenza di base solo per Nico e Luisa', async ({ request }) => {
  await loginNicola(request);
  const id = await novaId(request);
  const j = await (await request.get('/api/e2e/tone?id=' + id)).json();
  expect(j.applies).toBe(true);
  for (const k of ['chat', 'realtime', 'call']) {
    expect(j[k]).toContain('eh no, questa era una viscidata');
    expect(j[k]).toContain('nessun rancore');
    expect(j[k]).toContain('io dopo vado in palestra');
    expect(j[k]).toContain('se tu hai finito io me ne vado');
    expect(j[k]).toContain('NF Motors');
    expect(j[k]).toContain('Karina');
    expect(j[k]).not.toMatch(/sommelier/i);
  }
  const lu = await (await request.get('/api/e2e/tone?id=' + id + '&user=luisa')).json();
  expect(lu.chat).toContain('NF Motors');
  // la conoscenza di base non compare mai nell interfaccia
  const chars = await (await request.get('/api/characters')).text();
  expect(chars).not.toContain('NF Motors');
  expect(chars).not.toContain('Karina');
});

test('vista da zero: i messaggi vecchi non si vedono più ma restano sul disco; si torna indietro con from=null', async ({ request }) => {
  await loginNicola(request);
  const id = await novaId(request);
  const mark = 'vecchio-' + Date.now();
  const r = await request.post('/api/chats/' + id, { data: { message: mark, noAI: true }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
  const has = async () => JSON.stringify(await (await request.get('/api/chats/' + id)).json()).includes(mark);
  expect(await has()).toBe(true);
  await new Promise((ok) => setTimeout(ok, 20));
  const v = await request.post('/api/chats/all/visible-from', { data: { from: 'now' }, headers: HEAD });
  expect(v.ok()).toBeTruthy();
  expect(await has()).toBe(false);
  // sul disco il messaggio c è ancora
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.json')) files.push(p); } };
  walk(DATA);
  expect(files.some((f) => fs.readFileSync(f, 'utf8').includes(mark))).toBe(true);
  // i nuovi messaggi si vedono
  const mark2 = 'nuovo-' + Date.now();
  await request.post('/api/chats/' + id, { data: { message: mark2, noAI: true }, headers: HEAD });
  expect(JSON.stringify(await (await request.get('/api/chats/' + id)).json())).toContain(mark2);
  // reversibile
  await request.post('/api/chats/all/visible-from', { data: { from: null }, headers: HEAD });
  expect(await has()).toBe(true);
});

test('ospiti: solo il proprietario li crea; l ospite vede solo Nova e la sua chat, niente memoria, note, conoscenza privata o contenuti espliciti', async ({ request, baseURL }) => {
  await loginNicola(request);
  const id = await novaId(request);
  const gid = 'ospite_t' + String(Date.now()).slice(-6);
  const c = await request.post('/api/owner/guests', { data: { id: gid, name: 'Amico', pin: '2468' }, headers: HEAD });
  expect(c.ok()).toBeTruthy();
  const list = await (await request.get('/api/owner/guests')).json();
  expect(JSON.stringify(list)).toContain(gid);
  expect(JSON.stringify(list)).not.toContain('hash');
  // messaggio di Nico: l ospite non deve vederlo
  const secret = 'segreto-di-nico-' + Date.now();
  await request.post('/api/chats/' + id, { data: { message: secret, noAI: true }, headers: HEAD });
  const g = await pw.request.newContext({ baseURL });
  try {
    const lg = await g.post('/api/login', { data: { user: gid, pin: '2468' }, headers: HEAD });
    expect(lg.ok()).toBeTruthy();
    const me = await (await g.get('/api/me')).json();
    expect(me.guest).toBe(true); expect(me.admin).toBe(false);
    const chars = await (await g.get('/api/characters')).json();
    expect(chars.length).toBe(1);
    expect(chars[0].state).toBeFalsy(); expect(chars[0].requests).toBeFalsy(); expect(chars[0].personality).toBeFalsy();
    expect(await (await g.get('/api/memory')).json()).toEqual([]);
    expect((await (await g.get('/api/notes')).json()).text).toBe('');
    for (const [m, u] of [['post', '/api/notes'], ['post', '/api/owner/guests'], ['get', '/api/owner/guests'], ['post', '/api/chats/all/visible-from'], ['put', '/api/characters/' + id]]) {
      const res = await g[m](u, { data: {}, headers: HEAD });
      expect(res.status(), m + ' ' + u).toBeGreaterThanOrEqual(400);
    }
    const hello = 'ciao, mi ha dato il tuo numero Nico e Luisa';
    const s = await g.post('/api/chats/' + id, { data: { message: hello, noAI: true }, headers: HEAD });
    expect(s.ok()).toBeTruthy();
    const view = JSON.stringify(await (await g.get('/api/chats/' + id)).json());
    expect(view).toContain(hello);
    expect(view).not.toContain(secret);
    // Nico non vede la chat dell ospite
    const nico = JSON.stringify(await (await request.get('/api/chats/' + id)).json());
    expect(nico).not.toContain(hello);
    // istruzioni di Nova per l ospite
    const t = await (await request.get('/api/e2e/tone?id=' + id + '&user=' + gid)).json();
    expect(t.user).toBe(gid);
    expect(t.contentFilter).toBe(true); expect(t.imageAdult).toBe(false);
    for (const k of ['chat', 'realtime', 'call']) {
      expect(t[k]).toContain('Nico e Luisa');
      expect(t[k]).not.toContain('NF Motors');
      expect(t[k]).not.toContain('Karina');
      expect(t[k]).toContain('NON attiva');
    }
    // disattivato: non entra più (mai cancellato)
    const d = await request.post('/api/owner/guests/' + gid + '/disable', { data: {}, headers: HEAD });
    expect(d.ok()).toBeTruthy();
    expect((await g.get('/api/me')).status()).toBe(401);
    expect(JSON.stringify(await (await request.get('/api/owner/guests')).json())).toContain(gid);
  } finally { await g.dispose(); }
});

// ---------- interfaccia (libreria locale v2d-36, nessun dato live) ----------
function lib() {
  const outs = JSON.parse(fs.readFileSync(path.join(DIR, 'outfits.json'), 'utf8'));
  const cl = JSON.parse(fs.readFileSync(path.join(DIR, 'library.json'), 'utf8'));
  const files = {}; let i = 0, j = 0;
  const outfits = outs.map((o) => { const url = `/api/avatars/a${hex(++i)}.jpg`; files[url] = path.join(DIR, o.file); return { key: o.key, style: o.style, label: o.label, words: o.words, avatar: url, landmarks: o.landmarks || null }; });
  const clips = [];
  for (const c of cl) {
    const url = `/api/motion/c${hex(++j)}.mp4`; files[url] = path.join(DIR, c.file);
    const base = { id: 'm' + j, url, kind: c.kind, from: c.from, to: c.to, mood: [c.mood], outfit: c.outfit, label: c.label, ...(c.event ? { event: c.event } : {}) };
    clips.push(base);
    for (const v of c.variants || []) { const u = `/api/motion/c${hex(++j)}.mp4`; files[u] = path.join(DIR, v.file); clips.push({ ...base, id: 'm' + j, url: u, quality: 'lite' }); }
  }
  return { outfits, clips, files };
}
async function mock(page, L, seen, opts = {}) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === BASE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg') });
    if (L.files[p]) { if (opts.delay && p.endsWith('.mp4')) await new Promise((r) => setTimeout(r, opts.delay)); return route.fulfill({ status: 200, contentType: p.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', path: L.files[p] }); }
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Nova', ready: 'nova-scelta', avatar: BASE, motionClips: L.clips, outfits: L.outfits, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
    if (p === `/api/chats/${CH}` && req.method() === 'POST') { const b = req.postDataJSON(); seen.chat.push(b); return route.fulfill({ status: 200, contentType: 'text/plain', body: b.bye ? 'Ciao tesoro, a dopo! Io vado in palestra 😘' : (b.stay ? 'Va bene, resto volentieri 🙂' : 'Eccomi! [umore: allegra]') }); }
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/actions' || p === '/api/gestures') return json([]);
    return json({});
  });
}
async function open(page, scene) {
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0, null, { timeout: 30000 });
  await page.evaluate((key) => { App.ls.set('outfit:' + App.current.id, { scene: key, seen: Date.now(), visitAt: Date.now() }); App.ls.set('away:' + App.current.id, null); App.outfits.apply(true); }, scene);
  await page.waitForTimeout(3000); // l avvio finisce (apre la chat) prima di aprire il ritratto
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }, sel);

test('niente barra in basso: Home e Blocco note raggiungibili dall alto, ritratto a tutto schermo con tasti sopra', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  expect(await visible(page, '#solo-dock')).toBe(false);
  for (const s of ['#app-refresh', '#blocco-btn', '#wa-video', '#wa-home', '#chat-input', '#vn-mic']) expect(await visible(page, s), s).toBe(true);
  await page.click('#wa-home');
  await expect(page.locator('body')).toHaveClass(/solo-home/);
  expect(await visible(page, '#solo-dock')).toBe(false);
  expect(await visible(page, '#back-btn')).toBe(true); // ‹ Chat
  await page.click('#back-btn');
  await expect(page.locator('body')).toHaveClass(/solo-chat/);
  await page.evaluate(() => App.solo.openPortrait());
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.top, r.height, innerHeight]; });
  expect(st[0]).toBe(0); expect(st[1]).toBe(st[2]);
  for (const s of ['#app-refresh', '#blocco-btn', '#wa-video', '#wa-home', '#chat-input', '#vn-mic']) expect(await visible(page, s), 'ritratto ' + s).toBe(true);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `layout-portrait-${test.info().project.name}.png`) });
  await page.evaluate(() => App.solo.closePortrait());
  await expect(page.locator('body')).toHaveClass(/solo-chat/); // si torna in chat, da dove si è venuti
});

test('videochiamata a tutto schermo anche se parte con la tastiera aperta (scocca bassa)', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  await page.focus('#chat-input');
  await page.evaluate(() => { window.__vvTest = { height: 230, offsetTop: 0, addEventListener() {} }; App.applyViewport(); App.fitFrame(); });
  await page.evaluate(() => { App.call.start('video').catch(() => {}); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__vvTest = null; App.applyViewport(); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const q = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; }; return { vh: innerHeight, stage: q('#stage'), canvas: q('#avatar-canvas'), shell: q('#app-shell'), active: document.activeElement && document.activeElement.id }; });
  expect(r.stage).toEqual([0, r.vh]);
  expect(r.canvas[1]).toBe(r.vh);
  expect(r.shell[1]).toBeGreaterThanOrEqual(r.vh);
  expect(r.active).not.toBe('chat-input');
  await page.screenshot({ path: path.join(OUT, `call-full-${test.info().project.name}.png`) });
});

test('saluto: dopo «ok ciao ciao» Nova se ne va (clip palestra-ciao) e resta «non in linea» finché non le riscrivi', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  await page.evaluate(() => { App.tts = null; if (App.voice) App.voice.ttsOn = () => false; });
  await page.evaluate(() => App.solo.openPortrait());
  const send = async (t) => { await page.fill('#chat-input', t); await page.evaluate(() => document.getElementById('chat-form').requestSubmit()); await page.waitForFunction(() => !App.chat.busy); };
  await send('ciao Nova');
  expect(seen.chat[0].bye).toBeFalsy(); // saluto d arrivo
  await send('come va?');
  await send('dai aspetta ancora un attimo');
  expect(seen.chat[2].stay).toBe(true);
  await send('ok ciao ciao');
  expect(seen.chat[3].bye).toBe(true);
  await page.evaluate(() => { App.avatarConv.speaking = false; });
  await page.waitForSelector('#nv-walk, #stage.nv-leaving', { state: 'attached', timeout: 25000 });
  const walked = await page.evaluate(() => !!document.getElementById('nv-walk'));
  await page.waitForFunction(() => document.body.classList.contains('nova-away'), null, { timeout: 20000 });
  expect(walked).toBe(true);
  await expect(page.locator('#wa-status')).toContainText('non in linea');
  expect(await visible(page, '#nv-away-card')).toBe(true);
  await page.screenshot({ path: path.join(OUT, `away-${test.info().project.name}.png`) });
  await send('eccomi di nuovo');
  await expect(page.locator('body')).not.toHaveClass(/nova-away/);
  await expect(page.locator('#wa-status')).not.toContainText('non in linea');
});

test('rete lenta: con 3G arrivano i clip leggeri, con la rete lentissima resta la foto che respira; mai un fermo', async ({ page, browserName }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  test.skip(browserName !== 'chromium', 'limitazione di rete via CDP solo su Chromium');
  test.setTimeout(90000);
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, L, seen);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await open(page, 'nova_palestra');
  // 3G «buono» (~1,6 Mbit/s, 150 ms): clip leggeri
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.0e6 / 8, uploadThroughput: 750e3 / 8, connectionType: 'cellular3g' });
  await page.evaluate(() => { App.net.reset(); App.net.down('lite', 'test 3g'); App.solo.openPortrait(); });
  const t0 = Date.now(); const samples = [];
  while (Date.now() - t0 < 25000) {
    samples.push(await page.evaluate(() => { const P = App.motionPlayer; const v = P && P.els[P.cur]; return { t: v ? v.currentTime : -1, playing: P && P.playing && P.playing.quality, wait: document.getElementById('stage').classList.contains('nv-wait'), still: document.getElementById('stage').classList.contains('nv-still'), mode: App.net.mode() }; }));
    await page.waitForTimeout(500);
  }
  const lite = samples.filter((s) => s.playing === 'lite').length;
  expect(lite).toBeGreaterThan(10);
  expect(samples.every((s) => s.playing !== '' || s.mode !== 'lite')).toBe(true); // mai un clip normale in modalità leggera
  // nessun fermo: o il video avanza, o c è il respiro sulla scena
  let frozen = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].t === samples[i - 1].t && !samples[i].wait && !samples[i].still) frozen++;
  expect(frozen).toBeLessThanOrEqual(1);
  // rete lentissima: solo foto con respiro
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 800, downloadThroughput: 50e3 / 8, uploadThroughput: 50e3 / 8, connectionType: 'cellular2g' });
  await page.evaluate(() => App.net.down('still', 'test 2g'));
  await page.waitForTimeout(1500);
  const still = await page.evaluate(() => { const st = document.getElementById('stage'); const c = document.getElementById('avatar-canvas'); return { still: st.classList.contains('nv-still'), anim: getComputedStyle(c).animationName, on: !!(App.motionPlayer && App.motionPlayer.on) }; });
  expect(still.still).toBe(true); expect(still.anim).toBe('nvBreathe'); expect(still.on).toBe(false);
  fs.writeFileSync(path.join(OUT, 'net-throttle.json'), JSON.stringify({ lite: samples, still }, null, 1));
});

// ---------------------------------------------------------------------------------------------------------------
// v2d-36 (seconda parte): comandi a voce, capelli neri, cambio spontaneo, chiamata pulita, microfono a interruttore,
// niente lampo bianco e bocca sempre in movimento.

const FAKE_CH = () => {
  const L = lib();
  return { id: CH, outfits: L.outfits, motionClips: L.clips };
};

test('capelli neri: «riesci a farmi vedere come staresti coi capelli neri» -> look nova_mora (con clip e punti del viso)', () => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  O.spont.on = false;
  const ch = FAKE_CH();
  const mora = O.list(ch).find((o) => o.key === 'nova_mora');
  expect(mora && mora.style).toBe('capelli');
  expect(mora.landmarks && mora.landmarks.mouth).toBeTruthy();
  for (const t of ['riesci a farmi vedere come staresti coi capelli neri', 'fammi vedere come staresti mora', 'come staresti coi capelli neri?'])
    expect(O.fromText(ch, t) && O.fromText(ch, t).outfit.key, t).toBe('nova_mora');
  expect(O.fromText(ch, 'ho visto un gatto coi capelli neri')).toBe(null); // non è una richiesta a lei
  expect(O.scenes(ch).map((o) => o.key)).not.toContain('nova_mora'); // mai come scena a sorpresa
});

test('cambio spontaneo: a volte a una nuova visita e raramente a metà, mai mentre parla, mai sopra un look chiesto', () => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const store = {};
  globalThis.App = { ls: { get: (k, d) => (k in store ? JSON.parse(store[k]) : d), set: (k, v) => { store[k] = JSON.stringify(v); }, del: (k) => { delete store[k]; } } };
  try {
    O.spont.on = true;
    const ch = FAKE_CH();
    const own = O.ownPicks(ch).map((o) => o.key);
    expect(own).toContain('nova_mora');
    expect(own.every((k) => !O.scenes(ch).some((s) => s.key === k))).toBe(true);
    // nuova visita, dado basso: si è cambiata da sola (by 'lei', da dire)
    O.spont.rand = () => 0.01;
    const t0 = new Date(2026, 10, 14, 9, 0, 0).getTime();
    const cur = O.current(ch, t0, () => 0.1);
    expect(own).toContain(cur.key);
    let st = store['outfit:' + CH] && JSON.parse(store['outfit:' + CH]);
    expect(st.by).toBe('lei'); expect(st.told).toBe(false);
    // nuova visita, dado alto: niente cambio (resta la scena a sorpresa)
    O.spont.rand = () => 0.99;
    for (const k of Object.keys(store)) delete store[k];
    expect(O.scenes(ch).map((o) => o.key)).toContain(O.current(ch, t0, () => 0.1).key);
    // a metà: mai mentre parla / risponde, mai due volte nella sessione, non prima di 20 minuti
    O.spont.rand = () => 0.01;
    const t1 = t0 + 25 * 60e3;
    expect(O.midChange(ch, t0 + 5 * 60e3, () => 0.1, {})).toBe(null); // troppo presto
    expect(O.midChange(ch, t1, () => 0.1, { speaking: true })).toBe(null);
    expect(O.midChange(ch, t1, () => 0.1, { busy: true })).toBe(null);
    expect(O.midChange(ch, t1, () => 0.1, { done: true })).toBe(null);
    expect(O.midChange(ch, t1, () => 0.1, { guest: true })).toBe(null);
    const k = O.midChange(ch, t1, () => 0.1, {});
    expect(own).toContain(k);
    O.spont.rand = () => 0.5; expect(O.midChange(ch, t1, () => 0.1, {})).toBe(null); // raramente (12%)
    // un look chiesto da lui ha la precedenza
    O.spont.rand = () => 0.01;
    store['outfit:' + CH] = JSON.stringify({ scene: 'nova_palestra', seen: t1, visitAt: t0, key: 'nova_studio', by: 'chat', until: t1 + 3600e3 });
    expect(O.midChange(ch, t1 + 60e3, () => 0.1, {})).toBe(null);
  } finally { delete globalThis.App; O.spont.on = false; O.spont.rand = () => Math.random(); }
});

test('cambio spontaneo: il server le fa dire «ho voluto cambiare…» (una volta), su richiesta «dammi un attimo», scena senza annuncio', async ({ request }) => {
  const g = async (q) => (await (await request.get('/api/e2e/outfit-note?' + q)).json()).note;
  const lei = await g('key=nova_mora&changed=lei');
  expect(lei).toContain('coi capelli neri');
  expect(lei).toContain('DI TUA INIZIATIVA');
  expect(lei).toContain('ho voluto cambiare');
  expect(lei).toMatch(/pettinatura|capelli/);
  expect(await g('key=nova_serata&changed=lei')).toContain('Ti sei cambiata DI TUA INIZIATIVA');
  expect(await g('key=nova_serata&changed=1')).toContain('dammi un attimo');
  const scene = await g('key=nova_pigiama');
  expect(scene).toContain('Dove sei adesso'); expect(scene).not.toContain('INIZIATIVA');
  expect(await g('key=nova_inesistente&changed=lei')).toBe('');
});

test('cambio spontaneo in app: dopo una risposta, in un momento tranquillo, si cambia da sola e al messaggio dopo lo dice', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 664 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  await page.evaluate(() => { App.tts = null; if (App.voice) App.voice.ttsOn = () => false; Outfits.spont.on = true; Outfits.spont.rand = () => 0.01; App.ls.set('outfit:' + App.current.id, { scene: 'nova_palestra', seen: Date.now(), visitAt: Date.now() - 30 * 60e3 }); });
  const send = async (t) => { await page.fill('#chat-input', t); await page.evaluate(() => document.getElementById('chat-form').requestSubmit()); await page.waitForFunction(() => !App.chat.busy); };
  await send('come va la giornata?');
  expect(seen.chat[0].outfitChanged).toBeUndefined();
  await page.waitForFunction(() => { const s = App.ls.get('outfit:' + App.current.id, null); return s && s.by === 'lei'; }, null, { timeout: 15000 });
  const key = await page.evaluate(() => App.outfits.key(App.current));
  expect(key).not.toBe('nova_palestra');
  await send('raccontami');
  expect(seen.chat[1].outfit).toBe(key);
  expect(seen.chat[1].outfitChanged).toBe('lei');
  await send('e poi?');
  expect(seen.chat[2].outfitChanged).toBeUndefined(); // detto una volta sola
  const again = await page.evaluate(() => App.outfits.maybeSpontaneous(App.current));
  expect(again).toBe(null); // una volta per sessione
});

test('comandi a voce in chiamata: «ricordati…» e «ho visto che ti sei comprata…» finiscono nella memoria (niente webhook)', async ({ request }) => {
  await loginNicola(request);
  const id = await novaId(request);
  const turn = async (text) => (await request.post(`/api/chats/${id}/voice-turn`, { data: { role: 'user', text, callMode: 'video' }, headers: HEAD })).json();
  const tag = Date.now().toString(36);
  const a = await turn(`ricordati che domenica ${tag} andiamo al lago`);
  expect(a.intent).toBe('ricordo');
  const b = await turn(`ho visto che ti sei comprata un vestito rosso ${tag}`);
  expect(b.intent).toBe('vita');
  const mem = JSON.stringify(await (await request.get('/api/memory')).json());
  expect(mem).toContain(`domenica ${tag} andiamo al lago`);
  expect(mem).toContain(`vestito rosso ${tag}`);
  const c = await turn('come stai oggi?');
  expect(c.intent).toBeUndefined();
  // stessi comandi dalla chat scritta: stesso percorso (handleAppIntent)
  const r = await request.post(`/api/chats/${id}`, { data: { message: `ricordati che ${tag} mi piace il tè verde` }, headers: HEAD });
  expect(r.headers()['x-app-intent']).toBeTruthy();
  const mem2 = JSON.stringify(await (await request.get('/api/memory')).json());
  expect(mem2).toContain(`${tag} mi piace il tè verde`);
});

test('videochiamata pulita: niente sottotitoli/trascrizione, niente sfumature, solo ✕ / microfono / chiudi', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen);
  await open(page, 'nova_pigiama');
  await page.evaluate(() => { App.call.start('video').catch(() => {}); });
  await page.waitForFunction(() => document.body.classList.contains('in-call'), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  // anche se qualcosa prova a scrivere una didascalia, non si vede
  await page.evaluate(() => { try { App.call.caption('Ciao amore, eccomi qui'); } catch { /* */ } try { App.ls.set('callCaptions', true); } catch { /* */ } });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const vis = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && !e.closest('[hidden]'); };
    const ui = document.getElementById('call-ui');
    const buttons = [...ui.querySelectorAll('button')].filter(vis).map((b) => b.id);
    const texts = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); const e = n.parentElement; if (!t || !e || e.closest('button,script,style,template')) continue; if (vis(e)) texts.push((e.id || e.className || e.tagName) + ': ' + t.slice(0, 60)); }
    const grad = [ui, ...ui.querySelectorAll('*'), document.getElementById('stage')].filter(vis).filter((e) => /gradient/.test(getComputedStyle(e).backgroundImage) || /gradient/.test(getComputedStyle(e, '::before').backgroundImage) || /gradient/.test(getComputedStyle(e, '::after').backgroundImage)).map((e) => e.id || e.className);
    return { buttons, texts, grad, cap: document.getElementById('call-caption').textContent };
  });
  expect(r.cap).toBe('');
  expect(r.texts, 'testo visibile sopra la videochiamata').toEqual([]);
  expect(r.grad).toEqual([]);
  expect(r.buttons.sort()).toEqual(['call-end', 'call-min', 'call-mute']);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `call-clean-${test.info().project.name}.png`) });
});

test('microfono a interruttore: un tocco avvia, un secondo tocco ferma e invia (niente tieni premuto)', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.addInitScript(() => {
    const fakeStream = () => { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const d = c.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; } catch { return { getTracks: () => [] }; } };
    navigator.mediaDevices.getUserMedia = async () => { window.__gum = (window.__gum || 0) + 1; return fakeStream(); };
    class FakeRec { constructor(s) { this.stream = s; this.state = 'inactive'; this.mimeType = 'audio/webm'; } start() { this.state = 'recording'; this._t = setInterval(() => this.ondataavailable && this.ondataavailable({ data: new Blob(['x'.repeat(400)]) }), 120); } stop() { clearInterval(this._t); this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 10); } static isTypeSupported(m) { return /webm/.test(m); } }
    window.MediaRecorder = FakeRec;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  await page.evaluate(() => { window.__sent = []; const s = App.chat.send.bind(App.chat); App.chat.send = (t, a, b, v) => { window.__sent.push({ t, v: !!v }); return s(t, a, b, v); }; });
  const mic = page.locator('#vn-mic');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click(); // tocco breve: parte e RESTA in registrazione dopo aver alzato il dito
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(mic).toHaveClass(/rec/);
  await page.waitForTimeout(1500);
  await expect(mic).toHaveAttribute('aria-pressed', 'true'); // ancora registra
  const icon = await mic.evaluate((e) => ({ text: e.textContent.trim(), bg: getComputedStyle(e).backgroundColor }));
  expect([...icon.text.replace(/\uFE0F/g, '')].length).toBeLessThanOrEqual(1); // solo icona, nessuna scritta
  await page.screenshot({ path: path.join(OUT, `mic-on-${test.info().project.name}.png`) });
  await mic.click(); // secondo tocco: ferma e invia
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await page.waitForFunction(() => window.__sent.length > 0, null, { timeout: 5000 });
  expect(await page.evaluate(() => window.__sent[0].v)).toBe(true);
  expect(await page.evaluate(() => window.__gum)).toBe(1);
});

// niente lampo bianco all inizio della chiamata e bocca/viso sempre in movimento per oltre 60 s mentre parla (rete lenta)
test('chiamata: mai un lampo bianco e viso sempre in movimento per 60 s mentre parla (rete lenta)', async ({ page, browserName }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  test.setTimeout(240000);
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen, { delay: 350 }); // ogni clip arriva in ritardo
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: (1600 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  await open(page, 'nova_pigiama');
  const dir = path.join(OUT, `call60-${browserName}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let n = 0; const shot = async () => page.screenshot({ path: path.join(dir, `f${String(n++).padStart(4, '0')}.png`), scale: 'css', animations: 'allow' });
  await page.evaluate(() => { App.call.start('video').catch(() => {}); });
  for (let i = 0; i < 14; i++) { await shot(); await page.waitForTimeout(100); } // primo secondo e mezzo, fitto
  await page.evaluate(() => { App.avatarConv.speaking = true; }); // parla (frasi lunghe) per 60 s
  const t0 = Date.now();
  while (Date.now() - t0 < 62000) { await shot(); await page.waitForTimeout(400); if (n % 40 === 0) await page.evaluate(() => { App.avatarConv.speaking = false; setTimeout(() => { App.avatarConv.speaking = true; }, 600); }); }
  const out = path.join(OUT, `call60-${browserName}.json`);
  require('child_process').execFileSync('python3', [path.join(__dirname, 'frames.py'), dir, out]);
  const res = JSON.parse(fs.readFileSync(out, 'utf8'));
  const st = await page.evaluate(() => { const s = document.getElementById('stage'); return { lips: s.classList.contains('nv-lips'), motion: s.classList.contains('has-motion') }; });
  expect(res.white, 'fotogrammi bianchi').toEqual([]);
  expect(Math.min(...res.luma)).toBeGreaterThan(5); // nemmeno neri vuoti
  expect(res.longestStill, 'viso fermo per troppi fotogrammi di fila').toBeLessThanOrEqual(4);
  expect(res.movingShare).toBeGreaterThan(0.8);
  expect(st.lips).toBe(false); // con i clip «parla» niente bocca disegnata sulla foto
});

test('Home pulita: niente testi vecchi (nascosti, non tolti), foto grande del look, tasti rapidi, tutto raggiungibile', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen);
  await page.route('**/api/avatar-looks**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current: { id: 'l1', text: 'capelli lunghi', at: new Date().toISOString() }, entries: [] }) }));
  await open(page, 'nova_palestra');
  await page.evaluate(() => App.solo.showHome()); await page.waitForTimeout(1500);
  // il vecchio avviso è ancora nel DOM (non cancellato) ma non si vede
  await page.waitForFunction(() => /La foto 2D non cambia/.test(document.getElementById('look-msg').textContent), null, { timeout: 10000 });
  expect(await visible(page, '#look-msg')).toBe(false);
  expect(await visible(page, '#nh-gesti-count')).toBe(false);
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toContain('La foto 2D non cambia');
  await expect(page.locator('#nh-look')).toContainText('palestra');
  for (const s of ['#nh-photo', '#nh-q-chat', '#nh-q-video', '#nh-q-voice']) expect(await visible(page, s), s).toBe(true);
  const ph = await page.evaluate(() => document.querySelector('#nh-photo .nh-avatar').getBoundingClientRect().height);
  expect(ph).toBeGreaterThan(250);
  // in fondo si arriva (Impostazioni), senza tasti tagliati ai lati
  await page.locator('#dock-settings').scrollIntoViewIfNeeded();
  expect(await visible(page, '#dock-settings')).toBe(true);
  const cut = await page.evaluate(() => [...document.querySelectorAll('#look-bar button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); }).map((b) => b.id));
  expect(cut).toEqual([]);
  await page.click('#nh-q-chat');
  await expect(page.locator('body')).toHaveClass(/solo-chat/);
});

test('chiamata senza clip «parla» e senza punti del viso: niente bocca disegnata storta, il video calmo continua', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  L.clips = L.clips.filter((c) => !(c.outfit === 'nova_palestra' && c.kind === 'parla'));
  L.outfits = L.outfits.map((o) => (o.key === 'nova_palestra' ? { ...o, landmarks: null } : o));
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen);
  await open(page, 'nova_palestra');
  await page.evaluate(() => { App.call.start('video').catch(() => {}); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { App.avatarConv.speaking = true; });
  const marks = [];
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(400); marks.push(await page.evaluate(() => { const s = document.getElementById('stage'); const v = App.motionPlayer && App.motionPlayer.els[App.motionPlayer.cur]; return { lips: s.classList.contains('nv-lips'), canvas: getComputedStyle(document.getElementById('avatar-canvas')).visibility !== 'hidden' && getComputedStyle(document.getElementById('avatar-canvas')).display !== 'none' && +getComputedStyle(document.getElementById('avatar-canvas')).opacity > 0.05, t: v ? v.currentTime : -1, playing: !!(v && !v.paused) }; })); }
  expect(marks.every((m) => !m.lips)).toBe(true);
  expect(marks.filter((m) => m.playing).length).toBeGreaterThan(16);
  const ts = marks.map((m) => m.t); expect(new Set(ts.map((t) => t.toFixed(1))).size).toBeGreaterThan(8); // il video avanza
});
