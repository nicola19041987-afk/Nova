const { test, expect } = require('./harness');
const http = require('http');

// v2d-30: Blocco note 📝 (solo «segna/segnala/segnalo/segnalalo») e richieste di modifica dell'app al webhook «Appunti».
const HEAD = { 'X-Requested-With': 'app-privata' };
async function session(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test('note solo su richiesta esplicita, mai al webhook; modifiche dell’app al webhook', async ({ request, browserName }) => {
  test.skip(browserName === 'webkit', 'stesso server del test Chromium');
  test.skip(!!(process.env.NOTES_WEBHOOK_URL || process.env.NOTES_WEBHOOK_KEY || process.env.NOTES_WEBHOOK_AUTH), 'webhook reale nell’ambiente: il test non deve usarlo');
  const hits = [];
  const srv = http.createServer((q, r) => { const b = []; q.on('data', (d) => b.push(d)); q.on('end', () => { hits.push({ auth: q.headers.authorization, body: JSON.parse(Buffer.concat(b).toString() || '{}') }); r.end('{}'); }); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    await session(request, 'nicola', '1111');
    const set = await request.post('/api/admin/appunti-webhook', { data: { url: `http://127.0.0.1:${srv.address().port}/hook`, key: 'prova-chiave-e2e' }, headers: HEAD });
    const txt = await set.text();
    expect(set.ok(), txt).toBeTruthy();
    expect(txt).not.toContain('prova-chiave-e2e');
    expect(txt).not.toContain('/hook');
    const chars = await (await request.get('/api/characters')).json();
    const id = chars.find((c) => !c.archived).id;
    const turn = async (text) => (await request.post(`/api/chats/${id}/voice-turn`, { data: { role: 'user', text, callMode: 'video' }, headers: HEAD })).json();
    expect((await turn('Ho pensato a un orto sul balcone')).intent).toBeUndefined();
    expect((await turn('segnalalo')).intent).toBe('nota');
    expect((await turn('sistema i capelli')).intent).toBeUndefined();
    expect((await turn('cambiati la maglia')).intent).toBeUndefined();
    expect((await turn('sistema il tasto del microfono')).intent).toBe('richiesta');
    await expect.poll(() => hits.length).toBe(1);
    expect(hits[0].auth).toBe('Bearer prova-chiave-e2e');
    expect(hits[0].body).toMatchObject({ app: 'Nova', from: 'Nicola', text: 'sistema il tasto del microfono', channel: 'voce' });
    const notes = await (await request.get('/api/blocco-note')).json();
    expect(notes.count).toBe(1);
    expect(notes.notes[0].text).toBe('Ho pensato a un orto sul balcone');
    await session(request, 'luisa', '2222');
    expect((await request.post('/api/admin/appunti-webhook', { data: { url: 'https://esempio.it/x' }, headers: HEAD })).status()).toBe(403);
  } finally { srv.close(); }
});
