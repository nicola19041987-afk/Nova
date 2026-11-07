const { test, expect } = require('./harness');

test('il 3D è spento di default e, se scelto, carica il modello', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla home con l’avatar. Il caricamento è verificato su Chromium.');
  test.setTimeout(60000);
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/gestures') return json([]);
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.avatar3d);
  const before = await page.evaluate(() => ({
    value: document.getElementById('avatar-view').value,
    mode: App.avatar3d.mode(),
    on: document.body.classList.contains('vrm-on'),
  }));
  expect(before).toEqual({ value: 'photo', mode: 'photo', on: false });
  const loaded = await page.evaluate(async () => {
    await App.avatar3d.apply('3d');
    return { ready: App.avatar3d.ready(), failed: App.avatar3d.failed(), mode: App.avatar3d.mode(), on: document.body.classList.contains('vrm-on') };
  });
  expect(loaded.failed, loaded.failed).toBe('');
  expect(loaded.ready).toBe(true);
  expect(loaded.mode).toBe('3d');
  expect(loaded.on).toBe(true);
  const moved = await page.evaluate(() => {
    const heard = App.gestures.hear('fammi due passi');
    return { heard, clip: App.avatar3d.current(), full: !!(App.solo && App.solo.full) };
  });
  expect(moved.heard).toBe('play');
  expect(moved.clip).toBe('cammina');
  expect(moved.full).toBe(true);
});
