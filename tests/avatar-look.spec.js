const { test, expect } = require('./harness');
const look = require('../public/js/look-parse');

const HEAD = { 'X-Requested-With': 'app-privata' };
const CID = 'a11ce00000000001';

test('il parser rifiuta il suggerito e accetta genere, corpo e abiti ripetuti', () => {
  const nude = look.parse('lingerie nera', look.DEFAULT);
  expect(nude.ok).toBe(false);
  expect(nude.refused).toBe(true);
  const same = look.parse('canotta nera e jeans blu', look.DEFAULT);
  expect(same.ok).toBe(true);
  expect(same.look.top).toEqual([22, 22, 24]);
  expect(same.look.bottom).toEqual([36, 74, 140]);
  const red = look.parse('maglione rosso', same.look);
  expect(red.look.top).toEqual([156, 48, 48]);
  expect(red.look.bottom).toEqual([36, 74, 140]);
  const man = look.parse('uomo', look.DEFAULT);
  expect(man.look.gender).toBe('uomo');
  expect(man.look.shoulders).toBeGreaterThan(1);
  const other = look.parse('altro', look.DEFAULT);
  expect(other.look.gender).toBe('altro');
  let h = look.DEFAULT.height;
  let cur = look.DEFAULT;
  for (let i = 0; i < 8; i++) {
    cur = look.parse('più alta', cur).look;
    expect(cur.height).toBeGreaterThanOrEqual(h);
    h = cur.height;
  }
  expect(cur.height).toBeLessThanOrEqual(1.06);
  expect(cur.height).toBeGreaterThan(1);
});

test('v2d-41: niente storico (memoria visiva): resta solo il testo attuale e un rifiuto non lo cancella', async ({ request }) => {
  let r = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
  const a = await request.post('/api/avatar-looks', { data: { characterId: CID, text: 'canotta nera e jeans blu' }, headers: HEAD });
  expect(a.ok(), await a.text()).toBeTruthy();
  const b = await request.post('/api/avatar-looks', { data: { characterId: CID, text: 'maglione verde' }, headers: HEAD });
  expect(b.ok()).toBeTruthy();
  const body = await b.json();
  expect(body.entries.length).toBe(0);
  expect(body.entry.look.top).toEqual([46, 110, 72]);
  expect(body.entry.look.bottom).toEqual([36, 74, 140]);
  const no = await request.post('/api/avatar-looks', { data: { characterId: CID, text: 'lingerie nera' }, headers: HEAD });
  expect(no.status()).toBe(422);
  const kept = await (await request.get('/api/avatar-looks?character=' + CID)).json();
  expect(kept.entries.length).toBe(0);
  expect(kept.current.look.top).toEqual([46, 110, 72]);
});
