const { test, expect } = require('@playwright/test');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HEAD = { 'X-Requested-With': 'app-privata' };

function redJpeg() {
  const file = path.join(os.tmpdir(), 'nova-red-square.jpg');
  const made = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', file], { stdio: 'ignore' });
  if (made.status !== 0 || !fs.existsSync(file)) throw new Error('jpeg rosso non creato');
  const b64 = fs.readFileSync(file).toString('base64');
  fs.unlinkSync(file);
  return 'data:image/jpeg;base64,' + b64;
}

test('xAI descrive un riquadro rosso della fotocamera', async ({ request }) => {
  const key = String(process.env.XAI_API_KEY || process.env.AI_KEY || '').trim();
  test.skip(!key, 'XAI_API_KEY non è in questo ambiente: la descrizione reale non può partire da qui');
  const setup = await request.post('/api/pin/setup', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
  if (setup.status() === 409) {
    const login = await request.post('/api/login', { data: { user: 'nicola', pin: '1357' }, headers: HEAD });
    expect(login.ok(), await login.text()).toBeTruthy();
  } else expect(setup.ok(), await setup.text()).toBeTruthy();
  const chars = await (await request.get('/api/characters')).json();
  const nova = chars.find((c) => c && c.name === 'Nova') || chars[0];
  expect(nova && nova.id).toBeTruthy();
  const frame = redJpeg();
  const r = await request.post('/api/chats/' + nova.id + '/sight', {
    data: { image: frame },
    headers: { ...HEAD, 'X-AI-Key': key },
    timeout: 60000,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const note = String((await r.json()).note || '');
  expect(note.toLowerCase()).toMatch(/ross/);
  expect(note.length).toBeLessThan(400);
});
