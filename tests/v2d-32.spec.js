const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-32: «Nn si muove anteprima» (iPhone). Safari non fa partire un video muto senza tocco quando il telefono è in
// Risparmio energetico, né un video nascosto (display:none); il primo clip partiva dopo attese asincrone (fuori dal
// tocco) su un video ancora nascosto, e la foto restava ferma. Qui si simula quella regola in Chromium.
const FACE = '/api/avatars/b10b1a0000000001.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda-landmarks.json'), 'utf8'));
const DIR = process.env.NOVA_CLIPS || '/tmp/v30clips'; // clip privati: solo in locale, non nel repo
const FILES = { 'e000000000000001': 'base-petto-e-vivace-2s.mp4', 'd000000000000002': 'base-petto-d-calma-2s.mp4', 'a000000000000003': 'old-nova-ascolta-v2-2s.mp4' };
const OUT = process.env.NOVA_EVIDENCE || '/opt/cursor/artifacts';
const url = (k) => `/api/motion/${k}.mp4`;
const CLIPS = [
  { id: 'e1', url: url('e000000000000001'), kind: 'base', from: 'petto', to: 'petto', mood: ['vivace', 'allegra'] },
  { id: 'd1', url: url('d000000000000002'), kind: 'base', from: 'petto', to: 'petto', mood: ['calma'] },
  { id: 'starnuto', url: url('a000000000000003'), kind: 'event', event: 'starnuto', from: 'petto', to: 'petto' },
];

async function mock(page, policy) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  // Regola di Safari su iPhone (simulata): senza un tocco, play() di un video muto è rifiutato se il telefono è in
  // Risparmio energetico o se il video non è visibile. Un play() chiamato durante un tocco sblocca quel video per sempre.
  await page.addInitScript((pol) => {
    window.__pol = pol;
    for (const ev of ['touchstart', 'touchend', 'click']) window.addEventListener(ev, (e) => { if (!e.isTrusted) return; window.__inTouch = true; setTimeout(() => { window.__inTouch = false; }, 0); }, true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const touch = !!window.__inTouch; // solo tocchi veri (page.evaluate di Playwright conta come gesto: non vale)
      if (touch) this.__ok = true;
      const hidden = !this.isConnected || getComputedStyle(this).display === 'none';
      if (window.__pol.stallId && this.id === window.__pol.stallId && (this.__stalls = (this.__stalls || 0) + 1) <= (window.__pol.stallN || 2)) return Promise.resolve(); // «parte» ma resta fermo
      if (!this.__ok && (window.__pol.lowPower || hidden)) { window.__rejected = (window.__rejected || 0) + 1; return Promise.reject(new DOMException('Safari: serve un tocco', 'NotAllowedError')); }
      return play.call(this);
    };
    if (pol.blobFail) { const c = URL.createObjectURL; URL.createObjectURL = function (b) { const u = c.call(URL, b); if (b && /video/.test(b.type || '')) URL.revokeObjectURL(u); return u; }; }
  }, policy);
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    const m = /^\/api\/motion\/([a-f0-9]{16})\.mp4$/.exec(p);
    if (m && FILES[m[1]]) return route.fulfill({ status: 200, contentType: 'video/mp4', path: path.join(DIR, FILES[m[1]]) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Nova', ready: 'nova-bionda', avatar: FACE, motionClips: CLIPS, personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
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
// il video davanti avanza davvero per ~2 s (niente fermo immagine)
async function moving(page, sel) {
  return page.evaluate(async (sel) => {
    const pick = () => (sel ? document.querySelector(sel) : (App.motionPlayer && App.motionPlayer.els[App.motionPlayer.cur]));
    let played = 0, last = pick(), lt = last ? last.currentTime : 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const v = pick(); if (!v) continue;
      if (v === last && v.currentTime > lt) played += v.currentTime - lt;
      last = v; lt = v.currentTime;
    }
    const b = pick();
    return { played: +played.toFixed(2), advanced: played > 1, visible: !!(b && Number(getComputedStyle(b).opacity) > 0.9 && getComputedStyle(b).display !== 'none'), paused: b ? b.paused : null };
  }, sel);
}
const have = () => Object.values(FILES).every((f) => fs.existsSync(path.join(DIR, f)));
test.use({ hasTouch: true });

test('iPhone in Risparmio energetico: aprendo la foto con un tocco Nova si muove', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  const dir = path.join(OUT, 'v2d-32-' + testInfo.project.name); fs.mkdirSync(dir, { recursive: true });
  await mock(page, { lowPower: true });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').tap();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 15000 });
  const m = await moving(page);
  expect(m.advanced, JSON.stringify(m)).toBe(true);
  expect(m.visible).toBe(true);
  await page.locator('#stage').screenshot({ path: path.join(dir, 'ritratto-risparmio.png') });
});

test('iPhone: il primo clip parte anche se Safari rifiuta i video nascosti', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  await mock(page, { lowPower: false });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.waitForTimeout(2500); // l'avvio finisce di sistemare la chat
  await page.evaluate(() => App.solo.openPortrait()); // senza tocco: come all'avvio o dopo una chiamata
  expect(await page.evaluate(() => document.body.classList.contains('solo-portrait'))).toBe(true);
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 15000 });
  const m = await moving(page);
  expect(m.advanced, JSON.stringify(m)).toBe(true);
  // prima del primo clip i video non coprono la foto con il nero
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('avatar-canvas')).visibility)).toBe('hidden');
});

test('se il telefono non legge i clip dalla memoria locale (blob) usa l\'indirizzo del server e si muove', async ({ page }) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  await mock(page, { blobFail: true });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').tap();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 20000 });
  const m = await moving(page);
  expect(m.advanced, JSON.stringify(m)).toBe(true);
  expect(await page.evaluate(() => window.MotionGraph.srcState.net)).toBe(true);
  expect(await page.evaluate(() => App.motionPlayer.els[App.motionPlayer.cur].currentSrc)).toMatch(/\/api\/motion\/[a-f0-9]{16}\.mp4$/);
});

test('anteprima: la foto piccola in chat e in Home si muove, nel ritratto lascia il posto al video grande', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  const dir = path.join(OUT, 'v2d-32-' + testInfo.project.name); fs.mkdirSync(dir, { recursive: true });
  await mock(page, { lowPower: true });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && document.querySelector('#wa-photo video.mini-motion'));
  // Risparmio energetico: ferma finché non si tocca lo schermo (si vede la foto), poi parte
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => document.querySelector('#wa-photo video.mini-motion').paused)).toBe(true);
  await page.locator('#messages').tap({ position: { x: 100, y: 100 } });
  await page.waitForFunction(() => { const v = document.querySelector('#wa-photo video.mini-motion'); return v && !v.paused && v.classList.contains('on'); }, null, { timeout: 8000 });
  const h = await moving(page, '#wa-photo video.mini-motion');
  expect(h.advanced, JSON.stringify(h)).toBe(true);
  expect(h.visible).toBe(true);
  await page.locator('#wa-photo').screenshot({ path: path.join(dir, 'anteprima-chat.png') });
  await page.screenshot({ path: path.join(dir, 'chat.png') });
  await page.locator('#wa-home').tap();
  await page.waitForFunction(() => { const v = document.querySelector('#nh-avatar video.mini-motion'); return v && !v.paused && v.classList.contains('on'); }, null, { timeout: 8000 });
  const n = await moving(page, '#nh-avatar video.mini-motion');
  expect(n.advanced, JSON.stringify(n)).toBe(true);
  await page.screenshot({ path: path.join(dir, 'home.png') });
  // la foto piccola apre ancora il ritratto; lì c'è solo il video grande
  await page.locator('#nh-photo').tap();
  await page.waitForFunction(() => document.body.classList.contains('solo-portrait') && document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => document.querySelectorAll('video.mini-motion').length)).toBe(0);
  // in secondo piano tutto fermo
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => App.solo.closePortrait());
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.querySelectorAll('video.mini-motion').length)).toBe(0);
});

test('il secondo video non parte (iPhone): il guardiano passa al clip dopo e Nova non resta ferma', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  await mock(page, { stallId: 'motion-video-b', stallN: 3 });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').tap();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 15000 });
  // 10 s di campioni: tempo totale riprodotto e fermo immagine più lungo
  const r = await page.evaluate(async () => {
    let played = 0, still = 0, worst = 0, last = null, lt = 0;
    for (let i = 0; i < 100; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      const P = App.motionPlayer, v = P.els[P.cur];
      if (v === last && v.currentTime > lt + 0.01) { played += v.currentTime - lt; still = 0; } else still += 100;
      worst = Math.max(worst, still); last = v; lt = v.currentTime;
    }
    return { played: +played.toFixed(2), worst, stalls: App.motionPlayer.log.filter((l) => l.stall).length };
  });
  fs.writeFileSync(path.join(OUT, 'v2d-32-stallo-' + testInfo.project.name + '.json'), JSON.stringify(r));
  expect(r.played, JSON.stringify(r)).toBeGreaterThan(5);
  expect(r.worst, JSON.stringify(r)).toBeLessThan(3500);
});

test('Aggiorna (↻) è di nuovo nell\'intestazione di Nova; occhi e bocca sulla foto solo mentre parla', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  const dir = path.join(OUT, 'v2d-32-' + testInfo.project.name); fs.mkdirSync(dir, { recursive: true });
  await mock(page, {});
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  const btn = page.locator('#app-refresh');
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  for (const id of ['#blocco-btn', '#wa-video', '#wa-home', '#wa-photo']) await expect(page.locator(id)).toBeVisible();
  const title = await page.locator('.wa-title').boundingBox();
  expect(title.width).toBeGreaterThan(60);
  await page.locator('header.topbar').screenshot({ path: path.join(dir, 'intestazione.png') });
  await page.locator('#wa-home').tap();
  await expect(btn).toBeVisible();
  await page.locator('#back-btn').tap(); // v2d-36: niente barra in basso, «‹ Chat» in alto
  // ritratto con i clip: a riposo la foto non ha sguardo/sopracciglia disegnati; il labiale c'è mentre parla
  await page.locator('#wa-photo').tap();
  await page.waitForFunction(() => App.avatarConv.faceCalm === true, null, { timeout: 5000 });
  await page.evaluate(() => App.avatarConv.speakLive(() => 0.6, () => 0.5));
  await page.waitForFunction(() => !document.getElementById('stage').classList.contains('has-motion'), null, { timeout: 3000 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => App.avatarConv.mouth)).toBeGreaterThan(0.05);
  await page.evaluate(() => App.avatarConv.stopAudio());
  await page.evaluate(() => App.solo.closePortrait());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => App.avatarConv.faceCalm)).toBe(false);
});

test('iPhone: il microfono è un interruttore anche col permesso lento: un tocco registra (dopo «Consenti»), un tocco ferma', async ({ page }) => {
  // v2d-36: niente più «tieni premuto». getUserMedia lento come il riquadro «Consenti microfono» di Safari la prima volta
  await page.addInitScript(() => {
    let first = true;
    const fake = () => { const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); const o = ac.createOscillator(); o.connect(d); o.start(); return d.stream; };
    navigator.mediaDevices.getUserMedia = () => new Promise((ok) => setTimeout(() => ok(fake()), first ? (first = false, 1200) : 20));
    // WebKit di prova non registra da un flusso finto: registratore finto (la logica del tasto è quella vera)
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported || !['audio/webm', 'audio/mp4'].some((m) => MediaRecorder.isTypeSupported(m))) {
      window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/mp4'; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; setTimeout(() => this.onstop && this.onstop(), 10); } static isTypeSupported(m) { return m === 'audio/mp4'; } };
    }
  });
  await mock(page, {});
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && document.getElementById('vn-mic') && !document.getElementById('vn-mic').hidden);
  const b = await page.locator('#vn-mic').boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up(); // dito alzato per «Consenti»
  // appena dato il permesso registra, e resta in registrazione anche col dito alzato
  await page.waitForFunction(() => !document.getElementById('vn-hud').hidden && document.getElementById('vn-mic').classList.contains('rec'), null, { timeout: 4000 });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.getElementById('vn-mic').getAttribute('aria-pressed'))).toBe('true');
  // Annulla: niente invio, si spegne
  await page.click('#vn-cancel');
  await page.waitForFunction(() => document.getElementById('vn-hud').hidden && !document.getElementById('vn-mic').classList.contains('rec'), null, { timeout: 3000 });
  // secondo giro: tocco = parte subito, tocco = ferma
  await page.mouse.click(x, y);
  await page.waitForFunction(() => document.getElementById('vn-mic').classList.contains('rec'), null, { timeout: 3000 });
  await page.waitForTimeout(500);
  await page.mouse.click(x, y);
  await page.waitForFunction(() => !document.getElementById('vn-mic').classList.contains('rec'), null, { timeout: 3000 });
});
