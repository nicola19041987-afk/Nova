const { test, expect, request: playwrightRequest } = require('./harness');

const HEAD = { 'X-Requested-With': 'app-privata' };

async function session(request, user, pin) {
  let r = await request.post('/api/pin/setup', { data: { user, pin }, headers: HEAD });
  if (r.status() === 409) r = await request.post('/api/login', { data: { user, pin }, headers: HEAD });
  expect(r.ok(), await r.text()).toBeTruthy();
}

function settings(extra) {
  return {
    autoSave: false,
    allowExport: false,
    adultMode: false,
    noBrakes: false,
    videoModel: '',
    videoDuration: 6,
    ...extra,
  };
}

test('il filtro è per profilo, resta sul server e cambia chat e voce', async ({ request }) => {
  await session(request, 'nicola', '1357');
  const fresh = await playwrightRequest.newContext({ baseURL: 'http://127.0.0.1:8766' });
  const anon = await fresh.put('/api/settings', { data: settings({ contentFilter: false }), headers: HEAD });
  expect(anon.status()).toBe(401);
  await fresh.dispose();

  const reset = await request.put('/api/settings', { data: settings({ contentFilter: true }), headers: HEAD });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  expect((await reset.json()).contentFilter).toBe(true);
  const on = await (await request.get('/api/e2e/tone?sample=noflirt')).json();
  expect(on.contentFilter).toBe(true);
  expect(on.explicitTalk).toBe(false);
  expect(on.imageExplicit).toBe(false);
  for (const key of ['chat', 'realtime', 'call']) {
    expect(on[key]).toContain('Modalità adulti NON attiva: niente contenuti sessuali espliciti');
    expect(on[key]).not.toContain('FILTRO CONTENUTI ESPLICITI SPENTO');
    expect(on[key]).toContain('minori');
    expect(on[key].trim().endsWith('Rispondi sempre in italiano, salvo richiesta esplicita diversa.')).toBe(true);
  }

  const off = await request.put('/api/settings', { data: settings({ contentFilter: false }), headers: HEAD });
  expect(off.ok(), await off.text()).toBeTruthy();
  expect((await off.json()).contentFilter).toBe(false);
  const kept = await (await request.get('/api/settings')).json();
  expect(kept.contentFilter).toBe(false);
  const other = await request.put('/api/settings', { data: settings({ autoSave: true }), headers: HEAD });
  expect(other.ok(), await other.text()).toBeTruthy();
  expect((await other.json()).contentFilter).toBe(false);
  expect((await other.json()).autoSave).toBe(true);

  const talk = await (await request.get('/api/e2e/tone?sample=noflirt&user=nicola')).json();
  expect(talk.explicitTalk).toBe(true);
  expect(talk.imageExplicit).toBe(false);
  expect(talk.imageAdult).toBe(false);
  for (const key of ['chat', 'realtime', 'call']) {
    expect(talk[key], key).toContain('FILTRO CONTENUTI ESPLICITI SPENTO per Nico');
    expect(talk[key], key).toContain('linguaggio esplicito');
    expect(talk[key], key).toContain('Immagini, video e modifiche alle foto restano non espliciti');
    expect(talk[key], key).toContain('non riformulare per aggirare il rifiuto');
    expect(talk[key], key).toContain('minori');
    expect(talk[key], key).not.toContain('Modalità adulti NON attiva');
  }

  const hers = await (await request.get('/api/e2e/tone?sample=noflirt&user=luisa')).json();
  expect(hers.contentFilter).toBe(true);
  expect(hers.chat).toContain('Modalità adulti NON attiva: niente contenuti sessuali espliciti');
  expect(hers.realtime).not.toContain('FILTRO CONTENUTI ESPLICITI SPENTO');

  const back = await request.put('/api/settings', { data: settings({ contentFilter: true, autoSave: false }), headers: HEAD });
  expect(back.ok(), await back.text()).toBeTruthy();
  const quiet = await (await request.get('/api/e2e/tone?sample=noflirt')).json();
  expect(quiet.explicitTalk).toBe(false);
  expect(quiet.chat).toContain('Modalità adulti NON attiva: niente contenuti sessuali espliciti');
  expect(quiet.realtime).toContain('Modalità adulti NON attiva: niente contenuti sessuali espliciti');
});
