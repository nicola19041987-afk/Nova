const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const DATA = '/tmp/nova-e2e-empty';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function write(rel, buf) {
  const abs = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function seed() {
  write('users/nicola/gallery/aaaaaaaaaaaaaaaa.jpg', PNG);
  write('users/nicola/gallery.json', JSON.stringify([{ id: 'aaaaaaaaaaaaaaaa', file: 'aaaaaaaaaaaaaaaa.jpg', kind: 'image', type: 'image/jpeg', name: 'Dal telefono', addedAt: '2020-01-01T00:00:00.000Z' }]));
  write('users/luisa/images/bbbbbbbbbbbbbbbb.png', PNG);
  write('users/luisa/images.json', JSON.stringify([{ file: 'bbbbbbbbbbbbbbbb.png', prompt: 'un lago', createdAt: '2021-01-01T00:00:00.000Z' }]));
  write('shared/avatars/cccccccccccccccc.jpg', PNG);
  write('shared/chat-media/dddddddddddddddd.mp4', Buffer.from('fake-mp4'));
  write('shared/chats/eeeeeeeeeeeeeeee.json', JSON.stringify({ epoch: 'e', messages: [{ id: 'm1', n: 1, role: 'user', author: 'luisa', at: '2022-06-01T12:00:00.000Z', content: 'ci vediamo su telegram 123456789:AAFakeTokenValue1234567890', photo: { file: 'dddddddddddddddd.mp4', kind: 'video' } }] }));
  write('shared/trash-characters/1700000000000-ffffffffffff/meta.json', JSON.stringify({ deletedAt: '2023-03-01T00:00:00.000Z', by: 'nicola', name: 'Vecchia' }));
  write('shared/trash-characters/1700000000000-ffffffffffff/character.json', JSON.stringify({ id: 'ffffffffffff', name: 'Vecchia', createdBy: 'nicola' }));
  write('shared/trash-characters/1700000000000-ffffffffffff/files/1111111111111111.png', PNG);
}

async function session(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test('la galleria totale elenca ogni fonte, per entrambi, senza cancellare', async ({ request }) => {
  fs.rmSync(path.join(DATA, 'pins.json'), { force: true });
  fs.rmSync(path.join(DATA, 'lockout.json'), { force: true });
  seed();
  const anon = await request.get('/api/archive');
  expect(anon.status()).toBe(401);
  await session(request, 'luisa', '4321');
  const a = await request.get('/api/archive');
  expect(a.ok(), await a.text()).toBeTruthy();
  const body = await a.json();
  const raw = JSON.stringify(body);
  expect(raw).not.toContain('base64');
  expect(raw).not.toContain('data:image');
  expect(raw).not.toContain('AAFakeToken');
  expect(body.totals.photos).toBeGreaterThanOrEqual(3);
  expect(body.totals.videos).toBeGreaterThanOrEqual(1);
  expect(body.totals.by.Nicola).toBeGreaterThanOrEqual(1);
  expect(body.totals.by.Luisa).toBeGreaterThanOrEqual(1);
  expect(body.totals.by['Nova-generated']).toBeGreaterThanOrEqual(1);
  expect(body.totals.first).toBeTruthy();
  expect(body.totals.last).toBeTruthy();
  const sources = new Set(body.items.map((i) => i.source));
  for (const s of ['Galleria', 'Immagine generata', 'Avatar', 'Chat', 'Cestino']) expect(sources.has(s)).toBeTruthy();
  expect(body.items.some((i) => i.trash && i.label === 'Vecchia')).toBeTruthy();
  expect(body.items.map((i) => i.at).join('|')).toBe([...body.items].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((i) => i.at).join('|'));
  expect(body.telegram.code).toBe(false);
  expect(body.telegram.hits.some((h) => /telegram/i.test(h.text) && h.who === 'Luisa')).toBeTruthy();
  const photo = body.items.find((i) => i.source === 'Galleria');
  const file = await request.get(photo.url);
  expect(file.ok()).toBeTruthy();
  expect(file.headers()['content-type']).toContain('image/jpeg');
  const gone = await request.delete('/api/archive', { headers: HEAD });
  expect(gone.status()).toBe(404);
  await request.post('/api/logout', { headers: HEAD });
  await session(request, 'nicola', '1111');
  const b = await request.get('/api/archive');
  expect((await b.json()).items.map((i) => i.id).sort()).toEqual(body.items.map((i) => i.id).sort());
});

test('il link #galleria dopo il PIN apre la galleria e Impostazioni ci arriva', async ({ page }) => {
  seed();
  await page.goto('/#galleria');
  await expect(page.locator('#view-login')).toBeVisible();
  await expect(page.locator('#archive-page')).toBeHidden();
  await page.evaluate(async () => {
    const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'app-privata' }, body: JSON.stringify(body) });
    let r = await post('/api/pin/setup', { user: 'luisa', pin: '4321' });
    if (r.status === 409) r = await post('/api/login', { user: 'luisa', pin: '4321' });
    if (!r.ok) throw new Error(await r.text());
  });
  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('archive-on'));
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#archive-page')).toBeVisible();
  await expect(page.locator('#archive-totals')).toContainText('video');
  await expect(page.locator('#archive-totals')).toContainText('foto');
  await expect(page.locator('#archive-page')).not.toContainText('Cancella');
  await expect(page.locator('#archive-telegram')).toContainText('ci vediamo');
  await expect(page.locator('#archive-telegram')).not.toContainText('AAFakeToken');
  const img = page.locator('#archive-grid img').first();
  await expect(img).toHaveAttribute('loading', 'lazy');
  await page.locator('#archive-grid .arch-item').first().click();
  await expect(page.locator('#archive-view')).toBeVisible();
  await expect(page.locator('#archive-full')).toBeVisible();
  await page.locator('#archive-view-x').click();
  await expect(page.locator('#archive-view')).toBeHidden();
  await page.locator('#archive-back').click();
  await expect(page.locator('#archive-page')).toBeHidden();
  await page.locator('#dock-settings').click();
  await page.locator('#open-archive').click();
  await expect(page.locator('#archive-page')).toBeVisible();
  expect(page.url()).toContain('#galleria');
});
