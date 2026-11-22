// v2d-60: dopo il PIN (e a ogni avvio) si apre l'elenco chat, non il menu Impostazioni
// (Carattere, Vestiti, ecc.). Quel menu resta raggiungibile da Impostazioni.
const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function loginNicola(page) {
  const r = await page.request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) {
    const l = await page.request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(l.ok(), await l.text()).toBeTruthy();
  } else expect(r.ok(), await r.text()).toBeTruthy();
}

async function disableSw(page) {
  await page.addInitScript(() => { if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {}); });
}

async function landing(page) {
  await page.waitForFunction(() => window.App && App.solo && App.solo._booted && App.chars && App.chars.length > 0);
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    return {
      title: document.getElementById('title') && document.getElementById('title').textContent,
      home: document.body.classList.contains('solo-home'),
      list: document.body.classList.contains('solo-list'),
      chat: document.body.classList.contains('solo-chat'),
      tabChat: vis('tab-chat'),
      nhList: vis('nh-list'),
      names: [...document.querySelectorAll('#char-list li b')].map((b) => b.textContent),
      carattere: !![...document.querySelectorAll('#nh-list button')].find((b) => /Carattere/.test(b.textContent || '') && b.offsetParent),
    };
  });
}

test('v2d-60: cache e dopo il PIN si apre l’elenco, non il menu Carattere/Vestiti', async ({ page, request, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).toMatch(/const CACHE = 'app-privata-v2d-(6[1-9]|[7-9]\d|65b)'/); // v2d-65b alza la cache
  expect(sw).not.toContain("const CACHE = 'app-privata-v2d-59'");

  await disableSw(page);
  await loginNicola(page);
  await page.goto('/');
  const snap = await landing(page);
  expect(snap.list).toBe(true);
  expect(snap.home).toBe(false);
  expect(snap.chat).toBe(false);
  expect(snap.tabChat).toBe(true);
  expect(snap.nhList).toBe(false);
  expect(snap.carattere).toBe(false);
  expect(snap.title).toBe('Chat');
  expect(snap.names).toEqual(['IRA', 'MERCY', 'DOTT.', 'TUTTOFARE', 'P.T&FOOD']);

  // v2d-61: Impostazioni non è più raggiungibile
  await expect(page.locator('#solo-dock')).toBeHidden();
  await expect(page.locator('#dock-home')).toBeHidden();
  await page.evaluate(() => App.solo && App.solo.showHome && App.solo.showHome());
  expect(await page.evaluate(() => document.body.classList.contains('solo-home'))).toBe(false);
  expect(await page.evaluate(() => document.body.classList.contains('solo-list'))).toBe(true);

  // dalla lista si apre solo Ira
  await expect(page.locator('#char-list li[data-id]')).toHaveCount(1);
  await page.locator('#char-list li[data-id]').first().click();
  await page.waitForFunction(() => document.body.classList.contains('solo-chat'));
  await expect(page.locator('#title')).toHaveText('Ira');
  await expect(page.locator('#chat-form')).toBeVisible();
});

test('v2d-60: anche con localStorage vecchio o #home si apre l’elenco', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit chiude il processo aprendo la Home. Il percorso è verificato su Chromium.');
  await disableSw(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ap:lastProfile', 'nicola');
      localStorage.setItem('ap:nicola:lastView', '"home"');
      localStorage.setItem('ap:nicola:lastTab', '"account"');
      localStorage.setItem('ap:nicola:consentAsked', 'true');
      localStorage.setItem('ap:nicola:provaView', '"2d"');
      localStorage.setItem('ap:nicola:avatarView', '"photo"');
    } catch { /* */ }
  });
  await loginNicola(page);
  await page.goto('/#home');
  const snap = await landing(page);
  expect(snap.list).toBe(true);
  expect(snap.home).toBe(false);
  expect(snap.nhList).toBe(false);
  expect(snap.tabChat).toBe(true);
  expect(snap.title).toBe('Chat');
  expect(snap.names[0]).toBe('IRA');
  expect(await page.evaluate(() => location.hash)).toBe('#home'); // l'hash non è una rotta e viene ignorato
});
