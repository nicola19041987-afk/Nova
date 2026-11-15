// v2d-46 (Nicola, 15/11): menu vero (Chat · Chiamate · Impostazioni, niente Galleria), foto scelta SEMPRE come volto,
// bocca guidata dall'audio davvero suonato (tempo reale), appunti/richieste salvati solo per Nico (regola nel codice).
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
const CANOTTA = 'e44c0a7a00000001.jpg';
const SHOTS = process.env.V2D46_SHOTS || '';
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46-landmarks.json'), 'utf8'));
const JPG = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46.jpg'));
const TAVOLA = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-bionda.jpg'));

function startMockAI(seen) {
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Un secondo Luisa, devo chiederlo a Nico' } }] }));
      res.end('{}');
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
function startServer(dir, aiPort, extra = {}) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-v2d46', NOVA_E2E: '' };
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
async function login(request, base, user, pin) {
  const setup = await request.post(base + '/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (setup.status() === 409) { const l = await request.post(base + '/api/login', { data: { user, pin }, headers: HEAD }); expect(l.ok(), await l.text()).toBeTruthy(); }
  else expect(setup.ok(), await setup.text()).toBeTruthy();
}
// personaggio come sul server: foto scelta + scena «a tavola» salvata sul telefono (prima copriva la foto)
function alpha() {
  return {
    id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '/api/avatars/' + FOTO, avatarSource: 'upload', landmarks: { ...LM, src: '/api/avatars/' + FOTO },
    outfits: [{ key: 'nova_tavola', style: 'scena', label: 'A tavola in sala la sera, con un bicchiere di rosso: top nero', avatar: '/api/avatars/a1102c499e5beaba.jpg' }],
    motionClips: [{ id: 'x1', url: '/api/motion/aaaaaaaaaaaaaaaa.mp4', kind: 'base', from: 'petto', to: 'petto', outfit: 'nova_tavola' }, { id: 'x2', url: '/api/motion/bbbbbbbbbbbbbbbb.mp4', kind: 'base', from: 'petto', to: 'petto' }],
    motionVideo: '/api/motion/cccccccccccccccc.mp4', personality: '', style: '', requests: '', voice: 'eve', messages: 3,
  };
}
async function mockApp(page, seen = []) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    try { localStorage.setItem('nova:outfit:5ce17a0000000001', JSON.stringify({ scene: 'nova_tavola', seen: Date.now(), visitAt: Date.now() })); } catch { /* */ }
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname; seen.push(p);
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/avatars/' + FOTO) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
    if (p.startsWith('/api/avatars/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: TAVOLA });
    if (p.startsWith('/api/motion/')) return route.fulfill({ status: 404, body: '' });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true, simliFace: false });
    if (p === '/api/characters') return json([alpha()]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/calls') return json({ calls: [] });
    if (p === '/api/realtime/session') return json({ url: 'wss://example.test/realtime', token: 't', session: { instructions: 'ciao', voice: 'eve' }, adult: false });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: true, chat: false, users: [], missing: [] });
    if (p === '/api/gallery') return json({ items: [], trash: [], trashDays: 30 });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory' || p === '/api/gestures') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    return json({});
  });
}
async function openHome(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.current, null, { timeout: 30000 });
  await page.evaluate(() => App.solo.showHome());
  await page.waitForTimeout(600);
}
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; }, sel);

test('v2d-46: cache del service worker e HTML: barra Chat · Chiamate · Impostazioni, niente Galleria nel menu', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-4[6-9]'/);
  const html = await (await request.get('/')).text();
  expect(html).not.toContain('id="dock-gallery"');
  expect(html).not.toMatch(/<span>Galleria<\/span><em>/);
  const dock = html.slice(html.indexOf('id="solo-dock"'), html.indexOf('</nav>', html.indexOf('id="solo-dock"')));
  expect(dock.match(/data-dock="[a-z]+"/g)).toEqual(['data-dock="chat"', 'data-dock="calls"', 'data-dock="home"']);
  expect(dock).toContain('<span>Chat</span>'); expect(dock).toContain('<span>Chiamate</span>'); expect(dock).toContain('<span>Impostazioni</span>');
  for (const k of ['carattere', 'look', 'richieste', 'gesti', 'video', 'voce']) expect(html).toContain(`data-nh-open="${k}"`);
  expect(html).toContain('id="dock-settings"');
});

test('v2d-46: Home = foto scelta nel cerchio (mai la scena «a tavola»), elenco vero, barra in basso; Chiamate e Chat dalla barra', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE headless del box) chiude il processo appena l\u2019app è avviata, già sulla v2d-45 senza modifiche: verificato su Chromium; iPhone vero da provare.');
  test.setTimeout(60000);
  const seen = [];
  await mockApp(page, seen);
  await openHome(page);
  const face = await page.evaluate(() => ({ src: App.faceSrc(App.current), key: App.outfits.key(App.current), locked: App.faceLocked(), header: (document.querySelector('#wa-photo img') || {}).dataset?.src || '', home: (document.querySelector('#nh-avatar img') || {}).dataset?.src || '' }));
  expect(face.locked).toBe(true);
  expect(face.src).toBe('/api/avatars/' + FOTO);
  expect(face.key).toBe('');
  expect(face.home).toBe('/api/avatars/' + FOTO);
  expect(await page.locator('#nh-look').isHidden()).toBe(true); // niente «A tavola in sala la sera…»
  const circle = await page.evaluate(() => { const e = document.querySelector('#nh-photo .nh-avatar'); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, br: getComputedStyle(e).borderTopLeftRadius }; });
  expect(Math.round(circle.w)).toBe(Math.round(circle.h));
  expect(circle.br).toBe('50%');
  expect(await vis(page, '#solo-dock')).toBe(true);
  expect(await page.locator('#nh-list [data-dock="images"]').count()).toBe(0);
  for (const s of ['[data-nh-open="carattere"]', '[data-nh-open="look"]', '[data-nh-open="richieste"]', '[data-nh-open="gesti"]', '[data-nh-open="video"]', '[data-nh-open="voce"]', '#dock-settings']) await expect(page.locator('#nh-list ' + s)).toHaveCount(1);
  expect(seen.some((p) => p.startsWith('/api/motion/'))).toBe(false); // nessun clip di altre foto
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `01-home-${browserName}-390x844.png`) });
  await page.locator('#dock-calls').click();
  await expect(page.locator('#tab-calls')).toBeVisible();
  await expect(page.locator('#calls-video')).toBeVisible();
  await expect(page.locator('#calls-voice')).toBeVisible();
  expect(await vis(page, '#solo-dock')).toBe(true);
  await expect(page.locator('#dock-calls')).toHaveClass(/active/);
  expect(await vis(page, '#layer-x')).toBe(false); // «Chiamate» è una scheda, non un foglio da chiudere
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `02-chiamate-${browserName}-390x844.png`) });
  await page.locator('#dock-chat').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#chat-form')).toBeVisible();
  expect(await vis(page, '#solo-dock')).toBe(false); // dentro la conversazione la barra non c'è (come WhatsApp)
  expect(await page.evaluate(() => document.body.classList.contains('wa-conv'))).toBe(true); // testata con foto e «online» anche dopo «Chiamate»
  expect(await vis(page, '#wa-photo')).toBe(true);
  const hdr = await page.evaluate(() => App.faceSrc(App.current));
  expect(hdr).toBe('/api/avatars/' + FOTO);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `03-chat-${browserName}-390x844.png`) });
  await page.evaluate(() => App.solo.showHome());
  await page.locator('#dock-settings').scrollIntoViewIfNeeded();
  await page.locator('#dock-settings').click();
  await expect(page.locator('#tab-account')).toBeVisible();
  await expect(page.locator('#dock-home')).toHaveClass(/active/);
  // una richiesta di vestiti in chat non cambia più la foto
  const heard = await page.evaluate(() => App.outfits.hear(App.current, 'mettiti la felpa'));
  expect(heard).toBeNull();
  expect(await page.evaluate(() => App.faceSrc(App.current))).toBe('/api/avatars/' + FOTO);
});

// voce sintetica: 3 «sillabe» (vocale con armoniche) e pause vere; PCM16 24 kHz come la Voice Agent API
function synthPcm() {
  const R = 24000, parts = [[0.35, 0], [0.42, 1], [0.28, 0], [0.38, 1], [0.5, 0], [0.30, 1], [0.6, 0]];
  const total = parts.reduce((a, p) => a + Math.round(p[0] * R), 0); const pcm = new Int16Array(total); let i = 0;
  const seg = [];
  for (const [d, on] of parts) {
    const n = Math.round(d * R); seg.push({ t0: i / R, t1: (i + n) / R, on });
    for (let k = 0; k < n; k++, i++) {
      if (!on) continue; const t = k / R, env = Math.sin(Math.PI * k / n) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 6 * t));
      pcm[i] = Math.round(9000 * env * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t)) / 1.75);
    }
  }
  const env = []; for (let j = 0; j < total; j += 240) { let e = 0; const m = Math.min(total, j + 240); for (let k = j; k < m; k++) e += (pcm[k] / 32768) ** 2; env.push(Math.sqrt(e / (m - j))); }
  const mx = Math.max(...env); for (let j = 0; j < env.length; j++) env[j] /= mx;
  return { b64: Buffer.from(pcm.buffer).toString('base64'), seg, dur: total / R, env };
}

test('v2d-46: tempo reale, la bocca segue l\'audio SUONATO (non quello ricevuto): chiusa nelle pause e nel silenzio', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE headless del box) chiude il processo appena l\u2019app è avviata, già sulla v2d-45 senza modifiche: verificato su Chromium; iPhone vero da provare.');
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.__sent = [];
    function WS() { this.readyState = 0; this.protocol = 'xai-client-secret.t'; this.binaryType = ''; window.__ws = this; }
    WS.prototype.send = function (d) { window.__sent.push(String(d)); };
    WS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); };
    window.WebSocket = WS;
    // microfono finto (silenzio) uguale su Chromium e WebKit: la prova riguarda la voce di lei, non la cattura
    const fakeMic = async () => { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(), g = c.createGain(); g.gain.value = 0; const d = c.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start(); return d.stream; };
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = fakeMic; else Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fakeMic, enumerateDevices: async () => [] } });
  });
  await mockApp(page);
  await openHome(page);
  const { b64, seg, dur, env } = synthPcm();
  const envAt = (t) => (t < 0 || t >= dur ? 0 : env[Math.min(env.length - 1, Math.floor(t * 100))]);
  const r = await page.evaluate(async ({ b64, seg, dur }) => {
    App.audio.unlock && App.audio.unlock();
    const c = App.audio.ctx || (App.audio.ensure && App.audio.ensure());
    if (c && c.state === 'suspended') await c.resume().catch(() => {});
    const ch = App.current;
    App.solo.openPortrait && App.solo.openPortrait();
    const pending = App.rt.start(ch, 'voice', '');
    const t0w = Date.now();
    while (!window.__ws || !window.__ws.onopen) { if (Date.now() - t0w > 8000) throw new Error('socket assente'); await new Promise((ok) => setTimeout(ok, 20)); }
    const ws = window.__ws; ws.readyState = 1; ws.onopen();
    const feed = (ev) => ws.onmessage({ data: JSON.stringify(ev) });
    feed({ type: 'session.created' }); feed({ type: 'session.updated' });
    let startErr = ''; await pending.catch((e) => { startErr = String(e && e.message || e); });
    if (!App.rt._s()) throw new Error('tempo reale non partito: ' + startErr);
    const A = App.avatarConv;
    const samples = []; let start = null;
    // HUD: verde = voce che si sente adesso (dall'audio suonato), rosa = apertura della bocca disegnata
    const hud = document.createElement('div'); hud.style.cssText = 'position:fixed;left:12px;right:12px;bottom:20px;z-index:99999;font:600 13px -apple-system,sans-serif;color:#fff;background:#000a;border-radius:12px;padding:8px';
    hud.innerHTML = '<div>voce suonata <i id="h1" style="display:inline-block;height:10px;background:#3c3;width:0"></i></div><div>bocca <i id="h2" style="display:inline-block;height:10px;background:#f6a;width:0"></i></div>';
    document.body.appendChild(hud);
    feed({ type: 'response.created', response: { id: 'r1' } });
    // l'audio arriva TUTTO in anticipo (come dal servizio, più veloce del tempo reale): la bocca deve seguire la riproduzione
    const B = atob(b64); const CH = 4800 * 2;
    for (let i = 0; i < B.length; i += CH) feed({ type: 'response.output_audio.delta', response_id: 'r1', delta: btoa(B.slice(i, i + CH)) });
    const S = App.rt._s(); start = S.env && S.env.length ? S.env[0].t0 : null;
    const lat = (c.outputLatency || 0) + (c.baseLatency || 0);
    await new Promise((done) => {
      const tick = () => {
        const h = App.rt.heard(); const t = h - start; const on = seg.find((g) => t >= g.t0 && t < g.t1);
        samples.push({ t, truth: on ? on.on : 0, level: App.rt.level(), mouth: A ? A.mouth : 0 });
        document.getElementById('h1').style.width = (App.rt.level() * 200) + 'px'; document.getElementById('h2').style.width = ((A ? A.mouth : 0) * 200) + 'px';
        if (t > dur + 0.6) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    feed({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    await new Promise((ok) => setTimeout(ok, 400));
    const after = A ? A.mouth : 0;
    return { samples, lat, after, rate: c.sampleRate, st: c.state };
  }, { b64, seg, dur });
  // bocca: chiusa nel silenzio/pausa (oltre 120 ms dal bordo), aperta nel parlato; ritardo stimato tra voce e bocca
  const inside = (s, on) => seg.some((g) => g.on === on && s.t > g.t0 + 0.12 && s.t < g.t1 - 0.12);
  const talk = r.samples.filter((s) => inside(s, 1)), quiet = r.samples.filter((s) => inside(s, 0) || s.t < -0.1 || s.t > seg[seg.length - 1].t1 + 0.2);
  const mean = (a, f) => a.reduce((x, s) => x + f(s), 0) / Math.max(1, a.length);
  const out = { talkMouth: mean(talk, (s) => s.mouth), quietMouth: mean(quiet, (s) => s.mouth), quietMax: Math.max(0, ...quiet.map((s) => s.mouth)), n: r.samples.length, lat: r.lat, after: r.after, ctx: r.st };
  // ritardo: spostamento (0..200 ms) che massimizza la correlazione tra «voce» (truth) e bocca
  let best = { lag: 0, c: -1 };
  for (let lag = -0.1; lag <= 0.2001; lag += 0.01) {
    const pairs = r.samples.map((s) => [envAt(s.t - lag), s.mouth]); // voce vera (inviluppo del PCM, 10 ms) contro bocca
    const ma = mean(pairs, (p) => p[0]), mb = mean(pairs, (p) => p[1]);
    let sab = 0, saa = 0, sbb = 0; for (const [a, b] of pairs) { sab += (a - ma) * (b - mb); saa += (a - ma) ** 2; sbb += (b - mb) ** 2; }
    const cc = sab / Math.sqrt(saa * sbb || 1); if (cc > best.c) best = { lag: Math.round(lag * 1000), c: cc };
  }
  out.lagMs = best.lag; out.corr = Number(best.c.toFixed(3));
  console.log(`[${browserName}] labiale`, JSON.stringify(out));
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, `labiale-${browserName}.json`), JSON.stringify({ ...out, samples: r.samples }, null, 1));
  expect(out.n).toBeGreaterThan(60);
  expect(out.talkMouth).toBeGreaterThan(0.2);
  expect(out.quietMouth).toBeLessThan(0.03);
  expect(out.corr).toBeGreaterThan(0.75);
  expect(out.lagMs).toBeLessThanOrEqual(90);
  expect(out.after).toBeLessThan(0.02);
});

test('v2d-46: appunti, ricordi e richieste si salvano SOLO per Nico; per Luisa «Un secondo Luisa, devo chiederlo a Nico»', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium');
  test.setTimeout(60000);
  const seen = []; const ai = await startMockAI(seen);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-v2d46-notes-'));
  const s = startServer(dir, ai.address().port, { NOVA_E2E: '1' });
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await login(request, base, 'luisa', '2468');
    const chars = await (await request.get(base + '/api/characters')).json();
    const id = chars.find((c) => !c.archived).id;
    const turn = async (text) => (await request.post(`${base}/api/chats/${id}/voice-turn`, { data: { role: 'user', text, callMode: 'voice' }, headers: HEAD })).json();
    expect((await turn('segna che il frigo fa rumore')).intent).toBe('chiedi-nico');
    expect((await turn('ricordati che domani ho il dentista')).intent).toBe('chiedi-nico');
    expect((await turn('sistema il tasto del microfono')).intent).toBe('chiedi-nico');
    expect((await turn('ho pensato a un orto sul balcone')).intent).toBeUndefined();
    let notes = await (await request.get(base + '/api/blocco-note')).json();
    expect(notes.count).toBe(0);
    const mem = await (await request.get(base + '/api/memory')).json();
    expect(JSON.stringify(mem)).not.toContain('dentista');
    expect(fs.existsSync(path.join(dir, 'richieste-app.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'richieste-app.json'), 'utf8')).length : 0).toBe(0);
    // chat scritta: l'istruzione al modello dice di rispondere «Un secondo Luisa, devo chiederlo a Nico»
    const r = await request.post(`${base}/api/chats/${id}`, { data: { message: 'segnalo: comprare il vino' }, headers: { ...HEAD, 'X-AI-Key': 'xai-test' } });
    const call = seen.filter((x) => x.url.endsWith('/chat/completions')).pop();
    expect(call, await r.text()).toBeTruthy();
    const sys = JSON.parse(call.body).messages[0].content;
    expect(sys).toContain('Un secondo Luisa, devo chiederlo a Nico');
    expect(sys).toContain('NON l\'hai salvato');
    notes = await (await request.get(base + '/api/blocco-note')).json();
    expect(notes.count).toBe(0);
    // Nico: tutto come prima
    await request.post(base + '/api/logout', { headers: HEAD });
    await login(request, base, 'nicola', '1357');
    expect((await turn('segna che il frigo fa rumore')).intent).toBe('nota');
    notes = await (await request.get(base + '/api/blocco-note')).json();
    expect(notes.count).toBe(1);
    expect(notes.notes[0].from).toBe('Nicola');
  } finally { s.child.kill(); ai.close(); }
});

test('v2d-46: migrazione una tantum canotta → foto mandata da Nicola (storico, file vecchio intatto, punti del viso pronti); non si ripete', async ({ playwright, browserName }) => {
  test.skip(browserName === 'webkit', 'solo server');
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d46-foto-'));
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'ready', 'eris-canotta.jpg'), path.join(dir, 'shared', 'avatars', CANOTTA));
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({ eris_canotta_v2d44: { at: 'x', to: '/api/avatars/' + CANOTTA } }));
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{
    id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '/api/avatars/' + CANOTTA, avatarSource: 'upload', landmarks: { src: '/api/avatars/' + CANOTTA },
    appearance: {}, look: {}, wardrobe: [], personality: '', style: '', orders: '', requests: 'solo Nico', voice: 'eve', lookHistory: [], outfits: [{ key: 'nova_tavola', style: 'scena', label: 'a tavola', avatar: '/api/avatars/a1102c499e5beaba.jpg' }],
  }]));
  const ai = await startMockAI([]);
  let s = startServer(dir, ai.address().port);
  const ctxs = [];
  try {
    await waitUp(s);
    expect(s.log()).toContain('Foto principale di Alpha (v2d-46)');
    const base = `http://127.0.0.1:${s.port}`;
    const api = await playwright.request.newContext(); ctxs.push(api);
    await login(api, base, 'nicola', '1357');
    const live = (await (await api.get(base + '/api/characters')).json()).find((c) => c.id === CH);
    expect(live.avatar).toBe('/api/avatars/' + FOTO);
    expect(live.landmarks.eyeL && live.landmarks.mouth && live.landmarks.src).toBeTruthy();
    expect(live.landmarks.src).toBe('/api/avatars/' + FOTO);
    expect(live.requests).toBe('solo Nico'); // testo del personaggio intatto
    expect(live.outfits.length).toBe(1); // look salvati intatti
    const img = await api.get(base + '/api/avatars/' + FOTO);
    expect(img.ok()).toBeTruthy();
    expect(Buffer.compare(await img.body(), JPG)).toBe(0); // esattamente la foto mandata
    expect(fs.existsSync(path.join(dir, 'shared', 'avatars', CANOTTA))).toBe(true);
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8')).find((c) => c.id === CH);
    expect(disk.lookHistory[0].avatar).toBe('/api/avatars/' + CANOTTA);
    const keys = await (await api.get(base + '/api/keys/status')).json();
    expect(keys.xai.configured).toBe(true);
    expect(keys.xai.env).toBe('XAI_API_KEY');
    expect(JSON.stringify(keys)).not.toContain('test-key-v2d46');
    const sim = await api.post(base + '/api/simli/session', { headers: HEAD, data: {} });
    expect(sim.status()).toBe(503); // senza chiave Simli: foto con la bocca sull'audio
    s.child.kill();
    s = startServer(dir, ai.address().port);
    await waitUp(s);
    expect(s.log()).not.toContain('Foto principale di Alpha (v2d-46)');
  } finally {
    for (const c of ctxs) await c.dispose().catch(() => {});
    s.child.kill(); ai.close();
  }
});

test('v2d-46: Simli parte solo col volto creato dalla foto di Alpha (mai il volto di serie)', async ({ playwright, browserName }) => {
  test.skip(browserName === 'webkit', 'solo server');
  test.setTimeout(60000);
  const hits = [];
  const sim = http.createServer((req, res) => {
    const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => {
      hits.push({ url: req.url, key: req.headers['x-simli-api-key'], len: Buffer.concat(b).length });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/faces/trinity/preprocess')) { res.setHeader('Content-Type', 'image/png'); res.setHeader('TARGET-RATIO', '0'); res.setHeader('warnings', '[]'); return res.end(Buffer.alloc(2000, 7)); }
      if (req.url.startsWith('/faces/trinity?')) return res.end(JSON.stringify({ message: 'in coda', face_id: '11111111-2222-3333-4444-555555555555', warnings: [] }));
      if (req.url.startsWith('/faces/trinity/generation_status')) return res.end(JSON.stringify({ status: hits.filter((h) => h.url.includes('generation_status')).length > 1 ? 'completed' : 'processing', face_id: '11111111-2222-3333-4444-555555555555' }));
      if (req.url.startsWith('/compose/token')) return res.end(JSON.stringify({ session_token: 'tok' }));
      if (req.url.startsWith('/compose/ice')) return res.end('[]');
      res.end('{}');
    });
  });
  await new Promise((ok) => sim.listen(0, '127.0.0.1', ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d46-simli-'));
  const ai = await startMockAI([]);
  // il server usa api.simli.ai: qui lo si punta al finto servizio tramite SIMLI_API_BASE (solo prove)
  const s = startServer(dir, ai.address().port, { SIMLI_TEST_BASE: `http://127.0.0.1:${sim.address().port}` });
  const ctxs = [];
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    const api = await playwright.request.newContext(); ctxs.push(api);
    await login(api, base, 'nicola', '1357');
    expect((await api.post(base + '/api/simli/key', { headers: HEAD, data: { key: 'simli-prova-segreta' } })).ok()).toBeTruthy();
    expect((await (await api.get(base + '/api/me')).json()).simliFace).toBe(false);
    expect((await api.post(base + '/api/simli/session', { headers: HEAD, data: {} })).status()).toBe(409);
    const mk = await api.post(base + '/api/simli/face', { headers: HEAD, data: { wait: true } });
    const mkTxt = await mk.text();
    expect(mk.ok(), mkTxt).toBeTruthy();
    expect(mkTxt).not.toContain('simli-prova-segreta');
    const up = hits.find((h) => h.url.startsWith('/faces/trinity?'));
    expect(up.key).toBe('simli-prova-segreta'); expect(up.len).toBeGreaterThan(1000);
    expect((await (await api.get(base + '/api/simli/face')).json()).face.ready).toBe(false);
    expect((await (await api.get(base + '/api/simli/face')).json()).face.ready).toBe(true);
    expect((await (await api.get(base + '/api/me')).json()).simliFace).toBe(true);
    const ok = await api.post(base + '/api/simli/session', { headers: HEAD, data: {} });
    expect(ok.ok()).toBeTruthy();
  } finally { for (const c of ctxs) await c.dispose().catch(() => {}); s.child.kill(); ai.close(); sim.close(); }
});

// v2d-47: volto Simli come da documentazione (preprocess -> target-ratio -> create), errori di Simli registrati senza chiave,
// stessa foto col fondo allungato provata per prima, 403 = piano esaurito: ci si ferma (niente acquisti).
async function simliSetup(playwright, handler) {
  const hits = [];
  const sim = http.createServer((req, res) => {
    const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => { const h = { url: req.url, key: req.headers['x-simli-api-key'], ratio: req.headers['target-ratio'], len: Buffer.concat(b).length, body: Buffer.concat(b) }; hits.push(h); handler(h, res, hits); });
  });
  await new Promise((ok) => sim.listen(0, '127.0.0.1', ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d47-simli-'));
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'ready', 'eris-canotta.jpg'), path.join(dir, 'shared', 'avatars', CANOTTA));
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({ eris_canotta_v2d44: { at: 'x', to: '/api/avatars/' + CANOTTA } }));
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{ id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '/api/avatars/' + CANOTTA, avatarSource: 'upload', appearance: {}, look: {}, wardrobe: [], lookHistory: [], voice: 'eve' }]));
  const ai = await startMockAI([]);
  const s = startServer(dir, ai.address().port, { SIMLI_TEST_BASE: `http://127.0.0.1:${sim.address().port}` });
  await waitUp(s);
  const base = `http://127.0.0.1:${s.port}`;
  const api = await playwright.request.newContext();
  await login(api, base, 'nicola', '1357');
  expect((await api.post(base + '/api/simli/key', { headers: HEAD, data: { key: 'simli-prova-segreta-47' } })).ok()).toBeTruthy();
  return { hits, sim, s, ai, api, base, close: async () => { await api.dispose().catch(() => {}); s.child.kill(); ai.close(); sim.close(); } };
}
const EXT = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46-simli.jpg'));

test('v2d-47: volto Simli = preprocess + target-ratio + create; errore di Simli registrato senza chiave; foto col fondo allungato prima, poi la foto com\'è', async ({ playwright, browserName }) => {
  test.skip(browserName === 'webkit', 'solo server');
  test.setTimeout(60000);
  let pre = 0;
  const t = await simliSetup(playwright, (h, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (h.url.startsWith('/faces/trinity/preprocess')) {
      pre++;
      if (pre === 1) { res.statusCode = 400; return res.end(JSON.stringify({ detail: 'Could not frame waist-up (x-simli-api-key: simli-prova-segreta-47)' })); }
      res.setHeader('Content-Type', 'image/png'); res.setHeader('TARGET-RATIO', '0'); res.setHeader('warnings', '["torso partly cropped"]'); return res.end(Buffer.alloc(3000, 9));
    }
    if (h.url.startsWith('/faces/trinity?')) return res.end(JSON.stringify({ message: 'in coda', face_id: '22222222-3333-4444-5555-666666666666', dispatch_after: 1792412345, warnings: [] }));
    if (h.url.startsWith('/faces/trinity/generation_status')) return res.end(JSON.stringify({ status: 'pending', queue_position: 1, generations: [] }));
    res.end('{}');
  });
  try {
    const live = (await (await t.api.get(t.base + '/api/characters')).json()).find((c) => c.id === CH);
    expect(live.avatar).toBe('/api/avatars/' + FOTO);
    const mk = await t.api.post(t.base + '/api/simli/face', { headers: HEAD, data: { wait: true } });
    const txt = await mk.text();
    expect(mk.ok(), txt).toBeTruthy();
    expect(txt).not.toContain('simli-prova-segreta-47');
    const pres = t.hits.filter((h) => h.url.startsWith('/faces/trinity/preprocess'));
    expect(pres.length).toBe(2);
    expect(pres.every((h) => h.key === 'simli-prova-segreta-47')).toBe(true);
    expect(pres[0].body.includes(EXT.subarray(2000, 2400))).toBe(true); // prima la stessa foto col fondo allungato
    expect(pres[1].body.includes(JPG.subarray(2000, 2400))).toBe(true); // poi la foto com'è
    const cr = t.hits.filter((h) => h.url.startsWith('/faces/trinity?'));
    expect(cr.length).toBe(1);
    expect(cr[0].url).toContain('face_name=alpha-v2d47');
    expect(cr[0].ratio).toBe('0'); // TARGET-RATIO del preprocess passato così com'è
    expect(cr[0].body.includes(Buffer.alloc(3000, 9).subarray(0, 2500))).toBe(true); // il PNG riquadrato da Simli
    const st = JSON.parse(txt);
    expect(st.face.status).toBe('pending'); expect(st.face.input).toBe('foto-originale'); expect(st.face.mode).toBe('preprocess');
    expect(st.face.warnings).toContain('torso partly cropped');
    expect(st.job.state).toBe('created');
    const err = st.job.attempts.find((a) => a.http === 400);
    expect(err.input).toBe('foto-con-fondo-allungato'); expect(err.step).toBe('preprocess');
    expect(err.detail).toContain('Could not frame waist-up'); expect(err.detail).toContain('[chiave]');
    expect(t.s.log()).toContain('Could not frame waist-up');
    expect(t.s.log()).not.toContain('simli-prova-segreta-47');
    // già in creazione: un secondo tocco non ne crea un altro
    const again = await (await t.api.post(t.base + '/api/simli/face', { headers: HEAD, data: { wait: true } })).json();
    expect(again.already).toBe(true);
    expect(t.hits.filter((h) => h.url.startsWith('/faces/trinity?')).length).toBe(1);
  } finally { await t.close(); }
});

test('v2d-47: piano Simli esaurito (403): ci si ferma subito, stato «no-credits», nessun altro tentativo né acquisto', async ({ playwright, browserName }) => {
  test.skip(browserName === 'webkit', 'solo server');
  test.setTimeout(60000);
  const t = await simliSetup(playwright, (h, res) => { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end('{"detail":"no generations left"}'); });
  try {
    const st = await (await t.api.post(t.base + '/api/simli/face', { headers: HEAD, data: { wait: true } })).json();
    expect(st.job.state).toBe('no-credits');
    expect(st.face).toBe(null);
    expect(t.hits.length).toBe(1);
    // senza attesa: risponde subito 202 e lavora in background
    const bg = await t.api.post(t.base + '/api/simli/face', { headers: HEAD, data: {} });
    expect(bg.status()).toBe(202);
  } finally { await t.close(); }
});
