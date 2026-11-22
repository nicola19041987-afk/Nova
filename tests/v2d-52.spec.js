// v2d-52: un profilo sospeso, al login o al primo PIN, riceve lo stesso 401 generico di un accesso non valido.
// L'API di sospensione e blocked-users.json restano invariati; l'interfaccia non parla di sospensione.
const { test, expect } = require('./harness');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEAD = { 'X-Requested-With': 'app-privata' };
const SUSPEND_RE = /sospes|blocc|BLOCKED|non può entrare/i;

function startServer(dir) {
  const port = 21000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), NOVA_E2E: '' };
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
async function setupPin(request, base, user, pin) {
  const r = await request.post(base + '/api/pin/setup', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}
function assertSilentDeny(status, body) {
  expect(status).toBe(401);
  expect(body).toEqual({ error: 'Credenziali non valide' });
  expect(body).not.toHaveProperty('code');
  expect(JSON.stringify(body)).not.toMatch(SUSPEND_RE);
}
async function withServer(playwright, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-v2d52-'));
  const s = startServer(dir);
  try {
    await waitUp(s);
    await fn(`http://127.0.0.1:${s.port}`);
  } finally {
    s.child.kill('SIGTERM');
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
async function blockLuisa(playwright, base) {
  const asNico = await playwright.request.newContext();
  try {
    const loginNico = await asNico.post(base + '/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(loginNico.ok(), await loginNico.text()).toBeTruthy();
    const block = await asNico.post(base + '/api/admin/user-block', { data: { user: 'luisa', blocked: true }, headers: HEAD });
    expect(block.ok(), await block.text()).toBeTruthy();
    const st = await (await asNico.get(base + '/api/admin/user-block', { headers: HEAD })).json();
    const luisa = st.users.find((u) => u.user === 'luisa');
    expect(luisa && luisa.blocked).toBe(true);
  } finally {
    await asNico.dispose();
  }
}

test('v2d-52: cache del service worker e interfaccia senza testo di sospensione', async ({ request }) => {
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(5[2-9]|[6-9]\d|65b)'/); // v2d-65b alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-51'");
  const files = ['/js/auth.js', '/js/core.js', '/js/account.js', '/js/main.js', '/index.html'];
  for (const f of files) {
    const t = await (await request.get(f)).text();
    expect(t, f).not.toMatch(/Accesso sospeso|code:\s*['"]BLOCKED['"]|user-block/i);
  }
});

test('v2d-52: login e setup di un profilo sospeso restano generici; Nicola entra ancora; sblocco ripristina l\'accesso', async ({ playwright }) => {
  test.setTimeout(60000);
  await withServer(playwright, async (base) => {
    const ctx = await playwright.request.newContext();
    try {
      await setupPin(ctx, base, 'nicola', '1357');
      await setupPin(ctx, base, 'luisa', '2468');
      const profiles = await (await ctx.get(base + '/api/profiles')).json();
      expect(profiles.profiles.map((p) => p.id)).toEqual(expect.arrayContaining(['nicola', 'luisa']));
      await blockLuisa(playwright, base);

      const asLuisa = await playwright.request.newContext();
      try {
        const login = await asLuisa.post(base + '/api/login', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
        assertSilentDeny(login.status(), await login.json());
        const setup = await asLuisa.post(base + '/api/pin/setup', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
        assertSilentDeny(setup.status(), await setup.json());
      } finally {
        await asLuisa.dispose();
      }

      const after = await (await ctx.get(base + '/api/profiles')).json();
      expect(after.profiles.find((p) => p.id === 'luisa')).toMatchObject({ id: 'luisa', name: 'Luisa', hasPin: true });

      const stillNico = await playwright.request.newContext();
      try {
        const ok = await stillNico.post(base + '/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
        expect(ok.ok(), await ok.text()).toBeTruthy();
      } finally {
        await stillNico.dispose();
      }

      const asNico2 = await playwright.request.newContext();
      try {
        const loginNico = await asNico2.post(base + '/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
        expect(loginNico.ok(), await loginNico.text()).toBeTruthy();
        const un = await asNico2.post(base + '/api/admin/user-block', { data: { user: 'luisa', blocked: false }, headers: HEAD });
        expect(un.ok(), await un.text()).toBeTruthy();
      } finally {
        await asNico2.dispose();
      }

      const back = await playwright.request.newContext();
      try {
        const login = await back.post(base + '/api/login', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
        expect(login.ok(), await login.text()).toBeTruthy();
      } finally {
        await back.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });
});

test('v2d-52: in schermata di accesso il profilo sospeso vede solo «Credenziali non valide»', async ({ playwright, page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla schermata di accesso. Il percorso è verificato su Chromium.');
  test.setTimeout(60000);
  await withServer(playwright, async (base) => {
    const ctx = await playwright.request.newContext();
    try {
      await setupPin(ctx, base, 'nicola', '1357');
      await setupPin(ctx, base, 'luisa', '2468');
      await blockLuisa(playwright, base);
    } finally {
      await ctx.dispose();
    }
    await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
    await page.goto(base + '/');
    await expect(page.locator('#view-login')).toBeVisible();
    await page.locator('[data-profile="luisa"]').click();
    await expect(page.locator('#pin-form')).toBeVisible();
    for (const d of '2468') await page.locator(`#pin-pad [data-key="${d}"]`).click();
    await expect(page.locator('#login-error')).toHaveText('Credenziali non valide');
    expect(await page.locator('#login-error').innerText()).not.toMatch(SUSPEND_RE);
  });
});
