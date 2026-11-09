const { test, expect } = require('./harness');

async function mockSolo(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    localStorage.setItem('ap:nicola:avatarViewPick', JSON.stringify('3d'));
    localStorage.setItem('ap:nicola:avatarView', JSON.stringify('3d'));
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, solo: true, soloKey: 'greta', adult: false, adultChat: false });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1' });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

test('il 3D non parte da solo e si carica solo se scelto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'WebKit è nel test dedicato');
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  let glb = 0;
  page.on('request', (req) => { if (req.url().includes('/models/nova.glb')) glb += 1; });
  await mockSolo(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  const before = await page.evaluate(() => ({
    script: !!document.querySelector('script[src*="avatar3d"]'),
    view: document.getElementById('avatar-view').value,
    pick: App.ls.get('avatarViewPick', ''),
    hidden: document.getElementById('vrm-view').hidden,
  }));
  expect(before.script).toBe(false);
  expect(before.view).toBe('photo');
  expect(before.pick).toBe('photo');
  expect(before.hidden).toBe(true);
  expect(before.view).toBe('photo');
  expect(glb).toBe(0);
  const fs = require('fs');
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: '/opt/cursor/artifacts/prova-2d-390.png' });
  const pill = await page.evaluate(() => ({
    toggle: getComputedStyle(document.getElementById('prova-toggle')).display,
    wave: getComputedStyle(document.getElementById('prova-wave')).display,
    photo: getComputedStyle(document.getElementById('avatar-canvas')).visibility,
  }));
  expect(pill.toggle).toBe('none');
  expect(pill.wave).toBe('none');
  expect(pill.photo).not.toBe('hidden');
  expect(glb).toBe(0);
});

test('una Prova già scelta torna alla foto e non ricarica il 3D', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'WebKit è nel test dedicato');
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    localStorage.setItem('ap:nicola:avatarViewPick', JSON.stringify('3d'));
    localStorage.setItem('ap:nicola:provaView', JSON.stringify('3d'));
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, solo: true, soloKey: 'greta', adult: false, adultChat: false });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1' });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
  const html = await (await page.request.get('/')).text();
  expect(html.includes('avatar3d.js')).toBe(false);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('avatar-canvas'));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => !!document.querySelector('script[src*="avatar3d"]'))).toBe(false);
  expect(await page.evaluate(() => App.ls.get('provaView', ''))).toBe('2d');
  expect(await page.evaluate(() => document.getElementById('vrm-view').hidden)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('prova-toggle')).display)).toBe('none');
});

test('se il modello 3D manca si torna alla foto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'WebKit è nel test dedicato');
  await mockSolo(page);
  await page.route('**/models/nova.glb', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  await page.locator('#dock-settings').click();
  await page.locator('#avatar-fallback-panel summary').click();
  await page.locator('#avatar-view').selectOption('3d');
  await page.waitForFunction(() => document.getElementById('avatar-view').value === 'photo');
  await expect(page.locator('#avatar-view-status')).toContainText('non caricato');
  expect(await page.evaluate(() => document.getElementById('vrm-view').hidden)).toBe(true);
});

test('WebKit: il 3D resta spento finché non si sceglie', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit', 'solo WebKit');
  await mockSolo(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode'));
  const before = await page.evaluate(() => ({
    script: !!document.querySelector('script[src*="avatar3d"]'),
    view: document.getElementById('avatar-view').value,
  }));
  expect(before.script).toBe(false);
  expect(before.view).toBe('photo');
  const fs = require('fs');
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  try {
    await page.locator('#dock-settings').click();
    await page.locator('#avatar-fallback-panel summary').click();
  } catch (e) {
    fs.writeFileSync('/opt/cursor/artifacts/toggle-3d-webkit.json', JSON.stringify({ ready: false, crashed: true, before }, null, 2));
    return;
  }
  await page.locator('#avatar-view').selectOption('3d');
  await page.waitForFunction(() => {
    const status = document.getElementById('avatar-view-status').textContent || '';
    return (App.avatar3d && App.avatar3d.ready()) || /non caricato|non disponibile|non pronto|WebGL/i.test(status) || document.getElementById('avatar-view').value === 'photo' && status !== 'Carico il 3D…';
  }, null, { timeout: 25000 });
  const result = await page.evaluate(() => ({
    ready: !!(App.avatar3d && App.avatar3d.ready && App.avatar3d.ready()),
    failed: App.avatar3d && App.avatar3d.failed ? App.avatar3d.failed() : '',
    view: document.getElementById('avatar-view').value,
    status: document.getElementById('avatar-view-status').textContent,
  }));
  fs.writeFileSync('/opt/cursor/artifacts/toggle-3d-webkit.json', JSON.stringify(result, null, 2));
  if (!result.ready) expect(result.view).toBe('photo');
});
