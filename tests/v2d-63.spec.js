// v2d-63: pacchetti luogo in videochiamata (showroom, barca, auto, salotto, camera, cucina, palestra).
// Prima chiamata dopo v2d-66: casa/salotto, poi rotazione deterministica persistita, senza ripetizioni immediate.
// Inquadratura e etichette come v2d-62 (etichette in alto a destra). Cache app-privata-v2d-63.
const { test, expect } = require('./harness');
const path = require('path');
const fs = require('fs');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOT = '/workspace/nova-v2d63-shots';
const IRA = '5ce17a0000000001';
const ORDER = ['showroom', 'barca', 'auto', 'salotto', 'camera', 'cucina', 'palestra'];

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

async function openIraChat(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && document.body.classList.contains('solo-list'));
  await page.waitForSelector('#char-list li[data-id] img');
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') || document.body.classList.contains('wa-conv') || (document.getElementById('tab-conv') && !document.getElementById('tab-conv').hidden));
  await page.waitForFunction(() => window.App && App.locationCall && App.locationCall.loaded && App.locationCall.loaded());
}

async function startVideoCall(page) {
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call') && App.call && App.call.mode === 'video');
  await page.waitForTimeout(700);
}

async function endVideoCall(page) {
  await page.evaluate(() => { if (App.call && App.call.end) App.call.end(); });
  await page.waitForFunction(() => !document.body.classList.contains('in-call'));
  await page.waitForTimeout(200);
}

async function pageEvaluateCall(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('stage');
    const st = getComputedStyle(stage);
    const box = (id) => {
      const el = document.getElementById(id) || document.querySelector(id);
      if (!el || el.hidden) return null;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { id, x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top };
    };
    const top = document.querySelector('.call-top');
    const topBox = top && !top.hidden ? top.getBoundingClientRect() : null;
    const vids = [...document.querySelectorAll('#motion-video, #motion-video-b')].map((v) => ({
      src: v.currentSrc || v.src || '',
      poster: v.getAttribute('poster') || '',
      w: v.getBoundingClientRect().width,
      h: v.getBoundingClientRect().height,
    }));
    return {
      mode: App.call && App.call.mode,
      place: App.locationCall && App.locationCall.place && App.locationCall.place(),
      still: App.locationCall && App.locationCall.still && App.locationCall.still(),
      locOn: stage.classList.contains('loc-call'),
      zoom: st.getPropertyValue('--call-zoom').trim(),
      last: App.ls ? App.ls.get('locationLast', '') : '',
      top: topBox ? { y: topBox.top, left: topBox.left, right: topBox.right } : null,
      x: box('call-min'),
      vids,
    };
  });
}

test('v2d-63: cache, pacchetti pronti, prima chiamata casa, rotazione persistente, screenshot 390x844', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Stesso percorso verificato su Chromium (390x844).');
  test.setTimeout(120000);
  fs.mkdirSync(SHOT, { recursive: true });

  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(6[3-6]|65b)'/);
  expect(sw).toContain('/js/location-call.js');
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-62'");

  await loginNicola(page);

  const loc = await (await page.request.get('/api/locations', { headers: HEAD })).json();
  expect(loc.default).toBe('showroom');
  expect(loc.pick).toBe('rotation');
  expect(loc.order).toEqual(ORDER);
  const readyIds = (loc.places || []).filter((p) => p.ready).map((p) => p.id);
  expect(readyIds).toEqual(ORDER);

  for (const id of ORDER) {
    const pack = await (await page.request.get('/api/locations/' + id, { headers: HEAD })).json();
    expect(pack.still).toBe('/api/locations/' + id + '/still');
    expect((pack.clips || []).length).toBeGreaterThanOrEqual(2);
    expect((pack.clips || []).some((c) => c.kind === 'base')).toBe(true);
    if (id === 'showroom') {
      expect(pack.framing).toBe('close');
      expect((pack.clips || []).every((c) => c.kind !== 'parla')).toBe(true);
    } else {
      expect(pack.framing).toBe('close');
      expect((pack.clips || []).some((c) => c.kind === 'parla')).toBe(true);
    }
    const stillRes = await page.request.get('/api/locations/' + id + '/still', { headers: HEAD });
    expect(stillRes.ok(), id + ' still').toBeTruthy();
    const clipFile = path.basename(pack.clips[0].url);
    const clipRes = await page.request.get('/api/locations/' + id + '/' + clipFile, { headers: HEAD });
    expect(clipRes.ok(), id + ' clip').toBeTruthy();
  }

  await disableSw(page);
  await openIraChat(page);

  // rotazione: pulisci lo storage (incluso il one-shot casa) e simula 8 avvii
  const HOME_ROTATION = ['salotto', 'camera', 'cucina', 'palestra', 'showroom', 'barca', 'auto', 'salotto'];
  const rotated = await page.evaluate((order) => {
    App.ls.del('locationLast');
    App.ls.del('locationForce');
    App.ls.del('locationHomeV266');
    const out = [];
    for (let i = 0; i < order.length + 1; i++) {
      App.locationCall.onCallStart('video');
      out.push({ place: App.locationCall.place(), last: App.ls.get('locationLast', ''), zoom: getComputedStyle(document.getElementById('stage')).getPropertyValue('--call-zoom').trim() });
      App.locationCall.onCallEnd();
    }
    return out;
  }, ORDER);
  expect(rotated.map((x) => x.place)).toEqual(HOME_ROTATION);
  for (let i = 1; i < rotated.length; i++) {
    expect(rotated[i].place).not.toBe(rotated[i - 1].place);
  }
  for (let i = 0; i < rotated.length; i++) {
    const z = parseFloat(rotated[i].zoom || '0');
    expect(z, rotated[i].place + ' zoom').toBeGreaterThanOrEqual(1.0);
    expect(z, rotated[i].place + ' zoom').toBeLessThanOrEqual(1.25);
  }

  // screenshot di ogni luogo (locationForce, senza toccare la rotazione reale oltre il test)
  for (const id of ORDER) {
    await page.evaluate((place) => {
      App.ls.set('locationForce', place);
    }, id);
    await startVideoCall(page);
    const call = await pageEvaluateCall(page);
    expect(call.mode).toBe('video');
    expect(call.locOn).toBe(true);
    expect(call.place).toBe(id);
    expect(call.still).toBe('/api/locations/' + id + '/still');
    const zoom = parseFloat(call.zoom || '0');
    expect(zoom, id + ' zoom').toBeGreaterThanOrEqual(1.0);
    expect(zoom, id + ' zoom').toBeLessThanOrEqual(1.25);
    expect(call.top).toBeTruthy();
    expect(call.top.right).toBeGreaterThan(390 - 160);
    expect(call.top.left).toBeGreaterThan(390 * 0.55);
    expect(call.top.y).toBeLessThan(140);
    expect(call.x).toBeTruthy();
    expect(call.x.right).toBeGreaterThan(390 - 70);
    expect(call.x.top).toBeLessThan(80);
    const media = [call.still, ...(call.vids || []).flatMap((v) => [v.src, v.poster])].join('\n');
    expect(media).toMatch(new RegExp('locations/' + id));
    const shot = path.join(SHOT, 'v2d-63-call-' + id + '.png');
    await page.screenshot({ path: shot, animations: 'disabled' });
    expect(fs.existsSync(shot)).toBe(true);
    await endVideoCall(page);
  }

  // dopo aver tolto force, la prima chiamata vera parte da casa (salotto), poi ruota
  await page.evaluate(() => { App.ls.del('locationForce'); App.ls.del('locationLast'); App.ls.del('locationHomeV266'); });
  await startVideoCall(page);
  const first = await pageEvaluateCall(page);
  expect(first.place).toBe('salotto');
  expect(first.last).toBe('salotto');
  const firstShot = path.join(SHOT, 'v2d-63-call-prima-salotto.png');
  await page.screenshot({ path: firstShot, animations: 'disabled' });
  await endVideoCall(page);
  await startVideoCall(page);
  const second = await pageEvaluateCall(page);
  expect(second.place).toBe('camera');
  const secondShot = path.join(SHOT, 'v2d-63-call-seconda-camera.png');
  await page.screenshot({ path: secondShot, animations: 'disabled' });
  await endVideoCall(page);
});
