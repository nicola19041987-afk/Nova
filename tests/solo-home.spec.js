const { test, expect } = require('@playwright/test');

const CHIARA = 'aaaaaaaaaaaaaaaa';
const NOVA = 'bbbbbbbbbbbbbbbb';

function characters() {
  return [
    { id: CHIARA, name: 'Chiara', ready: 'chiara', avatar: '🌿', personality: 'x', style: '', orders: '', requests: '', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: NOVA, name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
}

async function mockApp(page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (path === '/api/characters/options') return json({});
    if (path === '/api/characters') return json(characters());
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (path === '/api/images' || path === '/api/videos' || path === '/api/feed' || path === '/api/actions') return json([]);
    if (path === '/api/solo/prep') return json({ ok: true });
    return json({});
  });
}

test('login resta visibile e non si blocca', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('.login-wordmark')).toHaveText('Nova');
  await expect(page.locator('#profile-pick')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('#view-login')).toBeVisible();
  expect(errors).toEqual([]);
});

test('la home è solo Nova (id greta), non la lista e non Chiara', async ({ page }) => {
  await mockApp(page);
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#title')).toHaveText('Nova');
  await expect(page.locator('body')).toHaveClass(/solo-mode/);
  await expect(page.locator('body')).toHaveAttribute('data-tab', 'conv');
  await expect(page.locator('#tab-conv')).toBeVisible();
  await expect(page.locator('#solo-dock')).toBeVisible();
  await expect(page.locator('#avatar-canvas')).toBeVisible();
  await expect(page.locator('#chat-form')).toBeVisible();
  await expect(page.locator('#dock-mic')).toBeVisible();
  const box = await page.locator('#avatar-canvas').boundingBox();
  expect(box && box.width).toBeGreaterThan(200);
  expect(box && box.height).toBeGreaterThan(100);
  await page.evaluate(() => { document.getElementById('tab-chat').hidden = false; });
  await expect(page.locator('#tab-chat')).toBeHidden();
  await expect(page.locator('#char-list')).toBeHidden();
  await expect(page.locator('#new-char')).toBeHidden();
  await expect(page.locator('#preset-row')).toBeHidden();
  const opened = await page.evaluate(() => App.current && { id: App.current.id, ready: App.current.ready, name: App.current.name });
  expect(opened).toEqual({ id: NOVA, ready: 'greta', name: 'Nova' });
  await page.evaluate(() => {
    const m = document.createElement('div');
    m.id = 'keep-me';
    m.textContent = 'resta';
    document.querySelector('#messages').appendChild(m);
  });
  // La seconda lettura non deve passare dalla rete (il service worker può scavalcare il mock) né riaprire la chat.
  await page.evaluate(async () => {
    App.api = async (path) => {
      if (path === '/api/characters') return [
        { id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '' },
      ];
      return {};
    };
    await App.loadChars();
    await App.solo.boot();
  });
  await expect(page.locator('#keep-me')).toHaveText('resta');
  await expect(page.locator('#title')).toHaveText('Nova');
  await expect(page.locator('#tab-account')).toBeHidden();
});
