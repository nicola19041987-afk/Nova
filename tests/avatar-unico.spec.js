const { test, expect, request: apiRequest } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HEAD = { 'X-Requested-With': 'app-privata' };
const ROOT = path.join(__dirname, '..');
const FACE = path.join(ROOT, 'assets', 'ready', 'nova-unico.jpg');
const LM = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'ready', 'nova-unico-landmarks.json'), 'utf8'));

function tinyJpeg() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
}

test('gli avatar vecchi restano su disco, nascosti, e Nova è l’unica visibile', async () => {
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-arch-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared', 'actions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'users', 'nicola', 'avatars'), { recursive: true });
  const oldJpg = tinyJpeg();
  const oldMp4 = Buffer.from('ftypmp42fake-clip');
  const userJpg = tinyJpeg();
  fs.writeFileSync(path.join(dir, 'shared', 'avatars', '0123456789abcdef.jpg'), oldJpg);
  fs.writeFileSync(path.join(dir, 'shared', 'actions', 'fedcba9876543210.mp4'), oldMp4);
  fs.writeFileSync(path.join(dir, 'users', 'nicola', 'avatars', 'aaaaaaaaaaaaaaaa.jpg'), userJpg);
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{
    id: '0123456789abcdef', name: 'Greta', ready: 'greta', avatar: '/api/avatars/0123456789abcdef.jpg',
    personality: 'vecchia scheda', actions: { saluta: { kind: 'video', file: 'fedcba9876543210.mp4' } },
  }]));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${port}` });
  try {
    const ready = Date.now();
    while (!log.includes('App privata avviata')) {
      if (child.exitCode != null) throw new Error(log || 'server spento');
      if (Date.now() - ready > 15000) throw new Error(log || 'avvio lento');
      await new Promise((ok) => setTimeout(ok, 50));
    }
    const pin = await api.post('/api/pin/setup', { data: { user: 'nicola', pin: '2468' }, headers: HEAD });
    expect(pin.ok(), await pin.text()).toBeTruthy();
    const luisa = await api.post('/api/pin/setup', { data: { user: 'luisa', pin: '1357' }, headers: HEAD });
    expect(luisa.ok(), await luisa.text()).toBeTruthy();
    const list = await api.get('/api/characters');
    expect(list.ok(), await list.text()).toBeTruthy();
    const chars = await list.json();
    expect(chars.map((c) => c.name)).toEqual(['Nova']);
    expect(chars[0].id).toBe('5ce17a0000000001');
    expect(chars[0].ready).toBe('nova-scelta');
    expect(chars[0].personality).toBe('');
    expect(chars[0].style).toBe('');
    expect(chars[0].orders).toBe('');
    expect(chars[0].requests).toBe('');
    expect(chars[0].voice).toBe('');
    expect(chars[0].avatar).toBe('/api/avatars/5ce17a0000000001.jpg');
    expect(chars[0].landmarks && chars[0].landmarks.auto).toBe(true);
    expect(chars[0].landmarks.src).toBe(chars[0].avatar);
    expect(chars[0].landmarks.mouthL && chars[0].landmarks.mouthR).toBeTruthy();
    expect(chars.some((c) => c.archived || c.name === 'Greta')).toBe(false);

    const nicoSet = await (await api.get('/api/settings')).json();
    expect(nicoSet.activeChar).toBe(chars[0].id);
    const asLuisa = await api.post('/api/login', { data: { user: 'luisa', pin: '1357' }, headers: HEAD });
    expect(asLuisa.ok()).toBeTruthy();
    const luisaSet = await (await api.get('/api/settings')).json();
    expect(luisaSet.activeChar).toBe(chars[0].id);

    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const greta = stored.find((c) => c.id === '0123456789abcdef');
    const dark = stored.find((c) => c.ready === 'nova-unico');
    const blonde = stored.find((c) => c.ready === 'nova-bionda');
    expect(greta && greta.archived).toBe(true);
    expect(dark && dark.archived).toBe(true);
    expect(blonde && blonde.archived).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'shared', 'avatars', '0123456789abcdef.jpg')).equals(oldJpg)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'shared', 'actions', 'fedcba9876543210.mp4')).equals(oldMp4)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'users', 'nicola', 'avatars', 'aaaaaaaaaaaaaaaa.jpg')).equals(userJpg)).toBe(true);
    const stamps = fs.readdirSync(path.join(dir, 'avatar-archive'));
    expect(stamps.length).toBe(1);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'avatar-archive', stamps[0], 'manifest.json'), 'utf8'));
    expect(man.files).toEqual(expect.arrayContaining([
      'shared/avatars/0123456789abcdef.jpg',
      'shared/actions/fedcba9876543210.mp4',
      'users/nicola/avatars/aaaaaaaaaaaaaaaa.jpg',
    ]));
    expect(man.files.some((f) => f.includes('a11cea7a10000001'))).toBe(false);
    for (const rel of man.files) {
      const copy = fs.readFileSync(path.join(dir, 'avatar-archive', stamps[0], 'files', rel));
      const orig = fs.readFileSync(path.join(dir, rel));
      expect(copy.equals(orig)).toBe(true);
    }
    const gal = await (await api.get('/api/archive')).json();
    const oldPhoto = gal.items.find((i) => i.label && i.label.includes('Greta') && i.source === 'Avatar');
    const oldClip = gal.items.find((i) => i.source === 'Clip' && i.label && i.label.includes('archiviato'));
    const unica = gal.items.find((i) => i.label === 'Nova' || (i.source === 'Avatar' && !(i.label || '').includes('archiviato') && (i.label || '').includes('Nova')));
    expect(oldPhoto && oldPhoto.label.includes('archiviato')).toBe(true);
    expect(oldClip).toBeTruthy();
    expect(gal.items.some((i) => i.source === 'Avatar' && (i.label || '') === 'Nova')).toBe(true);
    expect(unica && !(unica.label || '').includes('archiviato')).toBe(true);
    expect(fs.existsSync(path.join(dir, 'shared', 'avatars', 'a11cea7a10000001.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'shared', 'avatars', 'b10b1a0000000001.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'shared', 'avatars', '5ce17a0000000001.jpg'))).toBe(true);
  } finally {
    await api.dispose();
    child.kill('SIGTERM');
  }
});

test('la bocca della foto nuova è simmetrica a riposo e a metà frase', async ({ page }, testInfo) => {
  const jpeg = fs.readFileSync(FACE).toString('base64');
  await page.goto('/');
  const snap = await page.evaluate(async ({ jpeg, lm }) => {
    const img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error('foto')); im.src = 'data:image/jpeg;base64,' + jpeg; });
    img._src = lm.src;
    document.body.classList.add('solo-mode');
    const prev = document.getElementById('avatar-canvas'); if (prev) prev.id = 'avatar-canvas-app';
    const c = document.createElement('canvas');
    c.id = 'avatar-canvas';
    c.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:420px';
    document.body.appendChild(c);
    const av = new TalkingAvatar(c);
    av.img = img; av.lm = lm; av._trustKey = '';
    av.nextBlink = 1e15; av.blinkStart = -1e9;
    av.resize();
    const S = 1000;
    const map = (p) => { const tr = av.photoRect({ x: 0, y: 0, w: c.width, h: c.height }, av.extent(img)); return { x: tr.ox + p.x * S * tr.fit, y: tr.oy + p.y * S * tr.fit }; };
    const meanDiff = (a, b, x0, x1, y0, y1) => {
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * a.width + x) * 4;
        s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        n++;
      }
      return s / Math.max(1, n);
    };
    const shoot = (open) => {
      av.mouth = open; av._mh = open; av.speaking = open > 0.02; av.wide = 0.55; av._drawn = 0;
      av._pose = null; av._last = 8000; av.breathOn = false;
      av.frame(8000);
      return av.ctx.getImageData(0, 0, c.width, c.height);
    };
    const rest = shoot(0);
    const mid = shoot(0.62);
    const mouth = map(lm.mouth), left = map(lm.mouthL), right = map(lm.mouthR);
    const y0 = Math.max(0, Math.floor(mouth.y - 8)), y1 = Math.min(c.height, Math.floor(mouth.y + 36));
    const midX = Math.floor((left.x + right.x) / 2);
    const xL = Math.max(0, Math.floor(Math.min(left.x, right.x) - 6));
    const xR = Math.min(c.width, Math.ceil(Math.max(left.x, right.x) + 6));
    const leftD = meanDiff(rest, mid, xL, midX, y0, y1);
    const rightD = meanDiff(rest, mid, midX, xR, y0, y1);
    const cropOf = (im) => {
      const box = [lm.browL, lm.browR, lm.mouthL, lm.mouthR].map(map);
      const xs = box.map((p) => p.x), ys = box.map((p) => p.y);
      const a = Math.max(0, Math.floor(Math.min(...xs) - 36));
      const b = Math.max(0, Math.floor(Math.min(...ys) - 28));
      const w = Math.min(c.width - a, Math.ceil(Math.max(...xs) + 36) - a);
      const h = Math.min(c.height - b, Math.ceil(Math.max(...ys) + 48) - b);
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d').putImageData(im, -a, -b);
      return out.toDataURL('image/png');
    };
    av.breathOn = true; av.speaking = true; av._pose = null; av.speakLive(() => 0.8, () => 0.45);
    let now = 12000, liveRatio = 1;
    for (let i = 0; i < 10; i++) now += 48, av.frame(now);
    const live = av.ctx.getImageData(0, 0, c.width, c.height);
    const liveL = meanDiff(rest, live, xL, midX, y0, y1);
    const liveR = meanDiff(rest, live, midX, xR, y0, y1);
    if (liveL > 0.2 && liveR > 0.2) liveRatio = Math.max(liveL, liveR) / Math.min(liveL, liveR);
    return {
      trusted: av.faceTrusted(),
      left: leftD, right: rightD,
      ratio: Math.max(leftD, rightD) / Math.min(leftD, rightD),
      liveRatio, liveL, liveR,
      rest: cropOf(rest), mid: cropOf(mid),
      cornerDy: Math.abs(lm.mouthL.y - lm.mouthR.y),
      mouthX: lm.mouth.x,
    };
  }, { jpeg, lm: LM });
  expect(snap.trusted).toBe(true);
  expect(snap.cornerDy).toBeLessThan(0.01);
  expect(Math.abs(snap.mouthX - 0.5)).toBeLessThan(0.02);
  expect(snap.left).toBeGreaterThan(0.8);
  expect(snap.right).toBeGreaterThan(0.8);
  expect(snap.ratio).toBeLessThan(1.8);
  expect(snap.liveRatio).toBeLessThan(1.8);
  if (testInfo.project.name === 'chromium') {
    const out = path.join(ROOT, 'docs', 'mouth-check', 'nuovo');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'rest.png'), Buffer.from(snap.rest.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(out, 'mid.png'), Buffer.from(snap.mid.split(',')[1], 'base64'));
  }
});
