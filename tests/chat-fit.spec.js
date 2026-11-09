const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });

async function mockApp(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
}

test('la chat occupa il resto dello schermo, l’avatar sta circa a un terzo e il campo resta su due righe', async ({ page }, testInfo) => {
  await mockApp(page);
  if (testInfo.project.name === 'webkit') {
    await page.addInitScript(() => { localStorage.setItem('ap:nicola:avatarViewPick', JSON.stringify('photo')); });
  }
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  const stopAvatar = () => page.evaluate(() => {
    const stop = (av) => { if (!av) return; av.breathOn = false; try { cancelAnimationFrame(av._raf); } catch {} av._raf = 0; };
    if (window.App) { stop(App.avatarConv); stop(App.avatarEditor); stop(App.avatarPresence); }
  });
  if (testInfo.project.name !== 'chromium') await stopAvatar();
  await page.evaluate(() => {
    const box = document.getElementById('messages');
    for (let i = 1; i <= 8; i++) {
      const d = document.createElement('div');
      d.className = 'msg ' + (i % 2 ? 'user' : 'assistant');
      d.innerHTML = `<p>Messaggio ${i}. La lista deve restare nel terzo basso e scorrere.</p>`;
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  });
  const dir = path.join(__dirname, '..', 'docs', 'chat-check');
  if (testInfo.project.name === 'chromium') {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'after-half.png') });
    await stopAvatar();
  }
    const half = await page.evaluate(() => {
    const stageEl = document.getElementById('stage');
    const stage = stageEl.getBoundingClientRect();
    const faceBottom = stage.top + stage.height * 0.58;
    const msgs = document.getElementById('messages').getBoundingClientRect();
    const form = document.getElementById('chat-form').getBoundingClientRect();
    const dock = document.querySelector('.solo-dock').getBoundingClientRect();
    const overlaps = (r) => r.height > 1 && r.top < faceBottom - 1 && r.bottom > stage.top;
    const input = document.getElementById('chat-input');
    const hot = document.getElementById('hot-btn');
    input.value = 'prima riga della frase\nseconda riga ancora visibile\nterza riga che deve scorrere dentro il campo senza alzarlo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const cs = getComputedStyle(input);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    return {
      faceClear: getComputedStyle(stageEl).display === 'none' || (!overlaps(msgs) && !overlaps(form)),
      stageShare: stage.height / window.innerHeight,
      listShare: msgs.height / window.innerHeight,
      chatTaller: msgs.height > stage.height || getComputedStyle(document.getElementById('stage')).display === 'none',
      formAboveDock: dock.height < 2 || form.bottom <= dock.top + 2,
      formPinned: form.bottom > window.innerHeight - 140,
      hotHidden: !hot || getComputedStyle(hot).display === 'none',
      lines: input.clientHeight / lh,
      scrolls: input.scrollHeight > input.clientHeight + 1,
      max: lh * 2 + pad + border,
      client: input.clientHeight,
    };
  });
  expect(half.faceClear).toBe(true);
  expect(half.stageShare).toBeLessThan(0.05);
  expect(half.chatTaller).toBe(true);
  expect(half.listShare).toBeGreaterThan(0.4);
  expect(half.formAboveDock).toBe(true);
  expect(half.formPinned).toBe(true);
  expect(half.hotHidden).toBe(true);
  expect(half.client).toBeLessThanOrEqual(half.max + 2);
  expect(half.scrolls).toBe(true);
  if (testInfo.project.name === 'chromium') {
    await page.screenshot({ path: '/opt/cursor/artifacts/chat-after-390x844.png' });
    await page.locator('#wa-home').click();
    const home = await page.evaluate(() => ({
      home: document.body.classList.contains('solo-home'),
      list: getComputedStyle(document.getElementById('nh-list')).display !== 'none',
      stage: getComputedStyle(document.getElementById('stage')).display,
    }));
    expect(home.home).toBe(true);
    expect(home.list).toBe(true);
    expect(home.stage).toBe('none');
    await page.screenshot({ path: '/opt/cursor/artifacts/chat-after-390x844-mini.png' });
    await page.locator('#back-btn').click();
  }
  if (testInfo.project.name === 'chromium') {
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--app-h', '540px');
      document.documentElement.style.setProperty('--vv-bottom', '260px');
      const dock = document.querySelector('.solo-dock');
      if (dock) dock.style.bottom = '304px';
    });
    await page.screenshot({ path: path.join(dir, 'after-keyboard.png') });
    const kb = await page.evaluate(() => {
      const stage = document.getElementById('stage').getBoundingClientRect();
      const faceBottom = stage.top + Math.max(40, stage.height * 0.5);
      const form = document.getElementById('chat-form').getBoundingClientRect();
      const msgs = document.getElementById('messages').getBoundingClientRect();
      const hit = (r) => r.height > 1 && r.top < faceBottom - 1 && r.bottom > stage.top + 8;
      return { faceClear: !hit(form) && !hit(msgs), formTop: form.top, faceBottom };
    });
    expect(kb.faceClear).toBe(true);
  }
});

test('su iPhone SE la chat resta più alta dell’avatar e la scrittura è in basso', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'Il viewport iPhone SE è misurato su Chromium; WebKit chiude spesso la home.');
  await page.setViewportSize({ width: 375, height: 667 });
  await mockApp(page);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  await page.waitForFunction(() => document.body.classList.contains('vrm-on'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const box = document.getElementById('messages');
    for (let i = 1; i <= 6; i++) {
      const d = document.createElement('div');
      d.className = 'msg ' + (i % 2 ? 'user' : 'assistant');
      d.innerHTML = `<p>Messaggio ${i} su schermo piccolo.</p>`;
      box.appendChild(d);
    }
  });
  const box = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const msgs = document.getElementById('messages').getBoundingClientRect();
    const form = document.getElementById('chat-form').getBoundingClientRect();
    const dock = document.querySelector('.solo-dock').getBoundingClientRect();
    const hot = document.getElementById('hot-btn');
    return {
      stageShare: stage.height / innerHeight,
      listShare: msgs.height / innerHeight,
      chatTaller: msgs.height > stage.height,
      formAboveDock: dock.height < 2 || form.bottom <= dock.top + 2,
      hotHidden: !hot || getComputedStyle(hot).display === 'none',
    };
  });
  expect(box.stageShare).toBeLessThan(0.05);
  expect(box.chatTaller).toBe(true);
  expect(box.listShare).toBeGreaterThan(0.3);
  expect(box.formAboveDock).toBe(true);
  expect(box.hotHidden).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/chat-after-375x667.png' });
});
