const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const CURRENT = '406a5539c61fafa9.jpg';
const OLDER = '8b4bf23923c5e90d.jpg';
const FACE = '/api/avatars/' + CURRENT;
const HISTORY = '/api/avatars/' + OLDER;
const NEXT = '/api/avatars/cccccccccccccccc.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');
const HEAD = { 'X-Requested-With': 'app-privata' };

test('senza cookie la foto attuale risponde 401, con il cookie si carica', async ({ request }) => {
  fs.mkdirSync('/tmp/nova-e2e-empty/shared/avatars', { recursive: true });
  fs.copyFileSync(JPEG, path.join('/tmp/nova-e2e-empty/shared/avatars', CURRENT));
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

test('la scheda Nova mostra avatar corrente, non la foto nello storico', async ({ page }) => {
  const asked = [];
  await page.context().addCookies([{ name: 'sid', value: 'sessione-test', url: 'http://127.0.0.1:8766' }]);
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    asked.push(p);
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE || p === NEXT) {
      const cookie = route.request().headers().cookie || '';
      if (!cookie.includes('sid=')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    }
    if (p === HISTORY) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'storico' });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: FACE, avatarSource: 'upload',
      personality: 'x', style: '', requests: '',
      lookHistory: [{ id: 'h0', at: '2026-11-01T00:00:00.000Z', avatar: HISTORY, reason: 'foto precedente' }],
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
  await page.waitForFunction((face) => {
    const img = document.querySelector('#wa-photo img');
    return img && img.dataset.src === face && img.naturalWidth > 400
      && App.OWNER_FACE == null
      && App.faceSrc(App.current) === face
      && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 400
      && App.avatarConv.img._src === face;
  }, FACE);
  expect(asked.filter((p) => p === HISTORY)).toEqual([]);
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
  await page.locator('#back-btn').click();
  await page.locator('#wa-home').click();
  await page.waitForFunction((face) => {
    const img = document.querySelector('#nh-avatar img');
    return img && img.dataset.src === face && img.naturalWidth > 400;
  }, FACE);
  await page.evaluate((next) => {
    const fresh = { ...App.current, avatar: next, landmarks: { ...App.current.landmarks, src: next } };
    App.chars = App.chars.map((c) => c.id === fresh.id ? fresh : c);
    App.solo.syncChar();
  }, NEXT);
  await page.waitForFunction((next) => {
    const img = document.querySelector('#wa-photo img');
    return img && img.dataset.src === next && img.naturalWidth > 400
      && App.avatarConv.img && App.avatarConv.img._src === next;
  }, NEXT);
});

test('all’avvio la foto corrente non viene sostituita con quella dello storico', async () => {
  const { spawn } = require('child_process');
  const os = require('os');
  const ROOT = path.join(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-face-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  const avatars = path.join(dir, 'shared', 'avatars');
  fs.mkdirSync(avatars, { recursive: true });
  const current = fs.readFileSync(JPEG);
  const older = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta.jpg'));
  fs.writeFileSync(path.join(avatars, CURRENT), current);
  fs.writeFileSync(path.join(avatars, OLDER), older);
  const record = {
    id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: FACE, avatarSource: 'upload',
    landmarks: { auto: true, src: FACE, eyeL: { x: 0.36, y: 0.32 }, eyeR: { x: 0.64, y: 0.32 }, mouth: { x: 0.5, y: 0.48 } },
    lookHistory: [{ id: 'h0', at: '2026-11-01T00:00:00.000Z', avatar: HISTORY, reason: 'foto precedente' }],
  };
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([record]));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), NOVA_E2E: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  try {
    const t0 = Date.now();
    while (!log.includes('App privata avviata')) {
      if (child.exitCode != null) throw new Error(log || 'server spento');
      if (Date.now() - t0 > 15000) throw new Error(log || 'avvio lento');
      await new Promise((ok) => setTimeout(ok, 40));
    }
    const chars = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const nova = chars.find((c) => c.id === '5ce17a0000000001');
    expect(nova.avatar).toBe(FACE);
    expect(nova.lookHistory[0].avatar).toBe(HISTORY);
    expect(fs.readFileSync(path.join(avatars, CURRENT)).equals(current)).toBe(true);
    expect(fs.readFileSync(path.join(avatars, OLDER)).equals(older)).toBe(true);
    expect(log.includes('volto ripristinato')).toBe(false);
  } finally {
    child.kill();
  }
});
