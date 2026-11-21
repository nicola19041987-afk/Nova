// v2d-57: elenco chat dopo il PIN; funziona solo Ira (chat invariata).
// v2d-59: etichette IRA, MERCY (con foto, sottotitolo «Bot NF Motors»), DOTT., TUTTOFARE, P.T&FOOD (gli altri «In arrivo»).
const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

test('v2d-57: cache, elenco chat in ordine, solo Ira attiva, gli altri «In arrivo»', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(60|[6-9]\d)'/); // v2d-60 alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-56'");
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await loginNicola(page);
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && App.chars && App.chars.length > 0);
  await page.waitForTimeout(1500);
  await page.locator('#dock-chat').click();
  await expect(page.locator('#tab-chat')).toBeVisible();
  const names = await page.locator('#char-list li b').allTextContents();
  expect(names).toEqual(['IRA', 'MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']);
  await expect(page.locator('#char-list li[data-id]')).toHaveCount(1);
  const mercy = page.locator('#char-list li.chat-ph', { hasText: 'MERCY' });
  await expect(mercy).toHaveCount(1);
  await expect(mercy.locator('img')).toHaveCount(1);
  await expect(mercy.locator('img')).toHaveAttribute('src', /\/avatars\/mercy\.jpg/);
  await expect(mercy.locator('.avatar-default')).toHaveCount(0);
  await expect(mercy).toContainText('Bot NF Motors');
  await expect(mercy).not.toContainText('In arrivo');
  for (const n of ['DOTT.', 'TUTTOFARE', 'P.T&FOOD']) {
    const li = page.locator('#char-list li.chat-ph', { hasText: n });
    await expect(li).toHaveCount(1);
    await expect(li.locator('.avatar-default svg')).toHaveCount(1);
    await expect(li.locator('img')).toHaveCount(0);
    await expect(li).toContainText('In arrivo');
  }
  // un segnaposto (anche MERCY) non apre nessuna chat
  for (const n of ['MERCY', 'P.T&FOOD']) {
    await page.locator('#char-list li.chat-ph', { hasText: n }).click();
    await expect(page.locator('#tab-chat')).toBeVisible();
    await expect(page.locator('#tab-conv')).toBeHidden();
  }
  // Ira si apre come prima
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#title')).toHaveText('Ira');
  await expect(page.locator('#chat-form')).toBeVisible();
  expect(await page.evaluate(() => App.current && App.current.ready)).toBe('nova-scelta');
  await page.locator('#back-btn').click();
  await expect(page.locator('#tab-chat')).toBeVisible();
});
