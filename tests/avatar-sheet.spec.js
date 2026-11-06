const { test, expect } = require('@playwright/test');

const CHIARA = 'aaaaaaaaaaaaaaaa';
const NOVA = 'bbbbbbbbbbbbbbbb';
const GRETA = 'cccccccccccccccc';

function seed() {
  return [
    { id: CHIARA, name: 'Chiara', ready: 'chiara', avatar: '🌿', personality: 'x', style: '', orders: '', requests: '' },
    { id: NOVA, name: 'Nova', ready: 'greta', avatar: '🍷', personality: 'Chi sei: Nova', style: '', orders: '', requests: '' },
    { id: GRETA, name: 'Greta', avatar: 'G', personality: 'vecchia', style: '', orders: '', requests: '' },
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
    const activeBefore = sheet.querySelector('li.on b').textContent;
    const delLocked = sheet.querySelector('li.on [data-del]').disabled;
    row(ids.chiara).querySelector('[data-act]').click();
    for (let i = 0; i < 40 && document.getElementById('title').textContent !== 'Chiara'; i++) await new Promise((ok) => setTimeout(ok, 25));
    const asks = [];
    const prev = window.confirm;
    window.confirm = (m) => { asks.push(m); return false; };
    row(ids.greta).querySelector('[data-del]').click();
    window.confirm = prev;
    const still = sheet.querySelectorAll('li').length;
    const opened = !sheet.hidden;
    sheet.querySelector('.avatar-x').click();
    return {
      opened,
      names,
      activeBefore,
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
  }, { chiara: CHIARA, greta: GRETA });
  expect(r.names).toEqual(['Chiara', 'Nova', 'Greta']);
  expect(r.activeBefore).toBe('Nova');
  expect(r.delLocked).toBe(true);
  expect(r.title).toBe('Chiara');
  expect(r.current).toBe(CHIARA);
  expect(r.active).toBe(CHIARA);
  expect(r.photo).toBe('🌿');
  expect(r.asks).toEqual(['Cancellare definitivamente Greta?']);
  expect(r.still).toBe(3);
  expect(state.puts).toEqual([CHIARA]);
  expect(state.deleted).toEqual([]);
  expect(r.opened).toBe(true);
  expect(r.closed).toBe(true);
  expect(r.x).toBe('Chiudi');
});
