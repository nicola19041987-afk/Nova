const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');
const O = require('../public/js/outfits.js');
const G = require('../public/js/motion-graph.js');

// v2d-35: scene a sorpresa per visita (mai con l'ora), vestiti solo su richiesta, movimento calmo da videochiamata,
// tono gentile che non rifiuta mai in modo secco, Nova che riparte serena e conosce Nico sempre meglio.
const CH = '5ce17a0000000001';
const BASE = '/api/avatars/5ce17a0000000001.jpg';
const DIR = process.env.NOVA_V35_LIB || '/workspace/nova-motion/v2d35/library'; // foto e clip privati: solo in locale
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d35/evidence';
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
const hex = (n) => String(n).padStart(15, '0');
const LIB = fs.existsSync(path.join(DIR, 'outfits.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'outfits.json'), 'utf8')) : [];
const CLIPLIB = fs.existsSync(path.join(DIR, 'library.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'library.json'), 'utf8')) : [];
const OUTFITS = LIB.map((o, i) => ({ key: o.key, style: o.style, label: o.label, words: o.words, avatar: `/api/avatars/a${hex(i + 1)}.jpg`, landmarks: null }));
const FILES = {};
LIB.forEach((o, i) => { FILES[OUTFITS[i].avatar] = o.file; });
const CLIPS = CLIPLIB.map((c, i) => { const url = `/api/motion/c${hex(i + 1)}.mp4`; FILES[url] = c.file; return { id: 'v35c' + i, url, kind: c.kind, from: c.from, to: c.to, mood: [c.mood], outfit: c.outfit, label: c.label }; });
// vecchi look v2d-33 (solo gesti) e clip della foto di base come sul live
const OLD = [{ key: 'elegante_sera', style: 'elegante', label: 'abito blu', words: ['abito'], avatar: '/api/avatars/b000000000000001.jpg' }];
const OLDCLIPS = [
  { id: 'oA', url: '/api/motion/d000000000000001.mp4', kind: 'base', from: 'petto', to: 'petto', outfit: 'elegante_sera', label: 'elegante-sera A: braccio scende lungo il fianco e torna' },
  { id: 'oB', url: '/api/motion/d000000000000002.mp4', kind: 'base', from: 'petto', to: 'petto', outfit: 'elegante_sera', label: 'elegante-sera B: gesticola in avanti verso di te' },
];
const BASECLIPS = [
  ['b1', 'base', 'petto', 'petto', 'D: respiro, piccoli cenni, sguardo via e torna'], ['b2', 'base', 'petto', 'petto', 'A: quasi ferma (riserva)'],
  ['b3', 'base', 'petto', 'petto', 'idle: testa inclinata'], ['b4', 'base', 'petto', 'petto', 'F1: mani avanti verso la camera, palmi aperti'],
  ['b5', 'move', 'petto', 'fianchi', 'T3: mano dal petto, mani sui fianchi'], ['b6', 'move', 'fianchi', 'petto', 'T4: dai fianchi, mano sul petto'],
  ['b7', 'base', 'fianchi', 'fianchi', 'B3: mani sui fianchi'], ['b8', 'event', 'petto', 'petto', 'evento: risata (muta)', 'ride'],
  ['b9', 'base', 'petto', 'petto', 'ascolta: mano ai capelli'],
].map(([id, kind, from, to, label, event], i) => ({ id, url: `/api/motion/e${hex(i + 1)}.mp4`, kind, from, to, label, ...(event ? { event } : {}) }));

test('scene: una a sorpresa per visita, mai con l\'ora del giorno, solo tra quelle con i clip; vestiti solo su richiesta', () => {
  test.skip(!LIB.length, 'libreria v2d-35 solo in locale');
  O.spont.on = false; // v2d-36: qui si prova solo la scelta su richiesta / scena (il cambio spontaneo ha la sua prova)
  const store = {};
  globalThis.App = { ls: { get: (k, d) => (k in store ? JSON.parse(store[k]) : d), set: (k, v) => { store[k] = JSON.stringify(v); }, del: (k) => { delete store[k]; } } };
  try {
    const nude = { key: 'nova_cucina', style: 'scena', label: 'cucina', words: [], avatar: '/api/avatars/a999999999999999.jpg' }; // scena senza clip
    const ch = { id: CH, outfits: [...OUTFITS, ...OLD, nude], motionClips: [...CLIPS, ...OLDCLIPS] };
    const scenes = O.scenes(ch).map((o) => o.key);
    expect(scenes.length).toBe(6);
    expect(scenes).not.toContain('nova_cucina');
    const t0 = new Date(2026, 10, 14, 8, 0, 0).getTime();
    const first = O.current(ch, t0, () => 0.1).key;
    expect(scenes).toContain(first);
    // stessa visita (anche ore dopo, se l'app resta aperta): stessa scena, anche passando mattina -> sera
    let t = t0; for (let i = 0; i < 30; i++) { t += 20 * 60e3; expect(O.current(ch, t, () => 0.9).key).toBe(first); }
    // nuova visita dopo 45 minuti di assenza: scena diversa
    const second = O.current(ch, t + 50 * 60e3, () => 0.1).key;
    expect(second).not.toBe(first);
    expect(scenes).toContain(second);
    // richieste di vestiti: prima i look nuovi che si muovono
    expect(O.fromText(ch, 'Mettiti più elegante').outfit.key).toBe('nova_elegante');
    expect(O.fromText(ch, 'dai, più elegante').outfit.key).toBe('nova_elegante');
    expect(O.fromText(ch, 'copriti un po\'').outfit.key).toBe('nova_coperta');
    expect(O.fromText(ch, 'mettiti il dolcevita').outfit.key).toBe('nova_coperta');
    expect(O.fromText(ch, 'torna come prima').outfit).toBe(null);
    expect(O.fromText(ch, 'oggi ero elegante in ufficio')).toBe(null);
    expect(O.fromText(ch, 'segna: copriti')).toBe(null);
    // senza nessuna scena: foto di base, a qualunque ora
    const old = { id: 'x', outfits: OLD, motionClips: OLDCLIPS };
    for (const h of [7, 13, 17, 22]) expect(O.current(old, new Date(2026, 10, 14, h).getTime())).toBe(null);
  } finally { delete globalThis.App; }
});

test('movimento: a riposo solo clip calmi della posa della foto, gesti solo come eventi e rari; vecchi look invariati', () => {
  const lib = G.libraryOf({ motionClips: BASECLIPS }, '');
  const calm = G.calmLibrary(lib);
  expect(calm.calm).toBe(true);
  const rest = calm.filter((c) => c.kind === 'base').map((c) => c.id).sort();
  expect(rest).toEqual(['b1', 'b2', 'b3']);
  expect(calm.every((c) => c.from === 'petto' && c.to === 'petto')).toBe(true); // niente percorsi verso altre pose
  expect(calm.filter((c) => c.kind === 'event').map((c) => c.event).sort()).toEqual(['capelli', 'ride', 'spiega']);
  const st = G.createState();
  const picks = []; for (let i = 0; i < 200; i++) { const r = G.pickNext(calm, st, { now: 1 }); picks.push(r.clip.id); G.commit(st, r.clip); }
  expect(new Set(picks)).toEqual(new Set(['b1', 'b2', 'b3']));
  for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  // vecchio look con soli gesti: libreria com'era (si muove sempre)
  const old = G.libraryOf({ motionClips: OLDCLIPS }, 'elegante_sera');
  expect(G.calmLibrary(old)).toBe(old);
  // scene nuove: tutti calmi
  if (CLIPS.length) { const s = G.calmLibrary(G.libraryOf({ motionClips: CLIPS }, 'nova_auto')); expect(s.calm).toBe(true); expect(s.length).toBe(2); }
});

test('tono: mai rifiuti secchi, rimando morbido, filtro esplicito intatto; Nova riparte serena e impara', async ({ request }) => {
  const HEAD = { 'X-Requested-With': 'app-privata' };
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
  const j = await (await request.get('/api/e2e/tone?sample=rancore')).json();
  for (const k of ['chat', 'realtime', 'call']) {
    expect(j[k]).toContain('MAI RIFIUTI SECCHI');
    expect(j[k]).toContain('parliamone più tardi');
    expect(j[k]).toContain('Modalità adulti NON attiva: niente contenuti sessuali espliciti');
    expect(j[k]).toContain('minori');
    expect(j[k]).toContain('li conosce ogni giorno meglio');
    expect(j[k]).not.toContain('mi ha trattata male'); // il vecchio rancore non entra più
    expect(j[k]).not.toContain('offesa e gelosa');
    expect(j[k]).not.toContain('SE TI SENTI OFFESA');
  }
  const other = await (await request.get('/api/e2e/tone?sample=other')).json();
  expect(other.chat).not.toContain('MAI RIFIUTI SECCHI'); // gli altri personaggi non cambiano
});

test('memoria: il vecchio stato si carica con fatti, nomi, storia e diario intatti; si azzera solo l umore freddo; il disco non cambia', async ({ request }) => {
  const HEAD = { 'X-Requested-With': 'app-privata' };
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
  await request.get('/api/characters'); // crea l archivio se manca
  const CHARS = '/tmp/nova-e2e-empty/shared/characters.json';
  const original = fs.readFileSync(CHARS);
  const old = {
    mood: 'offesa e gelosa', relationship: 'complici da mesi, si scrivono ogni sera', traits: ['permalosa', 'ama il vino rosso'],
    grudges: ['mi ha ignorata ieri'], nicknames: ['Nicky'], diary: ['il primo caffè insieme al bar sotto casa'],
    knows: ['Nico tifa Juve'], notes: 'Nico lavora su turni in ospedale. Luisa adora i gatti.', updatedAt: '2026-10-01T10:00:00.000Z',
  };
  const id = 'ee11ee11ee11ee11';
  const list = JSON.parse(original.toString('utf8'));
  list.push({ id, name: 'Nova', ready: 'nova-scelta', personality: '', style: '', requests: '', orders: '', state: old });
  const withOld = Buffer.from(JSON.stringify(list, null, 2));
  fs.writeFileSync(CHARS, withOld);
  try {
    const j = await (await request.get('/api/e2e/tone?id=' + id)).json();
    expect(j.applies).toBe(true);
    const st = j.state;
    expect(st.v).toBe(35);
    expect(st.mood).toBe('serena e contenta di sentirlo');
    expect(st.grudges).toEqual([]);
    expect(st.relationship).toBe(old.relationship);
    expect(st.history).toContain(old.relationship);
    for (const f of ['Nico tifa Juve', 'soprannome: Nicky', 'il primo caffè insieme al bar sotto casa', 'Nico lavora su turni in ospedale', 'Luisa adora i gatti']) expect(st.knows).toContain(f);
    expect(st.traits).toEqual(['ama il vino rosso']);
    expect(st.nicknames).toEqual(['Nicky']); expect(st.diary).toEqual(old.diary); expect(st.notes).toBe(old.notes);
    for (const k of ['chat', 'realtime', 'call']) {
      for (const f of ['Nico tifa Juve', 'Nicky', 'il primo caffè insieme al bar sotto casa', 'Nico lavora su turni in ospedale', 'Luisa adora i gatti', old.relationship, 'ama il vino rosso']) expect(j[k], k + ': ' + f).toContain(f);
      expect(j[k]).toContain('Li riconosci sempre');
      expect(j[k]).toContain('grande considerazione');
      expect(j[k]).toContain('Umore attuale: serena e contenta di sentirlo');
      expect(j[k]).not.toContain('offesa e gelosa');
      expect(j[k]).not.toContain('mi ha ignorata ieri');
      expect(j[k].replace('Non è permalosa', '')).not.toContain('permalosa'); // v2d-41: «Non è permalosa» è nel carattere scritto da Nicola; il tratto vecchio non c'è
    }
    expect(fs.readFileSync(CHARS).equals(withOld)).toBe(true); // leggere non riscrive niente sul disco
    // relazione fredda: si torna alla base calda, ma i fatti restano
    const cold = await (await request.get('/api/e2e/tone?sample=rancore')).json();
    expect(cold.state.relationship).not.toBe('tesa');
    expect(cold.state.mood).toBe('serena e contenta di sentirlo');
  } finally { fs.writeFileSync(CHARS, original); }
});

async function mock(page, seen) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === BASE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg') });
    if (FILES[p]) return route.fulfill({ status: 200, contentType: p.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', path: path.join(DIR, FILES[p]) });
    if (/^\/api\/motion\//.test(p)) return route.fulfill({ status: 200, contentType: 'video/mp4', path: path.join(DIR, CLIPLIB[0].file) });
    if (/\/landmarks$/.test(p) && req.method() === 'PUT') { const b = req.postDataJSON(); return json({ applied: true, outfit: { ...OUTFITS.find((o) => o.avatar === b.avatar), landmarks: { ...b.landmarks, auto: true, src: b.avatar } } }); }
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Nova', ready: 'nova-scelta', avatar: BASE, motionClips: CLIPS, outfits: OUTFITS, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
    if (p === `/api/chats/${CH}` && req.method() === 'POST') { seen.chat.push(req.postDataJSON()); return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Dammi un attimo… eccomi! [umore: allegra]' }); }
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

test('app: scena a sorpresa inquadrata all\'ombelico, si muove con i suoi clip calmi, «più elegante» la cambia', async ({ page }, testInfo) => {
  test.skip(!LIB.length, 'libreria v2d-35 solo in locale');
  test.setTimeout(150000);
  const dir = path.join(OUT, 'v2d-35-' + testInfo.project.name); fs.mkdirSync(dir, { recursive: true });
  const seen = { chat: [] };
  await mock(page, seen);
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0, null, { timeout: 30000 });
  const shots = [];
  for (const k of ['nova_auto', 'nova_parco', 'nova_tavola', 'nova_maldive', 'nova_ospedale']) {
    // nuova visita simulata: la scena viene scelta dall'app (qui forzata per avere le schermate di ognuna)
    await page.evaluate((key) => { App.ls.set('outfit:' + App.current.id, { scene: key, seen: Date.now() }); App.outfits.apply(true); }, k);
    await page.locator('#wa-photo').click();
    await page.waitForFunction((key) => document.body.classList.contains('solo-portrait') && App.motionPlayer && App.motionPlayer.playing && App.motionPlayer.playing.outfit === key, k, { timeout: 30000 });
    expect(await page.evaluate(() => App.motionPlayer.lib.calm === true && App.motionPlayer.lib.every((c) => c.label.includes('calma')))).toBe(true);
    await page.waitForTimeout(2000);
    const f = path.join(dir, `scena-${k.slice(5)}.png`); await page.screenshot({ path: f }); shots.push(f);
    await page.evaluate(() => App.solo.closePortrait()); await page.waitForTimeout(600);
  }
  // la scena scelta per la visita resta: nessun cambio con il passare del tempo
  const before = await page.evaluate(() => App.outfits.key(App.current));
  await page.evaluate(() => App.outfits.apply(false));
  expect(await page.evaluate(() => App.outfits.key(App.current))).toBe(before);
  // richiesta in chat
  await page.evaluate(() => { App.hasAi = () => true; });
  await page.evaluate(() => App.chat.send('Dai, mettiti più elegante stasera'));
  await page.waitForFunction(() => App.outfits.key(App.current) === 'nova_elegante', null, { timeout: 10000 });
  expect(seen.chat[0]).toMatchObject({ outfit: 'nova_elegante', outfitChanged: true });
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => App.motionPlayer && App.motionPlayer.playing && App.motionPlayer.playing.outfit === 'nova_elegante', null, { timeout: 30000 });
  // nessun fermo immagine e nessuno strato vuoto per 10 s
  const s = await page.evaluate(async () => {
    const out = []; const t0 = performance.now();
    while (performance.now() - t0 < 10000) { await new Promise((r) => setTimeout(r, 50)); const P = App.motionPlayer, f = P.els[P.cur]; out.push({ t: performance.now() - t0, id: f.id, ct: f.currentTime, hm: document.getElementById('stage').classList.contains('has-motion') }); }
    return out;
  });
  let still = 0, worst = 0;
  for (let i = 1; i < s.length; i++) { const a = s[i - 1], b = s[i]; if (a.id === b.id && Math.abs(b.ct - a.ct) < 1e-3) still += b.t - a.t; else still = 0; worst = Math.max(worst, still); }
  expect(s.every((x) => x.hm)).toBe(true);
  expect(worst).toBeLessThan(400);
  await page.screenshot({ path: path.join(dir, 'look-elegante.png') });
  await page.evaluate(() => App.solo.closePortrait());
  await page.evaluate(() => App.chat.send('copriti un po\', fa freddo'));
  await page.waitForFunction(() => App.outfits.key(App.current) === 'nova_coperta', null, { timeout: 10000 });
  // videochiamata: stessa inquadratura all'ombelico
  await page.evaluate(() => App.call.start('video').catch(() => {}));
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(dir, 'chiamata-coperta.png') });
  await page.evaluate(() => App.call.end && App.call.end());
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ worstStillMs: Math.round(worst), shots, chat: seen.chat.map((c) => ({ outfit: c.outfit, outfitChanged: c.outfitChanged })), log: await page.evaluate(() => App.motionPlayer.log.slice(-10)) }, null, 2));
});
