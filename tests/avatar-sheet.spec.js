const { test, expect } = require('@playwright/test');

const CHIARA = 'aaaaaaaaaaaaaaaa';
const NOVA = 'bbbbbbbbbbbbbbbb';
const GRETA = 'cccccccccccccccc';
const MARA = 'ffffffffffffffff';
const ESTATE = 'dddddddddddddddd';
const INVERNO = 'eeeeeeeeeeeeeeee';

const LUNA = '1111111111111111';
const CLIP = '2222222222222222';
const UOMO = '3333333333333333';

function seed() {
  const old = (extra) => ({ archived: true, ...extra });
  return [
    old({ id: CHIARA, name: 'Chiara', ready: 'chiara', createdBy: 'nicola', avatar: '🌿', messages: 80, nicolaMessages: 40 }),
    { id: NOVA, name: 'Nova', ready: 'nova-unico', createdBy: 'nicola', avatar: '🍷', personality: '', style: '', orders: '', requests: '', messages: 90, nicolaMessages: 40 },
    old({ id: GRETA, name: 'Greta', avatar: 'G', messages: 0, nicolaMessages: 0 }),
    old({ id: MARA, name: 'Mara', createdBy: 'luisa', avatar: 'M', messages: 5, nicolaMessages: 0 }),
    old({ id: ESTATE, name: 'Estate', createdBy: 'nicola', avatar: 'E', messages: 2, nicolaMessages: 1 }),
    old({ id: INVERNO, name: 'Inverno', createdBy: 'nicola', avatar: 'I', messages: 0, nicolaMessages: 0 }),
    old({ id: LUNA, name: 'Luna', avatar: 'L', messages: 40, nicolaMessages: 18 }),
    old({ id: CLIP, name: 'Clip', createdBy: 'luisa', avatar: 'C', messages: 8, nicolaMessages: 3, actions: { saluta: { kind: 'video', url: '/api/actions/file/clip.mp4', at: '2026-02-01', stale: false } } }),
    old({ id: UOMO, name: 'Marco', createdBy: 'nicola', avatar: 'M', messages: 100, nicolaMessages: 50, appearance: { gender: 'uomo' } }),
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

test('il foglio mostra solo Nova e si chiude con la X', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE di Playwright) chiude il processo da solo: sulla home, con il motore dell’avatar, e anche dopo un click qualunque. Il foglio, aperto senza click e senza quell’engine, resta su. Non è il foglio né le miniature. Su Chromium a 390×844 il flusso è verificato.');
  const state = { chars: seed(), active: '', deleted: [], puts: [] };
  await mockApp(page, state);
  await page.goto('/');
  await page.waitForFunction(() => document.body.classList.contains('solo-mode') && document.getElementById('title').textContent === 'Nova');
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const r = await page.evaluate(async (nova) => {
    document.getElementById('wa-photo').click();
    const sheet = document.getElementById('avatar-sheet');
    const names = [...sheet.querySelectorAll('li b')].map((b) => b.textContent);
    const row = sheet.querySelector(`li[data-id="${nova}"]`);
    const delLocked = !!(row && row.querySelector('[data-del]').disabled);
    const opened = !sheet.hidden;
    sheet.querySelector('.avatar-x').click();
    return {
      opened,
      names,
      on: row && row.classList.contains('on'),
      delLocked,
      title: document.getElementById('title').textContent,
      current: App.current && App.current.id,
      closed: sheet.hidden,
      x: sheet.querySelector('.avatar-x').getAttribute('aria-label'),
    };
  }, NOVA);
  expect(r.names).toEqual(['Nova']);
  expect(r.on).toBe(true);
  expect(r.delLocked).toBe(true);
  expect(r.title).toBe('Nova');
  expect(r.current).toBe(NOVA);
  expect(state.deleted).toEqual([]);
  expect(r.opened).toBe(true);
  expect(r.closed).toBe(true);
  expect(r.x).toBe('Chiudi');
});

test('un avatar archiviato non va sul palco e un foglio chiude l’altro', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Questo WebKit (WPE) chiude il processo dopo l’avvio della home. Il flusso è verificato su Chromium a 390×844.');
  const state = { chars: seed(), active: '', deleted: [], puts: [] };
  await mockApp(page, state);
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Nova');
  const r = await page.evaluate(async () => {
    App.solo.openPicker();
    const names = [...document.querySelectorAll('#avatar-sheet li b')].map((b) => b.textContent);
    const video = document.getElementById('stage-video');
    App.solo.openLook();
    App.supportNote.open();
    const look = document.getElementById('solo-look-dialog');
    const sup = document.getElementById('support-dialog');
    const chiudi = sup && sup.querySelector('button[value="cancel"]');
    return {
      names,
      src: video && video.getAttribute('src'),
      shown: !!(video && !video.hidden),
      look: !!(look && look.open),
      support: !!(sup && sup.open),
      disabled: !!(chiudi && chiudi.disabled),
    };
  });
  expect(r.names).toEqual(['Nova']);
  expect(r.src || '').toBe('');
  expect(r.shown).toBe(false);
  expect(r.look).toBe(false);
  expect(r.support).toBe(true);
  expect(r.disabled).toBe(false);
});
