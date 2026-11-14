const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');


// v2d-37: bocca guidata dall'audio che suona davvero, tempo reale di serie a ogni chiamata, camera nella chiamata,
// foto della Home intera durante una chiamata ridotta, Voce dalla Home = chiamata vocale, look vecchi fermi ritirati.
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d39/evidence';
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

test('tempo reale: se parli mentre lei parla, tace subito (<200 ms), annulla la risposta, taglia al punto sentito e la bocca si ferma', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  await rtCall(page);
  await page.evaluate(() => window.__say(4));
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => App.rt.speaking())).toBe(true);
  // parli tu: voce vera sul microfono, poi l evento del servizio
  await page.evaluate(() => { window.__micG.gain.value = 0.4; });
  await page.waitForTimeout(350);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(); window.__ws.emit({ type: 'input_audio_buffer.speech_started' });
    while (App.rt.speaking() && performance.now() - t0 < 1000) await new Promise((z) => setTimeout(z, 5));
    const stopMs = performance.now() - t0;
    await new Promise((z) => setTimeout(z, 120));
    const o = App.rt._s().out; const g = o ? o.g.gain.value : 0;
    return { stopMs: Math.round(stopMs), speaking: App.rt.speaking(), gain: g, sent: window.__ws.sent.slice(-4), trunc: window.__trunc || null, lips: document.getElementById('stage').classList.contains('speaking'), audio: App.speakingAudio ? App.speakingAudio() : null };
  });
  console.log(JSON.stringify(r));
  expect(r.speaking).toBe(false);
  expect(r.stopMs).toBeLessThan(200);
  expect(r.gain).toBeLessThan(0.05);
  expect(r.sent).toContain('response.cancel');
  expect(r.trunc && r.trunc.item_id).toBe('it1');
  expect(r.trunc.audio_end_ms).toBeGreaterThan(700); expect(r.trunc.audio_end_ms).toBeLessThan(2500);
  expect(r.lips).toBe(false);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => App.speakingAudio())).toBe(false);
  await page.evaluate(() => App.call.end());
});

test('tempo reale: un «speech_started» senza voce sul microfono (eco filtrata) non la interrompe', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  await open(page, 'nova_studio');
  await rtCall(page);
  await page.evaluate(() => window.__say(4));
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__micG.gain.value = 0; window.__ws.emit({ type: 'input_audio_buffer.speech_started' }); });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => [App.rt.speaking(), window.__ws.sent.includes('response.cancel')])).toEqual([true, false]);
  // la voce arriva dopo: si ferma appena il microfono la conferma
  await page.evaluate(() => { window.__micG.gain.value = 0.4; });
  await page.waitForFunction(() => !App.rt.speaking(), null, { timeout: 800 });
  await page.evaluate(() => App.call.end());
});

test('chiamata classica: voce sul microfono per ~300 ms mentre lei legge -> la voce si ferma subito e ti ascolta', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen); await rtSetup(page);
  const R = 24000, n = R * 4, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(R, 24); b.writeUInt32LE(R * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 200 * i / R) * Math.max(0, Math.sin(Math.PI * 5 * i / R)) * 15000), 44 + i * 2);
  await page.route('**/api/tts', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: b }));
  await page.route('**/api/stt', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '' }) }));
  await open(page, 'nova_studio');
  await page.evaluate(() => { App.rt.classicOnly = true; App.ls.set('voiceEngine', 'xai'); App.hasAi = () => true; }); // v2d-40: classica solo in memoria (l'impostazione salvata non spegne più il tempo reale)
  await page.mouse.click(200, 420);
  await page.evaluate(() => App.call.start('video').catch(() => {}));
  await page.waitForFunction(() => App.call.micMode && App.call.micMode() === 'vad', null, { timeout: 10000 });
  await page.waitForTimeout(4500); // il saluto finisce
  await page.evaluate(() => App.tts.say('Ti racconto una cosa lunga, ascolta bene fino alla fine.'));
  await page.waitForFunction(() => App.audio.classicActive && App.audio.classicActive() && App.audio.classicLevel() > 0, null, { timeout: 5000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(async () => {
    const t0 = performance.now(); window.__micG.gain.value = 0.4;
    while (App.audio.classicActive() && performance.now() - t0 < 2000) await new Promise((z) => setTimeout(z, 5));
    return { ms: Math.round(performance.now() - t0), still: App.audio.classicActive(), q: App.tts.q.length, playing: !!App.tts.playing, listening: !!(App.callMic && App.callMic.speaking()) };
  });
  console.log(JSON.stringify(r));
  expect(r.still).toBe(false);
  expect(r.ms).toBeLessThan(550); // ~300 ms di voce + un blocco del microfono
  expect(r.q).toBe(0);
  expect(r.listening).toBe(true);
  await page.evaluate(() => { window.__micG.gain.value = 0; App.call.end(); });
});

test.describe('camera e ✕', () => {
  test.use({ hasTouch: true });
  test('videochiamata: camera accesa, ✕ -> anteprima tolta, camera spenta, e tasti/regole/vestiti rispondono ai tap veri', async ({ page }) => {
    test.skip(!HAS_LIB, 'libreria privata solo in locale');
    test.setTimeout(90000);
    await page.setViewportSize({ width: 390, height: 844 });
    const L = lib(); const seen = { chat: [] };
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async (c) => {
        if (c && c.video) { const cv = document.createElement('canvas'); cv.width = 120; cv.height = 160; const g = cv.getContext('2d'); setInterval(() => { g.fillStyle = '#3a7'; g.fillRect(0, 0, 120, 160); }, 60); const st = cv.captureStream(15); window.__camTracks = st.getTracks(); return st; }
        const a = new (window.AudioContext || window.webkitAudioContext)(); return a.createMediaStreamDestination().stream;
      };
    });
    await mock(page, L, seen);
    await open(page, 'nova_studio');
    await page.evaluate(() => { App.ls.set('callEngine', 'classic'); App.call.start('video').catch(() => {}); });
    await page.waitForFunction(() => document.body.classList.contains('in-call'), null, { timeout: 10000 });
    await page.waitForTimeout(1200);
await page.tap('#call-cam');
    await page.waitForFunction(() => { const v = document.getElementById('call-self'); return v && !v.hidden && v.srcObject; }, null, { timeout: 5000 });
    await page.tap('#call-min');
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => {
      const v = document.getElementById('call-self'); const b = v.getBoundingClientRect(); const cs = getComputedStyle(v);
      return { min: document.body.classList.contains('call-min'), shown: cs.display !== 'none' && !v.hidden && b.width > 0, tracks: (window.__camTracks || []).map((t) => t.readyState), stagePos: getComputedStyle(document.getElementById('stage')).position };
    });
    expect(st.min).toBe(true);
    expect(st.shown, 'anteprima camera ancora visibile dopo ✕').toBe(false);
    expect(st.tracks.every((t) => t === 'ended')).toBe(true);
    expect(st.stagePos).not.toBe('fixed');
    // ogni comando visibile in chat riceve il tocco (niente strati sopra)
    const bad = await page.evaluate(() => [...document.querySelectorAll('.topbar button, #chat-form button, #chat-form textarea, #chat-form input')].filter((e) => { const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 4 && b.height > 4 && b.top < innerHeight && b.bottom > 0; }).map((e) => { const b = e.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return h && (h === e || e.contains(h)) ? null : (e.id || e.className) + ' <- ' + (h && (h.id || h.tagName)); }).filter(Boolean));
    expect(bad).toEqual([]);
    await page.tap('#chat-input'); await page.keyboard.type('ciao'); await expect(page.locator('#chat-input')).toHaveValue('ciao'); await page.fill('#chat-input', '');
    // Home -> Vestiti e fisico, poi Impostazioni -> Le mie regole, con tap veri
    await page.evaluate(() => App.solo.showHome()); await page.waitForTimeout(600);
    const look = page.locator('#nh-list [data-nh-open="look"]'); await look.scrollIntoViewIfNeeded(); const lb = await look.boundingBox();
    await page.touchscreen.tap(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await expect(page.locator('[data-nh-page="look"]')).toBeVisible();
    await page.evaluate(() => App.solo.showHome()); await page.waitForTimeout(400);
    const set = page.locator('#dock-settings'); await set.scrollIntoViewIfNeeded(); const sb = await set.boundingBox();
    await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
    const rules = page.locator('#rules-input'); await rules.scrollIntoViewIfNeeded(); const rb = await rules.boundingBox();
    await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.keyboard.type('x');
    await expect(rules).toHaveValue(/x$/);
    // la chiamata si riprende e la camera si può riaccendere
    await page.evaluate(() => App.call.restore()); await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.body.classList.contains('call-min'))).toBe(false);
    await page.tap('#call-cam', { timeout: 5000 });
    await page.waitForFunction(() => { const v = document.getElementById('call-self'); return v && !v.hidden && v.srcObject; }, null, { timeout: 5000 });
    await page.evaluate(() => App.call.end());
  });
});
