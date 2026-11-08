const { test, expect, request: apiRequest } = require('./harness');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HEAD = { 'X-Requested-With': 'app-privata' };
const ROOT = path.join(__dirname, '..');
const NOVA = '5ce17a0000000001';
const OTHERS = [
  ['a100000000000001', 'Vera'],
  ['a100000000000002', 'Giada'],
  ['a100000000000003', 'Aurora'],
  ['a100000000000004', 'Chiara'],
  ['a100000000000005', 'Matteo'],
  ['a100000000000006', 'Elena'],
];

function startServer(dir) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  return { child, port, log: () => log };
}

async function waitUp(child, log) {
  const t0 = Date.now();
  while (!log().includes('App privata avviata')) {
    if (child.exitCode != null) throw new Error(log() || 'server spento');
    if (Date.now() - t0 > 15000) throw new Error(log() || 'avvio lento');
    await new Promise((ok) => setTimeout(ok, 40));
  }
}

test('solo Nova è visibile; gli altri sei si archiviano e si ripristinano senza cancellare le chat', async () => {
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-arch-chars-'));
  const chats = path.join(dir, 'shared', 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const cards = [
    { id: NOVA, name: 'Nova', ready: 'nova-scelta', avatar: '/api/avatars/5ce17a0000000001.jpg', personality: '', style: '', orders: '', requests: '', voice: '' },
    ...OTHERS.map(([id, name]) => ({ id, name, ready: name.toLowerCase(), avatar: '🌙', personality: 'resta', style: '', orders: '', requests: '', voice: '' })),
  ];
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify(cards, null, 2));
  const bodies = {};
  for (const [id, name] of OTHERS) {
    const body = JSON.stringify({ epoch: 'e1', messages: [{ n: 1, role: 'user', author: 'nicola', content: 'ciao ' + name, at: '2026-11-08T12:00:00.000Z' }] });
    bodies[id] = body;
    fs.writeFileSync(path.join(chats, id + '.json'), body);
  }
  const novaChat = JSON.stringify({ epoch: 'e-nova', messages: [{ n: 1, role: 'assistant', content: 'sono Nova', at: '2026-11-08T12:00:00.000Z' }] });
  fs.writeFileSync(path.join(chats, NOVA + '.json'), novaChat);

  let srv = startServer(dir);
  await waitUp(srv.child, srv.log);
  const api = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${srv.port}` });
  try {
    const pin = await api.post('/api/pin/setup', { data: { user: 'nicola', pin: '2468' }, headers: HEAD });
    expect(pin.ok(), await pin.text()).toBeTruthy();
    const live = await (await api.get('/api/characters')).json();
    expect(live.map((c) => c.id)).toEqual([NOVA]);
    expect(live[0].name).toBe('Nova');
    expect(live[0].avatar).toBe('/api/avatars/5ce17a0000000001.jpg');
    const hidden = await (await api.get('/api/characters/archived')).json();
    expect(hidden.map((c) => c.name).filter((n) => n !== 'Nova').sort()).toEqual(['Aurora', 'Chiara', 'Elena', 'Giada', 'Matteo', 'Vera']);
    expect(hidden.some((c) => c.id === NOVA)).toBe(false);
    expect(hidden.every((c) => c.archived === true)).toBe(true);
    const afterBoot = {};
    for (const [id, name] of OTHERS) {
      afterBoot[id] = fs.readFileSync(path.join(chats, id + '.json'), 'utf8');
      const chat = JSON.parse(afterBoot[id]);
      expect(chat.messages.map((m) => m.content)).toEqual(['ciao ' + name]);
      expect(hidden.find((c) => c.id === id).messages).toBe(1);
    }
    bodies.boot = afterBoot;
    const keptNova = await api.post('/api/characters/' + NOVA + '/archive', { headers: HEAD });
    expect(keptNova.status()).toBe(409);
    const back = await api.post('/api/characters/a100000000000005/restore', { headers: HEAD });
    expect(back.ok(), await back.text()).toBeTruthy();
    const live2 = await (await api.get('/api/characters')).json();
    expect(live2.map((c) => c.name).sort()).toEqual(['Matteo', 'Nova']);
    expect(fs.readFileSync(path.join(chats, 'a100000000000005.json'), 'utf8')).toBe(bodies.boot['a100000000000005']);
  } finally {
    await api.dispose();
    srv.child.kill('SIGTERM');
  }

  srv = startServer(dir);
  await waitUp(srv.child, srv.log);
  const api2 = await apiRequest.newContext({ baseURL: `http://127.0.0.1:${srv.port}` });
  try {
    const login = await api2.post('/api/login', { data: { user: 'nicola', pin: '2468' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
    const still = await (await api2.get('/api/characters')).json();
    expect(still.map((c) => c.name).sort()).toEqual(['Matteo', 'Nova']);
    const again = await api2.post('/api/characters/a100000000000005/archive', { headers: HEAD });
    expect(again.ok(), await again.text()).toBeTruthy();
    const only = await (await api2.get('/api/characters')).json();
    expect(only.map((c) => c.id)).toEqual([NOVA]);
    expect(fs.readFileSync(path.join(chats, 'a100000000000005.json'), 'utf8')).toBe(bodies.boot['a100000000000005']);
    const novaNow = JSON.parse(fs.readFileSync(path.join(chats, NOVA + '.json'), 'utf8'));
    expect(novaNow.messages.map((m) => m.content)).toEqual(['sono Nova']);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const matteo = stored.find((c) => c.id === 'a100000000000005');
    expect(matteo.archived).toBe(true);
    expect(matteo.personality).toBe('resta');
    expect(stored.find((c) => c.id === NOVA).archived).toBeFalsy();
  } finally {
    await api2.dispose();
    srv.child.kill('SIGTERM');
  }
});
