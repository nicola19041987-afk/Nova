const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

// v2d-41 (Luisa: «il microfono non parte»): il microfono parte sempre o lo dice chiaramente con «Riprova»; dopo un errore si
// torna sempre al tempo reale; nessuna impostazione salvata o errore spegne il tempo reale per sempre.
const CH = '5ce17a0000000001';
const AV = '/api/avatars/0000000000000def.jpg';
const READY = path.join(__dirname, '..', 'assets', 'ready');
const LM = { ...JSON.parse(fs.readFileSync(path.join(READY, 'nova-scelta-landmarks.json'), 'utf8')), src: AV };

async function mock(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request(); const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === AV) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(READY, 'nova-scelta.jpg') });
    if (p === '/api/me') return json({ user: 'luisa', name: 'Luisa', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Nova', ready: 'nova-scelta', avatar: AV, motionClips: [], outfits: [], personality: 'x', style: '', requests: '', voice: 'eve', landmarks: LM }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/actions' || p === '/api/gestures') return json([]);
    if (p === '/api/stt') return json({ text: '' });
    return json({});
  });
}
// getUserMedia finto e pilotato dal test: window.__mic = 'deny' | 'busy' | 'hang' | 'ok' (vale per la prossima richiesta)
async function fakeMic(page, first) {
  await page.addInitScript((first) => {
    window.__mic = first; window.__gum = [];
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = async (c) => {
      const how = window.__mic; window.__gum.push({ how, simple: !!(c && c.audio === true) });
      if (c && c.video) { const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; return cv.captureStream(1); }
      if (how === 'deny') { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; }
      if (how === 'busy') { window.__mic = 'ok'; const e = new Error('Could not start audio source'); e.name = 'NotReadableError'; throw e; }
      if (how === 'hang') { window.__mic = 'ok'; return new Promise(() => {}); }
      if (how === 'late') { window.__mic = 'hang'; const ac = new AudioContext(); const d = ac.createMediaStreamDestination(); return new Promise((ok) => setTimeout(() => ok(d.stream), 11000)); }
      const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream;
    };
  }, first);
}
// tempo reale finto: parte solo se c'è il microfono (come quello vero, che apre il microfono insieme alla connessione)
async function fakeRt(page) {
  await page.evaluate(() => {
    App.hasAi = () => true; App.rt.supported = () => true; window.__rt = 0;
    App.rt.start = async () => { window.__rt++; await App.audio.mic(); window.__rtLive = true; return true; };
    App.rt.stop = () => { window.__rtLive = false; };
  });
}
async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.current && App.solo && App.solo._bound, null, { timeout: 30000 });
  await page.waitForTimeout(800);
}

test('microfono negato: avviso chiaro con «Riprova»; dopo «Consenti» il microfono parte e si torna subito al tempo reale', async ({ page }) => {
  await fakeMic(page, 'deny'); await mock(page); await boot(page); await fakeRt(page);
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  const box = page.locator('#call-micfix');
  await expect(box).toBeVisible({ timeout: 8000 });
  await expect(box.locator('.cmf-text')).toContainText(/bloccato/i);
  await expect(box.locator('.cmf-btn')).toHaveText('Riprova');
  expect(await page.evaluate(() => App.call.engine())).toBe('classic');
  // nessuna impostazione salvata spegne il tempo reale
  expect(await page.evaluate(() => App.rt.enabled() && App.ls.get('callEngine', 'realtime') === 'realtime')).toBe(true);
  await page.evaluate(() => { window.__mic = 'ok'; });
  await box.locator('.cmf-btn').click();
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  await expect(box).toBeHidden();
  expect(await page.evaluate(() => App.audio.micLive())).toBe(true);
  await page.evaluate(() => App.call.end());
});

test('microfono occupato (o vincoli non accettati): secondo tentativo semplice da solo, nessun avviso, tempo reale', async ({ page }) => {
  await fakeMic(page, 'busy'); await mock(page); await boot(page); await fakeRt(page);
  await page.evaluate(() => App.call.start('video').catch(() => {}));
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  const g = await page.evaluate(() => window.__gum.filter((x) => x.how !== undefined));
  expect(g.some((x) => x.simple)).toBe(true); // ritentato con {audio:true}
  expect(await page.locator('#call-micfix').isVisible().catch(() => false)).toBe(false);
  await page.evaluate(() => App.call.end());
});

test('richiesta del microfono senza risposta: non blocca, avviso dopo il tempo massimo e «Riprova» funziona', async ({ page }) => {
  test.setTimeout(60000);
  await fakeMic(page, 'hang'); await mock(page); await boot(page); await fakeRt(page);
  // il secondo tentativo automatico (semplice) resta appeso anche lui
  await page.evaluate(() => { const md = navigator.mediaDevices, orig = md.getUserMedia; let n = 0; md.getUserMedia = (c) => (++n <= 2 && !(c && c.video) ? (window.__gum.push({ how: 'hang' }), new Promise(() => {})) : orig(c)); });
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  const box = page.locator('#call-micfix');
  await expect(box).toBeVisible({ timeout: 30000 });
  await expect(box.locator('.cmf-text')).toContainText(/non ha risposto|Riprova/);
  await box.locator('.cmf-btn').click();
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  await expect(box).toBeHidden();
  await page.evaluate(() => App.call.end());
});

test('«Consenti» toccato tardi: il microfono arrivato in ritardo si usa e si torna al tempo reale', async ({ page }) => {
  test.setTimeout(60000);
  await fakeMic(page, 'late'); await mock(page); await boot(page); await fakeRt(page);
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => App.audio.micLive() && App.call.engine() === 'realtime', null, { timeout: 30000 });
  await expect(page.locator('#call-micfix')).toBeHidden();
  await page.evaluate(() => App.call.end());
});

test('tempo reale che cade a chiamata in corso: si riprova da solo e si torna al tempo reale', async ({ page }) => {
  await fakeMic(page, 'ok'); await mock(page); await boot(page); await fakeRt(page);
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  await page.evaluate(() => App.call.fallback('rete caduta'));
  expect(await page.evaluate(() => App.call.engine())).not.toBe('realtime');
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 10000 });
  await page.evaluate(() => App.call.end());
  // una nuova chiamata riparte in tempo reale (niente «classica» ricordata)
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  await page.evaluate(() => App.call.end());
});

test('impostazioni vecchie salvate (classica, microfono spento, tempo reale tolto) non spengono microfono e tempo reale', async ({ page }) => {
  await fakeMic(page, 'ok'); await mock(page);
  await page.addInitScript(() => { try { const k = Object.keys(localStorage); void k; } catch { /* */ } });
  await page.goto('/');
  await page.evaluate(() => { for (const [k, v] of [['callEngine', 'classic'], ['micOn', false], ['soloRtOff', true], ['v41open', false]]) { try { App.ls.set(k, v); } catch { /* */ } } });
  await page.reload();
  await page.waitForFunction(() => window.App && App.current && App.solo && App.solo._bound, null, { timeout: 30000 });
  await fakeRt(page);
  expect(await page.evaluate(() => ({ eng: App.ls.get('callEngine'), mic: App.ls.get('micOn'), rt: App.rt.enabled() }))).toEqual({ eng: 'realtime', mic: true, rt: true });
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => App.call.engine() === 'realtime', null, { timeout: 8000 });
  await page.evaluate(() => App.call.end());
});

test('nota vocale: microfono che non risponde non blocca il tasto e dice cosa fare', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'MediaRecorder finto: verificato su Chromium.');
  test.setTimeout(60000);
  await fakeMic(page, 'deny'); await mock(page); await boot(page);
  await page.evaluate(() => App.solo.showChat());
  await page.waitForFunction(() => { const b = document.getElementById('vn-mic'); return b && b.offsetParent; });
  await page.locator('#vn-mic').click();
  await expect(page.locator('#vn-status')).toContainText(/bloccato/i);
  // seconda pressione: nuova richiesta (il tasto non resta bloccato)
  const before = await page.evaluate(() => window.__gum.length);
  await page.locator('#vn-mic').click();
  await page.waitForFunction((n) => window.__gum.length > n, before);
});
