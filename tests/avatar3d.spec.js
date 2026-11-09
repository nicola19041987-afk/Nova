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
    if (p === '/api/characters') return json([{ id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/8b4bf23923c5e90d.jpg', personality: 'x', style: '', orders: '', requests: '', voice: 'ara' }]);
    if (p === '/api/avatars/8b4bf23923c5e90d.jpg') {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', path: require('path').join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg') });
    }
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
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && App.avatarConv && App.avatarConv.img && String(App.avatarConv.img._src || '').includes('8b4bf23923c5e90d'));
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
      bundled: /nova-bionda|nova-scelta\.jpg|nova-unico/.test(String(App.avatarConv.img._src || '')),
      header: (document.getElementById('wa-photo') && document.getElementById('wa-photo').innerHTML) || '',
      voice: App.xaiVoice({ id: 'bbbbbbbbbbbbbbbb', voice: 'ara' }),
      stored: App.ls.get('ttsVoice', ''),
      lookHidden: document.getElementById('look-bar').hidden,
      lookOverlaps: look.height > 1 && look.top < stage.bottom - 1 && look.bottom > stage.top + 1,
      canvasWide: canvas.width >= stage.width - 2,
      stageShare: stage.height / window.innerHeight,
      aspect: stage.height / Math.max(1, stage.width),
      expand: es.display !== 'none' && es.visibility !== 'hidden' && expand.getBoundingClientRect().width > 2,
    };
  });
  expect(state.avatar3d).toBe('undefined');
  expect(state.vrmOn).toBe(false);
  expect(state.vrmHidden).toBe(true);
  expect(state.script).toBe(false);
  expect(state.view).toBe('photo');
  expect(state.has3d).toBe(true);
  expect(state.pick).toBe('photo');
  expect(state.src).toContain('/api/avatars/8b4bf23923c5e90d.jpg');
  expect(state.bundled).toBe(false);
  expect(state.header).toContain('8b4bf23923c5e90d');
  expect(state.voice).toBe('eve');
  expect(state.stored).toBe('eve');
  expect(state.lookHidden).toBe(true);
  expect(state.lookOverlaps).toBe(false);
  expect(state.canvasWide).toBe(true);
  expect(state.stageShare).toBeGreaterThan(0.48);
  expect(state.stageShare).toBeLessThan(0.78);
  expect(state.aspect).toBeGreaterThan(1.2);
  expect(state.aspect).toBeLessThan(1.45);
  await page.screenshot({ path: '/opt/cursor/artifacts/frame-wide-473.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => App.fitFrame && App.fitFrame());
  const narrow = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const form = document.getElementById('chat-form').getBoundingClientRect();
    const dock = document.querySelector('.solo-dock').getBoundingClientRect();
    return { aspect: stage.height / Math.max(1, stage.width), share: stage.height / innerHeight, formAbove: form.bottom <= dock.top + 2 };
  });
  expect(narrow.aspect).toBeGreaterThan(1.2);
  expect(narrow.aspect).toBeLessThan(1.45);
  expect(narrow.share).toBeGreaterThan(0.5);
  expect(narrow.formAbove).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/frame-wide-390.png' });
  await page.setViewportSize({ width: 473, height: 1024 });
  await page.evaluate(() => App.fitFrame && App.fitFrame());
  expect(state.expand).toBe(true);
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.textContent = 'sorgente ' + (App.avatarConv.img && App.avatarConv.img._src);
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:70px;z-index:999;background:#111;color:#fff;font:12px monospace;padding:4px';
    document.body.appendChild(b);
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/2d-face-473.png' });
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
  const framed = await page.evaluate(async () => {
    const paint = () => {
      const c = document.createElement('canvas');
      c.width = 360; c.height = 960;
      const g = c.getContext('2d');
      g.fillStyle = '#d7d2cc'; g.fillRect(0, 0, 360, 960);
      g.fillStyle = '#e8c070'; g.fillRect(0, 0, 360, 90);
      g.fillStyle = '#1d4e89'; g.fillRect(0, 860, 360, 100);
      return c.toDataURL('image/png');
    };
    const url = paint();
    const av = App.avatarConv;
    av.breathOn = false;
    av.setImage(url);
    const deadline = performance.now() + 3000;
    while (!(av.img && av.img._src === url && av.img.naturalWidth) && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 30));
    }
    const sample = () => {
      av.resize();
      av._drawn = 0;
      av.frame(performance.now());
      const w = av.c.width, h = av.c.height;
      const px = (x, y) => av.ctx.getImageData(Math.max(0, Math.min(w - 1, x | 0)), Math.max(0, Math.min(h - 1, y | 0)), 1, 1).data;
      const top = px(w / 2, 6);
      const bot = px(w / 2, h - 6);
      return { w, h, top: [top[0], top[1], top[2]], bot: [bot[0], bot[1], bot[2]] };
    };
    document.getElementById('tab-conv').classList.remove('stage-mini');
    if (App.solo) App.solo.toggleFull(false);
    const stage = sample();
    if (App.solo) App.solo.toggleFull(true);
    av.resize();
    const full = sample();
    if (App.solo) App.solo.toggleFull(false);
    return { stage, full, src: av.img && av.img._src === url };
  });
  expect(framed.src).toBe(true);
  expect(framed.stage.top[0]).toBeGreaterThan(180);
  expect(framed.stage.top[1]).toBeGreaterThan(140);
  expect(framed.stage.bot[2]).toBeGreaterThan(framed.stage.bot[0]);
  expect(framed.full.top[0]).toBeGreaterThan(180);
  expect(framed.full.bot[2]).toBeGreaterThan(framed.full.bot[0]);
  await page.screenshot({ path: '/opt/cursor/artifacts/frame-stage-473.png' });
  await page.evaluate(() => { if (App.solo) App.solo.toggleFull(true); if (App.avatarConv) { App.avatarConv.resize(); App.avatarConv.frame(performance.now()); } });
  await page.screenshot({ path: '/opt/cursor/artifacts/frame-full-473.png' });
  expect(testInfo.project.name).toBe('chromium');
});

test('un file con lo stesso nome ma hash diverso non sostituisce il ritratto', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawn } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-face-'));
  const port = 21000 + Math.floor(Math.random() * 20000);
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  const stock = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-scelta.jpg'));
  const other = fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-bionda.jpg'));
  fs.writeFileSync(path.join(dir, 'shared', 'avatars', '5ce17a0000000001.jpg'), stock);
  fs.writeFileSync(path.join(dir, 'shared', 'avatars', '8b4bf23923c5e90d.jpg'), other);
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{
    id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/5ce17a0000000001.jpg',
    landmarks: { auto: true, src: '/api/avatars/5ce17a0000000001.jpg', eyeL: { x: 0.4, y: 0.4 }, eyeR: { x: 0.6, y: 0.4 }, mouth: { x: 0.5, y: 0.6 } },
  }]));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir, PORT: String(port), NOVA_E2E: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  try {
    const t0 = Date.now();
    while (!log.includes('App privata avviata')) {
      if (child.exitCode != null) throw new Error(log || 'server spento');
      if (Date.now() - t0 > 15000) throw new Error(log || 'avvio lento');
      await new Promise((ok) => setTimeout(ok, 40));
    }
    const chars = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const nova = chars.find((c) => c.id === '5ce17a0000000001');
    expect(nova.avatar).toBe('/api/avatars/5ce17a0000000001.jpg');
    expect(nova.landmarks && nova.landmarks.src).toBe('/api/avatars/5ce17a0000000001.jpg');
    expect(fs.readFileSync(path.join(dir, 'shared', 'avatars', '8b4bf23923c5e90d.jpg')).equals(other)).toBe(true);
  } finally {
    child.kill();
  }
});
