const { test, expect } = require('./harness');

async function openChat(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (path === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/8b4bf23923c5e90d.jpg', personality: 'x', style: '', requests: '' }]);
    if (path === '/api/avatars/8b4bf23923c5e90d.jpg') return route.fulfill({ status: 200, contentType: 'image/jpeg', path: require('path').join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg') });
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({});
    if (path === '/api/actions') return json([]);
    if (path === '/api/simli/session') return json({ error: 'Simli non configurato', fallback: true });
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current);
}

test('il campo torna a una riga e il microfono non ascolta da solo', async ({ page }) => {
  await openChat(page);
  expect(await page.evaluate(() => App.voice.isListening())).toBe(false);
  const input = page.locator('#chat-input');
  await input.fill('prima riga\nseconda riga lunga che allarga il campo');
  await page.waitForTimeout(50);
  const tall = await input.evaluate((el) => el.getBoundingClientRect().height);
  await page.locator('#chat-form button[type="submit"]').click();
  await expect(input).toHaveValue('');
  const short = await input.evaluate((el) => el.getBoundingClientRect().height);
  expect(short).toBeLessThanOrEqual(48);
  expect(tall).toBeGreaterThan(short);
});

test('il video in testata apre la chiamata a schermo intero', async ({ page, browserName }) => {
  await openChat(page);
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call'));
  const call = await page.evaluate(() => {
    const stage = getComputedStyle(document.getElementById('stage'));
    const ui = document.getElementById('call-ui');
    const cam = document.getElementById('call-cam');
    return {
      stage: stage.display,
      full: stage.position === 'fixed',
      ui: !ui.hidden,
      timer: document.getElementById('call-timer').textContent,
      camOff: cam.getAttribute('aria-pressed') === 'false',
      mute: !!document.getElementById('call-mute'),
      end: !!document.getElementById('call-end'),
      flip: !!document.getElementById('call-flip'),
      self: !!document.getElementById('call-self'),
      phone: !!document.getElementById('wa-voice'),
      house: getComputedStyle(document.getElementById('wa-home')).display !== 'none',
      face: (App.avatarConv.img && App.avatarConv.img._src) || '',
      wide: document.getElementById('avatar-canvas').getBoundingClientRect().width >= window.innerWidth - 2,
    };
  });
  expect(call.stage).not.toBe('none');
  expect(call.full).toBe(true);
  expect(call.ui).toBe(true);
  expect(call.timer).toMatch(/^\d\d:\d\d$/);
  expect(call.camOff).toBe(true);
  expect(call.mute && call.end && call.flip && call.self).toBe(true);
  expect(call.phone).toBe(false);
  expect(call.house).toBe(true);
  expect(call.face).toContain('8b4bf23923c5e90d');
  expect(call.wide).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-16-call-390.png' });
});
