const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const FILE = '8b4bf23923c5e90d.jpg';
const FACE = '/api/avatars/' + FILE;
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const HEAD = { 'X-Requested-With': 'app-privata' };

test('senza cookie la foto dell’avatar risponde 401, con il cookie si carica', async ({ request }) => {
  fs.mkdirSync('/tmp/nova-e2e-empty/shared/avatars', { recursive: true });
  fs.copyFileSync(JPEG, path.join('/tmp/nova-e2e-empty/shared/avatars', FILE));
  const bare = await request.get(FACE);
  expect(bare.status()).toBe(401);
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const pic = await request.get(FACE);
  expect(pic.status()).toBe(200);
  expect(pic.headers()['content-type'] || '').toContain('image/jpeg');
  expect((await pic.body()).length).toBeGreaterThan(1000);
});

test('la scheda Nova con quella foto la mostra in testata, Home e a schermo intero', async ({ page }) => {
  await page.context().addCookies([{ name: 'sid', value: 'sessione-test', url: 'http://127.0.0.1:8766' }]);
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) {
      const cookie = route.request().headers().cookie || '';
      if (!cookie.includes('sid=')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    }
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: FACE, avatarSource: 'upload',
      personality: 'x', style: '', requests: '',
      landmarks: { auto: true, src: FACE, eyeL: { x: 0.36, y: 0.32 }, eyeR: { x: 0.64, y: 0.32 }, mouth: { x: 0.5, y: 0.48 } },
    }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json([]);
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => {
    const img = document.querySelector('#wa-photo img');
    return img && img.dataset.src === '/api/avatars/8b4bf23923c5e90d.jpg' && img.naturalWidth > 400 && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 400 && String(App.avatarConv.img._src).includes('8b4bf23923c5e90d');
  });
  await page.locator('#wa-photo').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-portrait'));
  const frame = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const s = getComputedStyle(document.getElementById('stage'));
    return { display: s.display, w: stage.width, h: stage.height, iw: innerWidth, ih: innerHeight };
  });
  expect(frame.display).not.toBe('none');
  expect(frame.w).toBeGreaterThanOrEqual(frame.iw - 2);
  expect(frame.h).toBeGreaterThan(frame.ih * 0.9);
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-17-portrait-390.png' });
  await page.locator('#back-btn').click();
  await page.locator('#wa-home').click();
  await page.waitForFunction(() => {
    const img = document.querySelector('#nh-avatar img');
    return img && img.naturalWidth > 400;
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-17-home-390.png' });
});
