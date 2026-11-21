// v2d-58: colori della sola chat Ira (fondo nero, bolle grigio scuro / fucsia, testo bianco,
// pillola «Oggi» grigio chiaro, orario e spunte chiari). Niente cambi di layout, elenco, server o voce.
const { test, expect } = require('./harness');

test('v2d-58: cache e colori della chat Ira (nero, grigio, fucsia)', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(60|[6-9]\d)'/); // v2d-60 alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-59'");

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
  await page.waitForFunction(() => (!(App.solo && App.solo._bound && App.current && (document.body.classList.contains('solo-home') || document.body.classList.contains('solo-list'))) || (App.solo.showChat(), 1)) && document.body.classList.contains('solo-chat'));
  await page.evaluate(() => {
    const chat = App.chat;
    const at = new Date().toISOString();
    chat.addMsg({ role: 'assistant', authorName: 'Ira', content: 'Ciao, sono in salone.', at, id: 'a1' });
    chat.addMsg({ role: 'assistant', authorName: 'Ira', content: 'Vuoi che ti mostri la Cayman?', at, id: 'a2' });
    chat.addMsg({ role: 'user', author: 'nicola', authorName: 'Nico', content: 'Sì, grazie.', at, id: 'u1' });
    chat.addMsg({ role: 'user', author: 'nicola', authorName: 'Nico', content: 'Perfetto, così va bene.', at, id: 'u2' });
    chat.ticks();
  });
  const skin = await page.evaluate(() => {
    const rgb = (el) => getComputedStyle(el).backgroundColor;
    const col = (el) => getComputedStyle(el).color;
    const user = document.querySelector('#messages .msg.user');
    const ira = document.querySelector('#messages .msg.assistant');
    const pill = document.querySelector('#messages .day-pill');
    const meta = user && user.querySelector('.meta');
    const ticks = user && user.querySelector('.ticks');
    return {
      messages: rgb(document.getElementById('messages')),
      pattern: getComputedStyle(document.getElementById('messages')).backgroundImage,
      conv: rgb(document.getElementById('tab-conv')),
      form: rgb(document.getElementById('chat-form')),
      user: rgb(user),
      ira: rgb(ira),
      userText: col(user.querySelector('.body') || user),
      iraText: col(ira.querySelector('.body') || ira),
      pillBg: pill ? rgb(pill) : null,
      pillFg: pill ? col(pill) : null,
      pillText: pill ? pill.textContent : null,
      meta: meta ? col(meta) : null,
      ticks: ticks ? col(ticks) : null,
      ticksText: ticks ? ticks.textContent : null,
    };
  });
  expect(skin.messages).toBe('rgb(0, 0, 0)');
  expect(skin.conv).toBe('rgb(0, 0, 0)');
  expect(skin.form).toBe('rgb(0, 0, 0)');
  expect(skin.pattern === 'none' || skin.pattern === 'none !important').toBeTruthy();
  expect(skin.user).toBe('rgb(194, 24, 91)');
  expect(skin.ira).toBe('rgb(42, 42, 42)');
  expect(skin.userText).toBe('rgb(255, 255, 255)');
  expect(skin.iraText).toBe('rgb(255, 255, 255)');
  expect(skin.pillText).toBe('Oggi');
  expect(skin.pillBg).toBe('rgb(229, 229, 229)');
  expect(skin.pillFg).toBe('rgb(0, 0, 0)');
  expect(skin.meta).toBe('rgba(255, 255, 255, 0.7)');
  expect(skin.ticks).toBe('rgba(255, 255, 255, 0.7)');
  expect(skin.ticksText).toBe('✓✓');
});
