const { test, expect } = require('./harness');
const path = require('path');

test('con la tastiera la testata resta in alto e il composer sopra di essa', async ({ page }) => {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/8b4bf23923c5e90d.jpg', personality: 'x', style: '', requests: '' }]);
    if (p === '/api/avatars/8b4bf23923c5e90d.jpg') return route.fulfill({ status: 200, contentType: 'image/jpeg', path: path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg') });
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
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && document.body.classList.contains('solo-home')) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat') && App.current);
  await page.evaluate(() => {
    const box = document.getElementById('messages');
    for (let i = 1; i <= 12; i++) {
      const el = document.createElement('div');
      el.className = i % 2 ? 'msg user' : 'msg assistant';
      el.innerHTML = `<div class="body">${i % 2 ? 'Messaggio di prova ' + i : 'Risposta ' + i}</div>`;
      box.appendChild(el);
    }
    box.lastElementChild.id = 'last-msg';
    box.scrollTop = box.scrollHeight;
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-23-chat-390.png' });
  const box = await page.evaluate(() => {
    window.scrollTo(0, 180);
    window.__vvTest = { height: 430, offsetTop: 280 };
    const input = document.getElementById('chat-input');
    input.focus();
    App.applyViewport();
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    const form = document.getElementById('chat-form').getBoundingClientRect();
    const last = document.getElementById('last-msg').getBoundingClientRect();
    const shell = document.getElementById('app-shell').getBoundingClientRect();
    return {
      scroll: window.scrollY,
      shellTop: shell.top,
      shellH: shell.height,
      header: topbar.top,
      formTop: form.top,
      formBottom: form.bottom,
      lastTop: last.top,
      lastBottom: last.bottom,
      headerText: document.getElementById('title').textContent,
    };
  });
  expect(box.scroll).toBe(0);
  expect(box.shellTop).toBeGreaterThan(270);
  expect(box.shellTop).toBeLessThan(290);
  expect(box.shellH).toBeGreaterThan(420);
  expect(box.shellH).toBeLessThan(440);
  expect(box.header).toBeGreaterThan(box.shellTop - 1);
  expect(box.header).toBeLessThan(box.shellTop + 70);
  expect(box.formBottom).toBeLessThanOrEqual(box.shellTop + box.shellH + 2);
  expect(box.formBottom).toBeGreaterThan(box.shellTop + box.shellH - 90);
  expect(box.lastBottom).toBeLessThanOrEqual(box.formTop + 8);
  expect(box.lastTop).toBeGreaterThan(box.header);
  expect(box.headerText).toBe('Nova');
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-23-keyboard-390.png' });
  await page.locator('#app-shell').screenshot({ path: '/opt/cursor/artifacts/v2d-23-keyboard-shell-390.png' });
});
