const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');


// v2d-40: chiamata vocale a tutto schermo (vista voce nel disegno, passo indietro nell'inquadratura), tempo reale sempre
// inserito con ritorno automatico dopo la riserva classica, bocca legata all'audio che si sente. Aiuti copiati da v2d-39.
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d40b/evidence';
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



// v2d-39: interruzione (barge-in). Servizio voce finto nel browser (nessuna rete): manda la risposta a pezzi PCM,
// poi «input_audio_buffer.speech_started» a metà. Lei deve tacere in <200 ms, con response.cancel e truncate.
async function rtSetup(page, opts = {}) {
  await page.addInitScript(() => {
    // microfono finto con livello regolabile (window.__micGain: 0 = silenzio/eco filtrata, 0.4 = voce vera)
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); o.frequency.value = 220; const g = c.createGain(); g.gain.value = 0; window.__micG = g;
      const d = c.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start(); return d.stream;
    };
    const Real = window.WebSocket;
    class FakeWS {
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__ws = this; this.protocol = 'x'; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.emit({ type: 'session.created' }); }, 30); }
      emit(ev) { this.onmessage && this.onmessage({ data: JSON.stringify(ev) }); }
      send(t) { const ev = JSON.parse(t); this.sent.push(ev.type); if (ev.type === 'session.update') setTimeout(() => this.emit({ type: 'session.updated' }), 5); if (ev.type === 'conversation.item.truncate') window.__trunc = ev; }
      close() { this.readyState = 3; }
    }
    window.WebSocket = function (url, p) { return /fake-rt/.test(url) ? new FakeWS(url) : new Real(url, p); };
    window.__say = (sec) => { // una risposta di lei: tanti pezzi PCM16 da 100 ms (tono con sillabe)
      const ws = window.__ws; ws.emit({ type: 'response.created', response: { id: 'r1' } }); ws.emit({ type: 'response.output_item.added', item: { id: 'it1' } });
      const n = 2400, k = Math.round(sec * 10);
      for (let j = 0; j < k; j++) { const a = new Int16Array(n); for (let i = 0; i < n; i++) { const t = (j * n + i) / 24000; a[i] = Math.round(Math.sin(2 * Math.PI * 200 * t) * Math.max(0, Math.sin(Math.PI * 5 * t)) * 12000); } let b = ''; const u = new Uint8Array(a.buffer); for (let i = 0; i < u.length; i++) b += String.fromCharCode(u[i]); ws.emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: btoa(b) }); }
    };
  });
  await page.route('**/api/realtime/session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'finto', url: 'wss://fake-rt.local/realtime', model: 'x', session: { instructions: 'x', voice: 'eve', turn_detection: { type: 'server_vad', threshold: 0.7 } } }) }));
  await page.route('**/api/realtime/instructions', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}
async function rtCall(page) {
  await page.evaluate(() => { App.ls.set('callEngine', 'realtime'); App.hasAi = () => true; });
  await page.mouse.click(200, 420);
  await page.evaluate(() => App.call.start('video').catch((e) => { window.__err = e.message; }));
  await page.waitForFunction(() => App.call.engine() === 'realtime' && App.rt.active, null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function voiceFromHome(page) {
  await page.evaluate(() => { App.hasAi = () => true; App.solo.showHome(); });
  await page.waitForTimeout(800);
  await page.click('#nh-q-voice');
  await page.waitForFunction(() => App.call.engine() === 'realtime' && App.rt.active, null, { timeout: 10000 });
  await page.waitForTimeout(400);
}
const viewState = (page) => page.evaluate(() => {
  const st = document.getElementById('stage'), cv = document.getElementById('avatar-canvas'), cs = getComputedStyle(cv), r = st.getBoundingClientRect();
  const z = (id) => { const e = document.getElementById(id); return e ? +getComputedStyle(e).zIndex || 0 : 0; };
  const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => { const c = getComputedStyle(e), b = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && b.width > 0; }).map((e) => e.id || e.className);
  const V = App.avatarConv.vv || {};
  return { cls: st.className, voiceCls: st.classList.contains('voice'), vc: st.classList.contains('nv-voicecall'), h: Math.round(r.height), ih: innerHeight, top: Math.round(r.top),
    cvVis: cs.visibility, cvOp: cs.opacity, cvFilter: cs.filter, cvTransform: cs.transform, cvZ: +cs.zIndex, vidZ: Math.max(z('motion-video'), z('motion-video-b')),
    vidTransform: getComputedStyle(document.getElementById('motion-video')).transform, portrait: shown('.call-portrait').length, backdrop: getComputedStyle(document.querySelector('.av-backdrop')).visibility,
    buttons: shown('#call-ui button'), on: !!V.on, z: V.z, mode: App.call.mode };
});
// luminosità media del canvas (0..255): la scena chiara, non il riquadro marrone scuro sfocato
const canvasLuma = (page) => page.evaluate(() => { const c = document.getElementById('avatar-canvas'), t = document.createElement('canvas'); t.width = 36; t.height = 64; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 36, 64); const d = x.getImageData(0, 0, 36, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return Math.round(s / (d.length / 4)); });

test('chiamata vocale dalla Home: lei viva a tutto schermo (niente sfondo scuro sfocato né ritratto rotondo), solo ✕, microfono e riaggancia', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  await voiceFromHome(page);
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const s = await viewState(page);
  console.log(JSON.stringify(s));
  expect(s.mode).toBe('voice');
  expect(s.vc).toBe(true); expect(s.voiceCls).toBe(false);
  expect(s.top).toBe(0); expect(s.h).toBe(s.ih); // a tutto schermo (prima ~585 px su 664: si vedeva la Home)
  expect(s.cvVis).toBe('visible'); expect(s.cvOp).toBe('1'); expect(s.cvFilter).toBe('none'); expect(s.cvTransform).toBe('none');
  expect(s.cvZ).toBeGreaterThan(s.vidZ); // il disegno sopra i video (che restano accesi sotto)
  expect(s.vidTransform).toBe('none'); // nessuna scala CSS
  expect(s.portrait).toBe(0); expect(s.backdrop).toBe('hidden');
  expect(s.buttons.sort()).toEqual(['call-end', 'call-min', 'call-mute'].sort());
  expect(s.on).toBe(true);
  expect(await canvasLuma(page)).toBeGreaterThan(70);
  fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `voce-${test.info().project.name}.png`) });
  await page.evaluate(() => App.call.end());
});

test('passo indietro nel disegno: di rado e lento, torna vicina; mai con prefers-reduced-motion; reset riducendo, passando al video e riagganciando', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  await voiceFromHome(page);
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 15000 });
  // il ciclo automatico: si allontana in ~2,8 s (passaggio morbido, non uno scatto), poi torna
  await page.evaluate(() => { App.avatarConv.vv.next = performance.now(); });
  await page.waitForFunction(() => App.avatarConv.vv.phase === 'far' && App.avatarConv.vv.z < 0.99, null, { timeout: 8000 }); // parte solo con lei in movimento
  await page.waitForTimeout(600);
  const mid = await page.evaluate(() => App.avatarConv.vv.z);
  await page.waitForTimeout(2800);
  const far = await page.evaluate(() => ({ z: App.avatarConv.vv.z, phase: App.avatarConv.vv.phase }));
  console.log(JSON.stringify({ mid, far }));
  expect(mid).toBeGreaterThan(0.81); expect(mid).toBeLessThan(0.99);
  expect(far.z).toBeCloseTo(0.8, 2); expect(far.phase).toBe('far');
  fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, `voce-lontana-${test.info().project.name}.png`) });
  expect(await canvasLuma(page)).toBeGreaterThan(60); // intorno: la sua scena sfocata, mai un fondo scuro
  expect((await viewState(page)).vidTransform).toBe('none');
  await page.evaluate(() => { App.avatarConv.vv.next = performance.now(); });
  await page.waitForTimeout(3200);
  expect(await page.evaluate(() => App.avatarConv.vv.z)).toBeCloseTo(1, 3);
  // ridotta: inquadratura normale subito; ripresa: vista voce di nuovo, vicina
  await page.evaluate(() => App.avatarConv.setFrameZoom(0.8, 0));
  await page.evaluate(() => App.call.minimize());
  let s = await viewState(page); expect(s.on).toBe(false); expect(s.z).toBe(1);
  await page.evaluate(() => App.call.restore());
  s = await viewState(page); expect(s.on).toBe(true); expect(s.z).toBe(1); expect(s.vc).toBe(true); expect(s.h).toBe(s.ih);
  // al video: niente vista voce
  await page.evaluate(() => { App.avatarConv.setFrameZoom(0.8, 0); App.call.setMode('video'); });
  s = await viewState(page); expect(s.on).toBe(false); expect(s.vc).toBe(false); expect(s.z).toBe(1); expect(s.mode).toBe('video');
  await page.evaluate(() => App.call.end());
  s = await viewState(page); expect(s.on).toBe(false); expect(s.vc).toBe(false);
});

test.describe('movimento ridotto', () => {
  test.use({ reducedMotion: 'reduce' });
  test('prefers-reduced-motion: nessun passo indietro e nessun movimento del disegno', async ({ page }) => {
    test.skip(!HAS_LIB, 'libreria privata solo in locale');
    const L = lib(); const seen = { chat: [] };
    await mock(page, L, seen); await rtSetup(page);
    await open(page, 'nova_studio');
    await voiceFromHome(page);
    await page.evaluate(() => { App.avatarConv.vv.next = performance.now(); });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => ({ z: App.avatarConv.vv.z, m: App.avatarConv.voiceMotion(performance.now(), 16, 390, 844) }));
    expect(r.z).toBe(1); expect(r.m).toEqual({ s: 1, dx: 0, dy: 0 });
    await page.evaluate(() => App.call.end());
  });
});

test('bocca legata all\'audio che si sente: segue le sillabe, chiusa nelle pause e appena la risposta finisce; la chat non la fa ripartire', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  let inject = false;
  await mock(page, L, seen); await rtSetup(page);
  await page.route((u) => u.pathname === `/api/chats/${CH}` && u.search.includes('since'), (r) => { if (!inject) return r.fallback(); inject = false; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ epoch: 'e1', last: 2, messages: [{ id: 'mx1', role: 'assistant', content: 'Eccomi, ti ho detto tutto a voce, ora ti ascolto con calma.', at: new Date().toISOString() }], typing: null }) }); });
  await open(page, 'nova_studio');
  await voiceFromHome(page);
  // 2,4 s di voce a sillabe (5 al secondo, con silenzi veri fra una e l'altra), poi fine della risposta
  const r = await page.evaluate(async () => {
    window.__say(2.4); window.__ws.emit({ type: 'response.done', response: { status: 'completed' } });
    const A = App.avatarConv, smp = []; const t0 = performance.now();
    while (performance.now() - t0 < 3600) { smp.push({ t: performance.now() - t0, m: A.mouth, lv: App.rt.level(), sp: App.rt.speaking(), av: A.speaking }); await new Promise((z) => setTimeout(z, 16)); }
    return smp;
  });
  const during = r.filter((x) => x.t > 400 && x.t < 2300), after = r.filter((x) => x.t > 3100);
  const max = Math.max(...during.map((x) => x.m)), min = Math.min(...during.map((x) => x.m));
  console.log(JSON.stringify({ max, min, after: after.slice(-1)[0] }));
  expect(max).toBeGreaterThan(0.35); // si apre sulle sillabe
  expect(min).toBeLessThan(0.15); // e si chiude nei silenzi (prima: livello del pezzo intero o 0,02 forzato = sillabe finte)
  expect(after.every((x) => x.m < 0.03 && !x.av && !x.sp)).toBe(true); // finita la voce: bocca chiusa, «parla» spento
  expect(await page.evaluate(() => document.getElementById('stage').classList.contains('speaking'))).toBe(false);
  // la trascrizione della risposta arriva nella chat: in chiamata nessun labiale finto dal testo
  inject = true;
  await page.evaluate(() => App.chat.poll());
  await page.waitForTimeout(700);
  const z = await page.evaluate(() => ({ av: App.avatarConv.speaking, kf: App.avatarConv.kf.length, m: App.avatarConv.mouth, sa: App.speakingAudio() }));
  expect(z.av).toBe(false); expect(z.m).toBeLessThan(0.03); expect(z.sa).toBe(false);
  await page.evaluate(() => App.call.end());
});

test('bocca e interruzione in chiamata vocale: parli sopra di lei -> tace e la bocca si chiude subito', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  await voiceFromHome(page);
  await page.evaluate(() => window.__say(4));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => App.rt.speaking())).toBe(true);
  await page.evaluate(() => { window.__micG.gain.value = 0.4; });
  await page.waitForTimeout(350);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(); window.__ws.emit({ type: 'input_audio_buffer.speech_started' });
    while (App.rt.speaking() && performance.now() - t0 < 1000) await new Promise((z) => setTimeout(z, 5));
    const stopMs = performance.now() - t0; await new Promise((z) => setTimeout(z, 350));
    return { stopMs: Math.round(stopMs), m: App.avatarConv.mouth, av: App.avatarConv.speaking, lips: document.getElementById('stage').classList.contains('nv-lips') };
  });
  console.log(JSON.stringify(r));
  expect(r.stopMs).toBeLessThan(200); expect(r.m).toBeLessThan(0.05); expect(r.av).toBe(false);
  await page.evaluate(() => { window.__micG.gain.value = 0; App.call.end(); });
});

test('tempo reale sempre inserito: la vecchia scelta «classica» non lo spegne; dopo la riserva classica la chiamata torna da sola al tempo reale', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await page.addInitScript(() => { localStorage.setItem('ap:nicola:callEngine', JSON.stringify('classic')); localStorage.setItem('ap:nicola:rtDefault37', 'true'); });
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  const s0 = await page.evaluate(() => { App.hasAi = () => true; return { saved: App.ls.get('callEngine'), enabled: App.rt.enabled(), sel: document.getElementById('call-engine').disabled }; });
  expect(s0.saved).toBe('realtime'); expect(s0.enabled).toBe(true);
  // nemmeno cambiandola a mano: enabled resta vero
  await page.evaluate(() => App.ls.set('callEngine', 'classic'));
  expect(await page.evaluate(() => App.rt.enabled())).toBe(true);
  await voiceFromHome(page);
  // il collegamento cade a chiamata in corso: riserva classica, poi ritorno automatico al tempo reale
  await page.evaluate(() => App.call.fallback('prova: collegamento perso'));
  expect(await page.evaluate(() => App.call.engine())).toBe('classic');
  await page.waitForFunction(() => App.call.engine() === 'realtime' && App.rt.active, null, { timeout: 8000 });
  expect(await page.evaluate(() => App.call.active)).toBe(true);
  await page.evaluate(() => App.call.end());
});
