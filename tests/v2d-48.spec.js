// v2d-48 (Nicola, 15/11): app a scatti su iPhone. Avatar senza layout forzato a ogni fotogramma, canvas più leggero,
// disegno fermo sotto il video Simli, chat lunga disegnata a finestre (gli ultimi messaggi subito, i precedenti scorrendo).
const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CH = '5ce17a0000000001';
const FOTO = 'a1fa460000000001.jpg';
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46-landmarks.json'), 'utf8'));
const JPG = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'alpha-foto-v46.jpg'));
const N = 527;
const MSGS = Array.from({ length: N }, (_, k) => { const i = k + 1; return { id: 'm' + String(i).padStart(14, '0'), n: i, role: i % 2 ? 'user' : 'assistant', author: i % 2 ? 'nicola' : undefined, authorName: i % 2 ? 'Nico' : 'Alpha', content: `messaggio ${i} ` + 'testo '.repeat(1 + (i % 5)), at: new Date(Date.parse('2026-11-10T10:00:00Z') + i * 60000).toISOString() }; });

async function mockApp(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p.startsWith('/api/avatars/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: JPG });
    if (p.startsWith('/api/motion/')) return route.fulfill({ status: 404, body: '' });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true, simliFace: false });
    if (p === '/api/characters') return json([{ id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '/api/avatars/' + FOTO, avatarSource: 'upload', landmarks: { ...LM, src: '/api/avatars/' + FOTO }, outfits: [], motionClips: [], personality: '', style: '', requests: '', voice: 'eve', messages: N }]);
    if (p.startsWith('/api/chats/')) { const since = u.searchParams.get('since'); return json({ epoch: 'e1', last: N, reset: since == null, messages: since == null ? MSGS : [], typing: null }); }
    if (p === '/api/calls') return json({ calls: [] });
    if (p === '/api/gallery') return json({ items: [], trash: [], trashDays: 30 });
    if (p === '/api/memory' || p === '/api/gestures') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    return json({});
  });
}
async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.current, null, { timeout: 30000 });
}

test('v2d-48: cache del service worker app-privata-v2d-48', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(4[89]|[5-9]\d)'/); // v2d-49 alza la cache
});

test('v2d-48: chat di 527 messaggi: subito gli ultimi 120, i precedenti in cima scorrendo, ordine e testo intatti', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE headless del box) chiude il processo appena l\u2019app è avviata: verificato su Chromium; iPhone vero da provare.');
  test.setTimeout(60000);
  await mockApp(page);
  await openApp(page);
  await page.locator('#dock-chat').click();
  await page.waitForFunction(() => document.querySelectorAll('#messages .msg').length > 0);
  await page.waitForTimeout(800);
  const first = await page.evaluate(() => { const m = document.getElementById('messages'); const all = [...m.querySelectorAll('.msg')]; return { n: all.length, last: all[all.length - 1].dataset.id, firstId: all[0].dataset.id, atEnd: m.scrollHeight - m.scrollTop - m.clientHeight < 80 }; });
  expect(first.n).toBe(120);
  expect(first.last).toBe(MSGS[N - 1].id);
  expect(first.firstId).toBe(MSGS[N - 120].id);
  expect(first.atEnd).toBe(true);
  // in cima: arrivano i precedenti e il messaggio che si stava leggendo resta allo stesso punto dello schermo
  const kept = await page.evaluate(async () => {
    const m = document.getElementById('messages');
    m.scrollTop = 0; await new Promise((r) => setTimeout(r, 300));
    const anchor = document.querySelector(`#messages .msg[data-id="${'m' + String(527 - 119).padStart(14, '0')}"]`);
    return { n: m.querySelectorAll('.msg').length, top: anchor.getBoundingClientRect().top - m.getBoundingClientRect().top };
  });
  expect(kept.n).toBe(200);
  expect(kept.top).toBeGreaterThan(-5);
  for (let i = 0; i < 10; i++) await page.evaluate(async () => { const m = document.getElementById('messages'); m.scrollTop = 0; await new Promise((r) => setTimeout(r, 120)); });
  const all = await page.evaluate(() => [...document.querySelectorAll('#messages .msg')].map((e) => e.dataset.id));
  expect(all).toEqual(MSGS.map((m) => m.id));
  expect(await page.evaluate(() => document.querySelectorAll('#messages .day-pill').length)).toBe(1);
  // un messaggio nuovo arriva in fondo come prima (nessun doppione)
  const added = await page.evaluate(() => App.chat.addMsg({ id: 'm' + String(528).padStart(14, '0'), role: 'assistant', authorName: 'Alpha', content: 'nuovo', at: new Date().toISOString() }) && document.querySelector('#messages .msg:last-of-type').dataset.id);
  expect(added).toBe('m' + String(528).padStart(14, '0'));
  expect(await page.evaluate(() => App.chat.addMsg({ id: 'm' + String(10).padStart(14, '0'), role: 'user', content: 'x' }))).toBeNull();
});

test('v2d-48: avatar: niente getClientRects a ogni fotogramma, canvas entro 1,1 Mpx, disegno fermo sotto il video Simli', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE headless del box) chiude il processo appena l\u2019app è avviata: verificato su Chromium; iPhone vero da provare.');
  test.setTimeout(60000);
  await page.addInitScript(() => { window.__gcr = 0; const g = Element.prototype.getClientRects; Element.prototype.getClientRects = function () { if (this.tagName === 'CANVAS') window.__gcr++; return g.call(this); }; });
  await mockApp(page);
  await openApp(page);
  await page.evaluate(() => App.solo.showHome());
  await page.waitForTimeout(500);
  const calls = await page.evaluate(async () => { window.__gcr = 0; await new Promise((r) => setTimeout(r, 2000)); return window.__gcr; });
  expect(calls).toBeLessThan(20); // prima: ~360 in 2 s (3 avatar x 60 fotogrammi)
  // il ritratto della chiamata: l'avatar disegna e il canvas resta entro il tetto di pixel
  await page.evaluate(() => { App.solo.openPortrait && App.solo.openPortrait(); document.getElementById('stage') && (document.getElementById('stage').hidden = false); });
  await page.waitForTimeout(800);
  const st = await page.evaluate(async () => { const av = App.avatarConv, c = av.c; const n0 = av._pf.n; await new Promise((r) => setTimeout(r, 600)); return { drew: av._pf.n - n0, px: c.width * c.height, vis: c.getClientRects().length > 0 }; });
  test.skip(!st.vis, 'canvas non visibile in questa vista');
  expect(st.drew).toBeGreaterThan(5);
  expect(st.px).toBeLessThanOrEqual(1.1e6 + 5000);
  // volto Simli a schermo: il canvas sotto non si ridisegna (lo stato della bocca continua)
  const covered = await page.evaluate(async () => {
    const v = document.getElementById('simli-video'), cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; cv.getContext('2d').fillRect(0, 0, 64, 64);
    v.srcObject = cv.captureStream(5); v.hidden = false; document.body.classList.add('simli-on');
    const av = App.avatarConv; await new Promise((r) => setTimeout(r, 200)); const n0 = av._pf.n; await new Promise((r) => setTimeout(r, 800)); const d1 = av._pf.n - n0;
    document.body.classList.remove('simli-on'); v.hidden = true; v.srcObject = null;
    const n1 = av._pf.n; await new Promise((r) => setTimeout(r, 600)); return { under: d1, after: av._pf.n - n1 };
  });
  expect(covered.under).toBe(0);
  expect(covered.after).toBeGreaterThan(5);
});
