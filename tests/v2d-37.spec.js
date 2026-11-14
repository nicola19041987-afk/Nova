const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');
const O = require('../public/js/outfits.js');

// v2d-37: bocca guidata dall'audio che suona davvero, tempo reale di serie a ogni chiamata, camera nella chiamata,
// foto della Home intera durante una chiamata ridotta, Voce dalla Home = chiamata vocale, look vecchi fermi ritirati.
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d37/evidence';
const CH = '5ce17a0000000001';
const BASE = '/api/avatars/5ce17a0000000001.jpg';
const DIR = process.env.NOVA_V36_LIB || '/workspace/nova-motion/v2d36/library'; // foto e clip privati: solo in locale
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8'));
const hex = (n) => String(n).padStart(15, '0');
const HAS_LIB = fs.existsSync(path.join(DIR, 'library.json'));
function wav(sec) { // voce di prova: sillabe sintetiche, 24 kHz mono
  const R = 24000, n = Math.round(R * sec), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(R, 24); b.writeUInt32LE(R * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / R; const e = Math.max(0, Math.sin(Math.PI * 5 * t)) ** 0.6; b.writeInt16LE(Math.round(e * (0.5 * Math.sin(2 * Math.PI * 190 * t) + 0.25 * Math.sin(2 * Math.PI * 570 * t)) * 20000), 44 + i * 2); }
  return b;
}

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

async function hold(page, key) { // look tenuto (richiesta nuova v2d-37)
  await page.evaluate((k) => { App.ls.set('outfit:' + App.current.id, { scene: 'nova_palestra', key: k, by: 'chat', until: Date.now() + 3600e3, v37: true, seen: Date.now(), visitAt: Date.now() }); App.outfits.apply(true); }, key);
  await page.waitForTimeout(1500);
}

test('look tenuti da prima di v2d-37: i look vecchi fermi (senza «parla") o senza clip si ritirano; le richieste nuove restano', () => {
  const store = {};
  globalThis.App = { ls: { get: (k, d) => (k in store ? JSON.parse(store[k]) : d), set: (k, v) => { store[k] = JSON.stringify(v); }, del: (k) => { delete store[k]; } } };
  try {
    const mk = (key, style) => ({ key, style, label: key, words: [], avatar: `/api/avatars/${'a'.repeat(15)}${key.length % 10}.jpg` });
    const clip = (o, kind, i) => ({ id: 'c' + i, url: `/api/motion/c${hex(i)}.mp4`, kind, from: 'petto', to: 'petto', outfit: o });
    const ch = { id: CH, outfits: [mk('nova_maldive', 'scena'), mk('sexy_raso', 'sexy'), mk('nova_mora', 'capelli'), mk('senza_clip', 'sexy')],
      motionClips: [clip('nova_maldive', 'base', 1), clip('nova_maldive', 'parla', 2), clip('sexy_raso', 'base', 3), clip('nova_mora', 'base', 4), clip('nova_mora', 'parla', 5)] };
    const set = (st) => { store['outfit:' + CH] = JSON.stringify({ scene: 'nova_maldive', seen: Date.now(), visitAt: Date.now(), ...st }); };
    const until = Date.now() + 3 * 3600e3;
    set({ key: 'sexy_raso', by: 'chat', until }); expect(O.key(ch)).toBe('nova_maldive'); // vecchio, fermo: ritirato
    set({ key: 'senza_clip', by: 'lei', until }); expect(O.key(ch)).toBe('nova_maldive'); // nessun clip: ritirato
    set({ key: 'nova_mora', by: 'chat', until }); expect(O.key(ch)).toBe('nova_mora'); // si muove e parla: resta
    set({ key: 'sexy_raso', by: 'chat', until, v37: true }); expect(O.key(ch)).toBe('sexy_raso'); // chiesto adesso: rispettato
    const still = { ...ch, motionClips: [] }; // personaggio senza clip: tutto come prima
    set({ key: 'sexy_raso', by: 'chat', until }); expect(O.key(still)).toBe('sexy_raso');
  } finally { delete globalThis.App; }
});

test('bocca e voce: il clip «parla» si vede solo quando la voce suona davvero (mai prima), entro 600 ms, e si ferma quando tace', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  test.setTimeout(90000);
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen);
  const W = wav(2.4);
  await page.route('**/api/tts', async (r) => { await new Promise((z) => setTimeout(z, 700)); r.fulfill({ status: 200, contentType: 'audio/wav', body: W }); });
  await page.addInitScript(() => {
    window.__au = [];
    const st = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when) { const c = this.context; const w = when || c.currentTime; const d = this.buffer ? this.buffer.duration : 0; if (d > 0.3) window.__au.push({ on: performance.now() + (w - c.currentTime) * 1000, off: performance.now() + (w - c.currentTime + d) * 1000 }); return st.apply(this, arguments); };
  });
  await open(page, 'nova_maldive');
  const res = {};
  for (const look of ['nova_studio', 'nova_mora']) {
    await hold(page, look);
    await page.evaluate(() => { App.ls.set('callEngine', 'classic'); App.ls.set('voiceEngine', 'xai'); App.hasAi = () => true; });
    await page.mouse.click(200, 420);
    await page.evaluate(() => App.call.start('video').catch(() => {}));
    await page.waitForTimeout(3000);
    // il saluto della chiamata finisce prima della misura
    await page.waitForFunction(() => !App.speakingAudio() && !(App.tts && (App.tts.playing || App.tts.q.length)), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__vis = []; window.__au = [];
      const f = () => { const P = App.motionPlayer; const vs = [...document.querySelectorAll('#motion-video,#motion-video-b')]; let top = null, best = -1; for (const v of vs) { const o = +getComputedStyle(v).opacity; if (o > best) { best = o; top = v; } } const c = top && P && P.lib.find((x) => x.id === top._clipId); window.__vis.push({ t: performance.now(), parla: !!(c && c.kind === 'parla'), o: best }); if (window.__vis.length < 1500) requestAnimationFrame(f); };
      requestAnimationFrame(f);
      App.tts.say('Ciao amore, eccomi qui con te stasera.');
    });
    await page.waitForTimeout(6500);
    const r = await page.evaluate(() => {
      const au = window.__au, vis = window.__vis; if (!au.length) return { err: 'nessun audio' };
      const on = au[0].on, off = au[au.length - 1].off;
      const first = vis.find((x) => x.t >= on - 2000 && x.parla && x.o > 0.9);
      const calm = vis.find((x) => x.t > off && !x.parla && x.o > 0.9);
      return { lag: first ? Math.round(first.t - on) : null, early: vis.some((x) => x.t < on - 30 && x.t > on - 2000 && x.parla && x.o > 0.5), stop: calm ? Math.round(calm.t - off) : null, look: App.outfits.key(App.current) };
    });
    res[look] = r;
    await page.evaluate(() => App.call.end && App.call.end());
    await page.waitForTimeout(800);
  }
  console.log(JSON.stringify(res)); fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `lag-test-${test.info().project.name}.json`), JSON.stringify(res, null, 1));
  for (const [k, r] of Object.entries(res)) {
    expect(r.look, k).toBe(k);
    expect(r.early, k + ': bocca prima della voce').toBe(false);
    expect(r.lag, k + ': ritardo bocca').not.toBeNull(); expect(r.lag, k).toBeLessThan(600);
    expect(r.stop, k + ': bocca ferma dopo la voce').not.toBeNull(); expect(r.stop, k).toBeLessThan(1300);
  }
});

test('tempo reale di serie: chi era rimasto su «classica" passa una volta al tempo reale, la chiamata lo avvia da sola e riprova se non si collega', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.addInitScript(() => { localStorage.setItem('ap:nicola:callEngine', JSON.stringify('classic')); });
  await mock(page, L, seen);
  await open(page, 'nova_maldive');
  expect(await page.evaluate(() => [App.ls.get('callEngine'), App.ls.get('rtDefault37')])).toEqual(['realtime', true]);
  await page.evaluate(() => {
    window.__rt = 0; App.hasAi = () => true;
    let live = false;
    App.rt.start = async () => { window.__rt++; if (window.__rt === 1) throw new Error('rete'); live = true; }; // la prima volta non si collega
    App.rt.stop = () => { live = false; }; App.rt.speaking = () => false; App.rt.setMuted = () => {};
    App.call.start('video').catch(() => {});
  });
  await page.waitForFunction(() => window.__rt >= 1, null, { timeout: 5000 });
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__rt)).toBe(2);
  await page.evaluate(() => App.call.end());
  // v2d-40: il tempo reale è sempre inserito: una vecchia scelta «classica» salvata NON lo spegne più
  await page.evaluate(() => { App.ls.set('callEngine', 'classic'); window.__rt = 0; App.rt.start = async () => { window.__rt++; }; App.call.start('video').catch(() => {}); });
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__rt)).toBe(1);
  await page.evaluate(() => App.call.end());
});

test('camera nella videochiamata: tasto solo icona, anteprima piccola di sé, un tocco accende, un altro spegne', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.addInitScript(() => {
    const fake = () => { const c = document.createElement('canvas'); c.width = 120; c.height = 160; const g = c.getContext('2d'); let k = 0; setInterval(() => { g.fillStyle = `hsl(${(k += 9) % 360},60%,50%)`; g.fillRect(0, 0, 120, 160); }, 60); return c.captureStream(15); };
    navigator.mediaDevices.getUserMedia = async (cons) => { window.__gum = (window.__gum || []); window.__gum.push(cons && cons.video ? 'video' : 'audio'); if (cons && cons.video) return fake(); const a = new (window.AudioContext || window.webkitAudioContext)(); const d = a.createMediaStreamDestination(); return d.stream; };
  });
  await mock(page, L, seen);
  await open(page, 'nova_maldive');
  await page.evaluate(() => { App.ls.set('callEngine', 'classic'); App.call.start('video').catch(() => {}); });
  await page.waitForFunction(() => document.body.classList.contains('in-call'), null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  expect(await visible(page, '#call-cam')).toBe(true);
  expect(await page.evaluate(() => document.getElementById('call-cam').textContent.replace(/\s/g, '').replace(/\uFE0F/g, ''))).toBe('📷'); // solo icona
  expect(await visible(page, '#call-self')).toBe(false); // camera spenta all inizio
  await page.click('#call-cam');
  await page.waitForFunction(() => { const v = document.getElementById('call-self'); return v && !v.hidden && v.srcObject; }, null, { timeout: 5000 });
  expect(await visible(page, '#call-self')).toBe(true);
  const sv = await page.evaluate(() => { const v = document.getElementById('call-self'); const b = v.getBoundingClientRect(); return { w: b.width, h: b.height, inl: v.playsInline, muted: v.muted, pressed: document.getElementById('call-cam').getAttribute('aria-pressed') }; });
  expect(sv.pressed).toBe('true'); expect(sv.inl).toBe(true); expect(sv.muted).toBe(true);
  expect(sv.w).toBeGreaterThan(40); expect(sv.w).toBeLessThan(140); // piccola
  fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `call-cam-${test.info().project.name}.png`) });
  await page.click('#call-cam');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => [document.getElementById('call-self').hidden, document.getElementById('call-cam').getAttribute('aria-pressed')])).toEqual([true, 'false']);
  await page.evaluate(() => App.call.end());
});

test('Home durante una chiamata ridotta (iPhone): la foto grande è una sola immagine, senza la metà della chiamata sopra', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page, L, seen);
  await open(page, 'nova_enoteca');
  await page.evaluate(() => { App.ls.set('callEngine', 'classic'); App.call.start('video').catch(() => {}); });
  await page.waitForFunction(() => document.body.classList.contains('in-call'), null, { timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.click('#call-min');
  await page.waitForTimeout(800);
  await page.evaluate(() => App.solo.showHome());
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const vis = (e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && b.width > 1 && b.height > 1 && b.bottom > 0 && b.top < innerHeight; };
    const hero = document.querySelector('#nh-photo .nh-avatar'); const hb = hero.getBoundingClientRect();
    const layers = [...hero.querySelectorAll('img,video,canvas')].filter(vis).map((e) => { const b = e.getBoundingClientRect(); return [e.tagName + '.' + e.className + ' ' + (e.getAttribute('style') || '').slice(0, 120), Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; });
    const stage = document.getElementById('stage');
    // nessun video/immagine di grandi dimensioni fuori dalla foto che la copra
    const over = [...document.querySelectorAll('img,video,canvas')].filter((e) => !hero.contains(e) && vis(e)).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 150 && b.height > 100 && b.top < hb.bottom && b.bottom > hb.top; }).map((e) => e.id || e.className);
    return { stage: vis(stage), hero: [Math.round(hb.left), Math.round(hb.top), Math.round(hb.width), Math.round(hb.height)], layers, over, min: document.body.classList.contains('call-min') };
  });
  fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `home-callmin-${test.info().project.name}.png`) });
  expect(r.min).toBe(true);
  expect(r.stage, 'la chiamata ridotta non copre la Home').toBe(false);
  expect(r.over).toEqual([]);
  console.log(JSON.stringify(r.layers));
  for (const l of r.layers) expect(l.slice(1), 'livelli della foto allineati: ' + l[0]).toEqual(r.hero);
  // il tasto Video della Home riporta alla chiamata
  await page.click('#nh-q-video');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => [document.body.classList.contains('call-min'), App.call.active])).toEqual([false, true]);
  await page.evaluate(() => App.call.end());
});

test('Voce dalla Home = chiamata vocale vera (tempo reale di serie); se il tempo reale del ritratto non parte, chiamata classica e non silenzio', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria v2d-36 solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen);
  await open(page, 'nova_maldive');
  await page.evaluate(() => { window.__calls = []; const s = App.call.start; App.call.start = (m) => { window.__calls.push(m); return Promise.resolve(); }; App.call._s = s; App.solo.showHome(); });
  await page.waitForTimeout(800);
  await page.click('#nh-q-voice');
  expect(await page.evaluate(() => window.__calls)).toEqual(['voice']);
  await page.evaluate(async () => { window.__calls = []; App.hasAi = () => true; App.rt.supported = () => true; App.rt.start = async () => { throw new Error('rete'); }; App.solo.showChat(); await new Promise((r) => setTimeout(r, 300)); document.body.classList.remove('solo-rt'); await App.solo.toggleRt(); });
  expect(await page.evaluate(() => window.__calls)).toEqual(['voice']);
});
