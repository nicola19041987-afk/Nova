const { test, expect } = require('@playwright/test');

const CHIARA = 'aaaaaaaaaaaaaaaa';
const NOVA = 'bbbbbbbbbbbbbbbb';
const GRETA = 'cccccccccccccccc';
const MARA = 'ffffffffffffffff';
const ESTATE = 'dddddddddddddddd';
const INVERNO = 'eeeeeeeeeeeeeeee';

function seed() {
  return [
    { id: CHIARA, name: 'Chiara', ready: 'chiara', createdBy: 'nicola', avatar: '🌿', personality: 'x', style: '', orders: '', requests: '' },
    { id: NOVA, name: 'Nova', ready: 'greta', createdBy: 'nicola', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '' },
    { id: GRETA, name: 'Greta', avatar: 'G', personality: 'vecchia', style: '', orders: '', requests: '' },
    { id: MARA, name: 'Mara', createdBy: 'luisa', avatar: 'M', personality: 'di luisa', style: '', orders: '', requests: '' },
    { id: ESTATE, name: 'Estate', createdBy: 'nicola', avatar: 'E', personality: 'salvata', style: '', orders: '', requests: '' },
    { id: INVERNO, name: 'Inverno', createdBy: 'nicola', avatar: 'I', personality: 'salvata', style: '', orders: '', requests: '' },
  ];
}

async function mockApp(page, state) {
  await page.addInitScript(() => {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (path === '/api/me') return json({ user: 'nicola', name: 'Nico', admin: true, editor: true, activated: true, consent: { activatedAt: '2026-01-01T00:00:00.000Z', phrase: 'ok' }, adult: false, adultChat: false, solo: true, soloKey: 'greta' });
    if (path === '/api/characters/options') return json({});
    if (path === '/api/characters' && route.request().method() === 'GET') return json(state.chars);
    if (path.startsWith('/api/characters/') && route.request().method() === 'DELETE') {
      const id = path.split('/').pop();
      state.deleted.push(id);
      state.chars = state.chars.filter((c) => c.id !== id);
      return json({ ok: true });
    }
    if (path.startsWith('/api/chats/')) return json({ epoch: 'e1', last: 1, messages: [], typing: null });
    if (path === '/api/settings') {
      if (route.request().method() === 'PUT') {
        const b = route.request().postDataJSON();
        state.active = b.activeChar || '';
        state.puts.push(b.activeChar || '');
      }
      return json({ autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6, activeChar: state.active });
    }
    if (path === '/api/adult-status') return json({ set: false, chat: false, users: [], missing: [] });
    if (path === '/api/adult-keyword') return json({ set: false });
    if (path === '/api/rules') return json({ text: '' });
    if (path === '/api/memory') return json([]);
    if (path === '/api/notes') return json({ text: '', toAI: false });
    if (path === '/api/sync') return json({ chars: '1', memory: '1', adultChat: false });
    if (path === '/api/images' || path === '/api/videos' || path === '/api/feed' || path === '/api/actions') return json([]);
    if (path === '/api/solo/prep') return json({ ok: true });
    return json({});
  });
}

test('il foglio avatar elenca, attiva, annulla la cancellazione e si chiude con la X', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WPE chiude il processo quando si apre questo foglio. Il flusso è verificato su Chromium a 390×844.');
  const state = { chars: seed(), active: '', deleted: [], puts: [] };
  await mockApp(page, state);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const r = await page.evaluate(async (ids) => {
    document.getElementById('wa-photo').click();
    const sheet = document.getElementById('avatar-sheet');
    const row = (id) => sheet.querySelector(`li[data-id="${id}"]`);
    const names = [...sheet.querySelectorAll('li b')].map((b) => b.textContent);
    const activeBefore = sheet.querySelector('li.on');
    row(ids.estate).querySelector('[data-act]').click();
    for (let i = 0; i < 40 && document.getElementById('title').textContent !== 'Estate'; i++) await new Promise((ok) => setTimeout(ok, 25));
    const delLocked = sheet.querySelector('li.on [data-del]').disabled;
    const activeName = sheet.querySelector('li.on b').textContent;
    const asks = [];
    const prev = window.confirm;
    window.confirm = (m) => { asks.push(m); return false; };
    row(ids.inverno).querySelector('[data-del]').click();
    window.confirm = prev;
    const still = sheet.querySelectorAll('li').length;
    const opened = !sheet.hidden;
    sheet.querySelector('.avatar-x').click();
    return {
      opened,
      names,
      activeBefore: !!activeBefore,
      activeName,
      delLocked,
      title: document.getElementById('title').textContent,
      current: App.current && App.current.id,
      active: App.settings && App.settings.activeChar,
      photo: document.getElementById('wa-photo').textContent,
      asks,
      still,
      closed: sheet.hidden,
      x: sheet.querySelector('.avatar-x').getAttribute('aria-label'),
    };
  }, { estate: ESTATE, inverno: INVERNO });
  expect(r.names).toEqual(['Estate', 'Inverno']);
  expect(r.activeBefore).toBe(false);
  expect(r.activeName).toBe('Estate');
  expect(r.delLocked).toBe(true);
  expect(r.title).toBe('Estate');
  expect(r.current).toBe(ESTATE);
  expect(r.active).toBe(ESTATE);
  expect(r.photo).toBe('E');
  expect(r.asks).toEqual(['Cancellare definitivamente Inverno?']);
  expect(r.still).toBe(2);
  expect(state.puts).toEqual([ESTATE]);
  expect(state.deleted).toEqual([]);
  expect(r.opened).toBe(true);
  expect(r.closed).toBe(true);
  expect(r.x).toBe('Chiudi');
});
