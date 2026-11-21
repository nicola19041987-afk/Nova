// v2d-59: elenco chat IRA (foto sua), MERCY (foto ufficiale bionda), DOTT., TUTTOFARE, P.T&FOOD
// (questi tre senza foto). Sottotitoli invariati; funziona solo la chat Ira.
const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

test('v2d-59: cache, nomi elenco, foto Mercy, solo Ira attiva', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(60|[6-9]\d)'/); // v2d-60 alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-59'");
  expect(sw).toContain("/avatars/mercy.jpg");

  const photo = await request.get('/avatars/mercy.jpg');
  expect(photo.ok(), await photo.text()).toBeTruthy();
  expect(photo.headers()['content-type'] || '').toMatch(/image\/jpeg/);
  const buf = Buffer.from(await photo.body());
  expect(buf.length).toBeGreaterThan(10000);
  expect(buf[0]).toBe(0xff);
  expect(buf[1]).toBe(0xd8);

  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await loginNicola(page);
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && App.chars && App.chars.length > 0);
  await page.waitForTimeout(1500);
  // v2d-61: niente barra in basso; dopo il PIN l'elenco è già aperto
  await expect(page.locator('#tab-chat')).toBeVisible();
  const names = await page.locator('#char-list li b').allTextContents();
  expect(names).toEqual(['IRA', 'MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']);
  await expect(page.locator('#char-list li[data-id]')).toHaveCount(1);

  const ira = page.locator('#char-list li[data-id]').first();
  await expect(ira.locator('b')).toHaveText('IRA');
  await expect(ira.locator('img')).toHaveCount(1);

  const mercy = page.locator('#char-list li.chat-ph', { hasText: 'MERCY' });
  await expect(mercy.locator('img')).toHaveAttribute('src', /\/avatars\/mercy\.jpg/);
  await expect(mercy.locator('.avatar-default')).toHaveCount(0);
  const loaded = await mercy.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBeTruthy();
  await expect(mercy.locator('span')).toHaveText('Bot NF Motors');
  await expect(mercy).not.toContainText('In arrivo');

  for (const n of ['DOTT.', 'TUTTOFARE', 'P.T&FOOD']) {
    const li = page.locator('#char-list li.chat-ph', { hasText: n });
    await expect(li.locator('.avatar-default svg')).toHaveCount(1);
    await expect(li.locator('img')).toHaveCount(0);
    await expect(li).toContainText('In arrivo');
  }

  for (const n of ['MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']) {
    await page.locator('#char-list li.chat-ph', { hasText: n }).click();
    await expect(page.locator('#tab-chat')).toBeVisible();
    await expect(page.locator('#tab-conv')).toBeHidden();
  }

  await ira.click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#title')).toHaveText('Ira'); // nome personaggio invariato; «IRA» è solo in elenco
  await expect(page.locator('#chat-form')).toBeVisible();
  expect(await page.evaluate(() => App.current && App.current.ready)).toBe('nova-scelta');
  await page.locator('#back-btn').click();
  await expect(page.locator('#tab-chat')).toBeVisible();
  const namesBack = await page.locator('#char-list li b').allTextContents();
  expect(namesBack).toEqual(['IRA', 'MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']);
});
