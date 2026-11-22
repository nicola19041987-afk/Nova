// v2d-66: clip luogo con tatuaggio ufficiale (still v02/v03), memoria gesti (conteggi, cap, no media),
// cache app-privata-v2d-66. Resta v2d-65: una sola voce, viso ufficiale, Impostazioni.
const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');
const motionMem = require('../lib/motion-memory');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/nova-v2d66-shots';
const STILLS = {
  barca: 'IRA-CALL-BARCA-v02.jpg',
  auto: 'IRA-CALL-AUTO-v02.jpg',
  salotto: 'IRA-CALL-SALOTTO-v03.jpg',
  camera: 'IRA-CALL-CAMERA-v03.jpg',
  cucina: 'IRA-CALL-CUCINA-v03.jpg',
  palestra: 'IRA-CALL-PALESTRA-v03.jpg',
};
const PLACES = ['showroom', 'barca', 'auto', 'salotto', 'camera', 'cucina', 'palestra'];

test('v2d-66: evict della memoria gesti (mai usati prima, catalogo protetto, cap 80)', () => {
  expect(motionMem.CAP).toBe(80);
  expect(motionMem.boostWeight(1, 0)).toBe(1);
  expect(motionMem.boostWeight(1, 1)).toBeCloseTo(1 + Math.log1p(1), 8);
  const catalog = new Set(['/api/locations/salotto/salotto-talk.mp4', '/api/locations/barca/barca-talk.mp4']);
  const evictedBad = motionMem.evict({
    '/api/locations/salotto/salotto-talk.mp4': { playCount: 2 },
    '/api/evil/x.mp4': { playCount: 99 },
    '/api/locations/barca/barca-talk.mp4': { playCount: 0 },
  }, { cap: 80, catalog });
  expect(Object.keys(evictedBad).sort()).toEqual([...catalog].sort());

  const clips = {};
  for (let i = 0; i < 90; i++) {
    clips['/api/locations/x/clip-' + i + '.mp4'] = { playCount: i < 15 ? 0 : i, lastPlayedAt: '2026-01-01T00:00:00Z' };
  }
  clips['/api/locations/salotto/salotto-talk.mp4'] = { playCount: 1, lastPlayedAt: '2026-01-02T00:00:00Z' };
  const ev = motionMem.evict(clips, { cap: 80, catalog, allowAll: true });
  expect(Object.keys(ev).length).toBe(80);
  expect(ev['/api/locations/salotto/salotto-talk.mp4']).toBeTruthy();
  // 91 voci, cap 80: si tolgono prima i 15 mai usati (11 evictions) e restano 4 mai usati + tutti quelli già usati + il catalogo.
  expect(Object.values(ev).filter((e) => !e.playCount).length).toBe(4);
  expect(Object.entries(ev).filter(([u, e]) => u.includes('/clip-') && e.playCount > 0).length).toBe(75);
});

test('v2d-66: cache del service worker e pacchetti con still del tatuaggio ufficiale', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-66'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-65'");
  expect(sw).toContain("'/js/motion-memory.js'");
  expect(sw).toContain("'/js/call-video.js'");
  expect(sw).toContain("'/js/clip-compose.js'");
  expect(sw).toContain('keys.filter((k) => k !== CACHE)');

  const graph = fs.readFileSync(path.join(__dirname, '../public/js/motion-graph.js'), 'utf8');
  expect(graph).toContain("CACHE_NAME = 'nova-motion-v2d-66'");
  expect(graph).toMatch(/CACHE_MAX = 24/);

  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const l = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();

  const loc = await (await request.get('/api/locations', { headers: HEAD })).json();
  expect(loc.default).toBe('showroom');
  expect(loc.order).toEqual(PLACES);
  const seenIds = new Set();
  for (const id of PLACES) {
    const pack = await (await request.get('/api/locations/' + id, { headers: HEAD })).json();
    expect(pack.ready, id).toBe(true);
    expect(pack.clips.length, id).toBeGreaterThan(0);
    const ids = pack.clips.map((c) => c.id);
    expect(new Set(ids).size, id).toBe(ids.length);
    for (const cid of ids) {
      const uniq = id + ':' + cid;
      expect(seenIds.has(uniq), uniq).toBe(false);
      seenIds.add(uniq);
    }
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/locations', id, 'manifest.json'), 'utf8'));
    if (id === 'showroom') {
      expect(man.still).toBe('IRA-CALL-SHOWROOM-v04.jpg');
      expect(man.outfit).toBe('lace-black');
      expect(man.framing).toBe('close');
      expect(man.clips.every((c) => c.kind !== 'parla')).toBe(true);
    } else {
      expect(man.still).toBe(STILLS[id]);
      const a = fs.readFileSync(path.join(__dirname, '../assets/locations', id, man.still));
      expect(a.length).toBeGreaterThan(10000);
    }
    for (const c of man.clips) {
      const f = path.join(__dirname, '../assets/locations', id, c.file);
      expect(fs.existsSync(f), f).toBe(true);
    }
    const stillRes = await request.get('/api/locations/' + id + '/still', { headers: HEAD });
    expect(stillRes.ok(), id + ' still').toBeTruthy();
  }
});

test('v2d-66: API memoria gesti, allowlist, conteggi, niente file media', async ({ request }) => {
  const r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();

  const mem0 = await (await request.get('/api/motion-memory', { headers: HEAD })).json();
  expect(mem0.cap).toBe(80);
  expect(mem0.clips['/api/locations/showroom/showroom-idle-stand.mp4']).toBeTruthy();
  expect(mem0.clips['/api/locations/barca/barca-talk.mp4'].playCount).toBeGreaterThanOrEqual(0);
  expect(mem0.clips['/api/gestures/saluto']).toBeFalsy();

  const bad = await request.post('/api/motion-memory/play', { data: { url: '/api/gestures/saluto' }, headers: HEAD });
  expect(bad.status()).toBe(400);
  const bad2 = await request.post('/api/motion-memory/play', { data: { url: '/etc/passwd' }, headers: HEAD });
  expect(bad2.status()).toBe(400);

  const url = '/api/locations/salotto/salotto-talk.mp4';
  const before = mem0.clips[url].playCount;
  const ok = await request.post('/api/motion-memory/play', { data: { url }, headers: HEAD });
  expect(ok.ok(), await ok.text()).toBeTruthy();
  const mem1 = await ok.json();
  expect(mem1.clips[url].playCount).toBe(before + 1);

  // nessun file media creato dalla memoria
  const dataDir = process.env.DATA_DIR || '/tmp/nova-e2e-empty';
  const memFile = path.join(dataDir, 'users', 'nicola', 'motion-memory.json');
  expect(fs.existsSync(memFile)).toBe(true);
  const raw = JSON.parse(fs.readFileSync(memFile, 'utf8'));
  expect(raw.clips[url].playCount).toBe(before + 1);
  const userDir = path.join(dataDir, 'users', 'nicola');
  const extraMedia = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(mp4|webm|mov)$/i.test(n)) extraMedia.push(p);
    }
  };
  walk(userDir);
  expect(extraMedia).toEqual([]);
});

test('v2d-66: in chiamata il luogo resta fisso, i clip partono, la memoria registra, screenshot 390x844', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Verificato su Chromium.');
  test.setTimeout(60000);
  fs.mkdirSync(SHOT, { recursive: true });

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
      const ws = { url, readyState: 0, sent: [], protocol: 'x', send() {}, close() { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000, reason: '' }); } };
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

  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.active, null, { timeout: 15000 });
  const first = await page.evaluate(() => ({
    place: App.locationCall.place(),
    locked: App.locationCall.locked(),
    still: App.locationCall.still(),
    ids: (App.locationCall.lib() || []).map((c) => c.id),
  }));
  expect(first.place).toBe('salotto');
  expect(first.locked).toBe(true);
  expect(first.still).toBe('/api/locations/salotto/still');
  expect(first.ids.length).toBeGreaterThan(0);
  expect(new Set(first.ids).size).toBe(first.ids.length);

  await page.waitForFunction(() => {
    const v = document.getElementById('motion-video') || document.querySelector('#stage video');
    return !!(v && v.currentTime > 0.05);
  }, null, { timeout: 8000 });
  await page.screenshot({ path: SHOT + '/call-salotto-home.png' });

  await expect.poll(async () => {
    const mem = await (await page.request.get('/api/motion-memory', { headers: HEAD })).json();
    return Object.values(mem.clips || {}).reduce((s, e) => s + (Number(e.playCount) || 0), 0);
  }, { timeout: 8000 }).toBeGreaterThan(0);

  const mid = await page.evaluate(() => App.locationCall.place());
  expect(mid).toBe('salotto'); // ancora lo stesso luogo a metà chiamata

  await page.evaluate(() => { if (App.call && App.call.end) App.call.end({ silent: true }); });
  await page.waitForFunction(() => App.call && !App.call.active && !App.locationCall.place());

  // seconda chiamata, luogo forzato barca (tatuaggio ufficiale visibile)
  await page.evaluate(() => {
    App.ls.set('locationForce', 'barca');
    App.hasAi = () => true;
    return App.call.start('video');
  });
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.locationCall.place() === 'barca', null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const v = document.getElementById('motion-video') || document.querySelector('#stage video');
    return !!(v && v.currentTime > 0.05);
  }, null, { timeout: 8000 });
  const barca = await page.evaluate(() => ({
    place: App.locationCall.place(),
    still: App.locationCall.still(),
    locked: App.locationCall.locked(),
    weights: (App.motionPlayer && App.motionPlayer.lib || []).map((c) => ({ id: c.id, w: c.weight })),
  }));
  expect(barca.place).toBe('barca');
  expect(barca.still).toBe('/api/locations/barca/still');
  expect(barca.locked).toBe(true);
  await page.screenshot({ path: SHOT + '/call-barca-tattoo.png' });
  await page.evaluate(() => { App.ls.set('locationForce', ''); if (App.call && App.call.end) App.call.end({ silent: true }); });
});


test('v2d-66: saluti e prompt di chiamata senza ahah/parla, niente te lo preparo', () => {
  const callSrc = fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8');
  const m = callSrc.match(/const GREET = \[([^\]]+)\]/);
  expect(m).toBeTruthy();
  const greet = m[1];
  expect(greet).not.toMatch(/ahah|haha|ah ah|parla|eccomi|ti ascolto/i);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  expect(server).not.toMatch(/Di. una frase corta tipo «te lo preparo»/);
  expect(server).toMatch(/niente «ahah»/);
  expect(server).toMatch(/handleSilence: false/);
  const voice = fs.readFileSync(path.join(__dirname, '../public/js/voice.js'), 'utf8');
  expect(voice).not.toMatch(/replace\([^)]*ahah[^)]*'\[laugh\]'\)/);
});

test('v2d-66: composizione percorsi, libreria movimenti distinta dai luoghi', async ({ request }) => {
  const compose = require('../public/js/clip-compose.js');
  const movements = [
    { id: 'studio-lace-sit', url: '/api/movements/studio-lace-sit.mp4', place: 'studio', outfit: 'lace-black', action: 'sit', from: 'stand', to: 'sit' },
    { id: 'studio-lace-stand-up', url: '/api/movements/studio-lace-stand-up.mp4', place: 'studio', outfit: 'lace-black', action: 'stand', from: 'sit', to: 'stand' },
    { id: 'studio-lace-turn', url: '/api/movements/studio-lace-turn.mp4', place: 'studio', outfit: 'lace-black', action: 'turn', from: 'stand', to: 'stand' },
  ];
  const location = [
    { id: 'salotto-idle', url: '/api/locations/salotto/salotto-idle-listen.mp4', place: 'salotto', outfit: 'home-shirt', action: 'idle', from: 'petto', to: 'petto', kind: 'base' },
  ];
  const sit = compose.plan('sedersi', { place: 'studio', outfit: 'lace-black', from: 'stand', movements, location });
  expect(sit.ok).toBe(true);
  expect(sit.path.map((c) => c.id)).toEqual(['studio-lace-sit']);
  const no = compose.plan('sedersi', { place: 'salotto', outfit: 'home-shirt', from: 'stand', movements, location });
  expect(no.ok).toBe(false);
  expect(no.reason).toMatch(/azione-assente|nessun-percorso|contesto/);
  const report = compose.report({ movements, location });
  const studio = report.find((r) => r.place === 'studio');
  expect(studio.composable).toEqual(expect.arrayContaining(['sit', 'stand', 'turn']));
  expect(studio.missing).toEqual(expect.arrayContaining(['talk', 'idle']));

  const r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
  const mov = await (await request.get('/api/movements', { headers: HEAD })).json();
  expect(mov.library).toBe('movement');
  expect(mov.clips.length).toBeGreaterThan(0);
  expect(mov.clips.every((c) => c.library === 'movement' && c.place && c.outfit && c.action)).toBe(true);
  const one = mov.clips.find((c) => c.id === 'studio-lace-sit');
  expect(one).toBeTruthy();
  const vid = await request.get(one.url, { headers: HEAD });
  expect(vid.ok()).toBeTruthy();
  expect(vid.headers()['content-type'] || '').toMatch(/video|octet/);
  // i vecchi clip non ufficiali dello showroom non sono più serviti
  expect((await request.get('/api/locations/showroom/showroom-talk-a.mp4', { headers: HEAD })).status()).toBe(404);
});
