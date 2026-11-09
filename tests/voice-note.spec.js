const { test, expect } = require('./harness');

test('il PIN è chiaro, con titolo verde e Avanti', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('.login-wordmark')).toHaveText('Nova');
  const screen = await page.evaluate(() => getComputedStyle(document.querySelector('.login-screen')).backgroundColor);
  expect(screen).toBe('rgb(255, 255, 255)');
  await page.locator('.login-profile').first().click();
  await expect(page.locator('#pin-submit')).toHaveText('Avanti');
  await expect(page.locator('#login-title')).toContainText('PIN');
  const field = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('pin-input'));
    return { inputmode: document.getElementById('pin-input').getAttribute('inputmode'), border: s.borderBottomColor };
  });
  expect(field.inputmode).toBe('numeric');
  expect(field.border).toBe('rgb(0, 168, 132)');
});

test('permesso microfono negato non invia un vocale', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (path === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', requests: '' }]);
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({});
    if (path === '/api/actions') return json([]);
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && document.getElementById('vn-mic'));
  const g = await page.evaluate(() => ({
    cancel: App.voiceNote.gesture(-90, 0, false),
    lock: App.voiceNote.gesture(0, -90, false),
    rec: App.voiceNote.gesture(-8, -8, false),
    phone: !!document.getElementById('wa-voice'),
    home: !!document.getElementById('wa-home'),
    video: !!document.getElementById('wa-video'),
  }));
  expect(g).toEqual({ cancel: 'cancel', lock: 'lock', rec: 'record', phone: false, home: true, video: true });
  await page.locator('#vn-mic').dispatchEvent('pointerdown', { pointerId: 1, clientX: 300, clientY: 700, button: 0 });
  await expect(page.locator('#vn-status')).toHaveText('Microfono non consentito.');
  await expect(page.locator('.has-voice')).toHaveCount(0);
});
