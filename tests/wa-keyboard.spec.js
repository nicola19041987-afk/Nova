const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const OUT = '/opt/cursor/artifacts';

async function boot(page) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta', serverKey: true });
    if (p === '/api/characters') return json([{ id: 'bbbbbbbbbbbbbbbb', name: 'Nova', ready: 'nova-scelta', avatar: '🙂', personality: 'x', style: '', requests: '' }]);
    if (p.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (p === '/api/settings') return json({ autoSave: false, allowExport: false, contentFilter: true });
    if (p === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (p === '/api/adult-keyword') return json({ set: false });
    if (p === '/api/rules') return json({ text: '' });
    if (p === '/api/memory') return json([]);
    if (p === '/api/notes') return json({ text: '', toAI: false });
    if (p === '/api/sync') return json({});
    if (p === '/api/actions') return json([]);
    if (p === '/api/gestures') return json([]);
    return json({});
  });
}

async function fill(page) {
  await page.waitForFunction(() => document.body.classList.contains('solo-chat') && document.getElementById('title').textContent === 'Nova' && document.getElementById('chat-form'));
  await page.evaluate(() => {
    const stop = (av) => { if (!av) return; try { cancelAnimationFrame(av._raf); } catch (e) {} av._raf = 0; av.breathOn = false; };
    if (window.App) { stop(App.avatarConv); stop(App.avatarEditor); stop(App.avatarPresence); }
  });
  await page.evaluate(() => {
    const box = document.getElementById('messages');
    for (let i = 1; i <= 18; i++) {
      const el = document.createElement('div');
      el.className = i % 2 ? 'msg user' : 'msg assistant';
      el.innerHTML = `<div class="body">${i % 2 ? 'Messaggio lungo di prova numero ' + i + ', come su WhatsApp.' : 'Risposta di Nova numero ' + i + ', resta nella lista.'}</div>`;
      box.appendChild(el);
    }
    box.lastElementChild.id = 'last-msg';
    box.scrollTop = box.scrollHeight;
  });
}

function measure() {
  const shellEl = document.getElementById('app-shell');
  const headerEl = document.querySelector('.topbar');
  const formEl = document.getElementById('chat-form');
  const lastEl = document.getElementById('last-msg');
  const listEl = document.getElementById('messages');
  const input = document.getElementById('chat-input');
  const shell = shellEl.getBoundingClientRect();
  const header = headerEl.getBoundingClientRect();
  const form = formEl.getBoundingClientRect();
  const last = lastEl.getBoundingClientRect();
  const list = listEl.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(formEl).paddingBottom) || 0;
  return {
    scroll: window.scrollY,
    shellTop: shell.top,
    shellH: shell.height,
    shellW: shell.width,
    headerTop: header.top,
    headerH: header.height,
    formTop: form.top,
    formBottom: form.bottom,
    formH: form.height,
    lastTop: last.top,
    lastBottom: last.bottom,
    listH: list.height,
    listScrolls: document.getElementById('messages').scrollHeight > document.getElementById('messages').clientHeight + 2,
    kb: document.documentElement.classList.contains('kb-open'),
    pad,
    inputH: input.getBoundingClientRect().height,
    title: document.getElementById('title').textContent,
  };
}

test('iPhone: a tastiera chiusa la testata sta in alto e il campo in basso', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.goto('/');
  await fill(page);
  const closed = await page.evaluate(measure);
  expect(closed.scroll).toBe(0);
  expect(closed.kb).toBe(false);
  expect(closed.shellTop).toBeGreaterThan(-1);
  expect(closed.shellTop).toBeLessThan(2);
  expect(closed.shellW).toBeGreaterThan(388);
  expect(Math.abs(closed.shellH - 844)).toBeLessThan(2);
  expect(closed.headerTop).toBeLessThan(closed.shellTop + 8);
  expect(Math.abs(closed.formBottom - (closed.shellTop + closed.shellH))).toBeLessThan(2);
  expect(closed.lastBottom).toBeLessThanOrEqual(closed.formTop + 10);
  expect(closed.lastTop).toBeGreaterThan(closed.headerTop + closed.headerH);
  expect(closed.listScrolls).toBe(true);
  expect(closed.title).toBe('Nova');
  await page.screenshot({ path: path.join(OUT, 'v2d-27-iphone-closed.png') }).catch(() => {});
});

test('iPhone: con la tastiera il campo è sul bordo e la testata non si muove', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.goto('/');
  await fill(page);
  await page.evaluate(() => {
    window.scrollTo(0, 180);
    window.__vvTest = { height: 430, offsetTop: 280 };
    App.applyViewport();
  });
  const opened = await page.evaluate(measure);
  expect(opened.scroll).toBe(0);
  expect(opened.kb).toBe(true);
  expect(opened.shellTop).toBeGreaterThan(270);
  expect(opened.shellTop).toBeLessThan(290);
  expect(opened.shellH).toBeGreaterThan(420);
  expect(opened.shellH).toBeLessThan(440);
  expect(opened.shellW).toBeGreaterThan(388);
  expect(opened.headerTop).toBeGreaterThan(opened.shellTop - 1);
  expect(opened.headerTop).toBeLessThan(opened.shellTop + 8);
  expect(Math.abs(opened.formBottom - (opened.shellTop + opened.shellH))).toBeLessThan(2);
  expect(opened.pad).toBeLessThan(8);
  expect(opened.lastBottom).toBeLessThanOrEqual(opened.formTop + 10);
  expect(opened.lastTop).toBeGreaterThan(opened.headerTop);
  const typed = await page.evaluate(() => {
    const header = document.querySelector('.topbar').getBoundingClientRect().top;
    const form = document.getElementById('chat-form').getBoundingClientRect().top;
    const input = document.getElementById('chat-input');
    input.value = 'a';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const one = {
      header: document.querySelector('.topbar').getBoundingClientRect().top,
      form: document.getElementById('chat-form').getBoundingClientRect().top,
      inputH: input.getBoundingClientRect().height,
    };
    input.value = 'riga uno\nriga due\nriga tre\nriga quattro';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const many = {
      header: document.querySelector('.topbar').getBoundingClientRect().top,
      inputH: input.getBoundingClientRect().height,
      lastBottom: document.getElementById('last-msg').getBoundingClientRect().bottom,
      formTop: document.getElementById('chat-form').getBoundingClientRect().top,
    };
    return { header, form, one, many };
  });
  expect(Math.abs(typed.one.header - typed.header)).toBeLessThan(1);
  expect(Math.abs(typed.one.form - typed.form)).toBeLessThan(1);
  expect(Math.abs(typed.many.header - typed.header)).toBeLessThan(1);
  expect(typed.many.inputH).toBeGreaterThan(typed.one.inputH + 20);
  expect(typed.many.inputH).toBeLessThan(150);
  expect(typed.many.lastBottom).toBeLessThanOrEqual(typed.many.formTop + 10);
  await page.screenshot({ path: path.join(OUT, 'v2d-27-iphone-open.png') });
  await page.screenshot({
    path: path.join(OUT, 'v2d-27-iphone-open-visible.png'),
    clip: { x: 0, y: Math.max(0, Math.round(opened.shellTop)), width: 390, height: Math.max(200, Math.round(opened.shellH)) },
  }).catch(() => {});
});

test('Android Chrome: la tastiera accorcia la viewport e il campo resta sul bordo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Emulazione Android su Chromium.');
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 412, height: 915 });
  await boot(page);
  await page.goto('/');
  await fill(page);
  const closed = await page.evaluate(measure);
  expect(closed.shellW).toBeGreaterThan(410);
  expect(Math.abs(closed.formBottom - (closed.shellTop + closed.shellH))).toBeLessThan(2);
  expect(closed.headerTop).toBeLessThan(40);
  expect(closed.listScrolls).toBe(true);
  await page.screenshot({ path: path.join(OUT, 'v2d-27-android-closed.png') });
  await page.evaluate(() => {
    window.__vvTest = { height: 520, offsetTop: 0 };
    document.getElementById('chat-input').focus();
    App.applyViewport();
  });
  const opened = await page.evaluate(measure);
  expect(opened.scroll).toBe(0);
  expect(opened.kb).toBe(true);
  expect(opened.shellTop).toBeLessThan(2);
  expect(opened.shellH).toBeGreaterThan(510);
  expect(opened.shellH).toBeLessThan(530);
  expect(opened.shellW).toBeGreaterThan(410);
  expect(Math.abs(opened.formBottom - (opened.shellTop + opened.shellH))).toBeLessThan(2);
  expect(opened.headerTop).toBeLessThan(40);
  expect(opened.pad).toBeLessThan(8);
  expect(opened.lastBottom).toBeLessThanOrEqual(opened.formTop + 10);
  await page.screenshot({ path: path.join(OUT, 'v2d-27-android-open.png') });
});
