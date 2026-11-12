// Test locale di /api/admin/xai-key: 401/403/400/200, permessi 0600, chiave usata da chat e /stt, mai nei log.
// Uso: node scripts/test-xai-key.js   (non usa chiavi vere: finto server xAI locale)
'use strict';
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawn } = require('child_process'); const assert = require('assert');
const KEY = 'xai-TEST' + 'x'.repeat(40); const NICO = 'nico-test-token'; const NICOLA = 'nicola-test-token';
const seen = [];
const mock = http.createServer((req, res) => {
  seen.push({ path: req.url, auth: req.headers.authorization || '' });
  req.resume(); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/stt')) return res.end(JSON.stringify({ text: 'prova vocale' }));
    res.end(JSON.stringify({ choices: [{ message: { content: 'Ciao dal finto Grok' } }] }));
  });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => mock.listen(0, r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, NN_TOKEN_NICO: NICO, NN_TOKEN_NICOLA: NICOLA,
    AI_BASE_URL: `http://127.0.0.1:${mock.address().port}`, XAI_API_KEY: '', AI_KEY: '', DATABASE_URL: '' };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env });
  let logs = ''; srv.stdout.on('data', (d) => (logs += d)); srv.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50 && !logs.includes('ascolto'); i++) await wait(100);
  const post = (k, body) => fetch(`${base}/api/admin/xai-key`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(k ? { 'X-NN-Key': k } : {}) }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await post('', { key: KEY })).status, 401, 'senza token -> 401');
    assert.strictEqual((await post(NICO, { key: KEY })).status, 403, 'token Nico -> 403');
    assert.strictEqual((await post(NICOLA, { key: 'abc' })).status, 400, 'chiave non valida -> 400');
    const r = await post(NICOLA, { key: KEY }); const j = await r.json();
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(j, { ok: true, len: KEY.length }, 'risposta senza chiave');
    const st = fs.statSync(path.join(dir, 'xai_key'));
    assert.strictEqual(st.mode & 0o777, 0o600, 'permessi 0600');
    // chat
    await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NN-Key': NICO }, body: JSON.stringify({ text: 'Ciao' }) });
    for (let i = 0; i < 30 && !seen.some((s) => s.path.endsWith('/chat/completions')); i++) await wait(100);
    const chat = seen.find((s) => s.path.endsWith('/chat/completions'));
    assert.ok(chat && chat.auth === `Bearer ${KEY}`, 'chat usa la chiave salvata');
    // voce
    const wav = Buffer.alloc(1000);
    const v = await fetch(`${base}/api/voice`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-NN-Key': NICO }, body: wav });
    assert.strictEqual(v.status, 200, 'voce ok');
    const stt = seen.find((s) => s.path.endsWith('/stt'));
    assert.ok(stt && stt.auth === `Bearer ${KEY}`, 'STT usa la chiave salvata');
    await wait(300);
    assert.ok(!logs.includes(KEY), 'la chiave non compare nei log');
    console.log('OK: 401/403/400/200, file 0600, chiave usata da chat e /stt, nessuna chiave nei log');
  } catch (e) { console.error('FALLITO:', e.message); process.exitCode = 1; }
  finally { srv.kill(); mock.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})();
