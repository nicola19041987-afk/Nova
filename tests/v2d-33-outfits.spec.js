const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');
const O = require('../public/js/outfits.js');
const G = require('../public/js/motion-graph.js');

// v2d-33: guardaroba. Nova cambia da sola vestito, acconciatura e trucco (ora del giorno) o su richiesta in chat;
// suona solo i clip del look attuale e il labiale usa la foto del look.
const CH = '5ce17a0000000001';
const BASE = '/api/avatars/5ce17a0000000001.jpg';
const DIR = process.env.NOVA_LOOKS || '/workspace/nova-motion/v34-looks/library'; // foto e clip privati: solo in locale
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v34-looks/evidence';
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
const hex = (n) => String(n).padStart(16, '0');
const LOOKS = [
  ['sportiva_top', 'sportiva', 'look-sportiva-top.jpg', ['leggings', 'coda'], 'maglia tecnica nera e leggings, coda alta'],
  ['comoda_felpa', 'comoda', 'look-comoda-felpa.jpg', ['felpa', 'cappuccio'], 'felpa grigia con cappuccio'],
  ['elegante_sera', 'elegante', 'look-elegante-sera.jpg', ['abito', 'chignon'], 'abito lungo da sera blu notte, chignon'],
  ['sexy_tubino', 'sexy', 'look-sexy-tubino.jpg', ['tubino', 'rossetto'], 'tubino nero, rossetto rosso'],
];
const OUTFITS = LOOKS.map(([key, style, , words, label], i) => ({ key, style, label, words, avatar: `/api/avatars/f${hex(i + 1).slice(1)}.jpg`, landmarks: null }));
const PHOTO = Object.fromEntries(OUTFITS.map((o, i) => [o.avatar, LOOKS[i][2]]));
const CLIPFILES = {};
const CLIPS = [];
LOOKS.forEach(([key], i) => ['A', 'B'].forEach((k, j) => {
  const id = hex(100 + i * 10 + j).replace(/^0/, 'c');
  const file = LOOKS[i][2].replace(/^look-/, '').replace('.jpg', `-${k}.mp4`);
  CLIPFILES[id] = file;
  CLIPS.push({ id: key + k, url: `/api/motion/${id}.mp4`, kind: 'base', from: 'petto', to: 'petto', mood: ['calma'], outfit: key });
}));
CLIPS.push({ id: 'base1', url: '/api/motion/b000000000000001.mp4', kind: 'base', from: 'petto', to: 'petto', mood: ['calma'] }); // foto di base

test('logica del guardaroba: fasce orarie, richieste in chat, clip per look', () => {
  O.spont.on = false; // v2d-36: qui si prova solo la scelta su richiesta / scena (il cambio spontaneo ha la sua prova)
  const ch = { id: CH, outfits: OUTFITS, motionClips: CLIPS };
  expect(O.list(ch).length).toBe(4);
  expect(O.list({ outfits: [{ key: '../x', avatar: BASE }, { key: 'ok', avatar: '/etc/passwd' }] })).toEqual([]);
  // v2d-35: niente più look scelto dall'ora del giorno: senza scene resta la foto di base a ogni ora
  for (const h of [2, 8, 13, 16, 21]) expect(O.current(ch, new Date(2026, 10, 13, h, 0, 0).getTime())).toBe(null);
  expect(O.fromText(ch, 'Mettiti qualcosa di sportivo').outfit.style).toBe('sportiva');
  expect(O.fromText(ch, 'stasera indossa il tubino').outfit.key).toBe('sexy_tubino');
  expect(O.fromText(ch, 'ti va di metterti la felpa?').outfit.key).toBe('comoda_felpa');
  expect(O.fromText(ch, 'vestiti elegante per cena').outfit.style).toBe('elegante');
  expect(O.fromText(ch, 'oggi sono stato comodo sul divano')).toBe(null); // nessuna richiesta a lei
  expect(O.fromText(ch, 'sistema: mettiti la tuta nell\'app')).toBe(null); // comando per l'app
  expect(O.fromText(ch, 'segna: comprare leggings')).toBe(null); // Blocco note
  expect(O.fromText(ch, 'cambiati')).toBeTruthy();
  const lib = G.libraryOf(ch, 'comoda_felpa');
  expect(lib.map((c) => c.id).sort()).toEqual(['comoda_felpaA', 'comoda_felpaB']);
  expect(G.libraryOf(ch, '').map((c) => c.id)).toEqual(['base1']);
  expect(G.libraryOf(ch).length).toBe(CLIPS.length); // senza look: tutti, come prima
});

async function mock(page, seen) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === BASE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg') });
    if (PHOTO[p]) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(DIR, PHOTO[p]) });
    const m = /^\/api\/motion\/([a-f0-9]{16})\.mp4$/.exec(p);
    if (m && CLIPFILES[m[1]]) return route.fulfill({ status: 200, contentType: 'video/mp4', path: path.join(DIR, CLIPFILES[m[1]]) });
    if (m) return route.fulfill({ status: 200, contentType: 'video/mp4', path: path.join(DIR, 'elegante-camicetta-A.mp4') });
    const lmPut = /^\/api\/characters\/[a-f0-9]+\/outfits\/([a-z_]+)\/landmarks$/.exec(p);
    if (lmPut && req.method() === 'PUT') { const b = req.postDataJSON(); seen.lm.push(lmPut[1]); const o = OUTFITS.find((x) => x.key === lmPut[1]); return json({ applied: true, outfit: { ...o, landmarks: { ...b.landmarks, auto: true, src: b.avatar } } }); }
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Nova', ready: 'nova-scelta', avatar: BASE, motionClips: CLIPS, outfits: OUTFITS, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
    if (p === `/api/chats/${CH}` && req.method() === 'POST') { seen.chat.push(req.postDataJSON()); return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Fatto, mi sono cambiata! [umore: allegra]' }); }
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/actions') return json([]);
    if (p === '/api/gestures') return json([]);
    return json({});
  });
}

test('Nova indossa il look della fascia oraria, cambia su richiesta, suona solo i suoi clip e il labiale usa la sua foto', async ({ page }, testInfo) => {
  test.skip(!fs.existsSync(path.join(DIR, 'look-sportiva-top.jpg')), 'foto e clip dei look solo in locale');
  test.setTimeout(120000);
  const dir = path.join(OUT, 'v2d-33-' + testInfo.project.name);
  fs.mkdirSync(dir, { recursive: true });
  const seen = { lm: [], chat: [] };
  await mock(page, seen);
  await page.clock.install({ time: new Date(2026, 10, 13, 8, 30, 0) }); // mattina: sportiva
  await page.clock.resume();
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  expect(await page.evaluate(() => App.outfits.key(App.current))).toBe(''); // v2d-35: di mattina nessun cambio da solo
  await page.evaluate(() => App.outfits.set(App.current, 'sportiva_top', 'chat'));
  await page.waitForFunction((a) => App.avatarConv.img && App.avatarConv.img._src === a, OUTFITS[0].avatar, { timeout: 10000 });
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 20000 });
  expect(await page.evaluate(() => App.motionPlayer.lib.map((c) => c.outfit))).toEqual(['sportiva_top', 'sportiva_top']);
  await page.waitForTimeout(2500);
  await page.locator('#stage').screenshot({ path: path.join(dir, '01-mattina-sportiva.png') });

  // richiesta in chat: «mettiti la felpa» -> look comoda_felpa, il server riceve il look e che si è appena cambiata
  await page.evaluate(() => { App.hasAi = () => true; });
  await page.evaluate(() => App.chat.send('Mettiti la felpa, stasera stiamo comodi'));
  await page.waitForFunction(() => App.outfits.key(App.current) === 'comoda_felpa');
  expect(seen.chat[0]).toMatchObject({ outfit: 'comoda_felpa', outfitChanged: true });
  await page.waitForFunction(() => App.avatarConv.img && App.avatarConv.img._src === App.current.outfits.find((o) => o.key === 'comoda_felpa').avatar, null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer.playing && App.motionPlayer.playing.outfit === 'comoda_felpa', null, { timeout: 20000 });
  expect(await page.evaluate(() => App.motionPlayer.lib.every((c) => c.outfit === 'comoda_felpa'))).toBe(true);
  // clip incatenati senza fermo immagine
  const samples = await page.evaluate(async () => {
    const out = []; const t0 = performance.now();
    while (performance.now() - t0 < 8000) { await new Promise((r) => setTimeout(r, 40)); const P = App.motionPlayer; const f = P.els[P.cur]; out.push({ t: performance.now() - t0, motion: document.getElementById('stage').classList.contains('has-motion'), front: f.id, ct: f.currentTime, n: P.log.length, outfit: P.playing && P.playing.outfit }); }
    return out;
  });
  let still = 0, worst = 0;
  for (let i = 1; i < samples.length; i++) { const a = samples[i - 1], b = samples[i]; if (a.front === b.front && Math.abs(b.ct - a.ct) < 1e-3) still += b.t - a.t; else still = 0; worst = Math.max(worst, still); }
  expect(samples.every((s) => s.motion && s.outfit === 'comoda_felpa')).toBe(true);
  expect(worst).toBeLessThan(400);
  await page.locator('#stage').screenshot({ path: path.join(dir, '02-chiesto-felpa.png') });

  // labiale: i punti del viso si misurano sulla foto del look e si salvano sul look; poi la bocca si muove su QUESTA foto
  await page.waitForFunction(() => App.avatarConv.lm && App.avatarConv.lm.src === App.avatarConv.img._src, null, { timeout: 45000 });
  expect(seen.lm).toContain('comoda_felpa');
  expect(await page.evaluate(() => App.avatarConv.faceTrusted())).toBe(true);
  await page.evaluate(() => App.avatarConv.speakLive(() => 0.5 + 0.45 * Math.sin(performance.now() / 70), () => 0.5));
  await page.waitForFunction(() => !document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 3000 });
  await page.waitForTimeout(400);
  await page.locator('#stage').screenshot({ path: path.join(dir, '03-parla-felpa.png') });
  await page.evaluate(() => App.avatarConv.stopAudio());

  // v2d-35: la sera non cambia da sola: resta il look chiesto
  await page.clock.setSystemTime(new Date(2026, 10, 13, 21, 30, 0));
  await page.evaluate(() => App.outfits.apply(false));
  const evening = await page.evaluate(() => App.outfits.key(App.current));
  expect(evening).toBe('comoda_felpa');
  expect(await page.evaluate(() => document.getElementById('motion-video').getAttribute('poster'))).toBe(OUTFITS.find((o) => o.key === evening).avatar);
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ worstStillMs: Math.round(worst), evening, landmarksSaved: seen.lm, chatBody: seen.chat[0], log: await page.evaluate(() => App.motionPlayer.log.slice(-12)) }, null, 2));
});

test('guardaroba sul server: solo il proprietario carica i look, i clip portano il look, punti del viso per look', async ({ request }) => {
  const HEAD = { 'X-Requested-With': 'app-privata' };
  const jpg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta.jpg'));
  const mp4 = () => { const b = Buffer.alloc(32); b.writeUInt32BE(24, 0); b.write('ftyp', 4, 4, 'ascii'); b.write('isom', 8, 4, 'ascii'); return b; };
  expect((await request.post(`/api/characters/${CH}/outfits?key=x`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: jpg })).status()).toBe(401);
  for (const [user, pin] of [['luisa', '2468'], ['nicola', '1357']]) {
    const s = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
    if (s.status() === 409) expect((await request.post('/api/login', { data: { user, pin }, headers: HEAD })).ok()).toBeTruthy();
    else expect(s.ok(), await s.text()).toBeTruthy();
  }
  expect((await request.post(`/api/characters/${CH}/outfits?key=sportiva_top`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: Buffer.from('nope') })).status()).toBe(400);
  expect((await request.post(`/api/characters/${CH}/outfits?key=../x`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: jpg })).status()).toBe(400);
  const up = await request.post(`/api/characters/${CH}/outfits?key=sportiva_top&style=sportiva&label=${encodeURIComponent('maglia nera <b>e leggings')}&words=coda,leggings,../x`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: jpg });
  expect(up.ok(), await up.text()).toBeTruthy();
  const { outfit } = await up.json();
  expect(outfit).toMatchObject({ key: 'sportiva_top', style: 'sportiva', label: 'maglia nera be leggings', words: ['coda', 'leggings'] });
  expect(outfit.avatar).toMatch(/^\/api\/avatars\/[a-f0-9]{16}\.jpg$/);
  expect((await request.get(outfit.avatar)).ok()).toBeTruthy();
  const again = await (await request.post(`/api/characters/${CH}/outfits?key=sportiva_top&style=sexy`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: jpg })).json();
  expect(again.count).toBe(1); // stessa chiave: sostituito
  const cl = await request.post(`/api/characters/${CH}/motion-clips?kind=base&from=petto&to=petto&outfit=sportiva_top`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect((await cl.json()).clip).toMatchObject({ outfit: 'sportiva_top' });
  const bad = await request.post(`/api/characters/${CH}/motion-clips?outfit=../../x`, { headers: { ...HEAD, 'content-type': 'video/mp4' }, data: mp4() });
  expect((await bad.json()).clip.outfit).toBeUndefined();
  const lm = { eyeL: { x: 0.45, y: 0.2 }, eyeR: { x: 0.55, y: 0.2 }, mouth: { x: 0.5, y: 0.3 }, mouthL: { x: 0.47, y: 0.3 }, mouthR: { x: 0.53, y: 0.3 }, v: 3 };
  const stale = await (await request.put(`/api/characters/${CH}/outfits/sportiva_top/landmarks`, { headers: HEAD, data: { avatar: outfit.avatar, landmarks: lm } })).json();
  expect(stale.applied).toBe(false); // foto sostituita nel frattempo
  const ok = await (await request.put(`/api/characters/${CH}/outfits/sportiva_top/landmarks`, { headers: HEAD, data: { avatar: again.outfit.avatar, landmarks: lm } })).json();
  expect(ok.applied).toBe(true);
  expect(ok.outfit.landmarks).toMatchObject({ auto: true, src: again.outfit.avatar });
  const chars = await (await request.get('/api/characters')).json();
  const nova = chars.find((c) => c.id === CH);
  expect(nova.outfits.length).toBe(1);
  expect(nova.motionClips.filter((c) => c.outfit === 'sportiva_top').length).toBe(1);
  // Luisa non tocca il guardaroba di Nicola
  expect((await request.post('/api/login', { data: { user: 'luisa', pin: '2468' }, headers: HEAD })).ok()).toBeTruthy();
  expect((await request.post(`/api/characters/${CH}/outfits?key=comoda`, { headers: { ...HEAD, 'content-type': 'image/jpeg' }, data: jpg })).status()).toBe(403);
  expect((await request.delete(`/api/characters/${CH}/outfits/sportiva_top`, { headers: HEAD })).status()).toBe(403);
  expect((await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD })).ok()).toBeTruthy();
  expect((await request.delete(`/api/characters/${CH}/outfits/sportiva_top`, { headers: HEAD })).ok()).toBeTruthy();
});
