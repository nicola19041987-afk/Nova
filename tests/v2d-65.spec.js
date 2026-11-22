// v2d-65: una sola voce in chiamata (niente TTS in parallelo al tempo reale);
// viso ufficiale v8 + pacchetti luogo; il SW cancella tutte le cache vecchie.
const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/nova-v2d65-shots';
const IRA = '5ce17a0000000001';
const OFFICIAL = '/api/avatars/c2d6200000000001.jpg';

test('v2d-65: cache del service worker, all\'attivazione si cancellano tutte le cache vecchie (anche nova-motion)', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-65b'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-64'");
  expect(sw).toContain('keys.filter((k) => k !== CACHE)');
  expect(sw).not.toContain("!k.startsWith('nova-motion-')");
  expect(sw).toMatch(/nova-motion/);
});

test('v2d-65b: icona e splash IRA (non Nova), cache-bust ?v=865', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8'));
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  expect(man.name).toBe('Ira');
  expect(man.short_name).toBe('Ira');
  expect(html).toContain('name="apple-mobile-web-app-title" content="Ira"');
  expect(html).toContain('<title>Ira</title>');
  expect(html).toMatch(/login-wordmark"[^>]*>IRA/);
  expect(html).toContain('?v=865');
  expect(html).not.toContain('?v=864');
  expect(JSON.stringify(man)).toContain('?v=865');
  expect(JSON.stringify(man)).not.toContain('?v=864');
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-65b'/);
  const icon = fs.readFileSync(path.join(__dirname, '../public/icons/icon-512.png'));
  // PNG del wordmark IRA v2d-53 (rosso #E50914 su nero puntinato), non il wordmark Nova azzurro
  expect(icon.length).toBeGreaterThan(1000);
  const fav = fs.readFileSync(path.join(__dirname, '../public/icons/favicon.svg'), 'utf8');
  expect(fav).toMatch(/#E50914/i);
  expect(fav).not.toMatch(/#4FC3F7/i);
  expect(fav.toLowerCase()).not.toContain('nova');
});

test('v2d-65: getUserMedia audio richiede sempre echoCancellation', async () => {
  const voice = fs.readFileSync(path.join(__dirname, '../public/js/voice.js'), 'utf8');
  expect(voice).toMatch(/echoCancellation:\s*true/);
  expect(voice).toMatch(/noiseSuppression:\s*true/);
  expect(voice).toMatch(/autoGainControl:\s*true/);
  // niente fallback { audio: true } senza cancellazione d'eco
  expect(voice).not.toMatch(/getUserMedia\(\{\s*audio:\s*true\s*\}\)/);
  const call = fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8');
  expect(call).toMatch(/echoCancellation:\s*true/);
});

test('v2d-65: in tempo reale niente seconda voce, viso ufficiale, niente gesti di repertorio', async ({ page, browserName }) => {
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
    window.__gum = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum.push(JSON.parse(JSON.stringify(c || {})));
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
    const Real = window.WebSocket;
    class FakeWS {
      constructor(url) {
        this.url = url; this.readyState = 0; this.sent = []; this.protocol = 'x';
        window.__ws = this; window.__wsList = (window.__wsList || []); window.__wsList.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); this.emit({ type: 'session.created' }); }, 20);
      }
      emit(ev) { this.onmessage && this.onmessage({ data: JSON.stringify(ev) }); }
      send(t) {
        let ev = {}; try { ev = JSON.parse(t); } catch {}
        this.sent.push(ev.type || 'raw');
        if (ev.type === 'session.update') setTimeout(() => this.emit({ type: 'session.updated' }), 5);
        if (ev.type === 'conversation.item.create') window.__rtItems = (window.__rtItems || 0) + 1;
      }
      close() { this.readyState = 3; this.closed = true; if (this.onclose) this.onclose({ code: 1000, reason: '' }); }
    }
    window.WebSocket = function (url, p) { return /fake-rt/.test(String(url)) ? new FakeWS(url) : new Real(url, p); };
  });

  await page.route('**/api/realtime/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      token: 'finto', url: 'wss://fake-rt.local/realtime', model: 'x',
      session: { instructions: 'x', voice: 'eve', turn_detection: { type: 'server_vad', threshold: 0.7 } },
    }),
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && App.current);
  await page.waitForFunction(() => window.App && App.locationCall && App.locationCall.loaded && App.locationCall.loaded());
  await page.evaluate(() => { App.hasAi = () => true; });

  const face = await page.evaluate((official) => {
    const ch = App.current;
    return {
      id: ch && ch.id,
      faceSrc: App.faceSrc(ch),
      official: official,
      locked: !!(App.faceLocked && App.faceLocked()),
    };
  }, OFFICIAL);
  expect(face.id).toBe(IRA);
  expect(face.faceSrc).toBe(OFFICIAL);
  expect(face.locked).toBe(true);

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Più tardi/i.test(x.textContent || '')); if (b) b.click(); });
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.engine() === 'realtime' && App.rt && App.rt.active, null, { timeout: 15000 });

  const during = await page.evaluate(() => {
    window.__tts = 0;
    const nx = App.tts;
    if (nx) {
      const say = nx.say.bind(nx), begin = nx.begin && nx.begin.bind(nx);
      nx.say = function () { window.__tts++; return say.apply(this, arguments); };
      if (begin) nx.begin = function () { window.__tts++; return begin.apply(this, arguments); };
    }
    const spoken = App.voice.speak('ciao dalla chat');
    const now = App.voice.sayNow('ciao adesso');
    const stream = App.voice.streamStart();
    const blocked = !!(App.voice.ttsBlocked && App.voice.ttsBlocked());
    App.chat.send('ciao in chiamata');
    const gesture = App.gestures && App.gestures.request ? App.gestures.request('saluto') : false;
    const gumAudio = (window.__gum || []).filter((c) => c && c.audio);
    const aec = gumAudio.map((c) => {
      const a = c.audio;
      return !!(a && a !== true && a.echoCancellation);
    });
    return {
      blocked, stream, gesture,
      ttsCalls: window.__tts,
      rtItems: window.__rtItems || 0,
      engine: App.call.engine(),
      face: App.faceSrc(App.current),
      place: App.locationCall.place(),
      locLocked: !!(App.locationCall.locked && App.locationCall.locked()),
      libUrls: (App.locationCall.lib() || []).map((c) => c.url),
      globalLib: !!(App.motionPlayer && App.motionPlayer.lib && App.motionPlayer.lib.some((c) => /\/api\/gestures\//.test(c.url || '') || (c.url && !/\/api\/locations\//.test(c.url)))),
      aec,
      audioElsPlaying: [...document.querySelectorAll('audio')].filter((a) => !a.paused && !a.muted && a.src).length,
    };
  });

  expect(during.engine).toBe('realtime');
  expect(during.blocked).toBe(true);
  expect(during.stream).toBe(false);
  expect(during.ttsCalls).toBe(0);
  expect(during.rtItems).toBeGreaterThan(0); // il testo è andato alla sessione live
  expect(during.gesture).toBe(false);
  expect(during.face).toBe(OFFICIAL);
  expect(during.locLocked).toBe(true);
  expect(during.libUrls.length).toBeGreaterThan(0);
  expect(during.libUrls.every((u) => u.includes('/api/locations/' + during.place + '/'))).toBe(true);
  expect(during.globalLib).toBe(false);
  expect(during.aec.length).toBeGreaterThan(0);
  expect(during.aec.every(Boolean)).toBe(true);
  expect(during.audioElsPlaying).toBe(0);

  await page.screenshot({ path: SHOT + '/call-official-voice.png' });
  await page.evaluate(() => { if (App.call && App.call.end) App.call.end({ silent: true }); });
});


test('v2d-65: ingranaggio Impostazioni in alto a destra sull\'elenco, interruttori si caricano e si salvano', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Verificato su Chromium.');
  test.setTimeout(45000);
  fs.mkdirSync(SHOT, { recursive: true });

  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();

  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });

  const puts = [];
  await page.route('**/api/settings', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch {}
      puts.push(body);
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id]');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Più tardi/i.test(x.textContent || '')); if (b) b.click(); });

  const gear = await page.evaluate(() => {
    const el = document.getElementById('list-settings');
    const bar = document.querySelector('.topbar');
    if (!el || !bar) return { ok: false };
    const s = getComputedStyle(el), r = el.getBoundingClientRect(), br = bar.getBoundingClientRect();
    const svg = el.querySelector('svg');
    const sr = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
    const rgb = (c) => {
      const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    };
    const [cr, cg, cb] = rgb(s.color);
    const [brr, brg, brb] = rgb(getComputedStyle(bar).backgroundColor);
    return {
      ok: true,
      visible: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.hidden,
      label: el.getAttribute('aria-label') || el.title,
      x: r.x, y: r.y, w: r.width, h: r.height, right: r.right,
      barRight: br.right, barTop: br.top, barBottom: br.bottom,
      svgW: sr.width, svgH: sr.height,
      color: [cr, cg, cb],
      barBg: [brr, brg, brb],
      btnBg: s.backgroundColor,
    };
  });
  expect(gear.ok && gear.visible).toBe(true);
  expect(gear.label).toBe('Impostazioni');
  expect(gear.w).toBeGreaterThanOrEqual(44);
  expect(gear.h).toBeGreaterThanOrEqual(44);
  expect(gear.svgW).toBeGreaterThanOrEqual(22);
  expect(gear.svgW).toBeLessThanOrEqual(26);
  expect(gear.svgH).toBeGreaterThanOrEqual(22);
  expect(gear.svgH).toBeLessThanOrEqual(26);
  expect(gear.right).toBeGreaterThan(340);
  expect(gear.y).toBeGreaterThanOrEqual(gear.barTop - 1);
  expect(gear.y + gear.h).toBeLessThanOrEqual(gear.barBottom + 1);
  expect(gear.barBg).toEqual([0, 0, 0]);
  // icona grigia, non bianca e non fucsia
  expect(gear.color[0]).toBeGreaterThan(120);
  expect(gear.color[0]).toBeLessThan(200);
  expect(Math.abs(gear.color[0] - gear.color[1])).toBeLessThan(8);
  expect(Math.abs(gear.color[1] - gear.color[2])).toBeLessThan(8);
  expect(gear.btnBg === 'rgba(0, 0, 0, 0)' || gear.btnBg === 'transparent' || gear.btnBg === 'rgb(0, 0, 0)').toBe(true);

  await page.screenshot({ path: SHOT + '/list-settings-gear.png' });

  await page.locator('#list-settings').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-settings') && document.getElementById('tab-account') && !document.getElementById('tab-account').hidden);
  await page.waitForFunction(() => window.App && App.settings);

  const open = await page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return !el.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const card = document.getElementById('tab-account');
    const filter = document.getElementById('set-content-filter');
    const adult = document.getElementById('set-adult');
    const gear = document.getElementById('list-settings');
    const gs = gear ? getComputedStyle(gear) : null;
    return {
      title: document.getElementById('title') && document.getElementById('title').textContent,
      tab: vis('tab-account'),
      list: vis('tab-chat') || document.body.classList.contains('solo-list'),
      filter: vis('set-content-filter') || !!(filter && filter.offsetParent),
      adult: vis('set-adult') || !!(adult && adult.offsetParent),
      filterLabel: filter && (filter.closest('label') && filter.closest('label').textContent || '').trim(),
      adultLabel: adult && (adult.closest('label') && adult.closest('label').textContent || '').trim(),
      filterOn: !!(filter && filter.checked),
      adultOn: !!(adult && adult.checked),
      settingsFilter: App.settings.contentFilter !== false,
      settingsAdult: !!App.settings.adultMode,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
      headerBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
      gearHidden: !gear || gs.display === 'none' || gear.hidden,
      house: vis('wa-home'),
      dock: vis('solo-dock'),
      voice: vis('wa-voice'),
    };
  });
  expect(open.title).toBe('Impostazioni');
  expect(open.tab).toBe(true);
  expect(open.list).toBe(false);
  expect(open.filter).toBe(true);
  expect(open.adult).toBe(true);
  expect(open.filterLabel).toMatch(/Filtro contenuti/i);
  expect(open.adultLabel).toMatch(/Modalità adulti \(18\+\)/i);
  expect(open.filterOn).toBe(open.settingsFilter);
  expect(open.adultOn).toBe(open.settingsAdult);
  expect(open.cardBg).toBe('rgb(0, 0, 0)');
  expect(open.headerBg).toBe('rgb(0, 0, 0)');
  expect(open.gearHidden).toBe(true);
  expect(open.house).toBe(false);
  expect(open.dock).toBe(false);
  expect(open.voice).toBe(false);

  await page.screenshot({ path: SHOT + '/impostazioni-open.png' });

  const wasOn = open.filterOn;
  page.once('dialog', (d) => d.accept());
  await page.locator('#set-content-filter').click({ force: true });
  await page.waitForTimeout(200);
  await expect.poll(() => puts.length, { timeout: 5000 }).toBeGreaterThan(0);
  const last = puts[puts.length - 1];
  expect(last.contentFilter).toBe(!wasOn);

  const after = await page.evaluate(() => ({
    ui: document.getElementById('set-content-filter').checked,
    mem: App.settings.contentFilter !== false,
  }));
  expect(after.ui).toBe(!wasOn);
  expect(after.mem).toBe(!wasOn);

  await page.locator('#back-btn').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-list'));
  const back = await page.evaluate(() => {
    const el = document.getElementById('list-settings');
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      title: document.getElementById('title') && document.getElementById('title').textContent,
      gear: s.display !== 'none' && r.width > 0,
      settings: document.body.classList.contains('solo-settings'),
    };
  });
  expect(back.title).toBe('Chat');
  expect(back.gear).toBe(true);
  expect(back.settings).toBe(false);
});
