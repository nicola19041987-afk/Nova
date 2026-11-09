const { test, expect } = require('./harness');

test('ara non esplicita diventa eve, una scelta esplicita resta', async ({ request }) => {
  const ara = await (await request.get('/api/e2e/voice?v=ara')).json();
  const empty = await (await request.get('/api/e2e/voice?v=')).json();
  const eve = await (await request.get('/api/e2e/voice?v=eve')).json();
  const kept = await (await request.get('/api/e2e/voice?v=ara&explicit=1')).json();
  const sal = await (await request.get('/api/e2e/voice?v=sal')).json();
  expect(ara.voice).toBe('eve');
  expect(empty.voice).toBe('eve');
  expect(eve.voice).toBe('eve');
  expect(kept.voice).toBe('ara');
  expect(sal.voice).toBe('sal');
});

test('niente 3D, foto bionda, tap e campo sotto, voce eve', async ({ page, browserName }, testInfo) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla home con l’avatar. Il percorso è verificato su Chromium.');
  test.setTimeout(60000);
  await page.setViewportSize({ width: 473, height: 1024 });
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
    localStorage.setItem('ap:nicola:avatarViewPick', JSON.stringify('3d'));
    localStorage.setItem('ap:nicola:avatarView', JSON.stringify('3d'));
    localStorage.setItem('ap:nicola:ttsVoice', JSON.stringify('ara'));
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🍷', personality: 'x', style: '', orders: '', requests: '', voice: 'ara' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6 });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (p === '/api/gestures') return json([]);
    if (p === '/api/avatar-looks') return json({ entries: [], current: null });
    if (p === '/api/e2e/reset-login-limit') return json({ ok: true });
    return json({});
  });
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.avatarConv && App.avatarConv.img && String(App.avatarConv.img._src || '').includes('nova-bionda'));
  const state = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const look = document.getElementById('look-bar').getBoundingClientRect();
    const canvas = document.getElementById('avatar-canvas').getBoundingClientRect();
    const vrm = document.getElementById('vrm-view');
    const sel = document.getElementById('avatar-view');
    const expand = document.getElementById('av-expand');
    const es = getComputedStyle(expand);
    return {
      avatar3d: typeof App.avatar3d,
      vrmOn: document.body.classList.contains('vrm-on'),
      vrmHidden: !vrm || vrm.hidden || getComputedStyle(vrm).display === 'none',
      script: !!document.querySelector('script[src*="avatar3d"]'),
      view: sel.value,
      has3d: [...sel.options].some((o) => o.value === '3d'),
      pick: App.ls.get('avatarViewPick', ''),
      src: App.avatarConv.img._src,
      voice: App.xaiVoice({ id: 'bbbbbbbbbbbbbbbb', voice: 'ara' }),
      stored: App.ls.get('ttsVoice', ''),
      lookHidden: document.getElementById('look-bar').hidden,
      lookOverlaps: look.height > 1 && look.top < stage.bottom - 1 && look.bottom > stage.top + 1,
      canvasWide: canvas.width >= stage.width - 2,
      stageShare: stage.height / window.innerHeight,
      expand: es.display !== 'none' && es.visibility !== 'hidden' && expand.getBoundingClientRect().width > 2,
    };
  });
  expect(state.avatar3d).toBe('undefined');
  expect(state.vrmOn).toBe(false);
  expect(state.vrmHidden).toBe(true);
  expect(state.script).toBe(false);
  expect(state.view).toBe('photo');
  expect(state.has3d).toBe(false);
  expect(state.pick).toBe('photo');
  expect(state.src).toContain('nova-bionda');
  expect(state.voice).toBe('eve');
  expect(state.stored).toBe('eve');
  expect(state.lookHidden).toBe(true);
  expect(state.lookOverlaps).toBe(false);
  expect(state.canvasWide).toBe(true);
  expect(state.stageShare).toBeGreaterThanOrEqual(0.28);
  expect(state.stageShare).toBeLessThanOrEqual(0.36);
  expect(state.expand).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/2d-473-photo.png' });
  await page.locator('#stage').click({ position: { x: 30, y: 80 } });
  const mini = await page.evaluate(() => document.getElementById('tab-conv').classList.contains('stage-mini'));
  expect(mini).toBe(true);
  await page.locator('#av-expand').click();
  const full = await page.evaluate(() => document.body.classList.contains('av-full-on'));
  expect(full).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/2d-473-full.png' });
  await page.evaluate(() => { if (App.solo) App.solo.toggleFull(false); document.getElementById('tab-conv').classList.remove('stage-mini'); });
  await page.locator('#look-toggle').click();
  const open = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const look = document.getElementById('look-bar').getBoundingClientRect();
    return {
      hidden: document.getElementById('look-bar').hidden,
      below: look.top >= stage.bottom - 2,
      overlaps: look.height > 1 && look.top < stage.bottom - 1 && look.bottom > stage.top + 1,
    };
  });
  expect(open.hidden).toBe(false);
  expect(open.below).toBe(true);
  expect(open.overlaps).toBe(false);
  await page.screenshot({ path: '/opt/cursor/artifacts/2d-473-look.png' });
  expect(testInfo.project.name).toBe('chromium');
});
