const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');


// v2d-37: bocca guidata dall'audio che suona davvero, tempo reale di serie a ogni chiamata, camera nella chiamata,
// foto della Home intera durante una chiamata ridotta, Voce dalla Home = chiamata vocale, look vecchi fermi ritirati.
const OUT = process.env.NOVA_EVIDENCE || '/workspace/nova-motion/v2d38/evidence';
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
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0, null, { timeout: 30000 });
  await page.evaluate((key) => { App.ls.set('outfit:' + App.current.id, { scene: key, seen: Date.now(), visitAt: Date.now() }); App.ls.set('away:' + App.current.id, null); App.outfits.apply(true); }, scene);
  await page.waitForTimeout(3000); // l avvio finisce (apre la chat) prima di aprire il ritratto
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }, sel);


// v2d-38: i tap sono veri touch (non dispatchEvent/click forzati). Una toast persistente riproduce l'intercettazione
// dopo una chiamata; ogni riga della Home e il tasto Impostazioni devono aprire la pagina corretta.
test.use({ hasTouch: true });
test('tutti i tasti in basso della Home rispondono ai tap, anche sotto una notifica dopo la chiamata', async ({ page }) => {
  test.skip(!HAS_LIB, 'libreria privata solo in locale');
  await page.setViewportSize({ width: 390, height: 844 });
  const L = lib(); const seen = { chat: [] };
  await mock(page, L, seen);
  await open(page, 'nova_studio');
  await page.evaluate(() => App.solo.showHome());
  await page.waitForTimeout(600);
  for (const key of ['carattere', 'look', 'richieste', 'gesti', 'video', 'cam', 'voce']) {
    await page.evaluate(() => App.solo.showHome());
    const btn = page.locator(`#nh-list [data-nh-open="${key}"]`);
    await btn.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      App.toast('Voce momentaneamente non disponibile. Puoi continuare a usare tutti i tasti.', 60000);
    });
    const box = await btn.boundingBox();
    // mettiamo la stessa notifica proprio sopra il tasto da controllare, come succede con testo lungo/viewport bassa
    await page.evaluate(({ y, h }) => { const t = document.getElementById('toast'); t.style.top = y + 'px'; t.style.bottom = 'auto'; t.style.height = h + 'px'; }, { y: box.y, h: box.height });
    const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('[data-nh-open]'); return { key: b && b.dataset.nhOpen, hit: e && (e.id || e.tagName) }; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit.key, 'chi riceve il tap: ' + JSON.stringify(hit)).toBe(key);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(`[data-nh-page="${key}"]`)).toBeVisible();
    await expect(page.locator('#nh-list')).toBeHidden();
  }
  await page.evaluate(() => App.solo.showHome());
  const settings = page.locator('#dock-settings'); await settings.scrollIntoViewIfNeeded(); const sb = await settings.boundingBox();
  await page.evaluate(({ y, h }) => { const t = document.getElementById('toast'); t.style.top = y + 'px'; t.style.height = h + 'px'; }, { y: sb.y, h: sb.height });
  await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await expect(page.locator('#tab-account')).toBeVisible();
  // Le mie regole: si può raggiungere il campo, modificarlo localmente senza salvare né inviare nulla.
  const rules = page.locator('#rules-input');
  await rules.scrollIntoViewIfNeeded();
  await rules.fill('prova locale non salvata');
  await expect(rules).toHaveValue('prova locale non salvata');
  const save = page.locator('#rules-save'); await save.scrollIntoViewIfNeeded(); const rb = await save.boundingBox();
  const rulesHit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('button'); return b && b.id; }, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 });
  expect(rulesHit).toBe('rules-save');
});
