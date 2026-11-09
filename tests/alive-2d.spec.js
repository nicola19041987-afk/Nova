const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const PHOTO = fs.existsSync('/workspace/nova-3d-check/nova-ref.jpg')
  ? '/workspace/nova-3d-check/nova-ref.jpg'
  : path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');

async function mockPhoto(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    localStorage.setItem('ap:nicola:provaView', JSON.stringify('3d'));
    localStorage.setItem('ap:nicola:avatarViewPick', JSON.stringify('3d'));
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/8b4bf23923c5e90d.jpg', personality: 'x', style: '', orders: '', requests: '', voice: 'eve' }]);
    if (p === '/api/avatars/8b4bf23923c5e90d.jpg') return route.fulfill({ status: 200, contentType: 'image/jpeg', path: PHOTO });
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1' });
    if (p === '/api/gestures') return json([]);
    if (p === '/api/avatar-looks') return json({ entries: [], current: null });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

async function grab(page) {
  const data = await page.evaluate(() => document.getElementById('avatar-canvas').toDataURL('image/png'));
  return Buffer.from(data.split(',')[1], 'base64');
}

test('la foto 2D respira e il 3D non parte', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'Il movimento è verificato su Chromium; WebKit copre il resto della suite.');
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPhoto(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.locator('#back-btn').click();
  await page.locator('#nh-photo').click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => App.ls.get('provaView', ''))).toBe('2d');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('prova-toggle')).display)).toBe('none');
  expect(await page.evaluate(() => !!document.querySelector('script[src*="avatar3d"]'))).toBe(false);
  const dir = '/opt/cursor/artifacts';
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < 3; i++) {
    if (i) await page.waitForTimeout(700);
    const buf = await grab(page);
    const name = path.join(dir, `alive-2d-frame-${i + 1}.png`);
    fs.writeFileSync(name, buf);
    frames.push(buf);
  }
  const diff = (a, b) => {
    let n = 0, d = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 80; i < len; i += 40) { d += Math.abs(a[i] - b[i]); n++; }
    return d / Math.max(1, n);
  };
  expect(diff(frames[0], frames[2])).toBeGreaterThan(0.15);
});

test('con movimento ridotto la foto resta ferma', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'Il movimento è verificato su Chromium.');
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockPhoto(page);
  await page.goto('/');
  await page.waitForFunction(() => App.avatarConv && App.avatarConv.img && App.avatarConv.img.naturalWidth > 0);
  await page.waitForTimeout(300);
  const a = await grab(page);
  await page.waitForTimeout(900);
  const b = await grab(page);
  let n = 0, d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 80; i < len; i += 40) { d += Math.abs(a[i] - b[i]); n++; }
  expect(d / Math.max(1, n)).toBeLessThan(0.08);
});
