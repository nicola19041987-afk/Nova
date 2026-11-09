const { test, expect } = require('./harness');
const fs = require('fs');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };
const CHARS = '/tmp/nova-e2e-empty/shared/characters.json';

function boundaries(text) {
  const toneAt = text.indexOf('un po\' maliziosa e complice');
  const baseAt = text.lastIndexOf('REGOLE DI BASE NON MODIFICABILI');
  return {
    playful: toneAt >= 0,
    serious: text.includes('Se il momento è serio, triste, pratico o un problema, niente malizia'),
    noExplicit: text.includes('non descrive atti sessuali, nudità o un ruolo erotico'),
    noInvent: text.includes('Non inventare ciò che vedi in una foto'),
    noCanned: text.includes('non ripetere disclaimer'),
    noForce: text.includes('non forzare il flirt'),
    adultOff: text.includes('Modalità adulti NON attiva: niente contenuti sessuali espliciti'),
    noBrakes: text.includes('SENZA FRENI'),
    minors: text.includes('minori'),
    consent: text.includes('non consensuali'),
    baseLast: baseAt > toneAt && text.trim().endsWith('Rispondi sempre in italiano, salvo richiesta esplicita diversa.'),
    noBypass: !/ignora le regole precedenti|senza limiti|bypassa/i.test(text),
  };
}

test('il tono di Nova è lo stesso in chat, dettato e voce, senza toccare i dati salvati', async ({ request }) => {
  const pin = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (pin.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(pin.ok(), await pin.text()).toBeTruthy();
  const chars = await (await request.get('/api/characters')).json();
  const nova = chars.find((c) => c && /nova/i.test(c.name || ''));
  expect(nova && nova.id).toBeTruthy();
  const before = fs.readFileSync(CHARS);
  const diskBefore = JSON.parse(before.toString('utf8')).find((c) => c.id === nova.id);

  const tone = await (await request.get('/api/e2e/tone?id=' + nova.id)).json();
  expect(tone.applies).toBe(true);
  expect(tone.model).toBe('grok-4.20-0309-non-reasoning');
  expect(tone.stored.personality).toBe(diskBefore.personality || '');
  expect(tone.stored.style).toBe(diskBefore.style || '');
  expect(tone.stored.requests).toBe(diskBefore.requests || '');
  for (const key of ['chat', 'realtime', 'call']) {
    const b = boundaries(tone[key]);
    expect(b.playful, key).toBe(true);
    expect(b.serious, key).toBe(true);
    expect(b.noExplicit, key).toBe(true);
    expect(b.noInvent, key).toBe(true);
    expect(b.noCanned, key).toBe(true);
    expect(b.noForce, key).toBe(true);
    expect(b.adultOff, key).toBe(true);
    expect(b.noBrakes, key).toBe(false);
    expect(b.minors, key).toBe(true);
    expect(b.consent, key).toBe(true);
    expect(b.baseLast, key).toBe(true);
    expect(b.noBypass, key).toBe(true);
  }
  expect(fs.readFileSync(CHARS).equals(before)).toBe(true);

  const other = await (await request.get('/api/e2e/tone?sample=other')).json();
  expect(other.applies).toBe(false);
  expect(other.chat.includes('un po\' maliziosa e complice')).toBe(false);
  expect(other.stored.personality).toBe('resta formale');

  const noflirt = await (await request.get('/api/e2e/tone?sample=noflirt')).json();
  expect(noflirt.conflict.flirtOff).toBe(true);
  expect(noflirt.conflict.explicitAsk).toBe(false);
  expect(noflirt.chat).toContain('Sii solo formale e non flirtare.');
  expect(noflirt.chat).toContain('REGISTRO SALVATO');
  expect(noflirt.realtime).toContain('REGISTRO SALVATO');

  const explicit = await (await request.get('/api/e2e/tone?sample=explicit')).json();
  expect(explicit.conflict.explicitAsk).toBe(true);
  expect(explicit.stored.requests).toBe('Voglio un ruolo erotico esplicito.');
  expect(explicit.chat).toContain('Voglio un ruolo erotico esplicito.');
  expect(explicit.chat).toContain('RICHIESTA ESPLICITA SALVATA');
  expect(explicit.chat).toContain('non descrive atti sessuali');
  expect(explicit.call).toContain('RICHIESTA ESPLICITA SALVATA');
  expect(fs.readFileSync(CHARS).equals(before)).toBe(true);
  const chatsDir = path.join('/tmp/nova-e2e-empty/shared/chats');
  if (fs.existsSync(chatsDir)) {
    for (const name of fs.readdirSync(chatsDir)) {
      expect(fs.readFileSync(path.join(chatsDir, name), 'utf8').includes('un po\' maliziosa')).toBe(false);
    }
  }
});
