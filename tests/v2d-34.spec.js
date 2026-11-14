const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-34: «parte un secondo, sfuma bianco e si blocca» (iPhone). Un clip che non riesce a partire non deve mai entrare
// in dissolvenza (video vuoto = fondo chiaro): resta l immagine attuale; sotto i video c è sempre la foto del look.
// Qui il secondo video «parte» ma resta fermo (come Safari con la rete lenta).
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

test('v2d-34: un clip che non parte non sfuma mai nel bianco, resta l immagine e poi si riparte', async ({ page }, testInfo) => {
  test.skip(!have(), 'clip di prova solo in locale');
  test.setTimeout(60000);
  await mock(page, { stallId: 'motion-video-b', stallN: 4 });
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#wa-photo').tap();
  await page.waitForFunction(() => document.getElementById('stage').classList.contains('has-motion') && App.motionPlayer && App.motionPlayer.playing, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    let empty = 0, n = 0, bgOk = 0, played = 0, last = null, lt = 0;
    for (let i = 0; i < 120; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      const P = App.motionPlayer, st = document.getElementById('stage');
      if (!st.classList.contains('has-motion')) continue;
      n++;
      if (/url\(/.test(getComputedStyle(st).backgroundImage)) bgOk++;
      // strato visibile: il video con opacità più alta deve avere un fotogramma vero
      const top = [...P.els].sort((a, b) => Number(getComputedStyle(b).opacity) - Number(getComputedStyle(a).opacity))[0];
      if (Number(getComputedStyle(top).opacity) < 0.5 || top.readyState < 2) empty++;
      const v = P.els[P.cur]; if (v === last && v.currentTime > lt + 0.01) played += v.currentTime - lt; last = v; lt = v.currentTime;
    }
    return { n, empty, bgOk, played: +played.toFixed(2), notReady: App.motionPlayer.log.filter((l) => l.notReady).length };
  });
  fs.writeFileSync(path.join(OUT, 'v2d-34-non-pronto-' + testInfo.project.name + '.json'), JSON.stringify(r));
  expect(r.n).toBeGreaterThan(50);
  expect(r.empty, JSON.stringify(r)).toBe(0);
  expect(r.bgOk, JSON.stringify(r)).toBe(r.n);
  expect(r.played, JSON.stringify(r)).toBeGreaterThan(5);
});
