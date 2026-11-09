const { test, expect } = require('./harness');

test('il PIN è chiaro, con titolo verde e Avanti', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla schermata di accesso. Il percorso è verificato su Chromium.');
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

test('permesso microfono negato non invia un vocale', async ({ page, browserName }) => {
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
    phone: getComputedStyle(document.getElementById('wa-voice')).display !== 'none',
    home: !!document.getElementById('wa-home'),
    video: getComputedStyle(document.getElementById('wa-video')).display !== 'none',
  }));
  expect(g).toEqual({ cancel: 'cancel', lock: 'lock', rec: 'record', phone: true, home: true, video: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const chat = App.chat;
    chat.addMsg({ role: 'user', author: 'nicola', authorName: 'Nico', content: 'Ciao Nova', at: new Date().toISOString(), id: 'u1' });
    chat.addMsg({ role: 'assistant', authorName: 'Nova', content: 'Ciao, sono qui.', at: new Date().toISOString(), id: 'a1' });
    chat.ticks();
  });
  const skin = await page.evaluate(() => {
    const user = document.querySelector('.msg.user');
    const nova = document.querySelector('.msg.assistant');
    const bg = getComputedStyle(document.getElementById('messages')).backgroundColor;
    return {
      pill: document.querySelector('.day-pill').textContent,
      user: getComputedStyle(user).backgroundColor,
      nova: getComputedStyle(nova).backgroundColor,
      ticks: document.querySelector('.ticks').textContent,
      bg,
      plus: !!document.getElementById('vn-plus'),
      cam: !!document.getElementById('vn-cam'),
    };
  });
  expect(skin.pill).toBe('Oggi');
  expect(skin.user).toBe('rgb(217, 253, 211)');
  expect(skin.nova).toBe('rgb(255, 255, 255)');
  expect(skin.ticks).toBe('✓✓');
  expect(skin.bg).toBe('rgb(239, 230, 216)');
  expect(skin.plus && skin.cam).toBe(true);
  if (browserName !== 'webkit') await page.screenshot({ path: '/opt/cursor/artifacts/wa-chat-390x844.png' });
  await page.locator('#vn-mic').dispatchEvent('pointerdown', { pointerId: 1, clientX: 300, clientY: 700, button: 0 });
  await expect(page.locator('#vn-status')).toHaveText(browserName === 'webkit' ? /non disponibile|non consentito/ : 'Microfono non consentito.');
  await expect(page.locator('.has-voice')).toHaveCount(0);
});
