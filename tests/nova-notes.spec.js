const { test, expect } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function login(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test('carattere, vestiti e richieste si salvano, si ricaricano e non scavalcano le regole', async ({ request }) => {
  await login(request, 'nicola', '1357');
  const chars = await (await request.get('/api/characters')).json();
  const nova = chars.find((c) => c && /nova/i.test(c.name || ''));
  expect(nova && nova.id).toBeTruthy();
  const id = nova.id;

  const notes = await request.post('/api/nova-notes', {
    data: { characterId: id, carattere: 'Parla in modo secco e preciso.', richieste: 'Chiamami solo se serve.' },
    headers: HEAD,
  });
  expect(notes.ok(), await notes.text()).toBeTruthy();
  const saved = await notes.json();
  expect(saved.carattere.current.text).toBe('Parla in modo secco e preciso.');
  expect(saved.richieste.entries.length).toBeGreaterThanOrEqual(1);

  const again = await request.post('/api/nova-notes', {
    data: { characterId: id, carattere: 'Tono più morbido.', richieste: 'Fammi domande brevi.' },
    headers: HEAD,
  });
  const body = await again.json();
  expect(body.carattere.entries.length).toBeGreaterThanOrEqual(2);
  const back = await request.post('/api/nova-notes/restore', {
    data: { characterId: id, kind: 'carattere', id: saved.carattere.current.id },
    headers: HEAD,
  });
  expect(back.ok(), await back.text()).toBeTruthy();
  const restored = await back.json();
  expect(restored.carattere.current.text).toBe('Parla in modo secco e preciso.');

  const look = await request.post('/api/avatar-looks', {
    data: { characterId: id, text: 'canotta nera a coste e jeans blu, corporatura media' },
    headers: HEAD,
  });
  expect(look.ok(), await look.text()).toBeTruthy();
  const loaded = await (await request.get('/api/nova-notes?character=' + id)).json();
  expect(loaded.carattere.current.text).toBe('Parla in modo secco e preciso.');
  expect(loaded.richieste.current.text).toBe('Fammi domande brevi.');

  const tone = await (await request.get('/api/e2e/tone?id=' + id)).json();
  expect(tone.chat).toContain('Parla in modo secco e preciso.');
  expect(tone.chat).toContain('Fammi domande brevi.');
  expect(tone.chat).toContain('canotta nera a coste');
  expect(tone.chat).toContain('non annulla le regole di base');
  expect(tone.chat).toContain('non aggirano un rifiuto');
  const baseAt = tone.chat.lastIndexOf('REGOLE DI BASE NON MODIFICABILI');
  const noteAt = tone.chat.indexOf('Parla in modo secco e preciso.');
  expect(baseAt).toBeGreaterThan(noteAt);
  expect(tone.chat.trim().endsWith('Rispondi sempre in italiano, salvo richiesta esplicita diversa.')).toBe(true);

  await login(request, 'luisa', '2468');
  const other = await (await request.get('/api/nova-notes?character=' + id)).json();
  expect(other.carattere.current).toBeFalsy();
});
