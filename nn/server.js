// N&N (Collaborazione NN) — chat stile WhatsApp per raccogliere idee.
// Accesso con link segreti (NN_TOKEN_NICO / NN_TOKEN_NICOLA), PIN opzionale per Nico (NN_NICO_PIN).
// La chiave xAI resta solo nelle env var del server: mai nel repo, mai nei log.
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'grok-4.20-0309-non-reasoning';
const CHAT_FALLBACK = process.env.CHAT_FALLBACK || 'grok-4.7';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_NAME = 'N&N';
const ROLES = { nico: 'Nico', nicola: 'Nicola' };

function aiKey() { return (process.env.XAI_API_KEY || process.env.AI_KEY || '').trim(); }
function tokenFor(role) { return (process.env[role === 'nico' ? 'NN_TOKEN_NICO' : 'NN_TOKEN_NICOLA'] || '').trim(); }
function pinFor(role) { return role === 'nico' ? (process.env.NN_NICO_PIN || '').trim() : ''; }
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function roleOf(key) {
  if (!key) return null;
  for (const r of Object.keys(ROLES)) { const t = tokenFor(r); if (t.length >= 16 && safeEq(key, t)) return r; }
  return null;
}
function sessFor(role) { return crypto.createHmac('sha256', tokenFor(role)).update('pin:' + pinFor(role)).digest('base64url'); }

// ---------- Archivio: Postgres se c'è DATABASE_URL, altrimenti file JSON in DATA_DIR ----------
let db = { messages: [], ideas: [], seq: 0 };
let pg = null;
async function load() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    await pg.query('CREATE TABLE IF NOT EXISTS nn_store (id int PRIMARY KEY, data jsonb NOT NULL)');
    const r = await pg.query('SELECT data FROM nn_store WHERE id = 1');
    if (r.rows[0]) db = r.rows[0].data;
    console.log('Archivio: Postgres');
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const f = path.join(DATA_DIR, 'nn.json');
    if (fs.existsSync(f)) db = JSON.parse(fs.readFileSync(f, 'utf8'));
    console.log('Archivio: file JSON');
  }
  db.messages = db.messages || []; db.ideas = db.ideas || []; db.seq = db.seq || 0;
  if (!db.messages.length) {
    db.messages.push({ id: ++db.seq, at: new Date().toISOString(), role: 'assistant', author: 'nn',
      content: `Ciao Nico! Sono ${APP_NAME}, il tuo pezzetto di carta digitale. Scrivimi o tieni premuto il microfono e dimmi la tua idea: la metto da parte con titolo, data e a che punto è. Nicola vede tutto in tempo reale.` });
    await save();
  }
}
let saving = Promise.resolve();
function save() {
  const snap = JSON.stringify(db);
  saving = saving.then(async () => {
    if (pg) await pg.query('INSERT INTO nn_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [snap]);
    else { const f = path.join(DATA_DIR, 'nn.json'); fs.writeFileSync(f + '.tmp', snap); fs.renameSync(f + '.tmp', f); }
  }).catch((e) => console.error('Salvataggio fallito:', e.message));
  return saving;
}

// ---------- Tempo reale (SSE) ----------
const clients = new Set();
function broadcast(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(line); } catch {} }
}
function addMsg(m) {
  const msg = { id: ++db.seq, at: new Date().toISOString(), ...m };
  db.messages.push(msg); save(); broadcast('message', msg); return msg;
}

// ---------- AI ----------
const SYSTEM = `Sei ${APP_NAME}, l'assistente di "Collaborazione NN": il "pezzetto di carta digitale" di Nico, un amico di Nicola pieno di idee.
Nicola e Nico usano questa chat insieme. Rispondi SEMPRE in italiano, breve (1-4 frasi), caldo, diretto e concreto, come un amico sveglio su WhatsApp.
Il tuo compito: accogliere ogni idea, aiutare a chiarirla con al massimo una domanda utile, proporre un passo pratico, e ricordare le idee già raccolte.
Se ti presenti, di' che sei ${APP_NAME}, il posto dove Nico appunta le sue idee.
Quando nel messaggio c'è un'idea nuova (o un aggiornamento chiaro di una già nota), aggiungi in fondo, su una riga a parte, ESATTAMENTE:
[[IDEA {"titolo":"titolo breve","descrizione":"una o due frasi","stato":"nuova|da approfondire|in corso|fatta"}]]
Non inventare idee che nessuno ha detto. Non mostrare mai questa riga come testo normale.`;

function ideasContext() {
  if (!db.ideas.length) return 'Nessuna idea salvata finora.';
  return 'Idee già salvate:\n' + db.ideas.slice(-40).map((i) => `- ${i.titolo} (${i.stato}, ${i.data}): ${i.descrizione}`).join('\n');
}
async function callModel(model, messages) {
  const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${aiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 600 }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('HTTP ' + r.status); e.status = r.status; e.detail = t.slice(0, 200); throw e; }
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content || '').trim();
}
let busy = Promise.resolve();
function reply() {
  busy = busy.then(async () => {
    if (!aiKey()) { addMsg({ role: 'assistant', author: 'nn', content: 'Chiave AI non configurata sul server.' }); return; }
    const hist = db.messages.slice(-30).map((m) => m.role === 'assistant'
      ? { role: 'assistant', content: m.content }
      : { role: 'user', content: `${ROLES[m.author] || m.author}${m.voice ? ' (vocale)' : ''}: ${m.content}` });
    const messages = [{ role: 'system', content: SYSTEM + '\n\n' + ideasContext() + '\nOggi è ' + new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) + '.' }, ...hist];
    broadcast('typing', { on: true });
    let text;
    try { text = await callModel(CHAT_MODEL, messages); }
    catch (e) {
      console.error('Errore AI:', e.message, e.detail || '');
      try { text = await callModel(CHAT_FALLBACK, messages); }
      catch (e2) { console.error('Errore AI (riserva):', e2.message); text = 'Scusa, ora non riesco a rispondere. Il messaggio è salvato, riprova tra poco.'; }
    }
    broadcast('typing', { on: false });
    const ideas = [];
    text = text.replace(/\[\[IDEA\s*(\{[\s\S]*?\})\s*\]\]/g, (_, js) => { try { ideas.push(JSON.parse(js)); } catch {} return ''; }).trim();
    for (const i of ideas) {
      const titolo = String(i.titolo || '').slice(0, 80).trim(); if (!titolo) continue;
      const rec = { titolo, descrizione: String(i.descrizione || '').slice(0, 400), stato: String(i.stato || 'nuova').slice(0, 30), data: new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) };
      const old = db.ideas.find((x) => x.titolo.toLowerCase() === titolo.toLowerCase());
      if (old) Object.assign(old, rec, { data: old.data, aggiornata: rec.data }); else db.ideas.push({ id: db.ideas.length + 1, ...rec });
    }
    if (ideas.length) broadcast('ideas', db.ideas);
    addMsg({ role: 'assistant', author: 'nn', content: text || '👍', idea: ideas.length ? ideas.map((i) => i.titolo).join(', ') : undefined });
  }).catch((e) => console.error('Risposta fallita:', e.message));
  return busy;
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));

// limite semplice per evitare abusi
const hits = new Map();
function limit(n, ms) {
  return (req, res, next) => {
    const k = (req.role || req.ip) + req.path; const now = Date.now();
    const h = (hits.get(k) || []).filter((t) => now - t < ms); h.push(now); hits.set(k, h);
    if (h.length > n) return res.status(429).json({ error: 'Troppi messaggi, aspetta un attimo.' });
    next();
  };
}
function auth(req, res, next) {
  const key = req.get('X-NN-Key') || req.query.k || '';
  const role = roleOf(key);
  if (!role) return res.status(401).json({ error: 'Link non valido' });
  if (pinFor(role)) {
    const s = req.get('X-NN-Sess') || req.query.s || '';
    if (!safeEq(s, sessFor(role))) return res.status(401).json({ error: 'PIN richiesto', pin: true, role });
  }
  req.role = role; next();
}
app.post('/api/unlock', express.json({ limit: '2kb' }), limit(8, 60000), (req, res) => {
  const role = roleOf(req.get('X-NN-Key') || '');
  if (!role) return res.status(401).json({ error: 'Link non valido' });
  const pin = pinFor(role);
  if (!pin) return res.json({ ok: true, sess: '' });
  if (!safeEq(String(req.body?.pin || ''), pin)) return res.status(403).json({ error: 'PIN errato' });
  res.json({ ok: true, sess: sessFor(role) });
});
app.get('/api/me', (req, res, next) => {
  const role = roleOf(req.get('X-NN-Key') || '');
  if (role && pinFor(role) && !safeEq(req.get('X-NN-Sess') || '', sessFor(role))) return res.json({ role, name: ROLES[role], pin: true, app: APP_NAME });
  next();
}, auth, (req, res) => res.json({ role: req.role, name: ROLES[req.role], pin: false, app: APP_NAME }));
app.get('/api/messages', auth, (req, res) => {
  const since = Number(req.query.since) || 0;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ messages: db.messages.filter((m) => m.id > since).slice(-500), ideas: db.ideas });
});
app.get('/api/ideas', auth, (req, res) => res.json({ ideas: db.ideas }));
app.post('/api/messages', auth, limit(20, 60000), express.json({ limit: '20kb' }), (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Messaggio vuoto' });
  const msg = addMsg({ role: 'user', author: req.role, content: text });
  reply();
  res.json({ message: msg });
});
// Messaggio vocale: audio WAV (o altro formato audio) -> xAI Speech to Text -> messaggio
app.post('/api/voice', auth, limit(12, 60000), express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 200) return res.status(400).json({ error: 'Audio vuoto' });
  if (!aiKey()) return res.status(503).json({ error: 'Chiave AI non configurata' });
  try {
    const type = (req.get('Content-Type') || 'audio/wav').split(';')[0];
    const ext = type.includes('wav') ? 'wav' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.includes('ogg') ? 'ogg' : 'webm';
    const fd = new FormData(); fd.append('language', 'it'); fd.append('file', new Blob([buf], { type }), 'nota.' + ext);
    const r = await fetch(`${AI_BASE_URL}/stt`, { method: 'POST', headers: { Authorization: `Bearer ${aiKey()}` }, body: fd, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('Errore trascrizione: HTTP', r.status, t.slice(0, 200)); return res.status(502).json({ error: 'Trascrizione non riuscita' }); }
    const j = await r.json().catch(() => ({}));
    const text = String(j.text || '').trim();
    if (!text) return res.status(422).json({ error: 'Non ho capito, riprova.' });
    const sec = Math.max(1, Math.round(Number(req.get('X-NN-Sec')) || 0));
    const msg = addMsg({ role: 'user', author: req.role, content: text.slice(0, 4000), voice: { sec } });
    reply();
    res.json({ message: msg });
  } catch (e) { console.error('Errore trascrizione:', e.message); res.status(502).json({ error: 'Trascrizione non raggiungibile' }); }
});
app.get('/api/stream', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ last: db.seq })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

load().then(() => app.listen(PORT, () => console.log(`${APP_NAME} in ascolto sulla porta ${PORT}`)))
  .catch((e) => { console.error('Avvio fallito:', e.message); process.exit(1); });
