const { test, expect } = require('./harness');

test('il fondo sotto i messaggi è grigio chiaro, le bolle e la carta restano', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🙂', personality: 'x', style: '', requests: '' }]);
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
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await page.evaluate(() => {
    const box = document.getElementById('messages');
    const a = document.createElement('div');
    a.className = 'msg assistant';
    a.innerHTML = '<div class="body">Ok, prova ricevuta.</div>';
    const u = document.createElement('div');
    u.className = 'msg user';
    u.innerHTML = '<div class="body">Ciao questa è una prova</div>';
    box.append(a, u);
    box.scrollTop = box.scrollHeight;
  });
  const colors = await page.evaluate(() => {
    const rgb = (el) => getComputedStyle(el).backgroundColor;
    const form = document.getElementById('chat-form');
    const messages = document.getElementById('messages');
    const bubble = document.querySelector('#messages .msg.user');
    const paper = document.querySelector('#messages .msg.assistant');
    return {
      conv: rgb(document.getElementById('tab-conv')),
      form: rgb(form),
      messages: rgb(messages),
      pattern: getComputedStyle(messages).backgroundImage.includes('svg'),
      user: rgb(bubble),
      nova: rgb(paper),
      header: rgb(document.querySelector('.topbar')),
    };
  });
  expect(colors.conv).toBe('rgb(240, 242, 245)');
  expect(colors.form).toBe('rgb(240, 242, 245)');
  expect(colors.messages).toBe('rgb(239, 230, 216)');
  expect(colors.pattern).toBe(true);
  expect(colors.user).toBe('rgb(217, 253, 211)');
  expect(colors.nova).toBe('rgb(255, 255, 255)');
  expect(colors.header).not.toBe('rgb(240, 242, 245)');
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-25-chat-390.png' });
  await page.evaluate(() => {
    window.__vvTest = { height: 430, offsetTop: 280 };
    document.getElementById('chat-input').focus();
    App.applyViewport();
  });
  const open = await page.evaluate(() => getComputedStyle(document.getElementById('chat-form')).backgroundColor);
  expect(open).toBe('rgb(240, 242, 245)');
  await page.locator('#app-shell').screenshot({ path: '/opt/cursor/artifacts/v2d-25-keyboard-390.png' });
});
