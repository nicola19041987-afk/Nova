// Ventuno (ex «Luisa e Nico») — chat stile WhatsApp per raccogliere idee (clone di N&N Ideas, stesso codice, dati separati).
// Accesso con link segreti (NN_TOKEN_NICO / NN_TOKEN_NICOLA), PIN opzionale per Nico (NN_NICO_PIN).
// La chiave xAI resta solo nelle env var del server (o nel file DATA_DIR/xai_key, 0600): mai nel repo, mai nei log.
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const extract = require('./extract');
const { createNotify } = require('./notify');

const PORT = Number(process.env.PORT) || 3000;
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'grok-4.20-0309-non-reasoning';
const CHAT_FALLBACK = process.env.CHAT_FALLBACK || 'grok-4.7';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_NAME = 'Ventuno';
const BOT_NAME = 'Idea'; // nome con cui l'assistente parla in chat
// Ruoli interni (nomi delle env invariati) -> nomi mostrati:
//   'nico'   = token NN_TOKEN_NICO (password)            -> Luisa
//   'nicola' = token NN_TOKEN_NICOLA (admin, senza PIN)  -> Nico Franchino, "Nico" (il proprietario)
const ROLES = { nico: 'Luisa', nicola: 'Nico' };
const FULL = { nico: 'Luisa', nicola: 'Nico Franchino' };
const VISION_MODEL = process.env.VISION_MODEL || 'grok-4.7';
const MAX_MEDIA = 50 * 1024 * 1024;
const MEDIA_DIR = path.join(DATA_DIR, 'media');

// Chiave xAI: env var XAI_API_KEY se presente, altrimenti file DATA_DIR/xai_key (impostato da Nicola via /api/admin/xai-key).
const KEY_FILE = path.join(DATA_DIR, 'xai_key');
let fileKey = '';
function loadFileKey() { try { fileKey = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { fileKey = ''; } }
loadFileKey();
function aiKey() { return (process.env.XAI_API_KEY || '').trim() || (process.env.AI_KEY || '').trim() || fileKey; }
function tokenFor(role) {
  if (role === 'nico') return (process.env.NN_TOKEN_NICO || '').trim();
  if (role === 'nicola') return (process.env.NN_TOKEN_NICOLA || '').trim();
  return '';
}
function pinFor(role) { return ''; } // accesso solo con password (token): PIN disattivato
function safeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function roleOf(key) {
  if (!key) return null;
  for (const r of ['nico', 'nicola']) { const t = tokenFor(r); if (t.length >= 4 && safeEq(key, t)) return r; }
  if (extraUsers.length && /^\d{4}$/.test(key)) {
    const h = hashPass(key);
    for (const u of extraUsers) { if (u.hash && u.hash.length === h.length && safeEq(h, u.hash)) return 'u_' + u.id; }
  }
  return null;
}
function sessFor(role) { return crypto.createHmac('sha256', tokenFor(role) || 'x').update('pin:' + pinFor(role)).digest('base64url'); }

// ---------- Utenti extra (fino a 3), password in hash, mai in chiaro su disco ----------
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USERS_SECRET_FILE = path.join(DATA_DIR, 'users.secret');
const MAX_EXTRA_USERS = 3;
let extraUsers = []; // { id, name, hash, createdAt }
function usersSecret() {
  try { return fs.readFileSync(USERS_SECRET_FILE, 'utf8').trim(); } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
function hashPass(pass) { return crypto.createHmac('sha256', usersSecret()).update(String(pass)).digest('hex'); }
function refreshUserRoles() {
  for (const k of Object.keys(ROLES)) if (k.startsWith('u_')) { delete ROLES[k]; delete FULL[k]; }
  for (const u of extraUsers) { const r = 'u_' + u.id; ROLES[r] = u.name; FULL[r] = u.name; }
}
function loadUsers() {
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    extraUsers = Array.isArray(j.users) ? j.users : [];
  } catch { extraUsers = []; }
  refreshUserRoles();
}
function saveUsers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ users: extraUsers }), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, USERS_FILE);
  refreshUserRoles();
}
function passTaken(pass) {
  for (const r of ['nico', 'nicola']) { const t = tokenFor(r); if (t && t.length === pass.length && safeEq(pass, t)) return true; }
  const h = hashPass(pass);
  return extraUsers.some((u) => u.hash && u.hash.length === h.length && safeEq(h, u.hash));
}
function genPass() {
  for (let i = 0; i < 80; i++) {
    const p = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!passTaken(p)) return p;
  }
  const e = new Error('Impossibile generare una password libera'); e.status = 500; throw e;
}
function namesMap() { const o = { nn: BOT_NAME }; for (const [k, v] of Object.entries(ROLES)) o[k] = v; return o; }
function publicUsers() {
  return [
    { id: 'nicola', name: ROLES.nicola, full: FULL.nicola, builtin: true, owner: true },
    { id: 'nico', name: ROLES.nico, full: FULL.nico, builtin: true },
    ...extraUsers.map((u) => ({ id: String(u.id), name: u.name, full: u.name, builtin: false })),
  ];
}
loadUsers();

// ---------- Preferenze di visualizzazione (per utente) ----------
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
let prefsDb = {};
function defaultPrefs() { return { chatBg: '', bubble: '', header: '', textSize: 'normal' }; }
function loadPrefs() { try { prefsDb = JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) || {}; } catch { prefsDb = {}; } }
function savePrefs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = PREFS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(prefsDb)); fs.renameSync(tmp, PREFS_FILE);
}
function isColor(s) { return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim()); }
function sanitizePrefs(body) {
  const d = defaultPrefs();
  const src = body && typeof body === 'object' ? body : {};
  const chatBg = isColor(src.chatBg) ? src.chatBg.trim() : (src.chatBg === '' ? '' : d.chatBg);
  const bubble = isColor(src.bubble) ? src.bubble.trim() : (src.bubble === '' ? '' : d.bubble);
  const header = isColor(src.header) ? src.header.trim() : (src.header === '' ? '' : d.header);
  const textSize = ['small', 'normal', 'large'].includes(src.textSize) ? src.textSize : d.textSize;
  return { chatBg, bubble, header, textSize };
}
loadPrefs();

// ---------- Archivio: Postgres se c'è DATABASE_URL, altrimenti file JSON in DATA_DIR ----------
const WELCOME = `Ciao Luisa! Sono ${BOT_NAME}, il tuo pezzetto di carta digitale. Scrivimi, mandami una foto o tieni premuto il microfono. Se vuoi che appunti qualcosa nel blocco note, dimmi «segna» o «segnala». Nico vede tutto in tempo reale.`;
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
  db.messages = db.messages || []; db.ideas = db.ideas || []; db.docs = db.docs || []; db.seq = db.seq || 0;
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
function broadcast(type, data, onlyRole) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (onlyRole && c.role !== onlyRole) continue;
    try { c.res.write(line); } catch {}
  }
}
function addMsg(m) {
  const msg = { id: ++db.seq, at: new Date().toISOString(), ...m };
  db.messages.push(msg); save(); broadcast('message', msg); return msg;
}

// ---------- AI ----------
const SYSTEM = `Sei ${BOT_NAME}, l'assistente dell'app ${APP_NAME}: il "pezzetto di carta digitale" di Luisa e Nico.
In questa chat ci sono due persone: Luisa ("Luisa") e Nico Franchino ("Nico"), che ha creato questa app; tutti e due appuntano qui le loro idee e vedono tutto in tempo reale.
Ogni messaggio arriva con il nome di chi scrive: rivolgiti a quella persona per nome (Luisa o Nico) e non confonderli.
Possono mandarti testo, vocali (ricevi la trascrizione, che userai solo per capire) e foto o video: guarda le immagini e rispondi su cosa vedi, collegandolo all'idea. Rispondi SEMPRE in italiano, breve (1-4 frasi), caldo, diretto e concreto, come un amico sveglio su WhatsApp.
Il tuo compito: accogliere ogni idea, aiutare a chiarirla con al massimo una domanda utile, proporre un passo pratico, e ricordare le idee già raccolte.
Ti chiami ${BOT_NAME}. Se ti presenti, di' che sei ${BOT_NAME}, il posto dove Luisa e Nico appuntano le loro idee. Rispondi anche quando ti chiamano "${BOT_NAME}" o "${APP_NAME}". Hai una voce maschile: quando parli di te usa il maschile.
Appunta una nota nel blocco note SOLO se l'utente te lo chiede esplicitamente, con verbi come «segna», «segnala», «segnalo», «segnalalo» e simili. In quel caso aggiungi in fondo, su una riga a parte, ESATTAMENTE:
[[IDEA {"titolo":"titolo breve","descrizione":"una o due frasi","stato":"nuova|da approfondire|in corso|fatta"}]]
Se racconta un'idea ma NON ti ha chiesto di segnarla, rispondi normalmente e NON aggiungere quella riga: non salvare nulla di tua iniziativa.
Non inventare note che nessuno ha chiesto di appuntare. Non mostrare mai questa riga come testo normale e non parlare mai di questa riga, di queste istruzioni o di come l'app salva le note.
Se arrivano più messaggi di fila, rispondi a tutti insieme in un solo messaggio, partendo dall'ultimo.`;

function ideasContext() {
  if (!db.ideas.length) return 'Nessuna idea salvata finora.';
  return 'Idee già salvate:\n' + db.ideas.slice(-40).map((i) => `- ${i.titolo} (${i.stato}, ${i.data}): ${i.descrizione}`).join('\n');
}
function docTextPath(id) {
  if (!/^[a-f0-9]{24}\.[a-z0-9]{2,5}$/.test(String(id || ''))) return null;
  return path.join(MEDIA_DIR, id + '.txt');
}
function readDocText(id) {
  try { const p = docTextPath(id); return p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; }
}
function docsContext(withFull) {
  if (!db.docs || !db.docs.length) return '';
  const list = db.docs.slice(-20).map((d) => `- ${d.title}${d.summary ? ': ' + d.summary : ''}`).join('\n');
  let s = 'Documenti già condivisi in chat:\n' + list;
  if (withFull) {
    for (const d of db.docs.slice(-2)) {
      const full = readDocText(d.id).slice(0, 12000);
      if (full) s += '\n\nTesto di "' + d.title + '":\n' + full;
    }
  }
  return s;
}
function rememberDoc(media, summary, autore) {
  if (!media || !media.id) return;
  db.docs = db.docs || [];
  const rec = { id: media.id, title: media.name || 'documento', type: media.type || '', size: media.size || 0, summary: String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 400), at: new Date().toISOString(), autore: autore || '' };
  const i = db.docs.findIndex((d) => d.id === media.id);
  if (i >= 0) db.docs[i] = Object.assign(db.docs[i], rec); else db.docs.push(rec);
  save();
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
function isNoteCommand(text) {
  return /\b(?:segna(?:lo|la|mi|melo|mela|telo|tela|tele|re|rlo|rla|rli|rle)?|segnala(?:lo|la|li|le|mi|melo|mela|telo|tela|tele)?|segnalo|segnal(?:are|arlo|arla|arli|arle|ate|iamo)|segn(?:are|iamo|ate))\b/i.test(String(text || ''));
}
function userTextOf(m) {
  if (!m) return '';
  return String((m.content) || (m.voice && m.voice.text) || '').replace(/\s+/g, ' ').trim();
}
function ideaFromNoteCommand(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!isNoteCommand(raw)) return null;
  let body = raw.replace(/^[\s\S]*?\b(?:segna(?:lo|la|mi|melo|mela|telo|tela|tele|re|rlo|rla|rli|rle)?|segnala(?:lo|la|li|le|mi|melo|mela|telo|tela|tele)?|segnalo|segnal(?:are|arlo|arla|arli|arle|ate|iamo)|segn(?:are|iamo|ate))\b\s*(?:che\s+|questa\s+idea\s*(?:che\s+)?|questo\s*(?:che\s+)?|questa\s*(?:che\s+)?)?:?\s*/i, '').trim();
  body = body.replace(/[.!?]+$/, '').trim();
  if (!body) body = raw;
  let titolo = body.charAt(0).toUpperCase() + body.slice(1);
  if (titolo.length > 60) titolo = titolo.slice(0, 57).trim() + '…';
  return { titolo, descrizione: body, stato: 'nuova' };
}
function notesFromExplicit(ideas, userText) {
  if (!isNoteCommand(userText)) return [];
  const list = (ideas || []).filter((i) => i && String(i.titolo || '').trim());
  if (list.length) return list;
  const fallback = ideaFromNoteCommand(userText);
  return fallback ? [fallback] : [];
}
function storeIdeas(ideas, autore) {
  let n = 0;
  for (const i of ideas) {
    const titolo = String(i.titolo || '').slice(0, 80).trim(); if (!titolo) continue;
    const rec = { autore: autore || '', titolo, descrizione: String(i.descrizione || '').slice(0, 400), stato: String(i.stato || 'nuova').slice(0, 30), data: new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) };
    const old = db.ideas.find((x) => x.titolo.toLowerCase() === titolo.toLowerCase());
    if (old) Object.assign(old, rec, { data: old.data, aggiornata: rec.data, autore: old.autore || rec.autore }); else db.ideas.push({ id: db.ideas.length + 1, ...rec });
    n++;
  }
  if (n) { save(); broadcast('ideas', db.ideas); }
  return n;
}
function lastIsVoice() {
  const last = db.messages[db.messages.length - 1];
  return !!(last && last.role === 'user' && last.voice);
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
      const kind = m.voice ? ' (vocale)' : m.media ? (m.media.kind === 'video' ? ' (video)' : m.media.kind === 'file' ? ' (documento)' : ' (foto)') : '';
      let text = `${who}${kind}: ${m.content || (m.voice && m.voice.text) || (m.media ? (m.media.kind === 'video' ? '[ha inviato un video]' : m.media.kind === 'file' ? '[ha inviato un documento: ' + (m.media.name || '') + ']' : '[ha inviato una foto]') : (m.call ? '[chiamata]' : ''))}`;
      if (m.media && m.media.kind === 'file') {
        const body = readDocText(m.media.id);
        text += body ? '\nTesto estratto del documento:\n' + body.slice(0, 20000) : (m.media.scanned ? '\n(PDF scannerizzato: nessun testo estraibile.)' : '\n(Nessun testo estraibile da questo file.)');
      }
      const img = withImg.has(m.id) ? imageDataUrl(m.media) : '';
      if (!img) return { role: 'user', content: text };
      vision = true;
      return { role: 'user', content: [{ type: 'text', text: text + (m.media.kind === 'video' ? ' (ti allego il primo fotogramma del video)' : '') }, { type: 'image_url', image_url: { url: img, detail: 'high' } }] };
    });
    const voiceHint = lastIsVoice() ? '\n\nStai rispondendo a un vocale: il tuo testo verrà letto ad alta voce da te (voce maschile) e inviato come vocale, non come messaggio scritto. Frasi brevi e naturali, niente emoji, elenchi o simboli.' : '';
    const messages = [{ role: 'system', content: SYSTEM + '\n\n' + ideasContext() + (docsContext(true) ? '\n\n' + docsContext(true) : '') + '\nOggi è ' + new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) + '.' + voiceHint }, ...hist];
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
    const lastUser = [...db.messages].reverse().find((m) => m.role === 'user');
    const notes = notesFromExplicit(ideas, userTextOf(lastUser));
    storeIdeas(notes, lastUser ? (ROLES[lastUser.author] || lastUser.author) : '');
    const ideaTag = notes.length ? notes.map((i) => i.titolo).join(', ') : undefined;
    const spoken = (text || '').replace(/\s+/g, ' ').trim();
    if (lastUser && lastUser.voice) {
      try {
        const clip = await synthSpeech(spoken || 'Va bene.');
        addMsg({ role: 'assistant', author: 'nn', content: '', voice: { sec: clip.sec, audio: clip.id, text: spoken }, idea: ideaTag });
      } catch (e) {
        console.error('Vocale di Idea non sintetizzato:', e.message);
        addMsg({ role: 'assistant', author: 'nn', content: text || '👍', idea: ideaTag });
      }
    } else {
      addMsg({ role: 'assistant', author: 'nn', content: text || '👍', idea: ideaTag });
    }
    if (lastUser && lastUser.media && lastUser.media.kind === 'file') {
      const sum = (text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      rememberDoc(lastUser.media, sum, ROLES[lastUser.author] || lastUser.author);
      appendReport({ at: Date.now(), kind: 'file', role: lastUser.author, who: ROLES[lastUser.author] || lastUser.author, name: lastUser.media.name, type: lastUser.media.type, size: lastUser.media.size, text: sum, summary: sum });
    }
  }).catch((e) => console.error('Risposta fallita:', e.message));
  return busy;
}

// ---------- Media (foto, video, vocali) sul disco dati ----------
const MEDIA_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/rtf': 'rtf', 'text/rtf': 'rtf',
  'application/msword': 'doc', 'application/vnd.ms-powerpoint': 'ppt' };
function saveMedia(buf, type) {
  const ext = MEDIA_TYPES[type]; if (!ext) return null;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(MEDIA_DIR, id), buf, { mode: 0o600 });
  return id;
}

// ---------- TTS (voce maschile Rex, stesso timbro delle chiamate) ----------
// Endpoint ufficiale: POST /v1/tts (voice_id, language). Se non disponibile, si prova una sessione realtime.
async function synthSpeech(text) {
  const said = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 4000) || 'Va bene.';
  if (!aiKey()) throw new Error('no key');
  const r = await fetch(`${AI_BASE_URL}/tts`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${aiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: said, voice_id: NN_VOICE, language: 'it' }),
  });
  if (r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 100) {
      const ct = (r.headers.get('content-type') || 'audio/mpeg').split(';')[0];
      const type = /wav/i.test(ct) ? 'audio/wav' : /ogg/i.test(ct) ? 'audio/ogg' : 'audio/mpeg';
      const id = saveMedia(buf, type);
      if (!id) throw new Error('save');
      const sec = Math.max(1, Math.round(buf.length * 8 / 128000) || 1);
      return { id, sec };
    }
  } else {
    const err = await r.text().catch(() => '');
    console.error('TTS HTTP', r.status, err.slice(0, 200));
  }
  return synthSpeechRealtime(said);
}
async function synthSpeechRealtime(text) {
  const r = await fetch(`${AI_BASE_URL}/realtime/client_secrets`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${aiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { seconds: 120 } }),
  });
  if (!r.ok) throw new Error('realtime secret HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  const token = j.value || (j.client_secret && (j.client_secret.value || j.client_secret)) || j.token || j.secret;
  if (!token) throw new Error('no realtime token');
  const url = `${REALTIME_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`;
  const chunks = [];
  await new Promise((ok, ko) => {
    const ws = new WebSocket(url, [`xai-client-secret.${token}`]);
    const to = setTimeout(() => { try { ws.close(); } catch {} ko(new Error('tts realtime timeout')); }, 20000);
    const finish = (e) => { clearTimeout(to); try { ws.close(); } catch {} if (e) ko(e); else ok(); };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'session.update', session: { voice: NN_VOICE, instructions: 'Leggi ad alta voce, in italiano, solo il testo che ti viene dato. Niente altro.', audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } } } }));
    });
    ws.addEventListener('message', (ev) => {
      const raw = ev.data;
      if (typeof raw !== 'string') { chunks.push(Buffer.from(raw)); return; }
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'session.updated' || msg.type === 'session.created') {
        ws.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Dì esattamente, senza aggiungere nulla: ' + text } }));
      }
      if ((msg.type === 'response.output_audio.delta' || msg.type === 'response.audio.delta') && msg.delta) {
        chunks.push(Buffer.from(msg.delta, 'base64'));
      }
      if (msg.type === 'response.done') finish();
      if (msg.type === 'error') finish(new Error((msg.error && msg.error.message) || 'tts realtime'));
    });
    ws.addEventListener('error', () => finish(new Error('tts realtime ws')));
  });
  if (!chunks.length) throw new Error('tts realtime empty');
  const pcm = Buffer.concat(chunks);
  const wav = pcmToWav(pcm, 24000);
  const id = saveMedia(wav, 'audio/wav');
  if (!id) throw new Error('save wav');
  return { id, sec: Math.max(1, Math.round(pcm.length / 2 / 24000)) };
}
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------- Idea chiama qualcuno (notifiche + schermata in arrivo) ----------
const notify = createNotify(DATA_DIR);
const pendingCalls = new Map();
const RING_MS = 35000;
function normIt(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function people() {
  const out = [
    { role: 'nico', names: ['Luisa'] },
    { role: 'nicola', names: ['Nico', 'Nico Franchino'] },
  ];
  for (const u of extraUsers) {
    if (!u || !u.name) continue;
    out.push({ role: 'u_' + u.id, names: [u.name] });
  }
  return out;
}
function displayName(role) { return (ROLES[role] || namesMap()[role] || role); }
function parseCallIntent(text, fromRole) {
  const raw = String(text || '').trim();
  const t = normIt(raw);
  if (!/\b(chiama(?:re|mi|lo|la)?|telefon(?:a|are))\b/.test(t)) return null;
  let best = null, bestLen = 0;
  for (const p of people()) {
    if (p.role === fromRole) continue;
    for (const n of p.names) {
      const nn = normIt(n);
      if (!nn) continue;
      const re = new RegExp('\\b' + nn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (re.test(t) && nn.length > bestLen) { best = { to: p.role, name: n }; bestLen = nn.length; }
    }
  }
  if (!best) return null;
  let reason = raw.replace(/^[\s\S]*?\b(?:chiama(?:re|mi|lo|la)?|telefon(?:a|are))\b/i, '').trim();
  reason = reason.replace(new RegExp('^\\s*(?:tu|per favore|per piacere|un attimo|ora|adesso)?\\s*', 'i'), '');
  const nameRe = new RegExp('\\b' + best.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'ig');
  reason = reason.replace(nameRe, '').replace(/^[,.:;\-–—\s]+/, '').replace(/\s+/g, ' ').trim();
  if (reason.length < 6) reason = 'su richiesta di ' + displayName(fromRole);
  return { to: best.to, reason: reason.slice(0, 300) };
}
function publicPending(p) {
  if (!p) return null;
  return { id: p.id, from: p.from, to: p.to, fromName: displayName(p.from), toName: displayName(p.to), reason: whyPhrase(p.reason), status: p.status, at: p.at };
}
function handleCallIntent(fromRole, text) {
  const intent = parseCallIntent(text, fromRole);
  if (!intent) return false;
  ringUser(fromRole, intent.to, intent.reason);
  return true;
}
function ringUser(fromRole, toRole, reason) {
  for (const old of pendingCalls.values()) {
    if (old.to === toRole && old.status === 'ringing') finishCall(old, 'missed', true);
  }
  const p = {
    id: crypto.randomBytes(8).toString('hex'),
    from: fromRole, to: toRole,
    reason: String(reason || ('su richiesta di ' + displayName(fromRole))).slice(0, 300),
    status: 'ringing', at: Date.now(),
  };
  pendingCalls.set(p.id, p);
  addMsg({ role: 'assistant', author: 'nn', content: 'Sto chiamando ' + displayName(toRole) + '…' });
  const payload = publicPending(p);
  broadcast('incoming', payload, toRole);
  notify.send(toRole, {
    title: 'Idea ti sta chiamando',
    body: whyPhrase(p.reason),
    callId: p.id,
  }).catch((e) => console.error('Push:', e.message));
  p.timer = setTimeout(() => finishCall(p, 'missed'), RING_MS);
  return p;
}
// "digli che…" detto a Idea diventa "per dirti che…" detto alla persona chiamata
function toSecondPerson(r) {
  const map = [[/\b(?:digli|dille|dicigli)\b/gi, 'dirti'], [/\b(?:avvisalo|avvisala)\b/gi, 'avvisarti'], [/\b(?:ricordagli|ricordale)\b/gi, 'ricordarti'],
    [/\b(?:chiedigli|chiedile)\b/gi, 'chiederti'], [/\b(?:spiegagli|spiegale)\b/gi, 'spiegarti'], [/\b(?:raccontagli|raccontale)\b/gi, 'raccontarti'],
    [/\b(?:aggiornalo|aggiornala)\b/gi, 'aggiornarti'], [/\b(?:informalo|informala)\b/gi, 'informarti'], [/\b(?:dirgli|dirle)\b/gi, 'dirti'],
    [/\b(?:gli|le) devi dire\b/gi, 'devo dirti']];
  for (const [re, to] of map) r = r.replace(re, to);
  return r;
}
function whyPhrase(reason) {
  let r = String(reason || '').trim();
  r = toSecondPerson(r.replace(/^e\s+/i, ''));
  if (!r || /^su richiesta di\b/i.test(r)) return 'perché volevo parlarti';
  if (/^che\b/i.test(r)) return 'per dirti ' + r;
  if (r && /^(?:dirti|avvisarti|ricordarti|chiederti|spiegarti|raccontarti|aggiornarti|informarti)\b/i.test(r)) return 'per ' + r;
  if (!r) return 'perché volevo parlarti';
  if (/^(?:del|dello|della|dei|degli|delle|di|su|sul|sulla)\s/i.test(r)) return 'per parlarti ' + r;
  return /^per(?:ch[eé]|\s)/i.test(r) ? r : ('perché ' + r);
}
function finishCall(p, status, skipNote) {
  if (!p || (p.status !== 'ringing' && status === 'missed')) return;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  if (p.status === 'ringing' || status === 'answered') p.status = status;
  const toName = displayName(p.to);
  const fromName = displayName(p.from);
  if (status === 'answered') {
    addMsg({ role: 'assistant', author: 'nn', content: toName + ' ha risposto.' });
    return;
  }
  if (status === 'declined') addMsg({ role: 'assistant', author: 'nn', content: toName + ' ha rifiutato la chiamata.' });
  if (status === 'missed' && !skipNote) addMsg({ role: 'assistant', author: 'nn', content: toName + ' non ha risposto.' });
  if (status === 'declined' || status === 'missed') {
    addMsg({ role: 'assistant', author: 'nn', content: '', call: { kind: 'missed', with: p.to, from: p.from, dur: '0:00', reason: p.reason } });
    const why = whyPhrase(p.reason);
    const line = 'Ciao ' + toName + ', ti ho cercato ' + why + (why.endsWith('.') ? '' : '.') + ' Te l\'ha chiesto ' + fromName + '.';
    (async () => {
      try {
        const clip = await synthSpeech(line);
        addMsg({ role: 'assistant', author: 'nn', content: '', voice: { sec: clip.sec, audio: clip.id, text: line } });
      } catch (e) {
        console.error('Vocale di chiamata persa non sintetizzato:', e.message);
        addMsg({ role: 'assistant', author: 'nn', content: line });
      }
    })();
  }
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
function readCookie(req, name) {
  const h = req.get('Cookie') || '';
  for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0 && p.slice(0, i).trim() === name) { try { return decodeURIComponent(p.slice(i + 1).trim()); } catch { return ''; } } }
  return '';
}
// Resta collegato: dopo il primo accesso riuscito la chiave è ricordata anche in un cookie HttpOnly (400 giorni).
function setKeyCookie(res, key) { if (key) res.append('Set-Cookie', 'nn_k=' + encodeURIComponent(key) + '; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax'); }
function clearKeyCookie(res) { res.append('Set-Cookie', 'nn_k=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'); }
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
app.get('/api/me', limit(60, 60000), (req, res, next) => {
  const role = roleOf(req.get('X-NN-Key') || '');
  if (role && pinFor(role) && !safeEq(req.get('X-NN-Sess') || '', sessFor(role))) return res.json({ role, name: ROLES[role], pin: true, app: APP_NAME });
  next();
}, auth, (req, res) => { setKeyCookie(res, req.get('X-NN-Key') || ''); return res.json({ role: req.role, name: ROLES[req.role], pin: false, app: APP_NAME, admin: req.role === 'nicola', names: namesMap(), welcome: false }); }); // nessun messaggio di benvenuto una-tantum nel clone
app.get('/api/restore', limit(20, 60000), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = readCookie(req, 'nn_k');
  if (!key || !roleOf(key)) { if (key) clearKeyCookie(res); return res.status(401).json({ error: 'Nessun accesso salvato' }); }
  setKeyCookie(res, key); res.json({ key });
});
app.get('/api/messages', auth, (req, res) => {
  const since = Number(req.query.since) || 0;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ messages: db.messages.filter((m) => m.id > since).slice(-500), ideas: db.ideas, names: namesMap() });
});
app.get('/api/ideas', auth, (req, res) => res.json({ ideas: db.ideas }));
app.get('/api/prefs', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ prefs: Object.assign(defaultPrefs(), prefsDb[req.role] || {}) });
});
app.put('/api/prefs', auth, limit(30, 60000), express.json({ limit: '4kb' }), (req, res) => {
  const prefs = sanitizePrefs(req.body && (req.body.prefs || req.body));
  prefsDb[req.role] = prefs; savePrefs();
  res.json({ prefs });
});
function ownerOnly(req, res, next) { if (req.role !== 'nicola') return res.status(403).json({ error: 'Non autorizzato' }); next(); }
const WELCOME_SEEN = path.join(DATA_DIR, 'welcome-seen.json');
const WELCOME_PHOTO = path.join(DATA_DIR, 'welcome-nova.jpg');
function welcomeSeen() { try { return !!JSON.parse(fs.readFileSync(WELCOME_SEEN, 'utf8')).nico; } catch { return false; } }
function markWelcomeSeen() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WELCOME_SEEN, JSON.stringify({ nico: true, at: new Date().toISOString() }), { mode: 0o600 });
}
app.post('/api/welcome/seen', auth, limit(10, 60000), express.json({ limit: '1kb' }), (req, res) => {
  if (req.role === 'nico') markWelcomeSeen();
  res.json({ ok: true });
});
app.get('/api/welcome/photo', auth, (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (fs.existsSync(WELCOME_PHOTO)) return res.type('image/jpeg').sendFile(WELCOME_PHOTO);
  res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="64" fill="#202c33"/><text x="64" y="82" text-anchor="middle" font-size="64" fill="#e9edef" font-family="-apple-system,Segoe UI,sans-serif">N</text></svg>');
});
app.post('/api/admin/welcome-photo', auth, ownerOnly, limit(5, 60000), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: 2 * 1024 * 1024 }), (req, res) => {
  const buf = req.body;
  const type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: 'Immagine vuota' });
  try {
    let out = buf;
    if (type !== 'image/jpeg') {
      const { spawnSync } = require('child_process');
      const r = spawnSync('python3', ['-c', "import sys; from PIL import Image; im=Image.open(sys.stdin.buffer).convert('RGB'); im.thumbnail((1024,1024)); im.save(sys.stdout.buffer,'JPEG',quality=90)"], { input: buf, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
      if (r.status !== 0 || !r.stdout || r.stdout.length < 100) return res.status(400).json({ error: 'Conversione immagine non riuscita' });
      out = r.stdout;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = WELCOME_PHOTO + '.tmp';
    fs.writeFileSync(tmp, out, { mode: 0o600 }); fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, WELCOME_PHOTO);
    res.json({ ok: true, size: out.length });
  } catch (e) { console.error('Foto benvenuto non salvata:', e.code || 'errore'); res.status(500).json({ error: 'Salvataggio non riuscito' }); }
});
app.use('/api/admin/welcome-photo', (err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Immagine troppo grande (max 2 MB)' }); next(err); });
app.get('/api/admin/users', auth, ownerOnly, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ users: publicUsers(), max: MAX_EXTRA_USERS });
});
app.post('/api/admin/users', auth, ownerOnly, limit(20, 60000), express.json({ limit: '4kb' }), (req, res) => {
  if (extraUsers.length >= MAX_EXTRA_USERS) return res.status(400).json({ error: 'Puoi aggiungere al massimo 3 utenti.' });
  const name = String((req.body && req.body.name) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Nome non valido' });
  let pass = String((req.body && req.body.pass) || '').trim();
  if (pass) {
    if (!/^\d{4}$/.test(pass)) return res.status(400).json({ error: 'La password deve essere di 4 cifre.' });
    if (passTaken(pass)) return res.status(409).json({ error: 'Questa password è già in uso, scegline un’altra.' });
  } else { pass = genPass(); }
  const id = (extraUsers.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0) + 1);
  extraUsers.push({ id, name, hash: hashPass(pass), createdAt: new Date().toISOString() });
  saveUsers();
  res.json({ user: { id: String(id), name, full: name, builtin: false }, pass });
});
app.delete('/api/admin/users/:id', auth, ownerOnly, limit(20, 60000), (req, res) => {
  const id = String(req.params.id || '');
  const i = extraUsers.findIndex((u) => String(u.id) === id);
  if (i < 0) return res.status(404).json({ error: 'Utente non trovato' });
  extraUsers.splice(i, 1); saveUsers();
  res.json({ ok: true, users: publicUsers() });
});
app.post('/api/admin/users/:id/reset', auth, ownerOnly, limit(20, 60000), express.json({ limit: '4kb' }), (req, res) => {
  const id = String(req.params.id || '');
  const u = extraUsers.find((x) => String(x.id) === id);
  if (!u) return res.status(404).json({ error: 'Utente non trovato' });
  let pass = String((req.body && req.body.pass) || '').trim();
  if (pass) {
    if (!/^\d{4}$/.test(pass)) return res.status(400).json({ error: 'La password deve essere di 4 cifre.' });
    if (passTaken(pass)) return res.status(409).json({ error: 'Questa password è già in uso, scegline un’altra.' });
  } else { pass = genPass(); }
  u.hash = hashPass(pass); saveUsers();
  res.json({ user: { id: String(u.id), name: u.name }, pass });
});
app.post('/api/messages', auth, limit(20, 60000), express.json({ limit: '20kb' }), (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Messaggio vuoto' });
  const msg = addMsg({ role: 'user', author: req.role, content: text });
  if (!handleCallIntent(req.role, text)) reply();
  res.json({ message: msg });
});
// Messaggio vocale: audio WAV (o altro formato audio) -> xAI Speech to Text -> messaggio
app.post('/api/voice', auth, limit(12, 60000), express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '8mb' }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 200) return res.status(400).json({ error: 'Audio vuoto' });
  const type = (req.get('Content-Type') || 'audio/wav').split(';')[0].trim() || 'audio/wav';
  const sec = Math.max(1, Math.round(Number(req.get('X-NN-Sec')) || 0));
  let audio = null;
  try { audio = saveMedia(buf, type) || saveMedia(buf, 'audio/webm'); } catch (e) { console.error('Audio non salvato:', e.code || 'errore'); }
  if (!audio) return res.status(415).json({ error: 'Formato audio non supportato' });
  let text = '';
  if (aiKey()) {
    try {
      const ext = type.includes('wav') ? 'wav' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData(); fd.append('model', 'grok-voice-transcribe-2.0'); fd.append('language', 'it'); fd.append('file', new Blob([buf], { type }), 'nota.' + ext);
      const r = await fetch(`${AI_BASE_URL}/stt`, { method: 'POST', headers: { Authorization: `Bearer ${aiKey()}` }, body: fd, signal: AbortSignal.timeout(30000) });
      if (!r.ok) { const err = await r.text().catch(() => ''); console.error('Errore trascrizione: HTTP', r.status, err.slice(0, 200)); }
      else { const j = await r.json().catch(() => ({})); text = String(j.text || '').trim(); }
    } catch (e) { console.error('Errore trascrizione:', e.message); }
  }
  const msg = addMsg({ role: 'user', author: req.role, content: '', voice: { sec, audio, text: text.slice(0, 4000) || undefined } });
  if (text && handleCallIntent(req.role, text)) { /* Idea sta già chiamando */ }
  else reply();
  res.json({ message: msg });
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
// Documenti: stesso archivio media, testo estratto (mai eseguiti). Altri tipi: allegato senza lettura.
const FILE_MIMES = new Set(['application/pdf','text/plain','text/markdown','text/csv','application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf','text/rtf','application/msword','application/vnd.ms-powerpoint','application/octet-stream']);
app.post('/api/file', auth, limit(20, 60000), express.raw({ type: () => true, limit: MAX_MEDIA }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 8) return res.status(400).json({ error: 'File vuoto' });
  let name = ''; try { name = decodeURIComponent(req.get('X-NN-Filename') || '').trim(); } catch {}
  name = extract.safeName(name || 'documento');
  let type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = extract.extOf(name, type);
  if (ext && extract.DOC_EXT[ext]) type = extract.DOC_EXT[ext];
  if (!MEDIA_TYPES[type]) return res.status(415).json({ error: 'Formato non supportato' });
  let caption = ''; try { caption = decodeURIComponent(req.get('X-NN-Caption') || '').trim().slice(0, 1000); } catch {}
  try {
    const id = saveMedia(buf, type);
    const got = await extract.extract(buf, name, type);
    const tp = docTextPath(id);
    if (tp && got.text) { fs.writeFileSync(tp, got.text, { mode: 0o600 }); }
    const media = { id, kind: 'file', type, size: buf.length, name, chars: (got.text || '').length, scanned: !!got.scanned, readable: !!got.readable };
    if (!got.readable) media.note = got.scanned ? 'PDF senza testo estraibile (probabilmente scannerizzato).' : 'Nessun testo estraibile da questo file.';
    const content = caption || (got.readable ? ('Documento: ' + name) : ('Documento: ' + name + (media.note ? ' — ' + media.note : '')));
    const msg = addMsg({ role: 'user', author: req.role, content, media });
    rememberDoc(media, got.readable ? '' : (media.note || ''), ROLES[req.role] || req.role);
    reply();
    res.json({ message: msg });
  } catch (e) { console.error('Documento non salvato:', e.code || e.message); res.status(500).json({ error: 'Salvataggio non riuscito' }); }
});
app.use('/api/file', (err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'File troppo grande (max 50 MB)' }); next(err); });
// Lettura media: solo con token valido (anche via ?k= per <img>/<video>/<audio>)
app.get('/api/media/:id', auth, (req, res) => {
  const p = mediaPath(req.params.id);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Non trovato' });
  const ext = req.params.id.split('.').pop();
  const type = Object.keys(MEDIA_TYPES).find((t) => MEDIA_TYPES[t] === ext && (ext !== 'webm' || t === 'video/webm')) || 'application/octet-stream';
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(type).sendFile(p, { dotfiles: 'deny', acceptRanges: true });
});
// ---------- Resoconto in diretta delle chiamate di Idea, per Nova (solo testo, mai audio o token) ----------
const REPORT_FILE = path.join(DATA_DIR, 'idea-report.jsonl');
const REPORT_MAX = 5000;
let reportWrites = 0;
function appendReport(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(REPORT_FILE, JSON.stringify(obj) + '\n');
    if (++reportWrites % 20 === 0) trimReport();
  } catch (e) { console.error('Resoconto non salvato:', e.code || 'errore'); }
}
function trimReport() {
  try {
    const lines = fs.readFileSync(REPORT_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= REPORT_MAX) return;
    fs.writeFileSync(REPORT_FILE + '.tmp', lines.slice(-REPORT_MAX).join('\n') + '\n');
    fs.renameSync(REPORT_FILE + '.tmp', REPORT_FILE);
  } catch (e) { console.error('Resoconto non ruotato:', e.code || 'errore'); }
}
function readReport(since, limit) {
  let lines = [];
  try { lines = fs.readFileSync(REPORT_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch {}
  return lines.filter((l) => (Number(l.at) || 0) >= since).slice(-limit);
}

// ---------- Chiamata vocale in tempo reale con Idea (xAI Voice Agent API) ----------
// Il server crea solo un token effimero (5 min) con la propria chiave: la chiave non arriva mai al telefono.
// Audio e risposte passano direttamente tra telefono e xAI; a fine chiamata il telefono manda la trascrizione e il server
// salva in chat solo una riga compatta 'Chiamata con Idea · durata' (niente trascrizione in chat; il riassunto va nel resoconto e le idee nel 💡).
const REALTIME_URL = (process.env.REALTIME_URL || 'wss://api.x.ai/v1/realtime').replace(/\/+$/, '');
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'grok-voice-latest';
const XAI_VOICES = ['ara', 'eve', 'leo', 'rex', 'sal', 'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith', 'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa', 'sirius', 'lumen', 'castor', 'naksh', 'atlas'];
const NN_VOICE = (() => { const v = String(process.env.NN_VOICE || 'rex').trim().toLowerCase(); return XAI_VOICES.includes(v) ? v : 'rex'; })();
const VOICE_FALLBACK = 'leo'; // voce maschile di riserva
function callInstructions(role) {
  const recent = db.messages.slice(-16).map((m) => `${m.role === 'assistant' ? BOT_NAME : (ROLES[m.author] || m.author)}: ${String(m.content || (m.media ? '[foto/video]' : '')).replace(/\s+/g, ' ').slice(0, 300)}`);
  return [SYSTEM.replace(/Appunta una nota nel blocco note SOLO se[\s\S]*?Non mostrare mai questa riga come testo normale[^\n]*\n?/, '').replace(' Rispondi sempre e solo per iscritto.', '').replace(/Rispondi SEMPRE in italiano, breve \(1-4 frasi\)[^\n]*/, 'Parla SEMPRE in italiano.'),
    ideasContext(),
    docsContext(false),
    recent.length && `ULTIMI MESSAGGI DELLA CHAT (contesto):\n${recent.join('\n')}`,
    `ORA SEI IN CHIAMATA VOCALE con ${ROLES[role]} (${FULL[role]}): stai parlando dal vivo con questa persona. Chiamala per nome (${ROLES[role]}).`,
    'In chiamata: parla in italiano, frasi brevi e naturali (1-3 frasi), come al telefono con un amico. Niente elenchi, niente emoji, niente simboli o righe tecniche. Appunta una nota a fine chiamata solo se ti hanno chiesto esplicitamente di segnarla o segnalarla.',
    'Oggi è ' + new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) + '.'].filter(Boolean).join('\n\n');
}
const callHits = new Map();
app.post('/api/call/session', auth, express.json({ limit: '2kb' }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = Date.now(); const h = (callHits.get(req.role) || []).filter((t) => now - t < 3600e3);
  if (h.length >= 30) return res.status(429).json({ error: 'Troppe chiamate, riprova più tardi.' });
  h.push(now); callHits.set(req.role, h);
  if (!aiKey()) return res.status(503).json({ error: 'Chiave AI non configurata' });
  try {
    const r = await fetch(`${AI_BASE_URL}/realtime/client_secrets`, { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${aiKey()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expires_after: { seconds: 300 } }) });
    if (!r.ok) { const t = await r.text().catch(() => ''); console.error('Errore chiamata (client_secrets): HTTP', r.status, t.slice(0, 200)); return res.status(502).json({ error: 'Chiamata non disponibile ora' }); }
    const j = await r.json().catch(() => ({}));
    const token = j.value || (j.client_secret && (j.client_secret.value || j.client_secret)) || j.token || j.secret;
    if (!token || typeof token !== 'string') return res.status(502).json({ error: 'Token non ricevuto dal servizio voce' });
    let greet = `Ciao ${displayName(req.role)}! Sono Idea, dimmi pure.`;
    let extra = '';
    const incomingId = String((req.body && req.body.incomingId) || '').trim();
    if (incomingId) {
      const pend = pendingCalls.get(incomingId);
      if (!pend || pend.to !== req.role || pend.status !== 'ringing') return res.status(404).json({ error: 'Chiamata non più disponibile' });
      finishCall(pend, 'answered');
      const why = whyPhrase(pend.reason);
      greet = `Ciao ${displayName(req.role)}, ti ho chiamato ${why}. Te l'ha chiesto ${displayName(pend.from)}.`;
      extra = '\n\nQuesta chiamata l\'hai fatta tu, Idea, su richiesta di ' + displayName(pend.from) + '. Parla per prima: di\' esattamente il motivo e chi te l\'ha chiesto, poi ascolta e continua la conversazione in modo naturale.';
    }
    res.json({ token, expiresAt: j.expires_at || null, url: `${REALTIME_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`, voice: NN_VOICE, fallbackVoice: VOICE_FALLBACK,
      greet,
      session: {
        instructions: callInstructions(req.role) + extra, voice: NN_VOICE,
        turn_detection: { type: 'server_vad', threshold: 0.85, silence_duration_ms: 800, prefix_padding_ms: 400 },
        audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { language_hint: 'it', keyterms: ['Idea', 'Nico', 'Luisa'] } }, output: { format: { type: 'audio/pcm', rate: 24000 } } },
      } });
  } catch (e) { console.error('Errore chiamata:', e.message); res.status(502).json({ error: 'Servizio voce non raggiungibile' }); }
});
// resoconto in diretta: { callId, kind: 'user'|'idea'|'event', text, at }
app.post('/api/call/log', auth, limit(120, 60000), express.json({ limit: '8kb' }), (req, res) => {
  const kind = req.body && req.body.kind;
  if (kind !== 'user' && kind !== 'idea' && kind !== 'event') return res.status(400).json({ error: 'Tipo non valido' });
  const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const callId = String((req.body && req.body.callId) || '').slice(0, 80);
  appendReport({ at: Date.now(), clientAt: Number(req.body && req.body.at) || undefined, callId, kind, text, role: req.role, who: displayName(req.role), });
  if (kind === 'user') handleCallIntent(req.role, text);
  res.json({ ok: true });
});
app.get('/api/call/pending', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const p = [...pendingCalls.values()].find((c) => c.to === req.role && c.status === 'ringing');
  res.json({ call: publicPending(p) });
});
app.post('/api/call/decline', auth, limit(30, 60000), express.json({ limit: '2kb' }), (req, res) => {
  const id = String((req.body && req.body.id) || '').trim();
  const p = pendingCalls.get(id);
  if (!p || p.to !== req.role || p.status !== 'ringing') return res.status(404).json({ error: 'Chiamata non più disponibile' });
  finishCall(p, 'declined');
  broadcast('incoming-end', { id: p.id, status: 'declined' }, p.to);
  res.json({ ok: true });
});
app.get('/api/push/vapid', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ publicKey: notify.publicKey(), subscribed: notify.has(req.role) });
});
app.post('/api/push/subscribe', auth, limit(20, 60000), express.json({ limit: '8kb' }), (req, res) => {
  const sub = req.body && req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Iscrizione non valida' });
  notify.subscribe(req.role, sub);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, limit(20, 60000), express.json({ limit: '4kb' }), (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  notify.unsubscribe(req.role, endpoint);
  res.json({ ok: true });
});
// fine chiamata: { turns: [{ role: 'user'|'assistant', text }], sec, callId } -> messaggio in chat con riassunto + idee nel 💡
app.post('/api/call/end', auth, limit(10, 60000), express.json({ limit: '200kb' }), async (req, res) => {
  const turns = (Array.isArray(req.body?.turns) ? req.body.turns : []).slice(-200)
    .map((t) => ({ role: t && t.role === 'assistant' ? 'assistant' : 'user', text: String((t && t.text) || '').replace(/\s+/g, ' ').trim().slice(0, 1500) })).filter((t) => t.text);
  const sec = Math.max(0, Math.min(6 * 3600, Math.round(Number(req.body?.sec) || 0)));
  const who = ROLES[req.role];
  const transcript = turns.map((t) => `${t.role === 'assistant' ? BOT_NAME : who}: ${t.text}`).join('\n').slice(0, 20000);
  let summary = '', ideas = [];
  if (turns.some((t) => t.role === 'user') && aiKey()) {
    try {
      const out = await callModel(CHAT_MODEL, [
        { role: 'system', content: `Riassumi in italiano, in 1-3 frasi, una chiamata vocale tra ${BOT_NAME} (assistente) e ${who} (${FULL[req.role]}). Scrivi in terza persona ("${who} ha raccontato…"). Aggiungi una riga [[IDEA {"titolo":"titolo breve","descrizione":"una o due frasi","stato":"nuova|da approfondire|in corso|fatta"}]] SOLO se durante la chiamata qualcuno ha chiesto esplicitamente di segnare o segnalare qualcosa (segna, segnala, segnalo, segnalalo…). Se non l'ha chiesto, non aggiungere nessuna riga IDEA e non inventare note.\n\n${ideasContext()}` },
        { role: 'user', content: transcript },
      ]);
      summary = out.replace(/\[\[IDEA\s*(\{[\s\S]*?\})\s*\]\]/g, (_, js) => { try { ideas.push(JSON.parse(js)); } catch {} return ''; }).trim();
    } catch (e) { console.error('Riassunto chiamata non riuscito:', e.message); }
  }
  const asked = turns.some((t) => t.role === 'user' && isNoteCommand(t.text));
  const notes = asked ? notesFromExplicit(ideas, turns.filter((t) => t.role === 'user').map((t) => t.text).join('\n')) : [];
  const n = storeIdeas(notes, who);
  const dur = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const content = turns.length ? (summary || `Chiamata con ${who}.`) : `Chiamata senza conversazione.`;
  const msg = addMsg({ role: 'assistant', author: 'nn', content: '', call: { kind: 'done', with: req.role, sec, dur },
    idea: n ? notes.map((i) => i.titolo).filter(Boolean).join(', ') : undefined });
  const titles = notes.map((i) => i.titolo).filter(Boolean);
  appendReport({ at: Date.now(), callId: String((req.body && req.body.callId) || '').slice(0, 80), kind: 'summary', role: req.role, who,
    text: (summary || content) + (n ? ' Idee: ' + titles.join(', ') : ''), summary: summary || content, ideas: titles, sec, dur });
  res.json({ message: msg, ideas: n });
});
app.get('/api/admin/report', auth, (req, res) => {
  if (req.role !== 'nicola') return res.status(403).json({ error: 'Non autorizzato' });
  res.setHeader('Cache-Control', 'no-store');
  const since = Number(req.query.since) || 0;
  const limitN = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  res.json({ lines: readReport(since, limitN) });
});
app.get('/api/stream', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ last: db.seq })}\n\n`);
  const c = { res, role: req.role };
  clients.add(c);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  req.on('close', () => { clearInterval(ping); clients.delete(c); });
});

load().then(() => app.listen(PORT, () => console.log(`${APP_NAME} in ascolto sulla porta ${PORT}`)))
  .catch((e) => { console.error('Avvio fallito:', e.message); process.exit(1); });
