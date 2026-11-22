// v2d-49 (Nicola, 16/11 alle 00:21): 1) con la foto fissa Ira non promette più «dammi un minuto, adesso mi cambio»;
// 2) bocca senza riga bianca né labbro doppio, niente toppe per sguardo e sopracciglia (occhio «girato» con la testa inclinata);
// 3) Simli: a fine sessione (durata massima o silenzio) la videochiamata si riconnette da sola, con attese crescenti e un
// limite di tentativi; poco prima della durata massima passa a una sessione nuova senza stacchi. Filtro prima dei 16 kHz.
const { test, expect } = require('./harness');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEAD = { 'X-Requested-With': 'app-privata' };
const CH = '5ce17a0000000001';
const FOTO = 'a1fa460000000001.jpg';
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46-landmarks.json'), 'utf8'));
const JPG = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46.jpg'));
const FACE = '11111111-2222-3333-4444-555555555555';
const WK = 'Questo WebKit (WPE headless del box) chiude il processo appena l\u2019app è avviata: verificato su Chromium; iPhone vero da provare.';

function startServer(dir, aiPort, extra = {}) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-v2d49', NOVA_E2E: '1' };
  for (const k of Object.keys(env)) if (/^(NOTES|SISTEMA)_WEBHOOK_|^SIMLI_/.test(k)) delete env[k];
  Object.assign(env, extra);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
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
function listen(handler) {
  const srv = http.createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => handler(req, res, body)); });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
async function login(request, base, user, pin) {
  const setup = await request.post(base + '/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (setup.status() === 409) { const l = await request.post(base + '/api/login', { data: { user, pin }, headers: HEAD }); expect(l.ok(), await l.text()).toBeTruthy(); }
  else expect(setup.ok(), await setup.text()).toBeTruthy();
}
async function mockApp(page, { simliFace = false, session = null } = {}) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    let s = 12345; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/simli/session' && session) return session(json);
    if (p.startsWith('/api/avatars/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
    if (p.startsWith('/api/motion/')) return route.fulfill({ status: 404, body: '' });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true, simliFace });
    if (p === '/api/characters') return json([{ id: CH, name: 'Ira', ready: 'nova-scelta', avatar: '/api/avatars/' + FOTO, avatarSource: 'upload', landmarks: { ...LM, src: '/api/avatars/' + FOTO }, outfits: [], motionClips: [], personality: '', style: '', requests: '', voice: 'eve', messages: 0 }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, reset: true, messages: [], typing: null });
    if (p === '/api/calls') return json({ calls: [] });
    if (p === '/api/memory' || p === '/api/gestures') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    return json({});
  });
}
async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.current, null, { timeout: 30000 });
}

test('v2d-49: cache del service worker app-privata-v2d-49', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(49|[5-9]\d|65b)'/); // v2d-65b alza la cache
});

test('v2d-49: con la foto fissa (di serie) Ira non promette di cambiarsi; Simli con sessioni più lunghe, chiave mai esposta', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'solo server');
  test.setTimeout(60000);
  const seen = [];
  const ai = await listen((req, res, body) => {
    seen.push({ url: req.url, body }); res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Eh, magari… per ora qui mi vedi così.' } }] }));
    res.end('{}');
  });
  const sim = await listen((req, res, body) => {
    seen.push({ url: 'simli:' + req.url, body, key: req.headers['x-simli-api-key'] }); res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/compose/token')) return res.end(JSON.stringify({ session_token: 'tok-49' }));
    if (req.url.startsWith('/compose/ice')) return res.end('[]');
    res.end('{}');
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-v2d49-'));
  const s = startServer(dir, ai.address().port, { SIMLI_TEST_BASE: `http://127.0.0.1:${sim.address().port}` });
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await login(request, base, 'nicola', '1357');
    const sysOf = async (data) => {
      const n0 = seen.length;
      const r = await request.post(`${base}/api/chats/${CH}`, { data, headers: { ...HEAD, 'X-AI-Key': 'xai-test' } });
      const call = seen.slice(n0).filter((x) => x.url.endsWith('/chat/completions')).pop();
      expect(call, await r.text()).toBeTruthy();
      return JSON.parse(call.body).messages[0].content;
    };
    // chat scritta, di serie (il telefono non manda faceLock): niente «dammi un minuto», niente «lo fai volentieri»
    const locked = await sysOf({ message: 'mettiti la felpa grigia' });
    expect(locked).toContain('VESTITI E ASPETTO (v2d-49, foto fissa)');
    expect(locked).toContain('non riesci a cambiarti');
    expect(locked).toContain('NON dire «dammi un minuto»');
    expect(locked).not.toContain('VESTITI AL VOLO');
    expect(locked).not.toContain('lo fai volentieri');
    expect(locked).toContain("PRENDE L'INIZIATIVA");
    // foto non fissa (solo prove sul telefono): il comportamento di prima
    const free = await sysOf({ message: 'mettiti la felpa grigia', faceLock: false });
    expect(free).toContain('VESTITI AL VOLO');
    expect(free).toContain('dammi un minuto');
    expect(free).not.toContain('VESTITI E ASPETTO (v2d-49');
    // chiamata in tempo reale: stessa regola
    const rt = await (await request.post(base + '/api/realtime/instructions', { data: { characterId: CH, mode: 'video' }, headers: HEAD })).json();
    expect(rt.instructions).toContain('VESTITI E ASPETTO (v2d-49, foto fissa)');
    expect(rt.instructions).not.toContain('VESTITI AL VOLO');
    const rtFree = await (await request.post(base + '/api/realtime/instructions', { data: { characterId: CH, mode: 'video', faceLock: false }, headers: HEAD })).json();
    expect(rtFree.instructions).toContain('VESTITI AL VOLO');
    // Simli: token con durata massima 1800 s e silenzio massimo 300 s (prezzo al minuto, nessun costo in più); chiave mai in risposta
    expect((await request.post(base + '/api/simli/key', { headers: HEAD, data: { key: 'simli-prova-segreta-49' } })).ok()).toBeTruthy();
    fs.writeFileSync(path.join(dir, 'simli-face.json'), JSON.stringify({ faceId: FACE, ready: true, status: 'completed', at: new Date().toISOString() }));
    const sr = await request.post(base + '/api/simli/session', { headers: HEAD, data: {} });
    const st = await sr.text();
    expect(sr.ok(), st).toBeTruthy();
    expect(st).not.toContain('simli-prova-segreta-49');
    expect(JSON.parse(st)).toMatchObject({ session_token: 'tok-49', maxSessionLength: 1800, maxIdleTime: 300 });
    const tok = seen.filter((x) => x.url.startsWith('simli:/compose/token')).pop();
    expect(JSON.parse(tok.body)).toMatchObject({ faceId: FACE, handleSilence: true, maxSessionLength: 1800, maxIdleTime: 300 });
    expect(s.log()).not.toContain('simli-prova-segreta-49');
  } finally { s.child.kill(); ai.close(); sim.close(); }
});

test('v2d-49: il telefono manda faceLock:false solo con la foto non fissa', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WK);
  await mockApp(page);
  await openApp(page);
  const bodies = await page.evaluate(async () => {
    const seen = [];
    const api = App.api; App.api = async (p, o) => { if (/\/api\/realtime\/(session|instructions)/.test(p)) { seen.push(o && o.body); return {}; } return api(p, o); };
    const lock = App.faceLocked();
    try { await App.api('/api/realtime/instructions', { method: 'POST', body: { characterId: 'x', mode: 'video', ...(App.faceLocked && !App.faceLocked() ? { faceLock: false } : {}) } }); } catch { /* */ }
    App.api = api;
    return { lock, seen };
  });
  expect(bodies.lock).toBe(true);
  expect(bodies.seen[0]).not.toHaveProperty('faceLock');
  // il codice dei due punti che chiamano il server porta davvero il campo
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat.js'), 'utf8');
  const rt = fs.readFileSync(path.join(ROOT, 'public', 'js', 'realtime.js'), 'utf8');
  expect(chat).toContain('App.faceLocked && !App.faceLocked() ? { faceLock: false } : {}');
  expect((rt.match(/App\.faceLocked && !App\.faceLocked\(\) \? \{ faceLock: false \} : \{\}/g) || []).length).toBe(3);
});

test('v2d-49: bocca senza riga chiara né bordo, niente toppe di sguardo e sopracciglia; la bocca si apre ancora', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WK);
  test.setTimeout(60000);
  await mockApp(page);
  await openApp(page);
  await page.evaluate(() => { App.solo.openPortrait && App.solo.openPortrait(); const st = document.getElementById('stage'); if (st) st.hidden = false; });
  // il ritratto a volte viene richiuso dall'avvio della Home: si riapre finché il canvas è a schermo e dimensionato
  await page.waitForFunction(() => { const A = App.avatarConv; if (!A.c.getClientRects().length && App.solo.openPortrait) App.solo.openPortrait(); return A.img && A.img.naturalWidth > 0 && A.c.height > 500 && A.lm && A.lm.mouthL; }, null, { timeout: 20000, polling: 300 });
  const m = await page.evaluate(async () => {
    const A = App.avatarConv; cancelAnimationFrame(A._raf); A.loop = () => {};
    await new Promise((r) => setTimeout(r, 100));
    const run = (mouth, wide, gaze) => {
      A.target = () => mouth; A.speaking = mouth > 0; A.vWide = wide; A.wide = wide; A.mouth = mouth; A.nextBlink = 1e13; A.blink = 0;
      const mc = A.micro; mc.gtx = gaze ? 1 : 0; mc.gty = gaze ? 0.6 : 0; mc.gx = mc.gtx; mc.gy = mc.gty; mc.brow = gaze ? 1 : 0; mc.browT = mc.brow; mc.browUntil = gaze ? 1e13 : 0; mc.nextBrow = 1e13;
      let t = 100000; A._drawn = 0; A._last = t;
      for (let k = 0; k < 60; k++) { t += 16.7; A.mouth = mouth; if (gaze) { mc.gtx = 1; mc.gty = 0.6; mc.browT = 1; mc.brow = 1; mc.browUntil = 1e13; } A.frame(t); }
      const d = A.ctx.getImageData(0, 0, A.c.width, A.c.height).data, L = new Float32Array(d.length / 4);
      for (let i = 0; i < L.length; i++) L[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
      return L;
    };
    run(0, 0.5, false); run(0, 0.5, false); // a regime (respiro, molle del capo)
    const rest = run(0, 0.5, false), gaze = run(0, 0.5, true), rest2 = run(0, 0.5, false), open = run(0.7, 0.55, false), wide = run(1, 0.95, false);
    const cmp = (a, b) => { let changed = 0, brighter = 0; for (let i = 0; i < a.length; i++) { const d = b[i] - a[i]; if (Math.abs(d) > 12) changed++; if (d > 40) brighter++; } return { changed, brighter }; };
    return { noise: cmp(rest, rest2), gaze: cmp(rest2, gaze), open: cmp(rest2, open), wide: cmp(rest2, wide) };
  });
  console.log('[v2d-49] volto', JSON.stringify(m));
  expect(m.gaze.changed).toBeLessThanOrEqual(m.noise.changed + 30); // sguardo e sopracciglia forzati: la foto non cambia (prima ~15.000 pixel in più)
  expect(m.open.changed).toBeGreaterThan(800); // la bocca si apre davvero
  expect(m.wide.changed).toBeGreaterThan(800);
  expect(m.open.brighter).toBeLessThan(40); // niente riga bianca (prima ~430 pixel molto più chiari)
  expect(m.wide.brighter).toBeLessThan(40);
});

// WebSocket e RTCPeerConnection finti: Simli non viene mai chiamato
const FAKES = () => {
  window.__ws = []; window.__pc = [];
  class FakeWS {
    constructor(url) { this.url = String(url); this.readyState = 0; this.texts = []; this.bin = 0; this.l = {}; window.__ws.push(this); setTimeout(() => { this.readyState = 1; this.emit('open'); }, 0); }
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
    emit(t, e) { (this.l[t] || []).slice().forEach((f) => f(e || {})); }
    say(text) { this.emit('message', { data: text }); }
    send(d) { if (typeof d === 'string') this.texts.push(d); else this.bin++; }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  }
  class FakePC {
    constructor() { this.iceGatheringState = 'complete'; this.connectionState = 'new'; this.l = {}; window.__pc.push(this); }
    addTransceiver() {}
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
    removeEventListener() {}
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0' }); }
    setLocalDescription(d) { this.localDescription = d; return Promise.resolve(); }
    setRemoteDescription() { return Promise.resolve(); }
    close() { this.connectionState = 'closed'; }
  }
  window.WebSocket = FakeWS; window.RTCPeerConnection = FakePC;
  // Simli «risponde»: START e una traccia video vera (canvas)
  window.__live = (i) => {
    const ws = window.__ws[i], pc = window.__pc[i];
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = ['#c33', '#3c3', '#33c', '#cc3'][i % 4]; g.fillRect(0, 0, 64, 64);
    const stream = c.captureStream(10); setInterval(() => { g.fillRect(0, 0, 1 + Math.random() * 63, 2); }, 100);
    ws.say('START');
    (pc.l.track || []).forEach((f) => f({ track: { kind: 'video' }, streams: [stream] }));
  };
};

test('v2d-49: Simli si riconnette da solo a fine sessione e cambia sessione prima della durata massima, senza stacchi', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WK);
  test.setTimeout(60000);
  await page.addInitScript(FAKES);
  let calls = 0, maxLen = 1800;
  await mockApp(page, { simliFace: true, session: (json) => { calls++; return json({ session_token: 'tok-' + calls, iceServers: [], fallback: false, maxSessionLength: maxLen, maxIdleTime: 300 }); } });
  await openApp(page);
  // 1) sessione normale
  await page.evaluate(async () => { App.call.active = true; App.call.mode = 'video'; await App.simli.start(); });
  await page.waitForFunction(() => window.__ws.length === 1 && window.__ws[0].texts.length > 0);
  await page.evaluate(() => window.__live(0));
  await page.waitForFunction(() => document.body.classList.contains('simli-on'), null, { timeout: 10000 });
  // 2) Simli chiude per silenzio: nuovo token e nuova sessione, da soli
  await page.evaluate(() => { window.__ws[0].say('CLOSING REASON: IDLE'); window.__ws[0].say('STOP'); });
  await page.waitForFunction(() => window.__ws.length === 2 && window.__ws[1].texts.length > 0, null, { timeout: 10000 });
  expect(calls).toBe(2);
  await page.evaluate(() => window.__live(1));
  await page.waitForFunction(() => document.body.classList.contains('simli-on') && App.simli.active(), null, { timeout: 10000 });
  expect((await page.evaluate(() => App.simli.stats())).reconnects).toBe(1);
  // 3) durata massima breve: poco prima della fine si apre una seconda sessione e si passa a quella senza togliere il video
  maxLen = 8;
  await page.evaluate(() => { window.__ws[1].say('CLOSING REASON: MAX'); window.__ws[1].say('STOP'); });
  await page.waitForFunction(() => window.__ws.length === 3 && window.__ws[2].texts.length > 0, null, { timeout: 10000 });
  await page.evaluate(() => window.__live(2));
  await page.waitForFunction(() => document.body.classList.contains('simli-on'), null, { timeout: 10000 });
  const hand = await page.evaluate(async () => {
    const off = []; const t0 = performance.now();
    while (window.__ws.length < 4 && performance.now() - t0 < 9000) { if (!document.body.classList.contains('simli-on')) off.push('prima'); await new Promise((r) => setTimeout(r, 50)); }
    const four = window.__ws.length === 4; const oldOpen = window.__ws[2].readyState === 1;
    await new Promise((r) => setTimeout(r, 300));
    window.__live(3);
    const t1 = performance.now();
    while (performance.now() - t1 < 800) { if (!document.body.classList.contains('simli-on')) off.push('durante'); await new Promise((r) => setTimeout(r, 25)); }
    return { four, oldOpen, off, oldClosed: window.__ws[2].readyState === 3, s: App.simli.stats(), on: document.body.classList.contains('simli-on'), src: document.getElementById('simli-video').srcObject && document.getElementById('simli-video').srcObject.id };
  });
  expect(hand.four).toBe(true); // la sessione di ricambio è partita mentre la vecchia era ancora aperta
  expect(hand.oldOpen).toBe(true);
  expect(hand.off).toEqual([]); // il volto Simli non è mai sparito
  expect(hand.oldClosed).toBe(true);
  expect(hand.s.handovers).toBe(1);
  expect(hand.on).toBe(true);
  // 4) fine chiamata: niente altri tentativi
  const before = calls;
  await page.evaluate(() => { App.call.active = false; App.simli.stop(); window.__ws[3].say('STOP'); });
  await page.waitForTimeout(2500);
  expect(calls).toBe(before);
  expect(await page.evaluate(() => document.body.classList.contains('simli-on'))).toBe(false);
});

test('v2d-49: Simli giù: tentativi con attese crescenti, al massimo 5, poi resta la foto; 409 (volto non pronto) non si riprova', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WK);
  test.setTimeout(90000);
  await page.addInitScript(FAKES);
  let mode = 502; const at = [];
  await mockApp(page, { simliFace: true, session: (json) => { at.push(Date.now()); return json({ error: 'Simli non raggiungibile', fallback: true }, mode); } });
  await openApp(page);
  await page.evaluate(async () => { App.call.active = true; App.call.mode = 'video'; await App.simli.start(); });
  await expect.poll(() => at.length, { timeout: 45000, intervals: [500] }).toBe(6); // 1 + 5 tentativi
  await page.waitForTimeout(3000);
  expect(at.length).toBe(6);
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1] * 1.4); // attese crescenti
  const st = await page.evaluate(() => ({ on: document.body.classList.contains('simli-on'), canvas: getComputedStyle(document.getElementById('avatar-canvas')).visibility !== 'hidden', s: App.simli.stats() }));
  expect(st.on).toBe(false); expect(st.canvas).toBe(true); expect(st.s.waiting).toBe(false);
  // volto non pronto: errore permanente, un solo tentativo
  mode = 409; const n0 = at.length;
  await page.evaluate(async () => { App.simli.stop(); await App.simli.start(); });
  await page.waitForTimeout(2500);
  expect(at.length).toBe(n0 + 1);
  await page.evaluate(() => { App.call.active = false; App.simli.stop(); });
});

test('v2d-49: audio per Simli: passa-basso prima di 24 kHz -> 16 kHz (niente ripiegamenti), voce intatta, pezzi continui', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', WK);
  await mockApp(page);
  await openApp(page);
  const r = await page.evaluate(() => {
    const P = App.simli._pcm16;
    const sine = (hz, n) => Float32Array.from({ length: n }, (_, k) => 0.5 * Math.sin(2 * Math.PI * hz * k / 24000));
    const rms = (u8) => { const a = new Int16Array(u8.buffer); let s = 0; for (let k = 200; k < a.length - 200; k++) s += (a[k] / 32768) ** 2; return Math.sqrt(s / (a.length - 400)) / (0.5 / Math.SQRT2); };
    const whole = new Int16Array(P(sine(1000, 24000), 24000, false).buffer);
    // a pezzi da 480 campioni (come arrivano dal tempo reale): stessa uscita del blocco intero
    P(new Float32Array(0), 24000, true);
    const parts = []; const x = sine(1000, 24000);
    for (let i = 0; i < x.length; i += 480) parts.push(...new Int16Array(P(x.subarray(i, i + 480), 24000, true).buffer));
    let maxd = 0; for (let i = 0; i < whole.length; i++) maxd = Math.max(maxd, Math.abs(whole[i] - parts[i]));
    return { v1k: rms(P(sine(1000, 24000), 24000, false)), v300: rms(P(sine(300, 24000), 24000, false)), a10k: rms(P(sine(10000, 24000), 24000, false)), a11k: rms(P(sine(11000, 24000), 24000, false)), len: whole.length, maxd };
  });
  expect(r.len).toBe(16000);
  expect(r.v300).toBeGreaterThan(0.95);
  expect(r.v1k).toBeGreaterThan(0.95);
  expect(r.a10k).toBeLessThan(0.05); // prima, senza filtro, un 10 kHz tornava come un 6 kHz quasi pieno
  expect(r.a11k).toBeLessThan(0.05);
  expect(r.maxd).toBeLessThanOrEqual(2);
});
