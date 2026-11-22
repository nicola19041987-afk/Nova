// v2d-64: una sola sessione vocale e una sola chat per chiamata; il luogo resta fisso
// fino al riaggancio; un solo getUserMedia; istruzioni di presenza nel luogo.
const { test, expect } = require('./harness');
const fs = require('fs');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/nova-v2d64-shots';
const IRA = '5ce17a0000000001';

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

async function disableSw(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
}

async function stubCallMedia(page) {
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
        g.fillStyle = '#3a2a22'; g.beginPath(); g.arc(360, 430, 150, 0, Math.PI * 2); g.fill();
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
        this.sent.push(ev.type || 'raw');
        if (ev.type === 'session.update') setTimeout(() => this.emit({ type: 'session.updated' }), 5);
      }
      close() { this.readyState = 3; this.closed = true; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
    }
    window.WebSocket = function (url, p) { return /fake-rt/.test(String(url)) ? new FakeWS(url) : new Real(url, p); };
  });
}

async function openIraChat(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id] img');
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') || document.body.classList.contains('wa-conv'));
  await page.waitForFunction(() => window.App && App.locationCall && App.locationCall.loaded && App.locationCall.loaded());
  await page.evaluate(() => { App.hasAi = () => true; });
}

test('v2d-64: cache del service worker app-privata-v2d-64', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(6[4-7]|65b)'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-63'");
  expect(sw).toContain('/js/location-call.js');
});

test('v2d-64: istruzioni realtime, presenza nel luogo, mai «esisto solo in app»', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Verificato su Chromium.');
  await loginNicola(page);
  const r = await page.request.post('/api/realtime/instructions', {
    data: { characterId: IRA, mode: 'video', location: 'barca' },
    headers: HEAD,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const j = await r.json();
  const text = String(j.instructions || '');
  expect(text).toContain('PRESENZA NEL LUOGO');
  expect(text).toMatch(/fisicamente in barca/i);
  expect(text).toMatch(/yacht al tramonto/i);
  expect(text).toContain('Non dire mai che esisti solo in un\'app');
  expect(text).toMatch(/alla prossima potrai collegarti da un altro posto/);
  expect(text).not.toMatch(/esisto solo nell['']app/i);
});

test('v2d-64: una sessione vocale, niente chat doppia, luogo fisso, clip che avanza, un getUserMedia', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Il socket finto è verificato su Chromium.');
  test.setTimeout(90000);
  fs.mkdirSync(SHOT, { recursive: true });

  await loginNicola(page);
  await disableSw(page);
  await stubCallMedia(page);
  let sessions = 0;
  const sessionBodies = [];
  await page.route('**/api/realtime/session', async (route) => {
    sessions += 1;
    try { sessionBodies.push(route.request().postDataJSON() || {}); } catch { sessionBodies.push({}); }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'finto',
        url: 'wss://fake-rt.local/realtime',
        model: 'x',
        session: { instructions: 'x', voice: 'eve', turn_detection: { type: 'server_vad', threshold: 0.7 } },
      }),
    });
  });

  await openIraChat(page);
  await page.evaluate(() => { App.ls.set('locationLast', ''); App.ls.set('locationForce', ''); });

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Più tardi/i.test(x.textContent || '')); if (b) b.click(); });
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.mode === 'video' && App.call.engine() === 'realtime' && App.rt && App.rt.active, null, { timeout: 15000 });
  await page.waitForTimeout(800);

  const first = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('#motion-video, #motion-video-b')];
    const playing = vids.find((v) => v.src || v.currentSrc);
    const msgs = [...document.querySelectorAll('#messages .msg, #solo-msgs .msg, #chat-log .msg, [data-n], .bubble')].map((el) => ({
      n: el.getAttribute('data-n') || el.dataset.n || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    }));
    return {
      place: App.locationCall.place(),
      locked: !!(App.locationCall.locked && App.locationCall.locked()),
      still: App.locationCall.still(),
      lib: (App.locationCall.lib() || []).map((c) => c.url),
      engine: App.call.engine(),
      rtLive: !!(App.rt.live && App.rt.live()),
      rtActive: !!App.rt.active,
      gum: window.__gum.slice(),
      wsOpen: (window.__wsList || []).filter((w) => w.readyState === 1).length,
      wsAll: (window.__wsList || []).length,
      audioEls: document.querySelectorAll('audio').length,
      selfHidden: !!(document.getElementById('call-self') && document.getElementById('call-self').hidden),
      selfZoom: getComputedStyle(document.getElementById('call-self')).transform,
      selfW: document.getElementById('call-self') && document.getElementById('call-self').getBoundingClientRect().width,
      selfH: document.getElementById('call-self') && document.getElementById('call-self').getBoundingClientRect().height,
      time0: playing ? playing.currentTime : 0,
      src0: playing ? (playing.currentSrc || playing.src) : '',
      msgs,
    };
  });

  expect(first.place).toBeTruthy();
  expect(first.locked).toBe(true);
  expect(first.engine).toBe('realtime');
  expect(first.rtActive).toBe(true);
  expect(first.rtLive).toBe(true);
  expect(sessions).toBe(1);
  expect(first.wsOpen).toBe(1);
  expect(sessionBodies[0].location).toBe(first.place);
  // un solo getUserMedia all'avvio, con audio e video insieme (niente secondo permesso)
  expect(first.gum.length).toBe(1);
  expect(first.gum[0].audio).toBe(true);
  expect(first.gum[0].video).toBe(true);
  expect(first.selfHidden).toBe(false);
  expect(first.selfW).toBeLessThanOrEqual(140);
  expect(first.lib.length).toBeGreaterThan(0);
  expect(first.lib.every((u) => u.includes('/api/locations/' + first.place + '/'))).toBe(true);

  await page.waitForFunction(() => {
    const vids = [...document.querySelectorAll('#motion-video, #motion-video-b')];
    return vids.some((v) => (v.currentSrc || v.src) && !v.paused && v.currentTime > 0.05);
  }, null, { timeout: 8000 });
  await page.screenshot({ path: SHOT + '/call-same-place-1.png' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT + '/call-same-place-2.png' });

  const mid = await page.evaluate(() => {
    const vids = [...document.querySelectorAll('#motion-video, #motion-video-b')];
    const playing = vids.find((v) => (v.currentSrc || v.src) && v.currentTime > 0) || vids.find((v) => v.src || v.currentSrc);
    const srcs = vids.map((v) => v.currentSrc || v.src || '').filter(Boolean);
    return {
      place: App.locationCall.place(),
      time: playing ? playing.currentTime : 0,
      srcs,
      paused: playing ? playing.paused : true,
    };
  });

  expect(mid.place).toBe(first.place);
  expect(mid.srcs.every((u) => !u || u.includes('/api/locations/' + first.place + '/') || u.startsWith('blob:'))).toBe(true);
  expect(mid.time).toBeGreaterThan(0);

  await page.screenshot({ path: SHOT + '/call-same-place-3.png' });

  // secondo avvio a chiamata già aperta (stesso percorso del tasto video): non parte una seconda sessione
  await page.evaluate(() => App.call.requestStart('video'));
  await page.waitForTimeout(500);
  const stillOne = await page.evaluate(() => ({
    place: App.locationCall.place(),
    engine: App.call.engine(),
    rtLive: !!(App.rt.live && App.rt.live()),
    wsOpen: (window.__wsList || []).filter((w) => w.readyState === 1).length,
    minimized: !!App.call.minimized,
    msgs: [...document.querySelectorAll('#messages .msg, #solo-msgs .msg, [data-n]')].map((el) => (el.getAttribute('data-n') || el.textContent || '').trim()),
  }));
  expect(stillOne.minimized).toBe(false);
  expect(stillOne.place).toBe(first.place);
  expect(stillOne.engine).toBe('realtime');
  expect(sessions).toBe(1);
  expect(stillOne.wsOpen).toBe(1);
  const uniq = new Set(stillOne.msgs.filter(Boolean));
  expect(uniq.size).toBe(stillOne.msgs.filter(Boolean).length);

  // riduci (✕) e «nuova chiamata»: chiude la sessione precedente, ne apre una sola
  await page.evaluate(() => App.call.minimize());
  await page.waitForFunction(() => App.call && App.call.minimized);
  expect(await page.evaluate(() => App.locationCall.place())).toBe(first.place);
  await page.evaluate(() => App.call.requestStart('video'));
  await page.waitForFunction(() => document.body.classList.contains('in-call') && !document.body.classList.contains('call-min') && App.rt && App.rt.active, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const afterNew = await page.evaluate(() => ({
    place: App.locationCall.place(),
    minimized: !!App.call.minimized,
    engine: App.call.engine(),
    rtLive: !!(App.rt.live && App.rt.live()),
    wsOpen: (window.__wsList || []).filter((w) => w.readyState === 1).length,
    wsClosed: (window.__wsList || []).filter((w) => w.readyState === 3 || w.closed).length,
    gum: window.__gum.slice(),
  }));
  expect(afterNew.minimized).toBe(false);
  expect(afterNew.engine).toBe('realtime');
  expect(afterNew.rtLive).toBe(true);
  expect(sessions).toBe(2);
  expect(afterNew.wsOpen).toBe(1);
  expect(afterNew.wsClosed).toBeGreaterThanOrEqual(1);
  // nuovo avvio: un altro getUserMedia combinato, non due (audio e video separati)
  // Il microfono finto è silenzioso: dopo ~4 s il riacquisto (preesistente) può aprire un getUserMedia solo audio.
  // L'avvio di ciascuna chiamata deve restare un solo getUserMedia combinato, mai una seconda fotocamera.
  const combined = afterNew.gum.filter((g) => g.audio && g.video);
  const videoOnly = afterNew.gum.filter((g) => g.video && !g.audio);
  expect(combined.length).toBe(2);
  expect(videoOnly.length).toBe(0);
  expect(afterNew.gum[0]).toEqual({ audio: true, video: true });
  expect(afterNew.gum[afterNew.gum.length - 1]).toEqual({ audio: true, video: true });

  await page.evaluate(() => { if (App.call && App.call.end) App.call.end({ silent: true }); });
});
