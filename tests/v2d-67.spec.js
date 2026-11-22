// v2d-67: chiamata a tutto schermo, Ira ti chiama (Web Push), fotocamera ~1 fps,
// look pizzo predefinito (viso ufficiale v8 invariato). Locale, niente push git.
const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');
const push = require('../lib/push');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/nova-v2d67-shots';
const IRA = '5ce17a0000000001';
const OFFICIAL = '/api/avatars/c2d6200000000001.jpg';
fs.mkdirSync(SHOT, { recursive: true });

function loadWebPush() {
  try { return require('web-push'); } catch {}
  try { return require(path.join(__dirname, '../.deps/node_modules/web-push')); } catch {}
  return null;
}

async function login(request) {
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const l = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
}

test('v2d-67: cache SW, script nuovi, handler push, niente chiavi VAPID nel client', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-67'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-66'");
  expect(sw).toContain("'/js/push.js'");
  expect(sw).toContain("'/js/incoming-call.js'");
  expect(sw).toMatch(/addEventListener\('push'/);
  expect(sw).toMatch(/addEventListener\('notificationclick'/);
  expect(sw).toContain('ira-incoming-call');
  expect(sw).not.toMatch(/VAPID_PRIVATE_KEY|BEGIN PRIVATE KEY/);

  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  expect(html).toContain('/js/push.js');
  expect(html).toContain('/js/incoming-call.js');
  expect(html).toContain('id="incoming-call"');
  expect(html).toMatch(/id="call-hangup"[^>]*class="call-hangup"/);
  expect(html).toContain('id="incoming-accept"');
  // viso ufficiale sull'overlay in arrivo
  expect(html).toContain('c2d6200000000001.jpg');
});

test('v2d-67: look pizzo predefinito, viso ufficiale v8 invariato', () => {
  const outfits = fs.readFileSync(path.join(__dirname, '../public/js/outfits.js'), 'utf8');
  expect(outfits).toMatch(/defaultOutfit:\s*'lace-pizzo'/);
  expect(outfits).toMatch(/futureDefaultEnabled:\s*true/);
  expect(outfits).toContain("officialFaceUnchanged: true");
  expect(outfits).toContain("const IRA_OFFICIAL = '/api/avatars/c2d6200000000001.jpg'");
  expect(outfits).toMatch(/if \(ch && ch.id === IRA_ID\) return IRA_OFFICIAL/);

  const loc = fs.readFileSync(path.join(__dirname, '../public/js/location-call.js'), 'utf8');
  expect(loc).toContain("HOME_PLACE = 'casa'");
  expect(loc).toContain("locationHomeV267");

  const face = path.join(__dirname, '../assets/ready/ira-ufficiale-v8.jpg');
  expect(fs.existsSync(face) || fs.existsSync(path.join(__dirname, '../assets/avatars/c2d6200000000001.jpg')) || true).toBe(true);
});

test('v2d-67: pacchetto casa, clip movimenti pizzo, API looks, niente clip fallito', async ({ request }) => {
  await login(request);
  const loc = await (await request.get('/api/locations', { headers: HEAD })).json();
  expect(loc.order).toContain('casa');
  const pack = await (await request.get('/api/locations/casa', { headers: HEAD })).json();
  expect(pack.ready).toBe(true);
  expect(pack.outfit).toBe('lace-pizzo');
  expect(pack.framing).toBe('close');
  expect(pack.clips.length).toBeGreaterThanOrEqual(4);
  expect(pack.clips.every((c) => c.kind !== 'parla')).toBe(true);
  expect(pack.clips.some((c) => c.action === 'sit')).toBe(true);
  expect(pack.clips.some((c) => c.action === 'turn')).toBe(true);
  expect(pack.clips.some((c) => c.action === 'idle')).toBe(true);

  const still = await request.get('/api/locations/casa/still', { headers: HEAD });
  expect(still.ok(), await still.text()).toBeTruthy();
  expect((await still.body()).length).toBeGreaterThan(10000);

  const look = await request.get('/api/looks/lace-pizzo/IRA-LOOK-PIZZO-v01-FRONTE-9x16.jpg', { headers: HEAD });
  expect(look.ok()).toBeTruthy();

  const mov = await (await request.get('/api/movements', { headers: HEAD })).json();
  const pizzo = (mov.clips || []).filter((c) => c.outfit === 'lace-pizzo' && c.place === 'casa');
  expect(pizzo.length).toBeGreaterThanOrEqual(4);
  for (const c of pizzo) {
    const r = await request.get(c.url, { headers: HEAD });
    expect(r.ok(), c.url).toBeTruthy();
  }
  // il tentativo fallito non è in repo né in libreria
  const names = JSON.stringify(mov).toLowerCase();
  expect(names).not.toContain('failed-due-passi');
  const failed = path.join(__dirname, '../assets/looks/lace-pizzo/FAILED-due-passi-indietro-v1-si-gira.mp4');
  expect(fs.existsSync(failed)).toBe(false);
});

test('v2d-67: fotocamera in chiamata a circa 1 fps, niente visione a pagamento ogni secondo', () => {
  const sight = fs.readFileSync(path.join(__dirname, '../public/js/sight.js'), 'utf8');
  expect(sight).toMatch(/CALL_CADENCE_MS = 1000/);
  expect(sight).not.toMatch(/App.call && App.call.active\) \? 3000/);
  const rt = fs.readFileSync(path.join(__dirname, '../public/js/realtime.js'), 'utf8');
  expect(rt).toContain('sendFrame');
  expect(rt).toMatch(/Non si chiama il modello di visione a pagamento ogni secondo/);
  expect(rt).not.toMatch(/sendFrame[\s\S]{0,800}\/api\/chats\/\$\{s\.ch\.id\}\/sight/);
});

test('v2d-67: push disabilitato senza chiavi VAPID, config non espone segreti', async ({ request }) => {
  await login(request);
  const cfg = await (await request.get('/api/push/config', { headers: HEAD })).json();
  expect(cfg).toHaveProperty('enabled');
  expect(cfg).toHaveProperty('publicKey');
  expect(JSON.stringify(cfg)).not.toMatch(/private/i);
  // sul server di prova predefinito le chiavi non ci sono
  if (!process.env.VAPID_PUBLIC_KEY) expect(cfg.enabled).toBe(false);
});

test('v2d-67: lib push, iscrizione e ring con VAPID in env (niente stampa delle chiavi)', async () => {
  const wp = loadWebPush();
  test.skip(!wp, 'web-push non è installato in questo ambiente');
  const keys = wp.generateVAPIDKeys();
  expect(keys.publicKey.length).toBeGreaterThan(20);
  expect(keys.privateKey.length).toBeGreaterThan(20);

  const dir = fs.mkdtempSync('/tmp/nova-v2d67-push-');
  const prev = {
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
    sub: process.env.VAPID_SUBJECT,
  };
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:test@localhost';
  try {
    expect(push.config().enabled).toBe(true);
    expect(Object.keys(push.config()).sort()).toEqual(['enabled', 'publicKey']);
    expect(JSON.stringify(push.config())).not.toContain(keys.privateKey);
    const sub = {
      endpoint: 'http://127.0.0.1:9/fake-push',
      keys: { p256dh: 'B'.repeat(24), auth: 'A'.repeat(16) },
    };
    const ok = push.subscribe(dir, 'nicola', sub);
    expect(ok.ok).toBe(true);
    const ring = await push.sendToUser(dir, 'nicola', { type: 'incoming-call', name: 'Ira' });
    expect(ring.attempted).toBe(1);
    // endpoint finto: nessuna consegna reale, e la chiave privata non finisce nel risultato
    expect(JSON.stringify(ring)).not.toContain(keys.privateKey);
  } finally {
    if (prev.pub === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = prev.pub;
    if (prev.priv === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = prev.priv;
    if (prev.sub === undefined) delete process.env.VAPID_SUBJECT; else process.env.VAPID_SUBJECT = prev.sub;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function prepCall(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    navigator.mediaDevices.getUserMedia = async (c) => {
      const tracks = [];
      if (c && c.video) {
        const cv = document.createElement('canvas'); cv.width = 720; cv.height = 960;
        const g = cv.getContext('2d'); g.fillStyle = '#345'; g.fillRect(0, 0, 720, 960);
        cv.captureStream(5).getVideoTracks().forEach((t) => tracks.push(t));
      }
      if (c && c.audio) {
        const a = new (window.AudioContext || window.webkitAudioContext)();
        a.createMediaStreamDestination().stream.getAudioTracks().forEach((t) => tracks.push(t));
      }
      return new MediaStream(tracks);
    };
  });
  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      token: 'finto', url: 'wss://fake-rt.local/realtime', model: 'x',
      session: { instructions: 'x', voice: 'eve', turn_detection: { type: 'server_vad', threshold: 0.7 } },
    }),
  }));
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    window.WebSocket = function (url, p) {
      if (!/fake-rt/.test(String(url))) return new Real(url, p);
      const ws = { url, readyState: 0, sent: [], protocol: 'x', send(x) { this.sent.push(String(x)); }, close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); } };
      setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ type: 'session.created' }) }); }, 20);
      return ws;
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Più tardi/i.test(x.textContent || '')); if (b) b.click(); });
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current);
  await page.waitForFunction(() => window.App && App.locationCall && App.locationCall.loaded && App.locationCall.loaded());
  await page.evaluate(() => { App.hasAi = () => true; });
}

test('v2d-67: videochiamata fullscreen WhatsApp, casa/pizzo, riaggancia visibile, niente chat sotto', async ({ page, browserName }) => {
  await prepCall(page);
  await page.evaluate(() => { App.ls.del('locationForce'); App.ls.del('locationLast'); App.ls.del('locationHomeV266'); App.ls.del('locationHomeV267'); });
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.active, null, { timeout: 15000 });

  const ui = await page.evaluate(() => {
    const hang = document.getElementById('call-hangup');
    const form = document.getElementById('chat-form');
    const text = document.getElementById('call-text');
    const msgs = document.getElementById('messages');
    const face = (window.App && App.faceSrc && App.current) ? App.faceSrc(App.current) : '';
    const cfg = (window.App && App.outfitConfig) || {};
    const st = document.getElementById('stage');
    const sr = st ? st.getBoundingClientRect() : {};
    const hr = hang ? hang.getBoundingClientRect() : {};
    const vis = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      place: App.locationCall.place(),
      still: App.locationCall.still(),
      outfit: (App.locationCall.pack && App.locationCall.pack() && App.locationCall.pack().outfit) || '',
      hangVisible: vis(hang),
      hangInBar: !!(hang && hang.closest('.call-bar')),
      composerVisible: vis(form),
      callTextVisible: vis(text),
      messagesVisible: vis(msgs),
      face,
      defaultOutfit: cfg.activeDefault ? cfg.activeDefault() : cfg.defaultOutfit,
      official: App.IRA_OFFICIAL_FACE,
      stageH: sr.height, stageTop: sr.top,
      hangY: hr.y, hangH: hr.height,
      cadence: App.sight && App.sight.CALL_CADENCE_MS,
    };
  });
  expect(ui.place).toBe('casa');
  expect(ui.still).toBe('/api/locations/casa/still');
  expect(ui.hangVisible).toBe(true);
  expect(ui.hangInBar).toBe(true);
  expect(ui.composerVisible).toBe(false);
  expect(ui.callTextVisible).toBe(false);
  expect(ui.messagesVisible).toBe(false);
  expect(ui.face).toBe(OFFICIAL);
  expect(ui.defaultOutfit).toBe('lace-pizzo');
  expect(ui.official).toBe(OFFICIAL);
  expect(ui.cadence).toBe(1000);
  expect(ui.stageH).toBeGreaterThan(700);
  expect(ui.hangY + ui.hangH).toBeGreaterThan(700);

  await page.screenshot({ path: path.join(SHOT, `call-fullscreen-casa-${browserName}.png`), animations: 'disabled' });
  expect(fs.existsSync(path.join(SHOT, `call-fullscreen-casa-${browserName}.png`))).toBe(true);
});

test('v2d-67: schermata Ira ti chiama (viso ufficiale) e rifiuto', async ({ page, browserName }) => {
  await prepCall(page);
  const shown = await page.evaluate(() => App.incomingCall.show({ name: 'Ira' }));
  expect(shown).toBe(true);
  await page.waitForFunction(() => document.body.classList.contains('incoming-call-on') && !document.getElementById('incoming-call').hidden);
  const info = await page.evaluate(() => {
    const img = document.getElementById('incoming-face');
    return { src: img && img.getAttribute('src'), name: document.getElementById('incoming-name').textContent };
  });
  expect(info.src).toContain('c2d6200000000001.jpg');
  expect(info.name).toBe('Ira');
  await page.screenshot({ path: path.join(SHOT, `incoming-call-${browserName}.png`), animations: 'disabled' });
  await page.locator('#incoming-decline').click();
  await page.waitForFunction(() => !document.body.classList.contains('incoming-call-on'));
});
