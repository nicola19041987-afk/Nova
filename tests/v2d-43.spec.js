const { test, expect } = require('./harness');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const JPG = path.join(__dirname, 'fixtures-v2d43', 'sample.jpg');
const MP4 = path.join(__dirname, 'fixtures-v2d43', 'sample.mp4');

const CH = '5ce17a0000000001';
async function mockHome(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: CH, name: 'Alpha', ready: 'nova-scelta', avatar: '', motionClips: [], outfits: [], personality: '', style: '', requests: '', voice: 'eve' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 0, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/gallery') return json({ items: [], trash: [], trashDays: 30 });
    if (p === '/api/images' || p === '/api/videos' || p === '/api/actions' || p === '/api/gestures' || p === '/api/memory' || p === '/api/rules') return json(p === '/api/rules' ? { text: '' } : (p === '/api/memory' ? [] : []));
    if (p === '/api/notes') return json({ text: '', toAI: false });
    return json({});
  });
}

test('v2d-43: nel menu solo-mode c e Galleria, apre la scheda con Aggiungi, e Indietro torna in chat', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso e verificato su Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockHome(page);
  await page.goto('/');
  await page.waitForFunction(() => window.App && App.solo && App.solo._bound, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await expect(page.locator('#nh-list')).toBeVisible();
  const gal = page.locator('#dock-gallery');
  await expect(gal).toBeVisible();
  await expect(gal).toContainText('Galleria');
  await gal.scrollIntoViewIfNeeded();
  await gal.click();
  await expect(page.locator('#tab-images')).toBeVisible();
  await expect(page.locator('#gal-add')).toBeVisible();
  await expect(page.locator('#gal-add')).toContainText('Aggiungi');
  await expect(page.locator('#legacy-tabbar')).toBeHidden();
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('#back-btn')).toBeVisible();
  await page.locator('#back-btn').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#chat-form')).toBeVisible();
  await expect(page.locator('#tab-images')).toBeHidden();
});

test('v2d-43: da Galleria si caricano un JPEG e un MP4 di prova e compaiono in Dal telefono', async ({ page, browserName, request }) => {
  test.skip(browserName === 'webkit', 'Upload file: percorso completo su Chromium.');
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  await request.post('/api/logout', { headers: HEAD }).catch(() => {});
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.login-profile', { hasText: 'Nico' }).click();
  for (const n of ['1', '3', '5', '7']) await page.locator(`#pin-pad [data-key="${n}"]`).click();
  await page.waitForFunction(() => document.getElementById('view-login').hidden, null, { timeout: 30000 });
  await page.waitForFunction(() => window.App && App.solo && document.body.classList.contains('solo-mode'), null, { timeout: 30000 });
  if (!(await page.locator('#nh-list').isVisible().catch(() => false))) {
    await page.evaluate(() => App.solo && App.solo.showHome && App.solo.showHome());
  }
  // pulizia della sola galleria di prova (DATA_DIR e2e), cosi la suite condivisa non lascia file precedenti
  const gal = await request.get('/api/gallery', { headers: HEAD });
  if (gal.ok()) {
    const body = await gal.json();
    for (const it of body.items || []) {
      await request.delete('/api/gallery/' + it.id, { data: { confirm: true }, headers: HEAD });
    }
  }
  await expect(page.locator('#dock-gallery')).toBeVisible();
  await page.locator('#dock-gallery').click();
  await expect(page.locator('#tab-images')).toBeVisible();
  await expect(page.locator('#gal-add')).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#gal-add').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([JPG, MP4]);
  await expect(page.locator('#gal-phone .ptile')).toHaveCount(2, { timeout: 20000 });
  await expect(page.locator('#gal-phone .ptile.vid')).toHaveCount(1);
  await expect(page.locator('#gal-count')).toHaveText('2 elementi');
  await expect(page.locator('#toast')).toContainText('aggiunti alla Galleria');
  await page.locator('#gal-phone .ptile.vid').click();
  await expect(page.locator('#viewer')).toBeVisible();
  await expect(page.locator('#viewer video')).toBeVisible();
  await page.locator('#vw-close').click();
  await expect(page.locator('#viewer')).toBeHidden();
  await page.locator('#back-btn').click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#chat-form')).toBeVisible();
});
