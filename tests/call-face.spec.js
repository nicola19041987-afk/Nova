const { test, expect } = require('./harness');
const path = require('path');

const FACE = '/api/avatars/406a5539c61fafa9.jpg';
const JPEG = path.join(__dirname, '..', 'assets', 'ready', 'nova-bionda.jpg');

test('in videochiamata resta la foto del personaggio, non un altro volto', async ({ page }) => {
  const asked = [];
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    asked.push(p);
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === FACE) return route.fulfill({ status: 200, contentType: 'image/jpeg', path: JPEG });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{
      id: '5ce17a0000000001', name: 'Nova', ready: 'nova-scelta', avatar: FACE, personality: 'x', style: '', requests: '',
      landmarks: { auto: true, src: FACE, eyeL: { x: 0.36, y: 0.32 }, eyeR: { x: 0.64, y: 0.32 }, mouth: { x: 0.5, y: 0.48 } },
    }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json([]);
    if (p === '/api/simli/session') return json({ session_token: 'tok-altro-volto', iceServers: [] });
    if (p === '/api/calls') return json({ ok: true });
    return json({});
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction((face) => {
    return document.body.classList.contains('solo-chat') && App.avatarConv && App.avatarConv.img && App.avatarConv.img._src === face && App.avatarConv.img.naturalWidth > 400;
  }, FACE);
  await page.locator('#wa-video').click();
  await page.waitForFunction(() => document.body.classList.contains('in-call'));
  const call = await page.evaluate((face) => {
    const video = document.getElementById('simli-video');
    const canvas = document.getElementById('avatar-canvas');
    const stage = getComputedStyle(document.getElementById('stage'));
    App.avatarConv.resize();
    App.avatarConv.mouth = 0.7;
    App.avatarConv.speaking = true;
    App.avatarConv.frame(performance.now());
    const w = canvas.width, h = canvas.height;
    const sample = (x, y) => App.avatarConv.ctx.getImageData(Math.max(0, Math.min(w - 1, x | 0)), Math.max(0, Math.min(h - 1, y | 0)), 1, 1).data[3];
    const drawn = w > 2 && h > 2 && [sample(w / 2, h / 2), sample(w / 2, h * 0.7), sample(w * 0.25, h * 0.55), sample(w * 0.75, h * 0.4)].some((a) => a > 0);
    return {
      simli: document.body.classList.contains('simli-on'),
      video: getComputedStyle(video).display,
      hidden: video.hidden,
      src: App.avatarConv.img && App.avatarConv.img._src,
      canvas: getComputedStyle(canvas).visibility,
      wide: canvas.getBoundingClientRect().width >= window.innerWidth - 2,
      full: stage.position === 'fixed',
      mute: !!document.getElementById('call-mute'),
      end: !!document.getElementById('call-end'),
      flip: !!document.getElementById('call-flip'),
      self: !!document.getElementById('call-self'),
      cam: document.getElementById('call-cam').getAttribute('aria-pressed') === 'false',
      drawn,
      mouth: App.avatarConv.mouth > 0,
      face,
    };
  }, FACE);
  expect(asked.filter((p) => p === '/api/simli/session')).toEqual([]);
  expect(call.simli).toBe(false);
  expect(call.video).toBe('none');
  expect(call.hidden).toBe(true);
  expect(call.src).toBe(FACE);
  expect(call.canvas).not.toBe('hidden');
  expect(call.wide).toBe(true);
  expect(call.full).toBe(true);
  expect(call.mute && call.end && call.flip && call.self && call.cam).toBe(true);
  expect(call.drawn).toBe(true);
  expect(call.mouth).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-19-call-390.png' });
});
