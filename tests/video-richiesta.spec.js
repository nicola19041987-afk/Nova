// Video su richiesta in chiamata: tool mostra_video, endpoint autenticato con API xAI
// finta, pannello in chiamata, sessione realtime che resta una sola.
const { test, expect } = require('./harness');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEAD = { 'X-Requested-With': 'app-privata' };
const IRA = '5ce17a0000000001';
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures', 'call-video-mock.mp4'));

function listen(handler) {
  const srv = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on('data', (c) => { body = Buffer.concat([body, c]); });
    req.on('end', () => handler(req, res, body));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

function startServer(dir, aiPort, extra = {}) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-video-richiesta', NOVA_E2E: '1' };
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
  if (setup.status() === 409) {
    const l = await request.post(base + '/api/login', { data: { user, pin }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
}

function mockXai({ pendingFirst = 1 } = {}) {
  const hits = { gen: 0, status: 0, seen: [] };
  const polls = new Map();
  const start = listen((req, res, body) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    hits.seen.push(req.method + ' ' + url.pathname);
    if (url.pathname === '/clip.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': CLIP.length });
      res.end(CLIP);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/videos/generations') {
      hits.gen += 1;
      let j = {};
      try { j = JSON.parse(body.toString() || '{}'); } catch {}
      hits.lastBody = j;
      const id = 'rid-' + hits.gen;
      polls.set(id, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ request_id: id }));
      return;
    }
    const m = url.pathname.match(/^\/v1\/videos\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      hits.status += 1;
      const n = (polls.get(m[1]) || 0) + 1;
      polls.set(m[1], n);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (n <= pendingFirst) res.end(JSON.stringify({ status: 'pending' }));
      else res.end(JSON.stringify({ status: 'done', video: { url: `http://127.0.0.1:${srv.address().port}/clip.mp4`, duration: 5, respect_moderation: true }, model: 'grok-imagine-video-1.5-lite' }));
      return;
    }
    if (req.method === 'POST' && /realtime\/client_secrets/.test(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ value: 'tok-finto', expires_at: Date.now() + 300000 }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  let srv;
  return start.then((s) => { srv = s; return { srv, hits, close: () => new Promise((ok) => s.close(ok)) }; });
}

test('video-richiesta: cache app-privata-v2d-66', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-66'/);
  expect(sw).toContain('/js/call-video.js');
});

test('video-richiesta: tool mostra_video nella sessione, generazione finta, limiti e sicurezza', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'Verifica API sul server, eseguita su Chromium.');
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-video-'));
  const ai = await mockXai({ pendingFirst: 1 });
  const s = startServer(dir, ai.srv.address().port, { CALL_VIDEO_DAILY: '2' });
  try {
    await waitUp(s);
    const base = `http://127.0.0.1:${s.port}`;
    await login(request, base, 'nicola', '1357');

    const sess = await request.post(base + '/api/realtime/session', {
      data: { characterId: IRA, mode: 'video', voice: 'eve', location: 'showroom' },
      headers: HEAD,
    });
    expect(sess.ok(), await sess.text()).toBeTruthy();
    const sj = await sess.json();
    const tools = (sj.session && sj.session.tools) || [];
    expect(tools.some((t) => t && t.type === 'web_search')).toBeTruthy();
    const fn = tools.find((t) => t && t.type === 'function' && t.name === 'mostra_video');
    expect(fn).toBeTruthy();
    expect(JSON.stringify(fn.parameters)).toMatch(/descrizione/);
    expect(sj.session.voice).toBe('eve');
    expect(String(sj.instructions || sj.session.instructions || '') + JSON.stringify(sj.session)).toMatch(/mostra_video|VIDEO SU RICHIESTA/);
    expect(tools.some((t) => t && t.name === 'muovi')).toBeTruthy();
    expect(String(sj.instructions || sj.session.instructions || '')).not.toMatch(/Di. una frase corta tipo «te lo preparo»/);
    expect(String(sj.instructions || sj.session.instructions || '')).toMatch(/non dire «te lo preparo»/);

    const inst = await request.post(base + '/api/realtime/instructions', {
      data: { characterId: IRA, mode: 'video', location: 'showroom' },
      headers: HEAD,
    });
    expect(inst.ok(), await inst.text()).toBeTruthy();
    const instText = (await inst.json()).instructions;
    expect(instText).toMatch(/mostra_video|VIDEO SU RICHIESTA/);
    expect(instText).not.toMatch(/Di. una frase corta tipo «te lo preparo»/);
    expect(instText).toMatch(/non dire «te lo preparo»/);
    expect(instText).toMatch(/muovi/);
    expect(instText).toMatch(/niente «ahah»/);

    const bad = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'una persona nuda sul letto' },
      headers: HEAD,
    });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).code).toBe('UNSAFE');

    const celeb = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'una celebrità che beve il caffè' },
      headers: HEAD,
    });
    expect(celeb.status()).toBe(400);
    expect((await celeb.json()).code).toBe('UNSAFE');

    const youth = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'una bambina che beve il caffè' },
      headers: HEAD,
    });
    expect(youth.status()).toBe(400);

    const start = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'una persona che beve il caffè' },
      headers: HEAD,
    });
    expect(start.ok(), await start.text()).toBeTruthy();
    const job = await start.json();
    expect(job.status).toBe('pending');
    expect(job.id).toBeTruthy();
    expect(ai.hits.lastBody.model).toBe('grok-imagine-video-1.5-lite');
    expect(ai.hits.lastBody.duration).toBe(5);
    expect(ai.hits.lastBody.resolution).toBe('720p');
    expect(String(ai.hits.lastBody.prompt)).toMatch(/No explicit sexual content/);
    expect(String(ai.hits.lastBody.prompt)).toMatch(/No on-screen text/);
    expect(String(ai.hits.lastBody.prompt)).toMatch(/persona che beve il caffè/);

    const busy = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'un gatto al sole' },
      headers: HEAD,
    });
    expect(busy.status()).toBe(429);
    expect((await busy.json()).code).toBe('BUSY');

    const mid = await request.get(base + '/api/call-videos/' + job.id, { headers: HEAD });
    expect(mid.ok(), await mid.text()).toBeTruthy();
    expect((await mid.json()).status).toBe('pending');

    const done = await request.get(base + '/api/call-videos/' + job.id, { headers: HEAD });
    expect(done.ok(), await done.text()).toBeTruthy();
    const fin = await done.json();
    expect(fin.status).toBe('done');
    expect(fin.chatUrl).toMatch(/\/api\/chat-media\/[a-f0-9]{16}\.mp4/);
    expect(fin.photo && fin.photo.kind).toBe('video');

    const media = await request.get(base + fin.chatUrl, { headers: HEAD });
    expect(media.ok()).toBeTruthy();
    const buf = Buffer.from(await media.body());
    expect(buf.length).toBe(CLIP.length);

    const chat = await request.get(base + '/api/chats/' + IRA, { headers: HEAD });
    expect(chat.ok(), await chat.text()).toBeTruthy();
    const msgs = (await chat.json()).messages || [];
    const vidMsg = msgs.find((m) => m.photo && m.photo.kind === 'video');
    expect(vidMsg).toBeTruthy();
    expect(vidMsg.role).toBe('assistant');

    const second = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'un gatto al sole' },
      headers: HEAD,
    });
    expect(second.ok(), await second.text()).toBeTruthy();
    const job2 = await second.json();
    await request.get(base + '/api/call-videos/' + job2.id, { headers: HEAD });
    const done2 = await request.get(base + '/api/call-videos/' + job2.id, { headers: HEAD });
    expect((await done2.json()).status).toBe('done');

    const cap = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'un caffè in una tazza' },
      headers: HEAD,
    });
    expect(cap.status()).toBe(429);
    expect((await cap.json()).code).toBe('DAILY');

    const unauth = await request.post(base + '/api/call-videos', {
      data: { characterId: IRA, descrizione: 'un caffè' },
    });
    expect(unauth.status()).toBe(403);
  } finally {
    s.child.kill('SIGTERM');
    await ai.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('video-richiesta: in chiamata il pannello compare e resta una sola sessione realtime', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Il socket finto è verificato su Chromium.');
  test.setTimeout(90000);

  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.addInitScript(() => {
    window.__gum = [];
    window.__wsList = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum.push({ audio: !!(c && c.audio), video: !!(c && c.video) });
      const tracks = [];
      if (c && c.video) {
        const cv = document.createElement('canvas');
        cv.width = 720; cv.height = 960;
        const g = cv.getContext('2d');
        g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, 720, 960);
        cv.captureStream(8).getVideoTracks().forEach((t) => tracks.push(t));
      }
      if (c && c.audio) {
        const a = new (window.AudioContext || window.webkitAudioContext)();
        a.createMediaStreamDestination().stream.getAudioTracks().forEach((t) => tracks.push(t));
      }
      return new MediaStream(tracks);
    };
    const Real = window.WebSocket;
    class FakeWS {
      constructor(url) {
        this.url = url; this.readyState = 0; this.sent = []; this.protocol = 'x';
        window.__ws = this; window.__wsList.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.emit({ type: 'session.created' }); }, 20);
      }
      emit(ev) { this.onmessage && this.onmessage({ data: JSON.stringify(ev) }); }
      send(t) {
        let ev = {}; try { ev = JSON.parse(t); } catch {}
        this.sent.push(ev);
        if (ev.type === 'session.update') setTimeout(() => this.emit({ type: 'session.updated' }), 5);
      }
      close() { this.readyState = 3; this.closed = true; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
    }
    window.WebSocket = function (url, p) { return /fake-rt/.test(String(url)) ? new FakeWS(url) : new Real(url, p); };
  });

  const r0 = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r0.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r0.ok(), await r0.text()).toBeTruthy();

  let sessions = 0;
  await page.route('**/api/realtime/session', async (route) => {
    sessions += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'finto',
        url: 'wss://fake-rt.local/realtime',
        model: 'x',
        session: {
          instructions: 'x',
          voice: 'eve',
          turn_detection: { type: 'server_vad', threshold: 0.7 },
          tools: [{ type: 'web_search' }, { type: 'function', name: 'mostra_video', parameters: { type: 'object', properties: { descrizione: { type: 'string' } }, required: ['descrizione'] } }],
        },
      }),
    });
  });

  let videoPosts = 0;
  await page.route('**/api/call-videos', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    videoPosts += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'job-ui-1', status: 'pending', descrizione: 'una persona che beve il caffè' }),
    });
  });
  let statusHits = 0;
  await page.route('**/api/call-videos/job-ui-1', async (route) => {
    statusHits += 1;
    const ready = statusHits >= 2;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ready
        ? { id: 'job-ui-1', status: 'done', chatUrl: '/api/chat-media/aaaaaaaaaaaaaaaa.mp4', url: '/api/videos/file/aaaaaaaaaaaaaaaa.mp4', photo: { file: 'aaaaaaaaaaaaaaaa.mp4', kind: 'video' }, saved: true }
        : { id: 'job-ui-1', status: 'pending', descrizione: 'una persona che beve il caffè' }),
    });
  });
  await page.route('**/api/chat-media/aaaaaaaaaaaaaaaa.mp4', async (route) => {
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: CLIP });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id] img');
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') || document.body.classList.contains('wa-conv'));
  await page.waitForFunction(() => window.App && App.locationCall && App.locationCall.loaded && App.locationCall.loaded());
  await page.evaluate(() => { App.hasAi = () => true; });
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Più tardi/i.test(x.textContent || '')); if (b) b.click(); });
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.engine() === 'realtime' && App.rt && App.rt.active, null, { timeout: 15000 });

  const before = await page.evaluate(() => ({
    sessionsOpen: (window.__wsList || []).filter((w) => w.readyState === 1).length,
    sessionsAll: (window.__wsList || []).length,
    panel: !document.getElementById('call-video-panel').hidden,
  }));
  expect(sessions).toBe(1);
  expect(before.sessionsOpen).toBe(1);
  expect(before.panel).toBe(false);

  await page.evaluate(() => {
    const ws = window.__ws;
    ws.emit({ type: 'response.function_call_arguments.done', name: 'mostra_video', call_id: 'call-1', arguments: JSON.stringify({ descrizione: 'una persona che beve il caffè' }) });
  });

  await page.waitForFunction(() => {
    const p = document.getElementById('call-video-panel');
    return p && !p.hidden;
  }, null, { timeout: 10000 });

  await page.waitForFunction(() => {
    const v = document.getElementById('call-video-player');
    return v && !v.hidden && !!(v.src || v.currentSrc);
  }, null, { timeout: 15000 });

  const after = await page.evaluate(() => {
    const p = document.getElementById('call-video-panel');
    const v = document.getElementById('call-video-player');
    const pr = p.getBoundingClientRect();
    const face = document.getElementById('avatar-canvas') || document.getElementById('motion-video');
    const fr = face ? face.getBoundingClientRect() : { top: 0, height: 0 };
    const sent = (window.__ws && window.__ws.sent) || [];
    return {
      sessionsOpen: (window.__wsList || []).filter((w) => w.readyState === 1).length,
      sessionsAll: (window.__wsList || []).length,
      rtLive: !!(App.rt && App.rt.live && App.rt.live()),
      engine: App.call.engine(),
      panel: !p.hidden,
      video: !v.hidden,
      src: v.currentSrc || v.src,
      muted: v.muted,
      panelBottom: pr.bottom,
      panelTop: pr.top,
      midFace: fr.top + fr.height * 0.35,
      outputs: sent.filter((e) => e && e.type === 'conversation.item.create' && e.item && e.item.type === 'function_call_output').length,
      creates: sent.filter((e) => e && e.type === 'response.create').length,
    };
  });

  expect(sessions).toBe(1);
  expect(after.sessionsOpen).toBe(1);
  expect(after.sessionsAll).toBe(1);
  expect(after.rtLive).toBe(true);
  expect(after.engine).toBe('realtime');
  expect(after.panel).toBe(true);
  expect(after.video).toBe(true);
  expect(after.src).toContain('aaaaaaaaaaaaaaaa.mp4');
  expect(after.muted).toBe(true);
  expect(after.outputs).toBeGreaterThanOrEqual(1);
  expect(after.creates).toBeGreaterThanOrEqual(1);
  expect(after.panelTop).toBeGreaterThan(after.midFace);
  expect(videoPosts).toBe(1);

  await page.locator('#call-video-close').click();
  await page.waitForFunction(() => document.getElementById('call-video-panel').hidden);
  expect(await page.evaluate(() => (window.__wsList || []).filter((w) => w.readyState === 1).length)).toBe(1);

  await page.evaluate(() => { if (App.call && App.call.end) App.call.end({ silent: true }); });
});
