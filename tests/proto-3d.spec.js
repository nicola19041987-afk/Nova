const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

async function openProto(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.goto('/proto/3d.html');
}

test('la home di produzione non carica il prototipo 3D', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html.includes('/proto/3d')).toBe(false);
  expect(html.includes('avatar3d.js')).toBe(false);
  expect(html.includes('Nova usa la foto')).toBe(true);
});

test('il prototipo mostra il corpo intero, respira e il saluto non è un salto', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'WebKit è misurato nel test dedicato');
  await page.setViewportSize({ width: 390, height: 844 });
  await openProto(page);
  await page.waitForFunction(() => window.Proto3D && (Proto3D.ready() || Proto3D.failed()), null, { timeout: 20000 });
  expect(await page.evaluate(() => Proto3D.failed())).toBe('');
  await page.waitForFunction(() => Proto3D.stats().frames > 8);
  const span = await page.evaluate(() => Proto3D.span());
  const hang = await page.evaluate(() => Proto3D.hang());
  expect(hang.length).toBe(2);
  expect(hang[0]).toBeLessThan(-0.05);
  expect(hang[1]).toBeLessThan(-0.05);
  expect(span.top).toBeGreaterThan(0.01);
  expect(span.top).toBeLessThan(0.22);
  expect(span.bot).toBeGreaterThan(0.78);
  expect(span.bot).toBeLessThan(0.995);
  const bar = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const bar = document.getElementById('bar').getBoundingClientRect();
    const banner = document.getElementById('banner').getBoundingClientRect();
    return { separated: bar.top >= stage.bottom - 1 && banner.bottom <= stage.top + 1, stageH: stage.height };
  });
  expect(bar.separated).toBe(true);
  expect(bar.stageH).toBeGreaterThan(400);
  const a = await page.evaluate(() => Proto3D.sample().head);
  await page.waitForTimeout(700);
  const b = await page.evaluate(() => Proto3D.sample().head);
  const moved = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  expect(moved).toBeGreaterThan(0.002);
  expect(moved).toBeLessThan(0.2);
  const stats = await page.evaluate(() => Proto3D.stats());
  expect(stats.frames).toBeGreaterThan(10);
  expect(stats.avgMs).toBeGreaterThan(15);
  expect(stats.avgMs).toBeLessThan(80);
  expect(stats.maxMs).toBeLessThan(150);
  fs.writeFileSync('/opt/cursor/artifacts/3d-proto-chromium.json', JSON.stringify({ viewport: '390x844', ...stats, span }, null, 2));
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: '/opt/cursor/artifacts/3d-proto-390.png' });
  await page.setViewportSize({ width: 473, height: 1024 });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => Proto3D.span());
  expect(wide.top).toBeLessThan(0.22);
  expect(wide.bot).toBeGreaterThan(0.78);
  await page.screenshot({ path: '/opt/cursor/artifacts/3d-proto-473.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const arm0 = await page.evaluate(() => Proto3D.sample().arm.slice());
  await page.locator('#wave').click();
  await page.waitForFunction(() => Proto3D.sample().waving);
  await page.waitForTimeout(1100);
  const arm = await page.evaluate(() => Proto3D.sample().arm);
  const armMove = Math.abs(arm[0] - arm0[0]) + Math.abs(arm[1] - arm0[1]) + Math.abs(arm[2] - arm0[2]);
  expect(armMove).toBeGreaterThan(0.25);
  expect(armMove).toBeLessThan(2.5);
  await page.screenshot({ path: '/opt/cursor/artifacts/3d-proto-wave.png' });
  await page.waitForFunction(() => !Proto3D.sample().waving, null, { timeout: 4000 });
  await page.locator('#full').click();
  await expect(page.locator('body')).toHaveClass(/full/);
  const full = await page.evaluate(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const bar = document.getElementById('bar').getBoundingClientRect();
    const span = Proto3D.span();
    return { separated: bar.top >= stage.bottom - 1, top: span.top, bot: span.bot, bannerHidden: getComputedStyle(document.getElementById('banner')).display === 'none' };
  });
  expect(full.separated).toBe(true);
  expect(full.bannerHidden).toBe(true);
  expect(full.top).toBeLessThan(0.2);
  expect(full.bot).toBeGreaterThan(0.8);
  await page.screenshot({ path: '/opt/cursor/artifacts/3d-proto-full.png' });
});

test('se il modello non arriva resta un avviso, senza pagina bianca', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit', 'WebKit è misurato nel test dedicato');
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/models/nova.glb', (route) => route.abort());
  await page.goto('/proto/3d.html');
  await expect(page.locator('#fail')).toBeVisible();
  await expect(page.locator('#fail')).toContainText('non caricato');
  expect(await page.evaluate(() => Proto3D.ready())).toBe(false);
});

test('registra un demo neutro del prototipo', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'il video di prova è Chromium');
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: '/tmp/nova-3d-video', size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.goto('/proto/3d.html');
  await page.waitForFunction(() => window.Proto3D && Proto3D.ready(), null, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await page.locator('#wave').click();
  await page.waitForTimeout(2400);
  await page.locator('#full').click();
  await page.waitForTimeout(1400);
  const video = page.video();
  await context.close();
  const src = await video.path();
  fs.copyFileSync(src, '/opt/cursor/artifacts/3d-proto-390.webm');
});

test('WebKit: il prototipo parte oppure spiega il fallimento', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit', 'solo WebKit');
  await page.setViewportSize({ width: 390, height: 844 });
  await openProto(page);
  await page.waitForFunction(() => window.Proto3D && (Proto3D.failed() || Proto3D.stats().frames > 5), null, { timeout: 20000 });
  const result = await page.evaluate(() => ({
    ready: Proto3D.ready(),
    failed: Proto3D.failed(),
    span: Proto3D.ready() ? Proto3D.span() : null,
    stats: Proto3D.stats(),
  }));
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync('/opt/cursor/artifacts/3d-proto-webkit.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '/opt/cursor/artifacts/3d-proto-webkit.png' });
  if (result.ready) {
    expect(result.span.top).toBeLessThan(0.25);
    expect(result.span.bot).toBeGreaterThan(0.75);
  } else {
    expect(result.failed.length).toBeGreaterThan(5);
    await expect(page.locator('#fail')).toBeVisible();
  }
});
