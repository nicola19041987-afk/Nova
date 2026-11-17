// v2d-51: nome visibile Ira (titolo, header, PWA, etichette, persona). Id, foto, voce, movimenti, PIN, filtro e chiavi invariati.
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
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), AI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`, XAI_API_KEY: 'test-key-v2d51', NOVA_E2E: '' };
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

test('v2d-51: titolo, PWA e cache del service worker dicono Ira', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('<title>Ira</title>');
  expect(html).toContain('name="apple-mobile-web-app-title" content="Ira"');
  expect(html).toContain('id="login-title">Ira<');
  expect(html).not.toMatch(/>Alpha</);
  expect(html).not.toMatch(/>Eris</);
  const man = await (await request.get('/manifest.json')).json();
  expect(man.name).toBe('Ira');
  expect(man.short_name).toBe('Ira');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(51|[5-9]\d)'/); // v2d-52 alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-50'");
});

test('v2d-51: il login mostra Ira', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('.login-wordmark')).toHaveText('Ira');
});

test('v2d-51: il prompt di sistema presenta Ira, non Alpha', async ({ request }) => {
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok()).toBeTruthy();
  const list = await (await request.get('/api/characters')).json();
  const ira = list.find((c) => c && /^(Nova|Eris|Alpha|Ira)$/i.test(c.name || '')) || list[0];
  expect(ira && ira.id).toBeTruthy();
  expect(ira.name).toBe('Ira');
  const t = await (await request.get('/api/e2e/tone?id=' + ira.id)).json();
  for (const k of ['chat', 'realtime', 'call']) {
    expect(t[k], k).toContain('PERSONAGGIO: Ira.');
    expect(t[k], k).toContain('CARATTERE DI IRA SCRITTO DA NICOLA');
    expect(t[k], k).toContain('Ira è una donna adulta, spontanea, affettuosa e ironica');
    expect(t[k], k).toContain("IRA PRENDE L'INIZIATIVA");
    expect(t[k], k).not.toContain('PERSONAGGIO: Alpha.');
    expect(t[k], k).not.toContain('CARATTERE DI ALPHA');
    expect(t[k], k).not.toContain('Alpha è una donna adulta');
    expect(t[k], k).not.toContain("ALPHA PRENDE L'INIZIATIVA");
  }
});

test('v2d-51: migrazione una tantum Alpha → Ira, senza toccare id, foto, ready; al secondo avvio non si ripete', async ({ playwright }) => {
  test.setTimeout(60000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d51-name-'));
  fs.mkdirSync(path.join(dir, 'shared', 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'avatars', OLD), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(dir, 'migrations.json'), JSON.stringify({
    eris_canotta_v2d44: { at: 'x', skipped: 'prova nome' },
    solo_visible_name_alpha_v45: { at: 'x', changed: true, from: 'Eris' },
  }));
  fs.writeFileSync(path.join(dir, 'shared', 'characters.json'), JSON.stringify([{
    id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '/api/avatars/' + OLD, avatarSource: 'upload',
    landmarks: { src: '/api/avatars/' + OLD }, appearance: {}, look: {}, wardrobe: [], personality: '', style: '', orders: '', requests: '', voice: 'eve', lookHistory: [], outfits: [],
  }]));
  const ai = await startMockAI();
  let s = startServer(dir, ai.address().port);
  const ctxs = [];
  try {
    await waitUp(s);
    expect(s.log()).toContain('Nome visibile del personaggio aggiornato: Alpha → Ira');
    expect(s.log()).not.toContain('Nome visibile del personaggio aggiornato: Eris → Alpha');
    const base = `http://127.0.0.1:${s.port}`;
    const api = await playwright.request.newContext(); ctxs.push(api);
    await pinLogin(api, base);
    const hz = await api.get(base + '/healthz');
    expect(hz.status()).toBe(200);
    expect(await hz.json()).toEqual({ ok: true });
    const live = await (await api.get(base + '/api/characters')).json();
    expect(live[0].name).toBe('Ira');
    expect(live[0].id).toBe(CH);
    expect(live[0].ready).toBe('nova-scelta');
    expect(live[0].avatar).toBe('/api/avatars/' + OLD);
    expect(live[0].voice).toBe('eve');
    const arch = await api.post(base + '/api/characters/' + CH + '/archive', { headers: HEAD });
    expect(arch.status()).toBe(409);
    expect((await arch.json()).error).toBe('Ira resta visibile.');
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    const card = disk.find((c) => c.id === CH);
    expect(card.name).toBe('Ira');
    expect(card.avatar).toBe('/api/avatars/' + OLD);
    expect(card.ready).toBe('nova-scelta');
    expect(card.id).toBe(CH);
    expect(Array.isArray(card.outfits)).toBe(true);
    const mig = JSON.parse(fs.readFileSync(path.join(dir, 'migrations.json'), 'utf8'));
    expect(mig.solo_visible_name_ira_v51.changed).toBe(true);
    expect(mig.solo_visible_name_ira_v51.from).toBe('Alpha');
    expect(mig.solo_visible_name_alpha_v45.from).toBe('Eris');
    s.child.kill();
    s = startServer(dir, ai.address().port);
    await waitUp(s);
    expect(s.log()).not.toContain('Nome visibile del personaggio aggiornato: Alpha → Ira');
    const disk2 = JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'characters.json'), 'utf8'));
    expect(disk2.find((c) => c.id === CH).name).toBe('Ira');
    expect(disk2.find((c) => c.id === CH).id).toBe(CH);
    expect(disk2.find((c) => c.id === CH).avatar).toBe('/api/avatars/' + OLD);
  } finally {
    for (const c of ctxs) await c.dispose().catch(() => {});
    s.child.kill();
    ai.close();
  }
});
