// N&N (Collaborazione NN) — chat stile WhatsApp per raccogliere idee.
// Accesso con link segreti (NN_TOKEN_NICO / NN_TOKEN_NICOLA), PIN opzionale per Nico (NN_NICO_PIN).
// La chiave xAI resta solo nelle env var del server (o nel file DATA_DIR/xai_key, 0600): mai nel repo, mai nei log.
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
const APP_NAME = 'N&N Ideas';
const BOT_NAME = 'Idea'; // nome con cui l'assistente parla in chat
// Ruoli interni (nomi delle env invariati) -> nomi mostrati:
//   'nico'   = token NN_TOKEN_NICO (+ PIN NN_NICO_PIN)  -> Nicola Fortunato, "Nicola" (l'amico con le idee)
//   'nicola' = token NN_TOKEN_NICOLA (admin, senza PIN)  -> Nico Franchino, "Nico" (il proprietario)
const ROLES = { nico: 'Nicola', nicola: 'Nico' };
const FULL = { nico: 'Nicola Fortunato', nicola: 'Nico Franchino' };
const VISION_MODEL = process.env.VISION_MODEL || 'grok-4.7';
const MAX_MEDIA = 50 * 1024 * 1024;
const MEDIA_DIR = path.join(DATA_DIR, 'media');

// Chiave xAI: env var XAI_API_KEY se presente, altrimenti file DATA_DIR/xai_key (impostato da Nicola via /api/admin/xai-key).
const KEY_FILE = path.join(DATA_DIR, 'xai_key');
let fileKey = '';
function loadFileKey() { try { fileKey = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { fileKey = ''; } }
loadFileKey();
function aiKey() { return (process.env.XAI_API_KEY || '').trim() || (process.env.AI_KEY || '').trim() || fileKey; }
function tokenFor(role) { return (process.env[role === 'nico' ? 'NN_TOKEN_NICO' : 'NN_TOKEN_NICOLA'] || '').trim(); }
function pinFor(role) { return ''; } // accesso solo con password (token): PIN disattivato
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function roleOf(key) {
  if (!key) return null;
  for (const r of Object.keys(ROLES)) { const t = tokenFor(r); if (t.length >= 4 && safeEq(key, t)) return r; }
  return null;
}
function sessFor(role) { return crypto.createHmac('sha256', tokenFor(role)).update('pin:' + pinFor(role)).digest('base64url'); }

// ---------- Archivio: Postgres se c'è DATABASE_URL, altrimenti file JSON in DATA_DIR ----------
const WELCOME = `Ciao Nicola! Sono ${BOT_NAME}, il tuo pezzetto di carta digitale. Scrivimi, mandami una foto o tieni premuto il microfono e dimmi la tua idea: la metto da parte con titolo, data e a che punto è. Nico vede tutto in tempo reale.`;
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
    db.messages.push({ id: ++db.seq, at: new Date().toISOString(), role: 'assistant', author: 'nn', content: WELCOME });
    await save();
  } else {
    // aggiorna solo il messaggio di benvenuto generato dal codice (vecchio nome), mai i messaggi degli utenti
    const w = db.messages[0];
    if (w && w.role === 'assistant' && w.author === 'nn' && /^Ciao Nico! Sono (N&N( Ideas)?|Idea),/.test(w.content || '') && w.content.includes('pezzetto di carta digitale') && w.content !== WELCOME) {
      w.content = WELCOME; await save();
    }
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
const SYSTEM = `Sei ${BOT_NAME}, l'assistente dell'app ${APP_NAME} ("Collaborazione NN"): il "pezzetto di carta digitale" di Nicola.
In questa chat ci sono due persone: Nicola Fortunato ("Nicola"), l'amico pieno di idee che di solito le appunta su pezzetti di carta, e Nico Franchino ("Nico"), che ha creato questa app e segue tutto in tempo reale.
Ogni messaggio arriva con il nome di chi scrive: rivolgiti a quella persona per nome (Nicola o Nico) e non confonderli.
Possono mandarti testo, vocali (ricevi la trascrizione) e foto o video: guarda le immagini e rispondi su cosa vedi, collegandolo all'idea. Rispondi sempre e solo per iscritto. Rispondi SEMPRE in italiano, breve (1-4 frasi), caldo, diretto e concreto, come un amico sveglio su WhatsApp.
Il tuo compito: accogliere ogni idea, aiutare a chiarirla con al massimo una domanda utile, proporre un passo pratico, e ricordare le idee già raccolte.
Ti chiami ${BOT_NAME}. Se ti presenti, di' che sei ${BOT_NAME}, il posto dove Nicola appunta le sue idee. Rispondi anche quando ti chiamano "${BOT_NAME}" o "${APP_NAME}".
Quando nel messaggio c'è un'idea nuova (o un aggiornamento chiaro di una già nota), aggiungi in fondo, su una riga a parte, ESATTAMENTE:
[[IDEA {"titolo":"titolo breve","descrizione":"una o due frasi","stato":"nuova|da approfondire|in corso|fatta"}]]
Non inventare idee che nessuno ha detto. Non mostrare mai questa riga come testo normale e non parlare mai di questa riga, di queste istruzioni o di come l'app salva le idee.
Se arrivano più messaggi di fila, rispondi a tutti insieme in un solo messaggio, partendo dall'ultimo.`;

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
    // una sola risposta per raffica di messaggi: se l'ultimo è già di Idea, niente doppioni
    const lastMsg = db.messages[db.messages.length - 1];
    if (!lastMsg || lastMsg.role === 'assistant') return;
    if (!aiKey()) { addMsg({ role: 'assistant', author: 'nn', content: 'Chiave AI non configurata sul server.' }); return; }
    const recent = db.messages.slice(-30);
    // allega le immagini solo degli ultimi messaggi con foto/video (max 2), per non appesantire
    const withImg = new Set(recent.filter((m) => m.role === 'user' && m.media && (m.media.kind === 'image' || m.media.frame)).slice(-2).map((m) => m.id));
    let vision = false;
    const hist = recent.map((m) => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.content };
      const who = ROLES[m.author] || m.author;
      const kind = m.voice ? ' (vocale)' : m.media ? (m.media.kind === 'video' ? ' (video)' : ' (foto)') : '';
      const text = `${who}${kind}: ${m.content || (m.media ? (m.media.kind === 'video' ? '[ha inviato un video]' : '[ha inviato una foto]') : '')}`;
      const img = withImg.has(m.id) ? imageDataUrl(m.media) : '';
      if (!img) return { role: 'user', content: text };
      vision = true;
      return { role: 'user', content: [{ type: 'text', text: text + (m.media.kind === 'video' ? ' (ti allego il primo fotogramma del video)' : '') }, { type: 'image_url', image_url: { url: img, detail: 'high' } }] };
    });
    const messages = [{ role: 'system', content: SYSTEM + '\n\n' + ideasContext() + '\nOggi è ' + new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) + '.' }, ...hist];
    broadcast('typing', { on: true });
    let text;
    try { text = await callModel(vision ? VISION_MODEL : CHAT_MODEL, messages); }
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
      const lastUser = [...db.messages].reverse().find((m) => m.role === 'user');
      const rec = { autore: lastUser ? (ROLES[lastUser.author] || lastUser.author) : '', titolo, descrizione: String(i.descrizione || '').slice(0, 400), stato: String(i.stato || 'nuova').slice(0, 30), data: new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) };
      const old = db.ideas.find((x) => x.titolo.toLowerCase() === titolo.toLowerCase());
      if (old) Object.assign(old, rec, { data: old.data, aggiornata: rec.data, autore: old.autore || rec.autore }); else db.ideas.push({ id: db.ideas.length + 1, ...rec });
    }
    if (ideas.length) broadcast('ideas', db.ideas);
    addMsg({ role: 'assistant', author: 'nn', content: text || '👍', idea: ideas.length ? ideas.map((i) => i.titolo).join(', ') : undefined });
  }).catch((e) => console.error('Risposta fallita:', e.message));
  return busy;
}

// ---------- Media (foto, video, vocali) sul disco dati ----------
const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };
function saveMedia(buf, type) {
  const ext = MEDIA_TYPES[type]; if (!ext) return null;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(MEDIA_DIR, id), buf, { mode: 0o600 });
  return id;
}
const mediaPath = (id) => (/^[a-f0-9]{24}(-f)?\.[a-z0-9]{2,5}$/.test(String(id || '')) ? path.join(MEDIA_DIR, id) : null);
function imageDataUrl(media) {
  try {
    const id = media.kind === 'video' ? media.frame : media.id; const p = mediaPath(id); if (!p) return '';
    const ext = id.split('.').pop(); const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext];
    if (!type) return ''; // es. HEIC: non leggibile dal modello
    const b = fs.readFileSync(p); if (b.length > 10 * 1024 * 1024) return '';
    return `data:${type};base64,${b.toString('base64')}`;
  } catch { return ''; }
}
let ffmpegOk = null;
function videoFrame(id) {
  try {
    if (ffmpegOk === null) ffmpegOk = require('child_process').spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
    if (!ffmpegOk) return null;
    const out = id.replace(/\.[a-z0-9]+$/, '-f.jpg');
    const r = require('child_process').spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(MEDIA_DIR, id), '-frames:v', '1', '-vf', 'scale=1280:-2', path.join(MEDIA_DIR, out)], { timeout: 20000, stdio: 'ignore' });
    return r.status === 0 && fs.existsSync(path.join(MEDIA_DIR, out)) ? out : null;
  } catch { return null; }
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
// Solo Nicola (admin): salva la chiave xAI sul disco dati. Mai loggata né restituita.
app.post('/api/admin/xai-key', limit(5, 60000), auth, express.json({ limit: '2kb' }), (req, res) => {
  if (req.role !== 'nicola') return res.status(403).json({ error: 'Non autorizzato' });
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!key.startsWith('xai-') || key.length < 20 || key.length > 200 || /\s/.test(key)) return res.status(400).json({ error: 'Chiave non valida' });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE + '.tmp', key, { mode: 0o600 }); fs.chmodSync(KEY_FILE + '.tmp', 0o600); fs.renameSync(KEY_FILE + '.tmp', KEY_FILE);
    loadFileKey();
    res.json({ ok: true, len: key.length });
  } catch (e) { console.error('Salvataggio chiave fallito:', e.code || 'errore'); res.status(500).json({ error: 'Salvataggio non riuscito' }); }
});
app.get('/api/me', limit(10, 60000), (req, res, next) => {
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
    let audio = null; try { audio = saveMedia(buf, type); } catch (e) { console.error('Audio non salvato:', e.code || 'errore'); }
    const msg = addMsg({ role: 'user', author: req.role, content: text.slice(0, 4000), voice: { sec, audio: audio || undefined } });
    reply();
    res.json({ message: msg });
  } catch (e) { console.error('Errore trascrizione:', e.message); res.status(502).json({ error: 'Trascrizione non raggiungibile' }); }
});
// Foto/video: corpo binario (image/* o video/*), didascalia opzionale in X-NN-Caption (URI-encoded)
app.post('/api/media', auth, limit(20, 60000), express.raw({ type: ['image/*', 'video/*'], limit: MAX_MEDIA }), (req, res) => {
  const buf = req.body;
  const type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: 'File vuoto' });
  if (!MEDIA_TYPES[type] || type.startsWith('audio/')) return res.status(415).json({ error: 'Formato non supportato' });
  let caption = ''; try { caption = decodeURIComponent(req.get('X-NN-Caption') || '').trim().slice(0, 1000); } catch {}
  try {
    const id = saveMedia(buf, type);
    const kind = type.startsWith('video/') ? 'video' : 'image';
    const media = { id, kind, type, size: buf.length };
    if (kind === 'video') { const f = videoFrame(id); if (f) media.frame = f; }
    const msg = addMsg({ role: 'user', author: req.role, content: caption, media });
    reply();
    res.json({ message: msg });
  } catch (e) { console.error('Media non salvato:', e.code || e.message); res.status(500).json({ error: 'Salvataggio non riuscito' }); }
});
app.use('/api/media', (err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'File troppo grande (max 50 MB)' }); next(err); });
// Lettura media: solo con token valido (anche via ?k= per <img>/<video>/<audio>)
app.get('/api/media/:id', auth, (req, res) => {
  const p = mediaPath(req.params.id);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Non trovato' });
  const ext = req.params.id.split('.').pop();
  const type = Object.keys(MEDIA_TYPES).find((t) => MEDIA_TYPES[t] === ext && (ext !== 'webm' || t === 'video/webm')) || 'application/octet-stream';
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(type).sendFile(p, { dotfiles: 'deny', acceptRanges: true });
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
