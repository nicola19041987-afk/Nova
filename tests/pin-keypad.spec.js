const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

test('il tastierino inserisce il PIN e Avanti entra, senza tastiera nativa', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo sulla schermata di accesso. Il percorso è verificato su Chromium.');
  const setup = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  await page.request.post('/api/logout', { headers: HEAD });
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.login-profile', { hasText: 'Nico' }).click();
  await expect(page.locator('#pin-pad')).toBeVisible();
  await expect(page.locator('#login-title')).toHaveText('Inserisci il PIN');
  const before = await page.evaluate(() => {
    const input = document.getElementById('pin-input');
    const body = getComputedStyle(document.body).backgroundColor;
    return { active: document.activeElement === input, readonly: input.readOnly, mode: input.getAttribute('inputmode'), body };
  });
  expect(before.active).toBe(false);
  expect(before.readonly).toBe(true);
  expect(before.mode).toBe('none');
  expect(before.body).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: '/opt/cursor/artifacts/v2d-22-pin-390.png' });
  for (const n of ['1', '3', '5']) await page.locator(`#pin-pad [data-key="${n}"]`).click();
  const dots = await page.evaluate(() => {
    const input = document.getElementById('pin-input');
    const s = getComputedStyle(input);
    return { value: input.value, security: s.webkitTextSecurity || s.getPropertyValue('-webkit-text-security'), active: document.activeElement === input };
  });
  expect(dots.value).toBe('135');
  expect(dots.security).toBe('disc');
  expect(dots.active).toBe(false);
  await page.locator('#pin-submit').click();
  await expect(page.locator('#login-error')).toContainText('4 cifre');
  await page.locator('#pin-pad [data-key="7"]').click();
  await page.waitForFunction(() => document.getElementById('view-login').hidden);
  await expect(page.locator('#view-login')).toBeHidden();
});
