// v2d-45: nome visibile Alpha (titolo, header, PWA, etichette, persona). Id, foto, voce, movimenti, PIN, filtro e chiavi invariati.
const { test, expect } = require('./harness');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEAD = { 'X-Requested-With': 'app-privata' };
const CH = '5ce17a0000000001';
const OLD = 'fef554e9dae89ba6.jpg';

function startMockAI() {
  const srv = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}
function startServer(dir, aiPort) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-v2d45', NOVA_E2E: '' };
  for (const k of Object.keys(env)) if (/^(NOTES|SISTEMA)_WEBHOOK_|^SIMLI_/.test(k)) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  return { child, port, log: () => log };
}
async function waitUp(s) {
  const t0 = Date.now();
  while (!s.log().includes('App privata avviata')) {
    if (s.child.exitCode != null) throw new Error(s.log() || 'server spento');
    if (Date.now() - t0 > 20000) throw new Error(s.log() || 'avvio lento');
    await new Promise((ok) => setTimeout(ok, 50));
  }
}
async function pinLogin(request, base) {
  const setup = await request.post(base + '/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) { const l = await request.post(base + '/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD }); expect(l.ok()).toBeTruthy(); }
  else expect(setup.ok(), await setup.text()).toBeTruthy();
}

test('v2d-45: titolo, PWA e cache del service worker dicono Alpha', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('<title>Alpha</title>');
  expect(html).toContain('name="apple-mobile-web-app-title" content="Alpha"');
  expect(html).toContain('id="login-title">Alpha<');
  expect(html).not.toMatch(/>Eris</);
  const man = await (await request.get('/manifest.json')).json();
  expect(man.name).toBe('Alpha');
  expect(man.short_name).toBe('Alpha');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toContain("const CACHE = 'app-privata-v2d-45'");
  expect(sw).not.toContain("app-privata-v2d-44'");
});

test('v2d-45: il login mostra Alpha', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('.login-wordmark')).toHaveText('Alpha');
});

test('v2d-45: migrazione una tantum Eris → Alpha, senza toccare id, foto, ready; al secondo avvio non si ripete', async ({ playwright }) => {
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d45-name-'));
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'avatars', OLD), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({ eris_canotta_v2d44: { at: 'x', skipped: 'prova nome' } }));
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{
    id: CH, name: 'Eris', ready: 'nova-scelta', avatar: '/api/avatars/' + OLD, avatarSource: 'upload',
    landmarks: { src: '/api/avatars/' + OLD }, appearance: {}, look: {}, wardrobe: [], personality: '', style: '', orders: '', requests: '', voice: 'eve', lookHistory: [], outfits: [],
  }]));
  const ai = await startMockAI();
  let s = startServer(dir, ai.address().port);
  const ctxs = [];
  try {
    await waitUp(s);
    expect(s.log()).toContain('Nome visibile del personaggio aggiornato: Eris → Alpha');
    const base = `http://127.0.0.1:${s.port}`;
    const api = await playwright.request.newContext(); ctxs.push(api);
    await pinLogin(api, base);
    const hz = await api.get(base + '/healthz');
    expect(hz.status()).toBe(200);
    expect(await hz.json()).toEqual({ ok: true });
    const live = await (await api.get(base + '/api/characters')).json();
    expect(live[0].name).toBe('Alpha');
    expect(live[0].id).toBe(CH);
    expect(live[0].ready).toBe('nova-scelta');
    expect(live[0].avatar).toBe('/api/avatars/' + OLD);
    expect(live[0].voice).toBe('eve');
    const arch = await api.post(base + '/api/characters/' + CH + '/archive', { headers: HEAD });
    expect(arch.status()).toBe(409);
    expect((await arch.json()).error).toBe('Alpha resta visibile.');
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const card = disk.find((c) => c.id === CH);
    expect(card.name).toBe('Alpha');
    expect(card.avatar).toBe('/api/avatars/' + OLD);
    expect(card.ready).toBe('nova-scelta');
    const mig = JSON.parse(fs.readFileSync(path.join(dir, 'migrations.json'), 'utf8'));
    expect(mig.solo_visible_name_alpha_v45.changed).toBe(true);
    expect(mig.solo_visible_name_alpha_v45.from).toBe('Eris');
    s.child.kill();
    s = startServer(dir, ai.address().port);
    await waitUp(s);
    expect(s.log()).not.toContain('Nome visibile del personaggio aggiornato: Eris → Alpha');
    const disk2 = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    expect(disk2.find((c) => c.id === CH).name).toBe('Alpha');
  } finally {
    for (const c of ctxs) await c.dispose().catch(() => {});
    s.child.kill();
    ai.close();
  }
});
