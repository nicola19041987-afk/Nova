// v2d-55: schermata di ingresso PIN elegante (nero, IRA rosso, puntini Nicola / Luisa).
// Solo interfaccia: stessa logica PIN, stessi endpoint, stesso blocco silenzioso di Luisa.
const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const SHOTS = process.env.V2D55_SHOTS || '/workspace/app-ira-v55';

test('v2d-55: cache e pagina PIN nera con IRA, puntini Nicola e Luisa, senza logo', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla schermata di accesso. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(5[5-9]|[6-9]\d)'/);
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-54'");

  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const setupL = await request.post('/api/pin/setup', { data: { user: 'luisa', pin: '2468' }, headers: HEAD });
  if (setupL.status() !== 409) expect(setupL.ok(), await setupL.text()).toBeTruthy();
  await request.post('/api/logout', { headers: HEAD });

  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#login-title')).toHaveText('IRA');
  await expect(page.locator('#profile-pick')).toBeVisible();

  const nicola = page.locator('.login-profile', { hasText: 'Nicola' });
  const luisa = page.locator('.login-profile', { hasText: 'Luisa' });
  await expect(nicola).toBeVisible();
  await expect(luisa).toBeVisible();
  await expect(nicola).toHaveAttribute('data-profile', 'nicola');
  await expect(luisa).toHaveAttribute('data-profile', 'luisa');
  await expect(page.locator('.login-profile')).toHaveCount(2);
  await expect(page.getByText('WhatsApp', { exact: false })).toHaveCount(0);

  const look = await page.evaluate(() => {
    const screen = getComputedStyle(document.querySelector('.login-screen'));
    const body = getComputedStyle(document.body);
    const title = getComputedStyle(document.getElementById('login-title'));
    const logo = document.querySelector('.login-logo');
    const logoStyle = logo ? getComputedStyle(logo) : null;
    return {
      screenBg: screen.backgroundColor,
      bodyBg: body.backgroundColor,
      titleColor: title.color,
      titleText: document.getElementById('login-title').textContent,
      logoShown: !!(logo && logoStyle && logoStyle.display !== 'none' && logoStyle.visibility !== 'hidden'),
    };
  });
  expect(look.screenBg).toBe('rgb(0, 0, 0)');
  expect(look.bodyBg).toBe('rgb(0, 0, 0)');
  expect(look.titleColor).toBe('rgb(229, 9, 20)');
  expect(look.titleText).toBe('IRA');
  expect(look.logoShown).toBe(false);

  fs.mkdirSync(SHOTS, { recursive: true });

  await nicola.click();
  await expect(nicola).toHaveClass(/on/);
  await expect(nicola).toHaveAttribute('aria-checked', 'true');
  await expect(luisa).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#pin-form')).toBeVisible();
  await expect(page.locator('#pin-pad')).toBeVisible();
  await expect(page.locator('#pin-slots span')).toHaveCount(4);
  await expect(page.locator('#pin-slots span.on')).toHaveCount(0);
  await expect(page.locator('#login-title')).toHaveText('IRA');
  await expect(page.locator('#pin-back')).toBeHidden();
  const pinLook = await page.evaluate(() => {
    const input = document.getElementById('pin-input');
    const s = getComputedStyle(input);
    const btn = getComputedStyle(document.getElementById('pin-submit'));
    const key = getComputedStyle(document.querySelector('#pin-pad [data-key="1"]'));
    return {
      security: s.webkitTextSecurity || s.getPropertyValue('-webkit-text-security'),
      mode: input.getAttribute('inputmode'),
      readonly: input.readOnly,
      color: s.color,
      btn: btn.backgroundColor,
      keyBg: key.backgroundColor,
      keyColor: key.color,
      radius: key.borderRadius,
    };
  });
  expect(pinLook.security).toBe('disc');
  expect(pinLook.mode).toBe('none');
  expect(pinLook.readonly).toBe(true);
  expect(pinLook.color).toBe('rgb(255, 255, 255)');
  expect(pinLook.btn).toBe('rgb(229, 9, 20)');
  expect(pinLook.keyColor).toBe('rgb(255, 255, 255)');
  expect(pinLook.radius).toBe('50%');
  await page.screenshot({ path: path.join(SHOTS, 'pin-nicola-390.png'), fullPage: true });

  await luisa.click();
  await expect(luisa).toHaveClass(/on/);
  await expect(luisa).toHaveAttribute('aria-checked', 'true');
  await expect(nicola).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#login-title')).toHaveText('IRA');
  await expect(page.locator('#pin-input')).toHaveValue('');
  await page.screenshot({ path: path.join(SHOTS, 'pin-luisa-390.png'), fullPage: true });
});

test('v2d-55: il tasto Nicola invia ancora il profilo nicola a /api/login', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla schermata di accesso. Il percorso è verificato su Chromium.');
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  await request.post('/api/logout', { headers: HEAD });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 390, height: 844 });
  const postedUsers = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/login') {
      const body = req.postDataJSON() || {};
      postedUsers.push(body.user);
    }
  });
  await page.goto('/');
  await page.locator('.login-profile', { hasText: 'Nicola' }).click();
  for (const n of ['1', '3', '5', '7']) await page.locator(`#pin-pad [data-key="${n}"]`).click();
  await page.waitForFunction(() => document.getElementById('view-login').hidden);
  expect(postedUsers).toEqual(['nicola']);
});
