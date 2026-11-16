// v2d-50: in chiamata la cornetta diventa il tasto video (icona stile WhatsApp);
// in videochiamata restano muto e fotocamera, sparisce riaggancia, sotto c'è una riga fissa
// (+ e campo) il cui testo entra nella sessione vocale come istruzione (niente risposta scritta).
const { test, expect } = require('./harness');
const path = require('path');

const JPG = path.join(__dirname, '..', 'assets', 'ready', 'alpha-foto-v46.jpg');

async function openApp(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c && c.video) { const cv = document.createElement('canvas'); cv.width = 8; cv.height = 8; return cv.captureStream(1); }
      const a = new AudioContext(); return a.createMediaStreamDestination().stream;
    };
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p.startsWith('/api/avatars/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPG });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Ira', ready: 'nova-scelta', avatar: '/api/avatars/a1fa460000000001.jpg', personality: 'x', style: '', requests: '' }]);
    if (p.startsWith('/api/chats/') && p.endsWith('/sight')) return json({ note: 'Vedo un vestito blu su uno sfondo chiaro.', cadenceMs: 8000, continuous: false });
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory' || p === '/api/gestures') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/calls') return json({ calls: [] });
    if (p === '/api/simli/session') return json({ error: 'Simli non configurato', fallback: true });
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound && App.current, null, { timeout: 30000 });
  await page.evaluate(() => { if (App.solo && App.solo.showChat) App.solo.showChat(); });
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current);
}

const vis = () => {
  const shown = (e) => {
    if (!e) return false;
    const cs = getComputedStyle(e), b = e.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && b.width > 0 && b.height > 0 && !e.hidden && !e.closest('[hidden]');
  };
  return {
    mode: App.call.mode,
    buttons: [...document.querySelectorAll('#call-ui button')].filter(shown).map((b) => b.id).filter(Boolean),
    hangup: shown(document.getElementById('call-hangup')),
    end: !!document.getElementById('call-end'),
    toggle: shown(document.getElementById('call-videotoggle')),
    pressed: document.getElementById('call-videotoggle') && document.getElementById('call-videotoggle').getAttribute('aria-pressed'),
    slash: (() => { const el = document.querySelector('#call-videotoggle .vid-off-line'); return el ? getComputedStyle(el).display !== 'none' : false; })(),
    mute: shown(document.getElementById('call-mute')),
    cam: shown(document.getElementById('call-cam')),
    form: shown(document.getElementById('call-text')),
    plus: shown(document.getElementById('call-attach')),
    input: shown(document.getElementById('call-input')),
  };
};

test('v2d-50: cache del service worker app-privata-v2d-50', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(50|[5-9]\d)'/); // v2d-51 alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-49'");
});

test('v2d-50: in chiamata vocale la cornetta è sostituita dal tasto video; niente riaggancia', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call.mode === 'voice');
  const s = await page.evaluate(vis);
  expect(s.mode).toBe('voice');
  expect(s.end).toBe(false);
  expect(s.hangup).toBe(false);
  expect(s.toggle).toBe(true);
  expect(s.pressed).toBe('false');
  expect(s.slash).toBe(false);
  expect(s.mute).toBe(true);
  expect(s.form).toBe(false);
  expect(s.buttons).toContain('call-videotoggle');
  expect(s.buttons).not.toContain('call-end');
  expect(s.buttons).not.toContain('call-hangup');
});

test('v2d-50: il tasto video apre la videochiamata; restano muto e camera; riga +/testo fissa; il testo va alla voce, non in chat', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => App.call.start('voice').catch(() => {}));
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call.mode === 'voice');
  await page.click('#call-videotoggle');
  await page.waitForFunction(() => App.call.mode === 'video');
  const s = await page.evaluate(vis);
  expect(s.mode).toBe('video');
  expect(s.toggle).toBe(true);
  expect(s.pressed).toBe('true');
  expect(s.slash).toBe(true);
  expect(s.mute).toBe(true);
  expect(s.cam).toBe(true);
  expect(s.hangup).toBe(false);
  expect(s.end).toBe(false);
  expect(s.form).toBe(true);
  expect(s.plus).toBe(true);
  expect(s.input).toBe(true);

  const layout = await page.evaluate(() => {
    document.documentElement.style.setProperty('--vv-bottom', '300px');
    const form = document.getElementById('call-text');
    const cs = getComputedStyle(form);
    return { pos: cs.position, bottom: cs.bottom, vv: getComputedStyle(document.documentElement).getPropertyValue('--vv-bottom').trim() };
  });
  expect(layout.pos).toBe('absolute');
  expect(layout.vv).toBe('300px');
  const bottomPx = parseFloat(layout.bottom);
  expect(bottomPx).toBeLessThan(80); // fissata in basso, non sollevata di 300px con la tastiera

  await page.evaluate(() => {
    window.__instr = [];
    window.__chat = [];
    App.rt.sendInstruction = async (t, o) => { window.__instr.push({ t, hasImage: !!(o && o.imageUrl) }); return true; };
    const orig = App.chat.send.bind(App.chat);
    App.chat.send = (t, ...rest) => { window.__chat.push(t); return orig(t, ...rest); };
  });
  await page.fill('#call-input', 'spogliati e cambiati');
  await page.locator('#call-text').evaluate((f) => f.requestSubmit());
  await page.waitForFunction(() => (window.__instr || []).length === 1);
  const sent = await page.evaluate(() => ({ instr: window.__instr, chat: window.__chat, input: document.getElementById('call-input').value }));
  expect(sent.instr).toEqual([{ t: 'spogliati e cambiati', hasImage: false }]);
  expect(sent.chat).toEqual([]);
  expect(sent.input).toBe('');

  // + apre il selettore foto
  const chooserP = page.waitForEvent('filechooser', { timeout: 3000 });
  await page.click('#call-attach');
  const chooser = await chooserP;
  expect(chooser.isMultiple()).toBe(false);

  // ✕ riduce, non chiude
  await page.click('#call-min');
  expect(await page.evaluate(() => ({ min: document.body.classList.contains('call-min'), on: App.call.active, form: document.getElementById('call-text').hidden }))).toEqual({ min: true, on: true, form: true });
});

test('v2d-50: il muto in videochiamata riusa il tasto esistente (🎙️ / 🔇)', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => App.call.start('video').catch(() => {}));
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call.mode === 'video');
  const before = await page.evaluate(() => document.getElementById('call-mute').textContent);
  expect(before).toBe('🎙️');
  await page.click('#call-mute');
  const after = await page.evaluate(() => ({ text: document.getElementById('call-mute').textContent, off: document.getElementById('call-mute').classList.contains('off') }));
  expect(after.text).toBe('🔇');
  expect(after.off).toBe(true);
  await page.click('#call-mute');
  expect(await page.evaluate(() => document.getElementById('call-mute').textContent)).toBe('🎙️');
});
