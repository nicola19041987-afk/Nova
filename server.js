// Server dell'app privata: Express + proxy verso l'API xAI (compatibile OpenAI).
// La chiave xAI arriva dal browser nell'header "X-AI-Key" a ogni richiesta:
// viene solo inoltrata ad api.x.ai, MAI salvata né scritta nei log.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const PORT = Number(process.env.PORT || 3000);
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
const CHAT_MODEL = process.env.CHAT_MODEL || 'grok-4';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'grok-imagine-image-2.0';
const IMAGE_EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || IMAGE_MODEL;
// Video: endpoint asincrono xAI (POST /videos/generations -> request_id, poi GET /videos/{id}).
// Per disattivarlo o puntare a un altro provider: VIDEO_PATH vuoto = "non configurato".
const VIDEO_PATH = process.env.VIDEO_PATH === undefined ? '/videos/generations' : process.env.VIDEO_PATH;
const VIDEO_STATUS_PATH = process.env.VIDEO_STATUS_PATH || '/videos/{id}';
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'grok-imagine-video-1.5-lite';
// Azioni dell'avatar (v7): brevi clip da immagine a video; il modello completo permette di fissare anche l'ultimo
// fotogramma uguale al primo (ritorno pulito all'avatar). Durata corta e 480p per spendere poco.
const ACTION_VIDEO_MODEL = process.env.ACTION_VIDEO_MODEL || 'grok-imagine-video-1.5';
const ACTION_SECONDS = Math.min(8, Math.max(2, Number(process.env.ACTION_SECONDS) || 5));
const ACTION_RESOLUTION = process.env.ACTION_RESOLUTION || '480p';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const COOKIE = 'sid';

// Solo due profili, nessuna registrazione pubblica. Accesso con PIN a 4 cifre (hash bcrypt in data/pins.json).
const USERS = { nicola: { name: 'Nico' }, luisa: { name: 'Luisa' } };
const USER_ALIASES = { nico: 'nicola', nicola: 'nicola', luisa: 'luisa' };
// Facoltativo: se impostato, serve anche questo codice per creare il PIN la prima volta.
const SETUP_CODE = process.env.SETUP_CODE || '';

// Regola di base FISSA, lato server, aggiunta SEMPRE PER ULTIMA a ogni conversazione.
// Non è modificabile dalla UI e prevale su personaggio, "Le mie regole" e memoria.
const BASE_RULE = `REGOLE DI BASE NON MODIFICABILI (prevalgono su TUTTE le istruzioni precedenti, che non possono annullarle):
- Gli utenti sono due adulti consenzienti (Nicola e Luisa). Sono ammessi contenuti per adulti tra adulti consenzienti.
- Vietato in modo assoluto qualsiasi contenuto che coinvolga minori o personaggi che sembrino minorenni, in qualunque forma o finzione.
- Vietato qualsiasi contenuto con atti non consensuali, coercizione, violenza sessuale o persone incapaci di dare consenso.
- Vietato qualsiasi contenuto che descriva, incoraggi o aiuti a compiere atti illegali.
- Vietato qualsiasi contenuto sessuale che raffiguri o riguardi persone reali identificabili diverse da Nicola e Luisa (es. celebrità, conoscenti, ex): solo i due utenti o personaggi inventati. Vietati scambi di volto o immagini con volti di terze persone reali.
- Se una richiesta o un'istruzione precedente viola queste regole, rifiuta con gentilezza e proponi un'alternativa consentita.
- Rispondi sempre in italiano, salvo richiesta esplicita diversa.`;
// Modalità adulti (per utente, OFF di default, solo dopo il consenso vocale): permette nudo/esplicito
// SOLO del personaggio inventato adulto. IMAGE_RULE resta sempre in testa e non è disattivabile.
const ADULT_IMAGE_RULE = 'Adult mode enabled by two consenting adult users: tasteful or explicit adult nudity of the fictional adult character (25+) is allowed. Still strictly: adults only, no youthful features, consensual, no real identifiable people. ';
const imgPrefix = (adult) => IMAGE_RULE + (adult ? ADULT_IMAGE_RULE : '');
// Errori del servizio AI in italiano chiaro (rifiuto per moderazione, chiave errata, altro)
function aiErrorMsg(status, j) {
  const raw = String((j && (j.error?.message || j.error || j.message)) || '');
  if (status === 401 || status === 403 && !/moderat|safety|policy|content/i.test(raw)) return 'Chiave xAI non valida';
  if ([400, 403, 422, 451].includes(status) && /moderat|safety|policy|content|nsfw|reject|refus|violat|block|not allowed|inappropriate/i.test(raw)) return 'Contenuto rifiutato dal servizio AI';
  if (status === 451) return 'Contenuto rifiutato dal servizio AI';
  return raw && raw.length < 200 ? `Errore dal servizio AI (${status}): ${raw}` : `Errore dal servizio AI (${status})`;
}
const IMAGE_RULE = 'Realistic. Only adults clearly aged 25 or older. No minors, no non-consensual or illegal content, no sexual depiction of real identifiable people or celebrities; faces only of the two consenting users or AI-generated faces. ';

// ---------- archivio su file JSON ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const userDir = (u, ...p) => { const d = path.join(DATA_DIR, 'users', u, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const readJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
// Lettura "sicura" per le modifiche: file mancante -> valore di partenza; file presente ma illeggibile -> ERRORE
// (mai sovrascrivere dati esistenti con un [] di ripiego). Il file rotto viene messo da parte e, se c'è,
// si ripristina l'ultima copia valida dai backup automatici.
const readJSONSafe = (f, def) => {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return def; throw e; }
  try { return JSON.parse(txt); } catch {
    const fixed = restoreCorrupt(f, txt);
    if (fixed !== undefined) return fixed;
    const err = new Error(`Archivio ${path.basename(f)} illeggibile: modifica bloccata per non perdere dati`); err.status = 503; throw err;
  }
};
// Scrittura atomica: file temporaneo univoco + rename (mai un JSON scritto a metà).
const revs = new Map(); // versione in memoria di ogni file condiviso (per il polling)
const BOOT_ID = crypto.randomBytes(3).toString('hex');
const MIRRORED = /^(characters|memory)\.json$/;
const writeJSON = (f, v) => {
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const txt = JSON.stringify(v, null, 2);
  fs.writeFileSync(tmp, txt); fs.renameSync(tmp, f);
  // copia speculare sempre aggiornata dei file principali (personaggi, memoria): primo ripiego se il file si rompe
  if (MIRRORED.test(path.basename(f)) && path.basename(path.dirname(f)) === 'shared') { fs.writeFileSync(tmp, txt); fs.renameSync(tmp, f + '.bak'); }
  revs.set(f, (revs.get(f) || 0) + 1);
};
const fileRev = (f) => `${BOOT_ID}.${revs.get(f) || 0}`;
const newId = () => crypto.randomBytes(8).toString('hex');
const ID_RE = /^[a-f0-9]{16}$/;
// Coda per file: le modifiche (leggi -> cambia -> scrivi) sullo stesso file avvengono una alla volta,
// sempre sui dati appena riletti dal disco, così due utenti che scrivono insieme non si sovrascrivono.
const locks = new Map();
function withLock(key, fn) {
  const run = (locks.get(key) || Promise.resolve()).then(() => fn());
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}
// fn riceve i dati freschi; se restituisce un valore diverso da undefined viene scritto (atomicamente).
// opts.removeId: unica eccezione alla protezione anti-svuotamento dell'elenco personaggi (eliminazione esplicita di quell'id).
const mutateJSON = (f, def, fn, opts = {}) => withLock(f, () => {
  const cur = readJSONSafe(f, typeof def === 'function' ? def() : JSON.parse(JSON.stringify(def)));
  const before = Array.isArray(cur) ? cur.map((c) => c && c.id) : null;
  const next = fn(cur);
  if (next === undefined) return next;
  if (f === CHARS_FILE()) { guardChars(before, next, opts); maybeBackup('modifica'); }
  writeJSON(f, next);
  return next;
});
// Protezione: l'elenco dei personaggi non può perdere elementi, salvo l'eliminazione esplicita di UN id.
function guardChars(before, next, opts) {
  if (!Array.isArray(next)) throw Object.assign(new Error('Scrittura personaggi non valida (bloccata)'), { status: 500 });
  if (!before) return;
  const ids = new Set(next.map((c) => c && c.id));
  const lost = before.filter((id) => !ids.has(id));
  if (!lost.length || (lost.length === 1 && opts.removeId && lost[0] === opts.removeId)) return;
  console.error(`BLOCCATA scrittura di characters.json: avrebbe rimosso ${lost.length} personaggi (${lost.join(', ')}); prima ${before.length}, dopo ${next.length}`);
  throw Object.assign(new Error('Modifica bloccata: avrebbe cancellato dei personaggi'), { status: 500 });
}

// ---------- archivio CONDIVISO tra Nico e Luisa (personaggi, chat, memoria, avatar, Diario) ----------
const sharedDir = (...p) => { const d = path.join(DATA_DIR, 'shared', ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const CHARS_FILE = () => path.join(sharedDir(), 'characters.json');
const MEM_FILE = () => path.join(sharedDir(), 'memory.json');
const MIGRATION_MARK = () => path.join(sharedDir(), 'migration.json');

// ---------- sessioni ----------
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = readJSON(SESS_FILE, {});
const saveSessions = () => writeJSON(SESS_FILE, sessions);
function pruneSessions() { const now = Date.now(); for (const [k, s] of Object.entries(sessions)) if (s.exp < now) delete sessions[k]; saveSessions(); }
pruneSessions();
setInterval(pruneSessions, 60 * 60 * 1000).unref();

// ---------- consenso vocale (attivazione account, UNA sola volta) ----------
const consentFile = (u) => path.join(userDir(u), 'consent.json');
const getConsent = (u) => readJSON(consentFile(u), null);
const isActivated = (u) => !!(getConsent(u) || {}).activatedAt;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'");
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: '12mb' }));

function auth(req, res, next) {
  const s = sessions[req.cookies[COOKIE]];
  if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'Accesso richiesto' });
  req.user = s.user;
  next();
}
function requireActivated(req, res, next) {
  if (!isActivated(req.user)) return res.status(403).json({ error: 'Account non attivato: registra prima il consenso vocale.' });
  next();
}
// La chiave xAI arriva dal dispositivo: usata solo per questa richiesta, mai salvata.
function requireKey(req, res, next) {
  const k = String(req.get('X-AI-Key') || '').trim();
  if (!k || k.length > 300 || /\s/.test(k)) return res.status(400).json({ error: 'Chiave xAI mancante: inseriscila in Account su questo dispositivo.', code: 'NO_KEY' });
  req.aiKey = k;
  next();
}
// Protezione CSRF semplice: le richieste che modificano dati devono arrivare dalla nostra UI.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'app-privata') return res.status(403).json({ error: 'Richiesta non valida' });
  next();
});

// ---------- accesso con PIN ----------
const PINS_FILE = path.join(DATA_DIR, 'pins.json');
const getPins = () => readJSON(PINS_FILE, {});
const PIN_RE = /^\d{4}$/;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Troppi tentativi da questo dispositivo. Riprova tra 15 minuti.' },
});
// Blocco per profilo: dopo 5 PIN sbagliati blocco crescente (5, 10, 20… minuti, max 24 h)
const LOCK_FILE = path.join(DATA_DIR, 'lockout.json');
const lock = readJSON(LOCK_FILE, {});
const lockInfo = (u) => lock[u] || (lock[u] = { fails: 0, until: 0, level: 0 });
const DUMMY_HASH = bcrypt.hashSync('0000-dummy', 10);

function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { user, exp: Date.now() + SESSION_DAYS * 864e5, created: new Date().toISOString() };
  saveSessions();
  res.cookie(COOKIE, token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'strict', maxAge: SESSION_DAYS * 864e5, path: '/' });
}
app.get('/api/profiles', (req, res) => {
  const pins = getPins();
  res.json({ profiles: Object.entries(USERS).map(([id, u]) => ({ id, name: u.name, hasPin: !!pins[id] })), setupCode: !!SETUP_CODE });
});
// Primo avvio: ogni profilo imposta il proprio PIN UNA volta. Poi non si può più reimpostare dalla schermata di accesso.
app.post('/api/pin/setup', loginLimiter, (req, res) => {
  const user = USER_ALIASES[String(req.body.user || '').toLowerCase()];
  const pin = String(req.body.pin || '');
  if (!user) return res.status(400).json({ error: 'Profilo non valido' });
  if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'Il PIN deve avere 4 cifre' });
  if (SETUP_CODE && req.body.setupCode !== SETUP_CODE) return res.status(403).json({ error: 'Codice di configurazione errato' });
  const pins = getPins();
  if (pins[user]) return res.status(409).json({ error: 'PIN già impostato per questo profilo. Per reimpostarlo serve l\'amministratore (npm run reset-pin).' });
  pins[user] = { hash: bcrypt.hashSync(pin, 12), createdAt: new Date().toISOString() };
  writeJSON(PINS_FILE, pins);
  startSession(res, user);
  res.json({ ok: true, user, name: USERS[user].name, activated: isActivated(user) });
});
app.post('/api/login', loginLimiter, async (req, res) => {
  const user = USER_ALIASES[String(req.body.user || '').toLowerCase()];
  const pin = String(req.body.pin || '');
  const rec = user && getPins()[user];
  if (user) {
    const li = lockInfo(user);
    if (li.until > Date.now()) return res.status(429).json({ error: `Profilo bloccato per troppi PIN errati. Riprova tra ${Math.ceil((li.until - Date.now()) / 60000)} minuti.` });
  }
  const ok = await bcrypt.compare(pin, rec ? rec.hash : DUMMY_HASH);
  if (!user || !rec || !ok) {
    if (user && rec) {
      const li = lockInfo(user); li.fails += 1;
      if (li.fails >= 5) { li.level += 1; li.fails = 0; li.until = Date.now() + Math.min(24 * 60, 5 * 2 ** (li.level - 1)) * 60000; }
      writeJSON(LOCK_FILE, lock);
      return res.status(401).json({ error: li.until > Date.now() ? 'Troppi PIN errati: profilo bloccato temporaneamente.' : `PIN errato (${5 - li.fails} tentativi rimasti)` });
    }
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  lock[user] = { fails: 0, until: 0, level: 0 }; writeJSON(LOCK_FILE, lock);
  startSession(res, user);
  res.json({ ok: true, user, name: USERS[user].name, activated: isActivated(user) });
});

app.post('/api/logout', (req, res) => {
  delete sessions[req.cookies[COOKIE]]; saveSessions();
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user, name: USERS[req.user].name, activated: isActivated(req.user), consent: getConsent(req.user), adult: adultOn(req.user), adultChat: adultChat(), chatModel: CHAT_MODEL, imageModel: IMAGE_MODEL, videoModel: VIDEO_MODEL, videoEnabled: !!VIDEO_PATH });
});

// ---------- consenso vocale ----------
const CONSENT_PHRASE = (name) => `Io, ${name}, dichiaro di essere maggiorenne e do il mio consenso libero e consapevole a usare questa app privata con contenuti per adulti, solo tra adulti consenzienti.`;
app.get('/api/consent/phrase', auth, (req, res) => res.json({ phrase: CONSENT_PHRASE(USERS[req.user].name) }));

app.post('/api/consent', auth, express.raw({ type: ['audio/*', 'video/webm', 'video/mp4', 'application/octet-stream'], limit: '10mb' }), (req, res) => {
  if (isActivated(req.user)) return res.status(409).json({ error: 'Account già attivato.' });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: 'Registrazione audio mancante o troppo corta.' });
  const mime = (req.get('Content-Type') || 'audio/webm').split(';')[0].trim();
  const ext = /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
  const now = new Date();
  const file = `consenso-${now.toISOString().replace(/[:.]/g, '-')}.${ext}`;
  fs.writeFileSync(path.join(userDir(req.user, 'consent'), file), req.body);
  const rec = { activatedAt: now.toISOString(), file, mime, phrase: CONSENT_PHRASE(USERS[req.user].name), bytes: req.body.length };
  writeJSON(consentFile(req.user), rec);
  res.json({ ok: true, consent: rec });
});

app.get('/api/consent/audio', auth, (req, res) => {
  const c = getConsent(req.user);
  if (!c) return res.status(404).end();
  res.type(c.mime || 'audio/webm');
  res.sendFile(path.join(userDir(req.user, 'consent'), path.basename(c.file)));
});

// ---------- privacy (per utente): tutto OFF di default ----------
const settingsFile = (u) => path.join(userDir(u), 'settings.json');
const getSettings = (u) => { const s = { autoSave: false, allowExport: false, adultMode: false, videoModel: '', videoDuration: 6, ...readJSON(settingsFile(u), {}) }; delete s.drawerScene; return s; }; // drawerScene (vecchio comodino, rimosso): ignorato
// Modalità adulti: per utente, attivabile solo dopo il consenso vocale. In chat condivisa vale solo se attiva per ENTRAMBI.
const adultOn = (u) => isActivated(u) && getSettings(u).adultMode === true;
const adultChat = () => Object.keys(USERS).every(adultOn);
// Il vecchio "comodino con cassetto" è stato rimosso (v6): i suoi eventuali messaggi (initiative: 'drawer') restano nel file
// per compatibilità ma non vengono mai mostrati né passati all'IA.
const visibleMsg = (m) => m.initiative !== 'drawer';
app.get('/api/settings', auth, (req, res) => res.json(getSettings(req.user)));
app.put('/api/settings', auth, (req, res) => {
  if (req.body.adultMode === true && !isActivated(req.user)) return res.status(403).json({ error: 'La modalità adulti si attiva solo dopo il consenso vocale.' });
  const s = { autoSave: req.body.autoSave === true, allowExport: req.body.allowExport === true, adultMode: req.body.adultMode === true,
    videoModel: /^[\w.\-]{0,60}$/.test(req.body.videoModel || '') ? String(req.body.videoModel || '') : '',
    videoDuration: num(req.body.videoDuration, 1, 15, 6) };
  writeJSON(settingsFile(req.user), s); res.json(s);
});
// ---------- parola chiave per attivare la modalità adulti (per profilo, facoltativa) ----------
// Salvata solo come hash bcrypt (users/<u>/adult-keyword.json). Il confronto avviene sul server, prima di qualunque chiamata all'IA:
// il messaggio con la parola chiave non viene salvato in chat né inviato a xAI. Poi serve la conferma "sì" (token valido 2 minuti).
const kwFile = (u) => path.join(userDir(u), 'adult-keyword.json');
const normKw = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const kwTokens = new Map(); // token -> { user, exp }
async function keywordMatch(u, text) {
  const rec = readJSON(kwFile(u), null); const t = normKw(text);
  if (!rec || !rec.hash || !t || t.length > 80) return null;
  if (!(await bcrypt.compare(t, rec.hash))) return null;
  const token = crypto.randomBytes(12).toString('hex'); kwTokens.set(token, { user: u, exp: Date.now() + 120e3 });
  return token;
}
app.get('/api/adult-keyword', auth, (req, res) => { const r = readJSON(kwFile(req.user), null); res.json({ set: !!(r && r.hash), updatedAt: r ? r.updatedAt : null }); });
app.put('/api/adult-keyword', auth, (req, res) => {
  const t = normKw(req.body.keyword);
  if (!t) { fs.rmSync(kwFile(req.user), { force: true }); return res.json({ set: false }); }
  if (t.length < 4 || t.length > 60) return res.status(400).json({ error: 'La parola chiave deve avere da 4 a 60 caratteri.' });
  writeJSON(kwFile(req.user), { hash: bcrypt.hashSync(t, 10), updatedAt: new Date().toISOString() }); res.json({ set: true });
});
// Controllo della sola parola chiave (es. dettatura vocale fuori dalla chat). Risponde solo sì/no + token.
app.post('/api/adult-keyword/check', auth, async (req, res) => { const token = await keywordMatch(req.user, req.body.text); res.json(token ? { match: true, token } : { match: false }); });
app.post('/api/adult-keyword/confirm', auth, (req, res) => {
  const tk = kwTokens.get(String(req.body.token || '')); kwTokens.delete(String(req.body.token || ''));
  if (!tk || tk.user !== req.user || tk.exp < Date.now()) return res.status(400).json({ error: 'Conferma scaduta: ripeti la parola chiave.' });
  const yes = /^(si|s|yes|certo|ok|confermo)\b/.test(normKw(req.body.answer));
  if (!yes) return res.json({ ok: true, adultMode: getSettings(req.user).adultMode === true, changed: false });
  if (!isActivated(req.user)) return res.status(403).json({ error: 'La modalità adulti si attiva solo dopo il consenso vocale.' });
  const s = { ...getSettings(req.user), adultMode: true }; writeJSON(settingsFile(req.user), s);
  console.log(`Modalità adulti attivata con parola chiave da ${req.user}`);
  res.json({ ok: true, adultMode: true, changed: true, adultChat: adultChat() });
});
setInterval(() => { const now = Date.now(); for (const [k, v] of kwTokens) if (v.exp < now) kwTokens.delete(k); }, 300e3).unref();

// Contenuti generati NON salvati: restano solo in memoria (RAM del server) per la sessione, max 12 ore.
const pending = new Map(); // id -> { user, buf, jpg, kind, prompt, at }
function addPending(user, kind, gen, prompt) {
  const id = newId();
  pending.set(id, { user, buf: gen.buf, jpg: gen.jpg, kind, prompt, at: Date.now() });
  return { pending: id, dataUrl: `data:image/${gen.jpg ? 'jpeg' : 'png'};base64,${gen.buf.toString('base64')}` };
}
const takePending = (user, id, kind) => { const p = pending.get(id); return p && p.user === user && (!kind || p.kind === kind) ? p : null; };
setInterval(() => { const lim = Date.now() - 12 * 3600e3; for (const [k, v] of pending) if (v.at < lim) pending.delete(k); }, 600e3).unref();
// Scaricamento consentito solo se l'utente ha attivato "Consenti esportazione/condivisione"
function sendPrivateFile(req, res, file) {
  if (req.query.download) {
    if (!getSettings(req.user).allowExport) return res.status(403).json({ error: 'Esportazione disattivata nelle impostazioni privacy.' });
    res.attachment(path.basename(file));
  }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
}

// ---------- "Le mie regole" (per utente) ----------
const rulesFile = (u) => path.join(userDir(u), 'rules.json');
const getRules = (u) => readJSON(rulesFile(u), { text: '', updatedAt: null });
app.get('/api/rules', auth, (req, res) => res.json(getRules(req.user)));
app.put('/api/rules', auth, (req, res) => {
  const r = { text: String(req.body.text || '').slice(0, 10000), updatedAt: new Date().toISOString() };
  writeJSON(rulesFile(req.user), r); res.json(r);
});

// ---------- memoria CONDIVISA (di coppia, la vede e la usa anche l'IA) ----------
const getMem = () => readJSON(MEM_FILE(), []);
const cleanFact = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300);
const AUTHOR_OK = (v) => (USERS[v] || v === 'auto' ? v : null);
const memView = (list) => { const names = new Map((readJSON(CHARS_FILE(), []) || []).map((c) => [c.id, c.name]));
  return list.map((m) => ({ ...m, byName: m.source === 'base' ? `base · ${names.get(m.charId) || 'personaggio'}` : m.by && USERS[m.by] ? USERS[m.by].name : m.by === 'auto' ? 'automatico' : '' })); };
app.get('/api/memory', auth, (req, res) => { res.setHeader('X-Version', fileRev(MEM_FILE())); res.json(memView(getMem())); });
// Sostituisce l'intera lista (modifica/cancella dalla schermata Account)
app.put('/api/memory', auth, async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Formato non valido' });
  const now = new Date().toISOString();
  const list = await mutateJSON(MEM_FILE(), [], (old) => {
    const byId = new Map(old.map((f) => [f.id, f]));
    return req.body.slice(0, 300).map((f) => {
      const prev = byId.get(f.id) || {};
      const text = cleanFact(f.text);
      return { id: ID_RE.test(f.id) ? f.id : newId(), text, source: ['auto', 'base'].includes(prev.source || f.source) ? (prev.source || f.source) : 'manuale', ...(prev.charId || f.charId ? { charId: prev.charId || f.charId } : {}),
        by: AUTHOR_OK(prev.by || f.by) || req.user, createdAt: prev.createdAt || f.createdAt || now,
        ...(prev.text && prev.text !== text ? { editedBy: req.user, editedAt: now } : prev.editedBy ? { editedBy: prev.editedBy, editedAt: prev.editedAt } : {}) };
    }).filter((f) => f.text);
  });
  res.json(memView(list));
});
app.post('/api/memory', auth, async (req, res) => {
  const text = cleanFact(req.body.text);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const f = { id: newId(), text, source: 'manuale', by: req.user, createdAt: new Date().toISOString() };
  await mutateJSON(MEM_FILE(), [], (list) => [...list, f].slice(-300));
  res.json(memView([f])[0]);
});
app.delete('/api/memory', auth, async (req, res) => { await mutateJSON(MEM_FILE(), [], () => []); res.json({ ok: true }); });
// Modifica / elimina un solo ricordo (non tocca quelli aggiunti nel frattempo dall'altro profilo)
app.patch('/api/memory/:id', auth, async (req, res) => {
  const text = cleanFact(req.body.text); let found = null;
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  await mutateJSON(MEM_FILE(), [], (list) => { const f = list.find((x) => x.id === req.params.id); if (!f) return undefined; Object.assign(f, { text, editedBy: req.user, editedAt: new Date().toISOString() }); found = f; return list; });
  if (!found) return res.status(404).json({ error: 'Ricordo non trovato' });
  res.json(memView([found])[0]);
});
app.delete('/api/memory/:id', auth, async (req, res) => {
  await mutateJSON(MEM_FILE(), [], (list) => list.filter((x) => x.id !== req.params.id)); res.json({ ok: true });
});

// Note personali (facoltative, solo per chi le scrive). Vanno all'IA solo se l'utente lo sceglie, e solo quando scrive lui/lei.
const notesFile = (u) => path.join(userDir(u), 'notes.json');
const getNotes = (u) => ({ text: '', toAI: false, updatedAt: null, ...readJSON(notesFile(u), {}) });
app.get('/api/notes', auth, (req, res) => res.json(getNotes(req.user)));
app.put('/api/notes', auth, (req, res) => {
  const n = { text: String(req.body.text || '').slice(0, 5000), toAI: req.body.toAI === true, updatedAt: new Date().toISOString() };
  writeJSON(notesFile(req.user), n); res.json(n);
});

// Estrazione automatica: chiede al modello nuovi fatti brevi dagli ultimi messaggi della chat condivisa.
app.post('/api/memory/extract', auth, requireActivated, requireKey, async (req, res) => {
  const id = String(req.body.characterId || '');
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const recent = readChat(id).messages.filter(visibleMsg).slice(-12);
  if (!recent.length) return res.json({ added: [] });
  const mem = getMem();
  const prompt = `Analizza la conversazione (condivisa tra Nico e Luisa) e individua NUOVE informazioni durature su Nico, su Luisa o sulla coppia: preferenze, gusti, argomenti ricorrenti, cose da ricordare. Indica sempre a chi si riferisce il fatto (es. "Luisa ama…", "Nico preferisce…").
Non ripetere fatti già noti. Ignora dettagli momentanei. Niente dati su minori o atti illegali.
Fatti già noti:
${mem.map((m) => '- ' + m.text).join('\n') || '(nessuno)'}

Conversazione:
${recent.map((m) => authorLabel(m) + ': ' + m.content.slice(0, 1500)).join('\n')}

Rispondi SOLO con un array JSON di stringhe brevi in italiano (max 5, ognuna max 120 caratteri), oppure [] se non c'è nulla di nuovo.`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey),
      body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.2, messages: [{ role: 'system', content: BASE_RULE }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: aiErrorMsg(r.status, await r.json().catch(() => ({}))) });
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content || '[]';
    let facts = [];
    try { facts = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)); } catch {}
    let added = [];
    await mutateJSON(MEM_FILE(), [], (cur) => { // riletta ora: dedup anche se l'altro dispositivo ha estratto nel frattempo
      const known = new Set(cur.map((m) => m.text.toLowerCase()));
      added = (Array.isArray(facts) ? facts : []).map(cleanFact).filter((t) => t && !known.has(t.toLowerCase()) && known.add(t.toLowerCase())).slice(0, 5)
        .map((text) => ({ id: newId(), text, source: 'auto', by: 'auto', createdAt: new Date().toISOString() }));
      return added.length ? [...cur, ...added].slice(-300) : undefined;
    });
    res.json({ added: memView(added) });
  } catch (e) {
    console.error('Errore estrazione memoria:', e.message);
    res.status(502).json({ error: 'Servizio AI non raggiungibile' });
  }
});

// ---------- aspetto, identità, guardaroba, cambi automatici ----------
// Termini che suggeriscono minore età: rifiutati lato server in OGNI testo usato per generare immagini.
const YOUTH_RE = /\b(teen\w*|adolescen\w*|minor(e|i|enne|enni)?|child\w*|kid(s|dy)?|loli\w*|shota\w*|underage|schoolgirl\w*|schoolboy\w*|school ?uniform|bambin[aoie]\w*|ragazzin[aoie]\w*|fanciull\w*|scolar\w*|liceal[ei]|giovanissim[aoie]|preteen|young(er|est)? (girl|boy)|little (girl|boy)|baby ?face|childlike|infantil\w*|puerile|youthful|jailbait|1[0-7] ?(yo|anni|years?))\b/i;
const hasYouth = (t) => YOUTH_RE.test(String(t || ''));
const safeText = (t, max) => (hasYouth(t) ? '' : String(t || '').replace(/\s+/g, ' ').trim().slice(0, max));
const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

const OPT = {
  gender: ['donna', 'uomo', 'persona non binaria'],
  build: ['esile', 'snella', 'atletica', 'morbida', 'formosa', 'muscolosa', 'robusta'], // ordinate: le derive automatiche si muovono di 1 passo
  shape: ['clessidra', 'pera', 'mela', 'rettangolo', 'triangolo invertito'],
  proportions: ['equilibrate', 'gambe lunghe', 'busto lungo', 'spalle larghe', 'fianchi larghi'],
  framing: ['ritratto', 'mezzo busto', 'figura intera'],
  cut: ['scalato', 'pari', 'caschetto', 'pixie', 'shag', 'con frangia', 'undercut'],
  length: ['cortissimi', 'corti', 'al mento', 'alle spalle', 'lunghi', 'molto lunghi'],
  hairColor: ['nero', 'castano scuro', 'castano', 'castano chiaro', 'biondo miele', 'biondo platino', 'ramato', 'rosso', 'grigio argento', 'balayage caramello'],
  hairStyle: ['sciolti lisci', 'mosse morbide', 'onde voluminose', 'coda alta', 'treccia laterale', 'chignon morbido', 'raccolti bassi'],
  makeup: ['acqua e sapone', 'naturale', 'leggero', 'serata', 'intenso'],
  outfit: ['casual', 'elegante', 'sportivo', 'notte'],
};
const EN = {
  donna: 'woman', uomo: 'man', 'persona non binaria': 'androgynous person',
  esile: 'slender', snella: 'slim', atletica: 'athletic', morbida: 'soft, curvy', formosa: 'voluptuous', muscolosa: 'muscular', robusta: 'sturdy, full-figured',
  clessidra: 'hourglass', pera: 'pear-shaped', mela: 'apple-shaped', rettangolo: 'straight', 'triangolo invertito': 'inverted triangle',
  equilibrate: 'balanced proportions', 'gambe lunghe': 'long legs', 'busto lungo': 'long torso', 'spalle larghe': 'broad shoulders', 'fianchi larghi': 'wide hips',
  ritratto: 'head-and-shoulders portrait', 'mezzo busto': 'half-body shot from the waist up', 'figura intera': 'full-body shot, head to toe',
  scalato: 'layered cut', pari: 'blunt one-length cut', caschetto: 'bob cut', pixie: 'pixie cut', shag: 'shag cut', 'con frangia': 'cut with bangs', undercut: 'undercut',
  cortissimi: 'very short', corti: 'short', 'al mento': 'chin-length', 'alle spalle': 'shoulder-length', lunghi: 'long', 'molto lunghi': 'very long',
  nero: 'black', 'castano scuro': 'dark brown', castano: 'brown', 'castano chiaro': 'light brown', 'biondo miele': 'honey blonde', 'biondo platino': 'platinum blonde',
  ramato: 'copper', rosso: 'red', 'grigio argento': 'silver grey', 'balayage caramello': 'caramel balayage',
  'sciolti lisci': 'worn down and straight', 'mosse morbide': 'soft waves', 'onde voluminose': 'voluminous waves', 'coda alta': 'high ponytail',
  'treccia laterale': 'side braid', 'chignon morbido': 'loose bun', 'raccolti bassi': 'low updo',
  'acqua e sapone': 'no makeup', naturale: 'natural makeup', leggero: 'light makeup', serata: 'evening makeup', intenso: 'bold glamorous makeup',
  casual: 'casual everyday outfit (jeans and a nice top)', elegante: 'elegant evening dress or tailored outfit', sportivo: 'sporty athleisure outfit', notte: 'tasteful silk nightwear',
};

function cleanAppearance(a = {}) {
  const c = a.colors || {};
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    gender: pick(a.gender, OPT.gender, 'donna'),
    age: num(a.age, 25, 80, 30), // mai sotto i 25 anni
    build: pick(a.build, OPT.build, 'snella'),
    shape: pick(a.shape, OPT.shape, 'clessidra'),
    proportions: pick(a.proportions, OPT.proportions, 'equilibrate'),
    height: num(a.height, 150, 200, 168),
    framing: pick(a.framing, OPT.framing, 'ritratto'),
    colors: { // applicati all'istante sul canvas, senza rigenerare
      hue: num(c.hue, -180, 180, 0), saturation: num(c.saturation, 0, 200, 100),
      brightness: num(c.brightness, 50, 150, 100), background: hex(c.background, '#2b1530'), glow: hex(c.glow, '#d14b8f'),
    },
  };
}
function cleanLook(l = {}) {
  return {
    cut: pick(l.cut, OPT.cut, 'scalato'), length: pick(l.length, OPT.length, 'lunghi'), hairColor: pick(l.hairColor, OPT.hairColor, 'castano'), hairStyle: pick(l.hairStyle, OPT.hairStyle, 'mosse morbide'),
    makeup: pick(l.makeup, OPT.makeup, 'naturale'), outfit: pick(l.outfit, OPT.outfit, 'casual'),
    custom: safeText(l.custom, 300),
  };
}
function cleanIdentity(i = {}, prev = {}) {
  return {
    core: safeText(i.core, 600), // descrizione fissa del volto
    seed: Number.isInteger(prev.seed) ? prev.seed : crypto.randomInt(1, 2 ** 31 - 1), // ancora fissa, non cambia mai
    refAvatar: typeof i.refAvatar === 'string' && i.refAvatar.startsWith('/api/avatars/') ? i.refAvatar : (prev.refAvatar || null),
    locked: !!i.locked,
  };
}
function cleanAuto(a = {}, prev = {}) {
  const b = OPT.build;
  return {
    enabled: !!a.enabled, everyDays: num(a.everyDays, 1, 30, 1),
    bodyDrift: !!a.bodyDrift, // piccole variazioni del corpo, solo dentro i limiti
    buildMin: pick(a.buildMin, b, 'esile'), buildMax: pick(a.buildMax, b, 'robusta'),
    lastAt: prev.lastAt || null,
  };
}
// Prompt sempre ancorato all'identità base + adulto 25+ realistico (imposto qui, lato server).
function buildImagePrompt(ch, extra) {
  const a = ch.appearance, l = ch.look, id = ch.identity;
  return [
    `Photorealistic, realistic photograph. Recurring invented adult character (identity anchor #${id.seed}): the SAME person in every image, same face, same facial features.`,
    `A fictional adult ${EN[a.gender]}, clearly ${a.age} years old (adult, at least 25), mature adult features; not a real or famous person.`,
    id.core && `Fixed face/identity: ${id.core}.`,
    `${EN[a.framing]}, front-facing, looking at the camera, eyes open, mouth closed, neutral background, soft natural light.`,
    a.framing !== 'ritratto' && `Body: ${EN[a.build]} build, ${EN[a.shape]} body shape, ${EN[a.proportions]}, height about ${a.height} cm.`,
    `Hair: ${EN[l.length]} ${EN[l.hairColor]} hair, ${EN[l.cut]}, ${EN[l.hairStyle]}. Makeup: ${EN[l.makeup]}. Outfit: ${EN[l.outfit]}.`,
    l.custom && `Look details: ${l.custom}.`,
    extra && !hasYouth(extra) && `Notes: ${String(extra).slice(0, 300)}.`,
  ].filter(Boolean).join(' ');
}

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const pt = (p, dx, dy) => ({ x: clamp01(p && p.x != null ? p.x : dx), y: clamp01(p && p.y != null ? p.y : dy) });
const avatarDir = () => sharedDir('avatars'); // avatar condivisi: data/shared/avatars
const AV_RE = /^\/api\/avatars\/([a-f0-9]{16}\.(png|jpg))$/;
function saveAvatarBuffer(u, buf) {
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const file = `${newId()}.${jpg ? 'jpg' : 'png'}`;
  fs.writeFileSync(path.join(avatarDir(u), file), buf);
  return `/api/avatars/${file}`;
}

function cleanChar(u, b, prev = {}) {
  let avatar = String(b.avatar || '🙂');
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new Error('Il nome è obbligatorio');
  let avatarSource = b.avatarSource === 'ai' ? 'ai' : b.avatarSource === 'upload' ? 'upload' : 'emoji';
  let avatarConsent = prev.avatarConsent || null;
  const pend = b.pendingId ? takePending(u, String(b.pendingId), 'avatar') : null;
  if (avatar.startsWith('data:') && pend) { // anteprima generata dall'IA, salvata ora su richiesta
    avatar = saveAvatarBuffer(u, pend.buf); pending.delete(String(b.pendingId)); avatarSource = 'ai';
  } else if (avatar.startsWith('data:')) { // nuova foto caricata dal dispositivo
    const m = avatar.match(/^data:image\/(png|jpeg|webp|gif);base64,(.+)$/);
    if (!m) throw new Error('Avatar non valido');
    if (avatar.length > 2_500_000) throw new Error('Immagine avatar troppo grande');
    if (b.avatarConsent !== true) throw new Error('Per caricare una foto devi spuntare la dichiarazione di consenso.');
    avatar = saveAvatarBuffer(u, Buffer.from(m[2], 'base64'));
    avatarSource = 'upload'; avatarConsent = { confirmed: true, at: new Date().toISOString() };
  } else if (AV_RE.test(avatar)) {
    if (!fs.existsSync(avatarPath(avatar.match(AV_RE)[1]))) throw new Error('Immagine avatar non trovata');
    if (avatarSource === 'emoji') avatarSource = prev.avatarSource || 'ai';
  } else { avatar = [...avatar].slice(0, 4).join(''); avatarSource = 'emoji'; }
  const lm = b.landmarks || prev.landmarks || {};
  const appearance = cleanAppearance(b.appearance || prev.appearance);
  const look = cleanLook(b.look || prev.look);
  const wardrobe = (Array.isArray(b.wardrobe) ? b.wardrobe : prev.wardrobe || []).slice(0, 40)
    .map((w) => ({ id: ID_RE.test(w.id) ? w.id : newId(), name: safeText(w.name, 40) || 'Look', look: cleanLook(w.look) }));
  return {
    name, avatar, avatarSource, avatarConsent,
    landmarks: { eyeL: pt(lm.eyeL, 0.38, 0.42), eyeR: pt(lm.eyeR, 0.62, 0.42), mouth: pt(lm.mouth, 0.5, 0.7) },
    appearance, look, wardrobe,
    identity: cleanIdentity(b.identity || prev.identity, prev.identity || {}),
    autoChanges: cleanAuto(b.autoChanges || prev.autoChanges, prev.autoChanges || {}),
    personality: String(b.personality || '').slice(0, 8000), style: String(b.style || '').slice(0, 2000),
    state: b.resetState ? defaultState() : (prev.state || defaultState()), // stato evolutivo: lo aggiorna solo il server
    memorySeededAt: prev.memorySeededAt || null,
    scenes: cleanScenes(prev.scenes), // immagini "scena" a figura intera per stanza: le aggiorna solo il server
  };
}
// ---------- scena cinematografica: versione a figura intera del personaggio in una stanza ----------
const SCENE_ROOMS = {
  salotto: 'sitting relaxed on a comfortable sofa in a warm, cozy living room in the evening, soft warm lamp light, plants and a rug',
  camera: 'sitting on the edge of a neatly made bed in a tasteful, softly lit bedroom, warm bedside lamp light',
  terrazza: 'sitting on an outdoor sofa on an elegant terrace at sunset, city lights and sky in the background, string lights',
};
function cleanScenes(sc) {
  const out = {};
  for (const k of Object.keys(SCENE_ROOMS)) {
    const v = sc && sc[k]; if (!v || !AV_RE.test(String(v.url || ''))) continue;
    const lm = v.landmarks;
    // coordinate nello spazio del quadrato centrale dell'immagine 16:9: possono uscire da 0..1 in orizzontale
    const q = (p) => (p && Number.isFinite(+p.x) && Number.isFinite(+p.y) ? { x: Math.min(2, Math.max(-1, +p.x)), y: Math.min(2, Math.max(-1, +p.y)) } : null);
    const L = lm && { eyeL: q(lm.eyeL), eyeR: q(lm.eyeR), mouth: q(lm.mouth) };
    out[k] = { url: v.url, at: v.at || null, landmarks: L && L.eyeL && L.eyeR && L.mouth ? L : null };
  }
  return out;
}
function buildScenePrompt(ch, room) {
  const a = ch.appearance, l = ch.look, id = ch.identity;
  return [
    `Cinematic photorealistic film still, wide 16:9 shot. Recurring invented adult character (identity anchor #${id.seed}): the SAME person in every image, same face, same facial features.`,
    `A fictional adult ${EN[a.gender]}, clearly ${a.age} years old (adult, at least 25), mature adult features; not a real or famous person.`,
    id.core && `Fixed face/identity: ${id.core}.`,
    `Full-body shot: the WHOLE body visible from head to feet, nothing cut off, with some space above the head and below the feet, person centered in the frame, ${SCENE_ROOMS[room]}.`,
    `Face clearly visible, turned towards the camera, eyes open, mouth closed, relaxed natural pose. Cinematic lighting, shallow depth of field, warm color grading.`,
    `Body: ${EN[a.build]} build, ${EN[a.shape]} body shape, ${EN[a.proportions]}, height about ${a.height} cm.`,
    `Hair: ${EN[l.length]} ${EN[l.hairColor]} hair, ${EN[l.cut]}, ${EN[l.hairStyle]}. Makeup: ${EN[l.makeup]}. Outfit: ${EN[l.outfit]}.`,
    l.custom && `Look details: ${l.custom}.`,
  ].filter(Boolean).join(' ');
}
function defaultState() { return { mood: 'serena', relationship: 'all\'inizio, curiosa di conoscerti', traits: [], grudges: [], notes: '', updatedAt: null }; }
// Se l'immagine cambia, il look precedente va nello storico (per poter tornare indietro).
function pushHistory(prev, next, reason) {
  const hist = Array.isArray(prev.lookHistory) ? prev.lookHistory : [];
  if (prev.avatar && prev.avatar !== next.avatar && AV_RE.test(prev.avatar)) {
    hist.unshift({ id: newId(), at: new Date().toISOString(), avatar: prev.avatar, appearance: prev.appearance, look: prev.look, landmarks: prev.landmarks, reason: reason || 'modifica' });
  }
  return hist.slice(0, 40);
}

// Personaggi CONDIVISI: un solo elenco per Nico e Luisa (data/shared/characters.json).
const DEFAULT_CHAR = { name: 'Aurora', avatar: '🌙', personality: 'Sei Aurora, una compagna di conversazione affascinante, ironica e complice. Ascolti, fai domande e ti adatti ai desideri di chi ti scrive.', style: 'Tono caldo e giocoso, frasi brevi, qualche emoji.' };
function getChars(u) {
  let c = readJSONSafe(CHARS_FILE(), null); // illeggibile -> errore (mai rimpiazzato da Aurora)
  if (!Array.isArray(c) && c !== null) throw Object.assign(new Error('Archivio personaggi non valido'), { status: 503 });
  if (!c) {
    c = [{ id: newId(), ...cleanChar(u, DEFAULT_CHAR), lookHistory: [], createdAt: new Date().toISOString() }];
    writeJSON(CHARS_FILE(), c);
  }
  return c;
}
const notFound = () => { const e = new Error('Personaggio non trovato'); e.status = 404; return e; };
// Modifica serializzata: rilegge l'elenco aggiornato, applica le modifiche, salva in modo atomico.
async function updateChar(u, id, body, reason) {
  getChars(u);
  let out;
  await mutateJSON(CHARS_FILE(), [], (list) => {
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) throw notFound();
    const next = { ...list[i], ...cleanChar(u, typeof body === 'function' ? body(list[i]) : body, list[i]), updatedAt: new Date().toISOString(), updatedBy: u };
    next.lookHistory = pushHistory(list[i], next, reason);
    if (!next.identity.refAvatar && AV_RE.test(next.avatar) && next.avatarSource === 'ai') next.identity.refAvatar = next.avatar;
    list[i] = next; out = next; return list;
  });
  return out;
}
// Modifica di campi interni (stato emotivo, lastAt dei cambi automatici) senza passare da cleanChar.
async function patchChar(id, fn) {
  let out;
  await mutateJSON(CHARS_FILE(), [], (list) => {
    const c = list.find((x) => x.id === id); if (!c) throw notFound();
    const r = fn(c); if (r === false) return undefined;
    out = c; return list;
  });
  return out;
}

// ---------- memoria BASE del personaggio (contesto di partenza, modificabile/cancellabile) ----------
// Generata SOLO dai campi dell'editor del personaggio + valori predefiniti italiani. Nessun dato personale preso altrove.
// Elementi con source 'base' e charId; creati una volta per personaggio (flag memorySeededAt) se ha meno di 5 ricordi.
const BASE_MIN = 5;
function baseFacts(ch) {
  const a = ch.appearance || {}, l = ch.look || {};
  const lady = a.gender === 'uomo' ? 'un uomo' : a.gender === 'persona non binaria' ? 'una persona' : 'una donna';
  const pers = String(ch.personality || '').replace(/\s+/g, ' ').trim();
  const style = String(ch.style || '').replace(/\s+/g, ' ').trim();
  return [
    `Gli utenti sono due: Nico (Nicola) e Luisa, una coppia, entrambi adulti. Sono le uniche persone reali con cui ${ch.name} parla.`,
    `${ch.name} riconosce chi scrive dal prefisso del messaggio ("Nico:" o "Luisa:"), si rivolge a quella persona per nome e saluta per nome chi è appena arrivato in chat.`,
    `${ch.name} è ${lady} adulta di fantasia di ${num(a.age, 25, 80, 30)} anni (sempre 25+), compagna di conversazione di Nico e Luisa nella loro chat di coppia condivisa.`,
    pers ? `Carattere di ${ch.name}: ${pers.slice(0, 220)}` : `Carattere di ${ch.name}: solare, ironica, curiosa e complice; ascolta molto e fa domande.`,
    style ? `Modo di parlare di ${ch.name}: ${style.slice(0, 200)}` : `Modo di parlare di ${ch.name}: tono caldo e informale in italiano, frasi brevi, qualche emoji.`,
    `Storia (inventata) di ${ch.name}: è cresciuta in una cittadina italiana di mare, ama viaggiare e oggi vive in città; i suoi ricordi sono tutti di fantasia.`,
    `Gusti di ${ch.name}: buona cucina italiana, musica, film, passeggiate al tramonto e lunghe chiacchierate con Nico e Luisa.`,
    a.build && l.hairColor ? `Aspetto di ${ch.name}: corporatura ${a.build}, capelli ${l.length || ''} ${l.hairColor} (${l.hairStyle || 'naturali'}), trucco ${l.makeup || 'naturale'}, stile ${l.outfit || 'casual'}.`.replace(/\s+/g, ' ') : null,
    `Relazione: ${ch.name} tratta Nico e Luisa con complicità, rispetto e affetto, li coinvolge entrambi e non li mette mai uno contro l'altra.`,
  ].filter(Boolean).map(cleanFact);
}
// force = true: rigenera (sostituisce i vecchi elementi base di quel personaggio)
async function seedBaseMemory(ch, force = false) {
  if (!ch || (!force && ch.memorySeededAt)) return { added: [] };
  let added = [];
  await mutateJSON(MEM_FILE(), [], (list) => {
    const mineCount = list.filter((m) => m.charId === ch.id).length;
    if (!force && mineCount >= BASE_MIN) return undefined;
    const keep = force ? list.filter((m) => !(m.charId === ch.id && m.source === 'base')) : list;
    const known = new Set(keep.map((m) => m.text.toLowerCase()));
    added = baseFacts(ch).filter((t) => !known.has(t.toLowerCase())).map((text) => ({ id: newId(), text, source: 'base', charId: ch.id, by: 'auto', createdAt: new Date().toISOString() }));
    return [...keep, ...added].slice(-300);
  });
  await patchChar(ch.id, (c) => { c.memorySeededAt = new Date().toISOString(); }).catch(() => {});
  return { added };
}
app.post('/api/characters/:id/memory-base', auth, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const r = await seedBaseMemory(ch, true);
  res.json({ added: memView(r.added) });
});

app.get('/api/characters', auth, (req, res) => {
  const list = getChars(req.user).map(({ drawer, ...c }) => ({ ...c, scenes: cleanScenes(c.scenes), actions: visibleActions(c), adultActionsOk: aiFace(c) })); // il vecchio campo del comodino non viene esposto
  res.setHeader('X-Version', fileRev(CHARS_FILE())); res.json(list);
});
app.get('/api/characters/options', auth, (req, res) => res.json(OPT));
app.post('/api/characters', auth, async (req, res) => {
  try {
    getChars(req.user);
    const c = { id: newId(), ...cleanChar(req.user, req.body), lookHistory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: req.user, updatedBy: req.user };
    await mutateJSON(CHARS_FILE(), [], (list) => [...list, c]);
    await seedBaseMemory(c);
    res.json(c);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/characters/:id', auth, async (req, res) => {
  try { res.json(await updateChar(req.user, req.params.id, req.body, req.body.reason === 'ripristino' ? 'prima del ripristino' : 'modifica')); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.delete('/api/characters/:id', auth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
    const ch = getChars(req.user).find((c) => c.id === id);
    if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
    backupShared('prima-eliminazione'); // copia completa (personaggio + chat) prima di eliminare
    await mutateJSON(CHARS_FILE(), [], (list) => list.filter((c) => c.id !== id), { removeId: id });
    const msgs = readChat(id).messages.length;
    await withLock(chatFile(id), () => fs.rmSync(chatFile(id), { force: true }));
    audit(req.user, 'elimina-personaggio', { id, name: ch.name, messages: msgs });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/api/avatars/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  if (!/^[a-f0-9]{16}\.(png|jpg)$/.test(f)) return res.status(400).end();
  sendPrivateFile(req, res, avatarPath(f));
});
// Percorso di un avatar: archivio condiviso, con riserva sulle vecchie cartelle per utente (prima della migrazione).
function avatarPath(f) {
  const p = path.join(avatarDir(), f);
  if (fs.existsSync(p)) return p;
  for (const u of Object.keys(USERS)) { const old = path.join(DATA_DIR, 'users', u, 'avatars', f); if (fs.existsSync(old)) return old; }
  return p;
}

const ASPECTS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'];
async function generateImage(key, prompt, adult = false, aspect = null) {
  const r = await fetch(`${AI_BASE_URL}/images/generations`, {
    method: 'POST', headers: aiHeaders(key),
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: imgPrefix(adult) + prompt, n: 1, response_format: 'b64_json', ...(ASPECTS.includes(aspect) ? { aspect_ratio: aspect } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Errore AI immagini: HTTP', r.status); // mai loggare la chiave
    throw new Error(aiErrorMsg(r.status, j));
  }
  const item = j.data?.[0] || {};
  let buf;
  if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
  else if (item.url) buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  else throw new Error('Nessuna immagine ricevuta');
  return { buf, revised: item.revised_prompt || null, jpg: buf[0] === 0xff && buf[1] === 0xd8 };
}

// Modifica immagine con una o più immagini sorgente (xAI /images/edits, JSON).
async function editImage(key, prompt, dataUrls, adult = false, aspect = null) {
  const body = { model: IMAGE_EDIT_MODEL, prompt: imgPrefix(adult) + prompt, response_format: 'b64_json', ...(ASPECTS.includes(aspect) ? { aspect_ratio: aspect } : {}) };
  if (dataUrls.length === 1) body.image = { url: dataUrls[0], type: 'image_url' };
  else body.images = dataUrls.map((u) => ({ url: u, type: 'image_url' })); // multi-immagine (max 5)
  const r = await fetch(`${AI_BASE_URL}/images/edits`, { method: 'POST', headers: aiHeaders(key), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Errore AI modifica immagine: HTTP', r.status); throw new Error(aiErrorMsg(r.status, j)); }
  const item = j.data?.[0] || {};
  const buf = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
  if (!buf) throw new Error('Nessuna immagine ricevuta');
  return { buf, jpg: buf[0] === 0xff && buf[1] === 0xd8 };
}
const fileToDataUrl = (f) => { const b = fs.readFileSync(f); return `data:image/${b[0] === 0xff ? 'jpeg' : 'png'};base64,${b.toString('base64')}`; };
// Identità stabile: se esiste un'immagine di riferimento la usiamo come sorgente (image edit), altrimenti testo + ancore.
async function generateAnchored(user, key, ch, extra) {
  const ref = ch.identity && ch.identity.refAvatar && ch.identity.refAvatar.match(AV_RE);
  const refFile = ref && avatarPath(ref[1]);
  const prompt = buildImagePrompt(ch, extra);
  if (refFile && fs.existsSync(refFile)) {
    try { return await editImage(key, `Keep exactly the same person, same face and identity as in the reference image. ${prompt}`, [fileToDataUrl(refFile)], adultOn(user)); }
    catch (e) { console.error('Edit con riferimento non riuscito, uso generazione:', e.message); if (e.message === 'Contenuto rifiutato dal servizio AI') throw e; }
  }
  return generateImage(key, prompt, adultOn(user));
}

// Rigenera l'avatar di un personaggio (corpo, guardaroba, look) ancorato all'identità base.
// body: { appearance?, look?, identity?, prompt?, reason? }  -> salva e restituisce il personaggio aggiornato
app.post('/api/characters/:id/regenerate', auth, requireActivated, requireKey, async (req, res) => {
  const list = getChars(req.user); const ch = list.find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const texts = [req.body.prompt, req.body.look && req.body.look.custom, req.body.identity && req.body.identity.core];
  if (texts.some(hasYouth)) return res.status(400).json({ error: 'Descrizione non consentita: i personaggi devono essere adulti (25+).' });
  try {
    const draft = { ...ch, ...cleanChar(req.user, { ...ch, ...req.body, avatar: ch.avatar, avatarSource: ch.avatarSource }, ch) };
    const gen = await generateAnchored(req.user, req.aiKey, draft, req.body.prompt);
    const fields = { appearance: draft.appearance, look: draft.look, identity: draft.identity };
    if (!getSettings(req.user).autoSave) return res.json({ preview: { ...addPending(req.user, 'avatar', gen, 'avatar'), ...fields } }); // solo in memoria
    const url = saveAvatarBuffer(req.user, gen.buf);
    const identity = { ...draft.identity };
    if (!identity.refAvatar) identity.refAvatar = url; // la prima immagine salvata diventa il riferimento dell'identità
    // solo i campi dell'aspetto: se nel frattempo l'altro utente ha cambiato nome/personalità, non li sovrascriviamo
    res.json({ character: await updateChar(req.user, ch.id, (cur) => ({ ...cur, appearance: draft.appearance, look: draft.look, identity, avatar: url, avatarSource: 'ai' }), String(req.body.reason || 'rigenerazione').slice(0, 40)) });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});

// Genera la versione "scena" (figura intera, seduta in una stanza, 16:9) ancorata all'identità del personaggio.
// body: { room: 'salotto'|'camera'|'terrazza' } -> { preview:{pending,dataUrl}, room } (senza salvataggio automatico) | { character, room }
app.post('/api/characters/:id/scene-image', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const room = String(req.body.room || '');
  if (!SCENE_ROOMS[room]) return res.status(400).json({ error: 'Stanza non valida' });
  try {
    const draft = { ...ch, ...cleanChar(req.user, { ...ch, avatar: ch.avatar, avatarSource: ch.avatarSource }, ch) }; // campi normalizzati (anche per personaggi vecchi)
    const prompt = buildScenePrompt(draft, room);
    const ref = draft.identity && draft.identity.refAvatar && ch.identity.refAvatar.match(AV_RE);
    const refFile = ref && avatarPath(ref[1]);
    let gen = null;
    if (refFile && fs.existsSync(refFile)) {
      try { gen = await editImage(req.aiKey, `Keep exactly the same person, same face and identity as in the reference image, but show her full body in a new scene. ${prompt}`, [fileToDataUrl(refFile)], adultOn(req.user), '16:9'); }
      catch (e) { if (e.message === 'Contenuto rifiutato dal servizio AI') throw e; console.error('Scena: edit con riferimento non riuscito, uso generazione:', e.message); }
    }
    if (!gen) gen = await generateImage(req.aiKey, prompt, adultOn(req.user), '16:9');
    if (!getSettings(req.user).autoSave) return res.json({ room, preview: addPending(req.user, 'scene', gen, room) });
    const url = saveAvatarBuffer(req.user, gen.buf);
    res.json({ room, character: await setScene(req.user, ch.id, room, { url, landmarks: null }) });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});
async function setScene(u, id, room, v) {
  const c = await patchChar(id, (c) => {
    const sc = { ...(c.scenes || {}) };
    if (v === null) delete sc[room]; else sc[room] = { ...(sc[room] || {}), ...v, at: v.url ? new Date().toISOString() : (sc[room] || {}).at };
    c.scenes = cleanScenes(sc); c.updatedAt = new Date().toISOString(); c.updatedBy = u;
  });
  const { drawer, ...pub } = c; return pub;
}
// Salva un'anteprima di scena e/o i punti del viso trovati sul telefono. body: { room, pendingId?, landmarks? }
app.put('/api/characters/:id/scene', auth, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const room = String(req.body.room || '');
  if (!SCENE_ROOMS[room]) return res.status(400).json({ error: 'Stanza non valida' });
  const v = {};
  if (req.body.pendingId) {
    const pend = takePending(req.user, String(req.body.pendingId), 'scene');
    if (!pend) return res.status(410).json({ error: 'Anteprima scaduta: rigenera la scena' });
    v.url = saveAvatarBuffer(req.user, pend.buf); pending.delete(String(req.body.pendingId)); v.landmarks = null;
  } else if (!(ch.scenes || {})[room]) return res.status(404).json({ error: 'Nessuna scena salvata per questa stanza' });
  if (req.body.landmarks !== undefined) v.landmarks = req.body.landmarks;
  res.json({ room, character: await setScene(req.user, ch.id, room, v) });
});
app.delete('/api/characters/:id/scene/:room', auth, async (req, res) => {
  if (!SCENE_ROOMS[req.params.room]) return res.status(400).json({ error: 'Stanza non valida' });
  if (!getChars(req.user).find((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Personaggio non trovato' });
  res.json({ character: await setScene(req.user, req.params.id, req.params.room, null) });
});

// Generatore di variazioni VINCOLATO: piccoli passi plausibili dallo stato attuale.
function stepIn(list, cur, maxStep = 1) {
  const i = Math.max(0, list.indexOf(cur));
  const d = crypto.randomInt(-maxStep, maxStep + 1);
  return list[Math.min(list.length - 1, Math.max(0, i + d))];
}
function subtleVariation(ch) {
  const look = { ...ch.look };
  const appearance = { ...ch.appearance, colors: { ...ch.appearance.colors } };
  const changes = [];
  const r = () => crypto.randomInt(0, 100);
  if (r() < 70) { const v = stepIn(OPT.hairStyle, look.hairStyle); if (v !== look.hairStyle) { look.hairStyle = v; changes.push(`capelli: ${v}`); } }
  if (r() < 50) { const v = stepIn(OPT.makeup, look.makeup); if (v !== look.makeup) { look.makeup = v; changes.push(`trucco: ${v}`); } }
  if (r() < 60) { const others = OPT.outfit.filter((o) => o !== look.outfit && o !== 'notte'); look.outfit = others[crypto.randomInt(0, others.length)]; changes.push(`outfit: ${look.outfit}`); }
  const ac = ch.autoChanges;
  if (ac.bodyDrift && r() < 15) { // deriva minima del corpo, solo entro i limiti scelti
    const lo = OPT.build.indexOf(ac.buildMin), hi = OPT.build.indexOf(ac.buildMax);
    const v = stepIn(OPT.build, appearance.build); const vi = OPT.build.indexOf(v);
    if (v !== appearance.build && vi >= Math.min(lo, hi) && vi <= Math.max(lo, hi)) { appearance.build = v; changes.push(`corporatura: ${v}`); }
  }
  if (!changes.length) { look.hairStyle = stepIn(OPT.hairStyle, look.hairStyle) || look.hairStyle; changes.push(`capelli: ${look.hairStyle}`); }
  return { look, appearance, changes };
}
// Cambio automatico del personaggio CONDIVISO: una sola volta per periodo, anche se Nico e Luisa aprono l'app insieme.
// Il turno viene "prenotato" (lastAt) in modo atomico PRIMA della generazione; se la generazione fallisce si annulla.
const autoBusy = new Set();
app.post('/api/characters/:id/auto-change', auth, requireActivated, requireKey, async (req, res) => {
  const id = req.params.id;
  if (autoBusy.has(id)) return res.json({ skipped: 'già in corso' });
  let ch, prevLast, skipped = null;
  try {
    await patchChar(id, (c) => {
      const ac = c.autoChanges || {};
      if (!ac.enabled) { skipped = 'disattivato'; return false; }
      if (!AV_RE.test(c.avatar)) { skipped = 'serve un avatar generato'; return false; }
      const due = !ac.lastAt || Date.now() - Date.parse(ac.lastAt) >= ac.everyDays * 864e5 - 2 * 3600e3;
      if (!due) { skipped = 'non ancora'; return false; }
      prevLast = ac.lastAt || null; c.autoChanges.lastAt = new Date().toISOString(); c.autoChanges.lastBy = req.user;
      ch = JSON.parse(JSON.stringify(c));
    });
  } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  if (skipped) return res.json({ skipped });
  autoBusy.add(id);
  const { look, appearance, changes } = subtleVariation(ch);
  try {
    const draft = { ...ch, look, appearance };
    const gen = await generateAnchored(req.user, req.aiKey, draft, 'subtle everyday variation, same person');
    if (!getSettings(req.user).autoSave) return res.json({ preview: { ...addPending(req.user, 'avatar', gen, 'avatar'), look, appearance }, changes });
    const url = saveAvatarBuffer(req.user, gen.buf);
    const updated = await updateChar(req.user, ch.id, (cur) => ({ ...cur, look, appearance, avatar: url, avatarSource: 'ai' }), 'cambio automatico');
    res.json({ character: updated, changes });
  } catch (e) {
    await patchChar(id, (c) => { if (c.autoChanges) c.autoChanges.lastAt = prevLast; }).catch(() => {});
    res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' });
  } finally { autoBusy.delete(id); }
});
// Ripristina un look dallo storico
app.post('/api/characters/:id/revert/:hid', auth, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const h = (ch.lookHistory || []).find((x) => x.id === req.params.hid);
  if (!h) return res.status(404).json({ error: 'Look non trovato' });
  try { res.json(await updateChar(req.user, ch.id, (cur) => ({ ...cur, avatar: h.avatar, appearance: h.appearance, look: h.look, landmarks: h.landmarks || cur.landmarks }), 'prima del ripristino')); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// Evoluzione della personalità: dopo le conversazioni il modello aggiorna umore, relazione, tratti, rancori.
app.post('/api/characters/:id/evolve', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const st = ch.state || defaultState();
  const recent = readChat(ch.id).messages.filter(visibleMsg).slice(-14);
  if (!recent.length) return res.json({ state: st });
  const prompt = `Sei il "motore emotivo" del personaggio ${ch.name}, che parla in una chat condivisa con Nico e Luisa (una coppia). Personalità di base: ${ch.personality.slice(0, 1500)}
Stato attuale (JSON): ${JSON.stringify({ mood: st.mood, relationship: st.relationship, traits: st.traits, grudges: st.grudges, notes: st.notes })}
Ultimi messaggi:
${recent.map((m) => authorLabel(m, ch) + ': ' + m.content.slice(0, 1200)).join('\n')}

Aggiorna lo stato in modo realistico e graduale: l'umore può cambiare (anche offesa, gelosa, triste, euforica, permalosa), la relazione evolve lentamente, i rancori restano finché non c'è una vera riconciliazione, i tratti emergono dalle esperienze. Niente contenuti con minori, non consensuali o illegali.
Rispondi SOLO con JSON: {"mood": string breve, "relationship": string breve, "traits": [max 8 stringhe brevi], "grudges": [max 5 stringhe brevi], "notes": string max 300 caratteri}`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey),
      body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.4, messages: [{ role: 'system', content: BASE_RULE }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: aiErrorMsg(r.status, await r.json().catch(() => ({}))) });
    const txt = (await r.json()).choices?.[0]?.message?.content || '{}';
    let j = {}; try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch {}
    const arr = (a, n) => (Array.isArray(a) ? a : []).map((x) => safeText(x, 120)).filter(Boolean).slice(0, n);
    const next = {
      mood: safeText(j.mood, 60) || st.mood, relationship: safeText(j.relationship, 160) || st.relationship,
      traits: j.traits ? arr(j.traits, 8) : st.traits, grudges: j.grudges ? arr(j.grudges, 5) : st.grudges,
      notes: j.notes != null ? safeText(j.notes, 300) : st.notes, updatedAt: new Date().toISOString(),
    };
    await patchChar(ch.id, (c) => { c.state = next; });
    res.json({ state: next });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
});

// ---------- chat CONDIVISA ----------
// Un unico thread per personaggio, uguale per Nico e Luisa: data/shared/chats/<id>.json
// Formato: { epoch, messages: [{ id, n, role: 'user'|'assistant', author: 'nicola'|'luisa'|<id personaggio>, content, at }] }
// "n" cresce sempre (1, 2, 3…): il polling chiede solo i messaggi con n > since. "epoch" cambia quando la chat viene svuotata.
const chatFile = (id) => path.join(sharedDir('chats'), id + '.json');
const aiHeaders = (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });
const newChat = () => ({ epoch: newId(), messages: [] });
function normChat(c) {
  if (Array.isArray(c)) c = { epoch: newId(), messages: c }; // vecchio formato (array)
  if (!c || !Array.isArray(c.messages)) c = newChat();
  let n = 0;
  for (const m of c.messages) { if (!m.id) m.id = newId(); if (!Number.isInteger(m.n) || m.n <= n) m.n = n + 1; n = m.n; }
  return c;
}
const readChat = (id) => normChat(readJSON(chatFile(id), null));
// Aggiunge un messaggio in coda alla chat, sempre sulla versione appena riletta dal disco (serializzato per file).
async function appendMsg(chatId, msg) {
  let saved;
  await mutateJSON(chatFile(chatId), newChat, (raw) => {
    const c = normChat(raw);
    const last = c.messages.length ? c.messages[c.messages.length - 1].n : 0;
    saved = { id: msg.id || newId(), n: last + 1, role: msg.role, author: msg.author, content: msg.content, at: new Date().toISOString(), ...(msg.extra || {}) };
    c.messages.push(saved);
    if (c.messages.length > 2000) c.messages = c.messages.slice(-2000);
    return c;
  });
  return saved;
}
const typing = new Map(); // chatId -> { by, at }: "sta scrivendo…" mentre l'IA risponde (solo in memoria)
function authorLabel(m, ch) {
  if (USERS[m.author]) return USERS[m.author].name;
  if (m.role === 'user') return 'Utente';
  return ch ? ch.name : 'Personaggio';
}
const pubMsg = (m, ch) => ({ ...m, authorName: authorLabel(m, ch) });

// GET /api/chats/:id?since=<n>&epoch=<epoch>  -> { epoch, last, reset, messages, typing }
app.get('/api/chats/:id', auth, (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const ch = getChars(req.user).find((c) => c.id === id);
  const c = readChat(id);
  const last = c.messages.length ? c.messages[c.messages.length - 1].n : 0;
  const since = Number(req.query.since);
  const incremental = req.query.since !== undefined && Number.isFinite(since) && req.query.epoch === c.epoch && since <= last;
  const list = (incremental ? c.messages.filter((m) => m.n > since) : c.messages).filter(visibleMsg);
  const t = typing.get(id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ epoch: c.epoch, last, reset: !incremental, messages: list.map((m) => pubMsg(m, ch)),
    typing: t && Date.now() - t.at < 120e3 ? { by: t.by, name: ch ? ch.name : '', for: USERS[t.by] ? USERS[t.by].name : '' } : null });
});
app.delete('/api/chats/:id', auth, async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID non valido' });
  try {
    const n = readChat(req.params.id).messages.length;
    if (n) backupShared('prima-svuota-chat');
    await mutateJSON(chatFile(req.params.id), newChat, () => newChat()); // nuova epoch: i dispositivi ricaricano da zero
    audit(req.user, 'svuota-chat', { id: req.params.id, messages: n });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

function stateText(ch) {
  const st = ch.state || defaultState();
  return `IL TUO MONDO INTERIORE (personalità aperta, in evoluzione — non un copione):
Sei una persona con emozioni vere e una personalità che cresce con le conversazioni. Puoi avere sbalzi d'umore, discutere, non essere d'accordo, offenderti, tenere il broncio per un po' e non fare pace subito se ti senti ferita; puoi anche emozionarti, affezionarti, scherzare. Reagisci in modo coerente con la tua storia.
Umore attuale: ${st.mood}. Stato della relazione: ${st.relationship}.
${st.traits.length ? 'Tratti emersi: ' + st.traits.join('; ') + '.' : ''}
${st.grudges.length ? 'Cose che ti hanno ferita o infastidita (e non hai ancora del tutto perdonato): ' + st.grudges.join('; ') + '.' : ''}
${st.notes ? 'Note su di te: ' + st.notes : ''}`.replace(/\n{2,}/g, '\n');
}
// user = chi sta scrivendo adesso (e la cui chiave xAI paga la risposta)
function buildSystem(user, ch) {
  const rulesOf = (u) => getRules(u).text.trim();
  const mem = getMem();
  const notes = getNotes(user);
  return [
    `PERSONAGGIO: ${ch.name}.`,
    ch.personality && `Personalità: ${ch.personality}`,
    ch.style && `Stile: ${ch.style}`,
    `CHAT DI COPPIA CONDIVISA: gli utenti sono Nico (Nicola) e Luisa, una coppia, entrambi adulti. Sono due persone reali che vedono gli stessi messaggi. Ogni loro messaggio inizia con il nome di chi scrive ("Nico:" o "Luisa:"): riconosci da lì chi ti sta scrivendo, rivolgiti a quella persona chiamandola per nome e, quando qualcuno arriva o ti scrive per la prima volta dopo un po', salutalo per nome. Ricorda chi ha detto cosa e, quando ha senso, coinvolgi entrambi. Non iniziare le tue risposte con il tuo nome e non scrivere tu il prefisso "Nico:"/"Luisa:".`,
    `Ora ti sta scrivendo ${USERS[user].name}.`,
    ...Object.keys(USERS).map((u) => rulesOf(u) && `LE REGOLE / IL GIOCO DI ${USERS[u].name.toUpperCase()}:\n${rulesOf(u)}`),
    mem.filter((m) => !m.charId).length && `MEMORIA CONDIVISA (cosa sai di Nico, di Luisa e della coppia):\n${mem.filter((m) => !m.charId).map((m) => '- ' + m.text).join('\n')}`,
    mem.filter((m) => m.charId === ch.id).length && `LA TUA MEMORIA DI BASE (chi sei, modificabile dagli utenti):\n${mem.filter((m) => m.charId === ch.id).map((m) => '- ' + m.text).join('\n')}`,
    notes.toAI && notes.text.trim() && `NOTE PERSONALI DI ${USERS[user].name.toUpperCase()} (riservate, non citarle all'altra persona):\n${notes.text.trim()}`,
    stateText(ch),
    actionsPrompt(ch),
    adultChat() ? 'MODALITÀ ADULTI ATTIVA (scelta da entrambi gli utenti, che hanno registrato il consenso vocale): sono ammessi linguaggio esplicito e gioco di ruolo sessuale esplicito tra Nico, Luisa e il personaggio, che è una donna adulta inventata (25+). Resta sempre tutto entro le regole di base qui sotto.'
      : 'Modalità adulti NON attiva: niente contenuti sessuali espliciti; se richiesti, ricorda con gentilezza che va attivata in Account da entrambi.',
    BASE_RULE, // sempre ultima, non sovrascrivibile
  ].filter(Boolean).join('\n\n');
}

// POST /api/chats/:id  { message, noAI? }
// - noAI: true -> "solo messaggio" per l'altra persona: salvato e visibile a entrambi, l'IA non risponde (non serve la chiave).
// - altrimenti il messaggio viene salvato SUBITO (l'altro lo vede col polling) e la risposta dell'IA arriva in streaming
//   a chi l'ha inviato; a fine risposta viene aggiunta alla chat condivisa.
// Header di risposta: X-Msg-Id / X-Msg-N (messaggio utente), X-Reply-Id (id che avrà la risposta).
app.post('/api/chats/:id', auth, requireActivated, (req, res, next) => (req.body && req.body.noAI === true ? next() : requireKey(req, res, next)), async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const ch = getChars(req.user).find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const text = String(req.body.message || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ error: 'Messaggio vuoto' });

  // parola chiave della modalità adulti: confrontata qui sul server (hash), MAI salvata in chat né inviata a xAI
  const kw = await keywordMatch(req.user, text);
  if (kw) return res.json({ keyword: true, token: kw, question: 'Vuoi attivare la modalità adulti? Rispondi sì o no', activated: isActivated(req.user) });
  if (!ch.memorySeededAt) await seedBaseMemory(ch).catch(() => {});
  const mine = await appendMsg(id, { role: 'user', author: req.user, content: text, extra: req.body.noAI === true ? { noAI: true } : {} });
  if (req.body.noAI === true) return res.json({ message: pubMsg(mine, ch) });
  if (typing.has(id) && Date.now() - typing.get(id).at < 120e3) {
    // l'IA sta già rispondendo all'altra persona: il messaggio resta in chat e verrà letto nella prossima risposta
    return res.status(409).json({ error: `${ch.name} sta già rispondendo: il tuo messaggio è in chat, riprova tra poco per la sua risposta.`, message: pubMsg(mine, ch) });
  }

  const history = readChat(id).messages.filter(visibleMsg).slice(-40);
  const messages = [{ role: 'system', content: buildSystem(req.user, ch) },
    ...history.map((m) => (m.role === 'user' ? { role: 'user', content: `${authorLabel(m)}: ${m.content}` } : { role: 'assistant', content: m.content }))];
  const replyId = newId();
  res.setHeader('X-Msg-Id', mine.id); res.setHeader('X-Msg-N', String(mine.n)); res.setHeader('X-Reply-Id', replyId);

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  typing.set(id, { by: req.user, at: Date.now() });
  let reply = '';
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey), signal: ctrl.signal,
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true }),
    });
    if (!r.ok || !r.body) {
      console.error('Errore AI chat: HTTP', r.status); // mai loggare la chiave
      const msg = aiErrorMsg(r.status, await r.json().catch(() => ({})));
      typing.delete(id);
      return res.status(502).json({ error: msg, message: pubMsg(mine, ch) });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const decoder = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { reply += d; res.write(d); } } catch {}
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Errore AI chat:', e.message);
    if (!res.headersSent) { typing.delete(id); return res.status(502).json({ error: 'Servizio AI non raggiungibile', message: pubMsg(mine, ch) }); }
  }
  // la risposta viene aggiunta in coda alla versione aggiornata della chat (eventuali messaggi arrivati nel frattempo restano)
  if (reply) {
    const t = takeActionTag(reply, ch); // [azione:xxx] -> tolto dal testo, salvato come campo del messaggio (lo vedono entrambi)
    await appendMsg(id, { id: replyId, role: 'assistant', author: ch.id, content: t.text || reply, extra: { replyTo: req.user, ...(t.action ? { action: t.action } : {}) } });
  }
  typing.delete(id);
  res.end();
});

// Polling leggero: versioni di personaggi e memoria condivisi (il client ricarica solo ciò che è cambiato).
app.get('/api/sync', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ chars: fileRev(CHARS_FILE()), memory: fileRev(MEM_FILE()), adultChat: adultChat() });
});


// ---------- immagini ----------
const imgIndex = (u) => path.join(userDir(u), 'images.json');
const IMG_RE = /^[a-f0-9]{16}\.(png|jpg)$/;
app.get('/api/images', auth, (req, res) => res.json(readJSON(imgIndex(req.user), []).slice().reverse()));
app.get('/api/images/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  if (!IMG_RE.test(f)) return res.status(400).end();
  sendPrivateFile(req, res, path.join(userDir(req.user, 'images'), f));
});
app.delete('/api/images/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  if (!IMG_RE.test(f)) return res.status(400).end();
  fs.rmSync(path.join(userDir(req.user, 'images'), f), { force: true });
  writeJSON(imgIndex(req.user), readJSON(imgIndex(req.user), []).filter((i) => i.file !== f));
  res.json({ ok: true });
});
function saveImage(u, buf, jpg, prompt) {
  const file = `${newId()}.${jpg ? 'jpg' : 'png'}`;
  fs.writeFileSync(path.join(userDir(u, 'images'), file), buf);
  const rec = { file, prompt, createdAt: new Date().toISOString() };
  const idx = readJSON(imgIndex(u), []); idx.push(rec); writeJSON(imgIndex(u), idx);
  return rec;
}
// Salvataggio manuale di un'immagine generata (anteprima in memoria)
app.post('/api/images/save', auth, (req, res) => {
  const p = takePending(req.user, String(req.body.pending || ''), 'image');
  if (!p) return res.status(404).json({ error: 'Anteprima scaduta o non trovata' });
  pending.delete(String(req.body.pending));
  res.json({ ...saveImage(req.user, p.buf, p.jpg, p.prompt), saved: true });
});
app.post('/api/images', auth, requireActivated, requireKey, async (req, res) => {
  const prompt = String(req.body.prompt || '').trim().slice(0, 2000);
  if (!prompt) return res.status(400).json({ error: 'Descrizione vuota' });
  if (hasYouth(prompt)) return res.status(400).json({ error: 'Descrizione non consentita: solo persone adulte (25+).' });
  try {
    const gen = await generateImage(req.aiKey, prompt, adultOn(req.user));
    if (!getSettings(req.user).autoSave) return res.json({ ...addPending(req.user, 'image', gen, prompt), prompt, saved: false, createdAt: new Date().toISOString() });
    res.json({ ...saveImage(req.user, gen.buf, gen.jpg, prompt), saved: true });
  } catch (e) {
    console.error('Errore AI immagini:', e.message);
    res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' });
  }
});

// ---------- anteprime in memoria (immagini e video non salvati) ----------
app.get('/api/pending/:id', auth, (req, res) => {
  const p = takePending(req.user, req.params.id);
  if (!p) return res.status(404).end();
  if (req.query.download && !getSettings(req.user).allowExport) return res.status(403).end();
  res.type(p.kind === 'video' ? 'video/mp4' : p.jpg ? 'image/jpeg' : 'image/png');
  res.setHeader('Cache-Control', 'no-store'); res.send(p.buf);
});

// ---------- immagine caricata/ritagliata dal dispositivo (es. dopo il ritaglio locale) ----------
const FACE_CONSENT_MSG = 'Devi confermare che l\'immagine ritrae te o il tuo partner con il suo consenso, oppure un volto inventato/generato dall\'IA, e non una terza persona reale.';
const parseDataUrl = (d) => { const m = String(d || '').match(/^data:image\/(png|jpeg|webp);base64,(.+)$/); return m ? Buffer.from(m[2], 'base64') : null; };
app.post('/api/images/upload', auth, (req, res) => {
  if (req.body.consent !== true) return res.status(400).json({ error: FACE_CONSENT_MSG });
  const buf = parseDataUrl(req.body.dataUrl);
  if (!buf || buf.length > 8e6) return res.status(400).json({ error: 'Immagine non valida' });
  res.json({ ...saveImage(req.user, buf, buf[0] === 0xff, safeText(req.body.prompt, 200) || 'Immagine ritagliata'), saved: true });
});

// ---------- scambio volto / reinquadratura via image edit (solo Nicola, Luisa o volti IA) ----------
// body: { target: {source:'image'|'avatar'|'pending'|'upload', ref|dataUrl}, face: {source:'avatar'|'upload', ref|dataUrl}, consent, instruction }
function resolveImage(user, spec) {
  if (!spec) return null;
  if (spec.source === 'upload') return parseDataUrl(spec.dataUrl) ? spec.dataUrl : null;
  if (spec.source === 'pending') { const p = takePending(user, String(spec.ref)); return p && p.kind !== 'video' ? `data:image/${p.jpg ? 'jpeg' : 'png'};base64,${p.buf.toString('base64')}` : null; }
  if (spec.source === 'image' && IMG_RE.test(String(spec.ref))) { const f = path.join(userDir(user, 'images'), spec.ref); return fs.existsSync(f) ? fileToDataUrl(f) : null; }
  if (spec.source === 'avatar' && AV_RE.test(String(spec.ref))) { const f = avatarPath(String(spec.ref).match(AV_RE)[1]); return fs.existsSync(f) ? fileToDataUrl(f) : null; }
  return null;
}
app.post('/api/faceswap', auth, requireActivated, requireKey, async (req, res) => {
  const { target, face } = req.body;
  const usesUpload = (target && target.source === 'upload') || (face && face.source === 'upload');
  if (usesUpload && req.body.consent !== true) return res.status(400).json({ error: FACE_CONSENT_MSG });
  const instruction = String(req.body.instruction || '').slice(0, 500);
  if (hasYouth(instruction)) return res.status(400).json({ error: 'Descrizione non consentita: solo persone adulte (25+).' });
  const t = resolveImage(req.user, target); const f = face ? resolveImage(req.user, face) : null;
  if (!t) return res.status(400).json({ error: 'Immagine di partenza mancante' });
  const prompt = f
    ? `Replace the face of the adult person in the first image with the face of the adult person in the second image (one of the two consenting users or an AI-generated face), keeping pose, body, lighting and framing of the first image. Realistic. ${instruction}`
    : `Reframe/recompose this image as requested, keep the same adult person and identity. Realistic. ${instruction}`;
  try {
    const gen = await editImage(req.aiKey, prompt, f ? [t, f] : [t]);
    if (!getSettings(req.user).autoSave) return res.json({ ...addPending(req.user, 'image', gen, 'Scambio volto / reinquadratura'), saved: false, prompt: 'Scambio volto / reinquadratura', createdAt: new Date().toISOString() });
    res.json({ ...saveImage(req.user, gen.buf, gen.jpg, 'Scambio volto / reinquadratura'), saved: true });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});

// ---------- video (xAI, asincrono) ----------
const vidIndex = (u) => path.join(userDir(u), 'videos.json');
const VID_RE = /^[a-f0-9]{16}\.mp4$/;
app.get('/api/videos', auth, (req, res) => res.json(readJSON(vidIndex(req.user), []).slice().reverse()));
app.get('/api/videos/file/:f', auth, (req, res) => { const f = path.basename(req.params.f); if (!VID_RE.test(f)) return res.status(400).end(); sendPrivateFile(req, res, path.join(userDir(req.user, 'videos'), f)); });
app.delete('/api/videos/file/:f', auth, (req, res) => {
  const f = path.basename(req.params.f); if (!VID_RE.test(f)) return res.status(400).end();
  fs.rmSync(path.join(userDir(req.user, 'videos'), f), { force: true });
  writeJSON(vidIndex(req.user), readJSON(vidIndex(req.user), []).filter((v) => v.file !== f)); res.json({ ok: true });
});
const videoJobs = new Map(); // request_id -> { user, prompt }
app.post('/api/videos', auth, requireActivated, requireKey, async (req, res) => {
  if (!VIDEO_PATH) return res.status(501).json({ error: 'Generazione video non configurata (VIDEO_PATH vuoto).' });
  const prompt = String(req.body.prompt || '').trim().slice(0, 2000);
  if (!prompt) return res.status(400).json({ error: 'Descrizione vuota' });
  if (hasYouth(prompt)) return res.status(400).json({ error: 'Descrizione non consentita: solo persone adulte (25+).' });
  const st = getSettings(req.user);
  const body = { model: st.videoModel || VIDEO_MODEL, prompt: IMAGE_RULE + prompt, duration: num(req.body.duration, 1, 15, st.videoDuration), aspect_ratio: ['16:9', '9:16', '1:1'].includes(req.body.aspect) ? req.body.aspect : '9:16', resolution: '720p' };
  if (req.body.image) { const img = resolveImage(req.user, req.body.image); if (img) body.image = { url: img }; } // da immagine a video
  try {
    const r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.request_id) { console.error('Errore AI video: HTTP', r.status); return res.status(502).json({ error: aiErrorMsg(r.status, j) }); }
    videoJobs.set(j.request_id, { user: req.user, prompt });
    res.json({ requestId: j.request_id });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
});
app.get('/api/videos/status/:rid', auth, requireKey, async (req, res) => {
  const job = videoJobs.get(req.params.rid);
  if (!job || job.user !== req.user) return res.status(404).json({ error: 'Lavoro non trovato' });
  try {
    const r = await fetch(AI_BASE_URL + VIDEO_STATUS_PATH.replace('{id}', encodeURIComponent(req.params.rid)), { headers: aiHeaders(req.aiKey) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: aiErrorMsg(r.status, await r.json().catch(() => ({}))) });
    if (j.status !== 'done') return res.json({ status: j.status || 'pending' });
    const buf = Buffer.from(await (await fetch(j.video.url)).arrayBuffer());
    videoJobs.delete(req.params.rid);
    if (!getSettings(req.user).autoSave) { const id = newId(); pending.set(id, { user: req.user, buf, kind: 'video', prompt: job.prompt, at: Date.now() }); return res.json({ status: 'done', pending: id, url: `/api/pending/${id}`, prompt: job.prompt, saved: false }); }
    res.json({ status: 'done', ...saveVideo(req.user, buf, job.prompt), saved: true });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
});
function saveVideo(u, buf, prompt) {
  const file = `${newId()}.mp4`; fs.writeFileSync(path.join(userDir(u, 'videos'), file), buf);
  const rec = { file, prompt, createdAt: new Date().toISOString(), url: `/api/videos/file/${file}` };
  const idx = readJSON(vidIndex(u), []); idx.push(rec); writeJSON(vidIndex(u), idx); return rec;
}
app.post('/api/videos/save', auth, (req, res) => {
  const p = takePending(req.user, String(req.body.pending || ''), 'video');
  if (!p) return res.status(404).json({ error: 'Anteprima scaduta o non trovata' });
  pending.delete(String(req.body.pending)); res.json({ ...saveVideo(req.user, p.buf, p.prompt), saved: true });
});

// ---------- Diario: bacheca privata condivisa SOLO tra Nicola e Luisa ----------
const FEED_DIR = path.join(DATA_DIR, 'shared', 'feed'); fs.mkdirSync(FEED_DIR, { recursive: true });
const FEED_FILE = path.join(DATA_DIR, 'shared', 'feed.json');
const getFeed = () => readJSON(FEED_FILE, []);
const pubPost = (p, u) => ({ ...p, likedByMe: p.likes.includes(u), mine: p.author === u, authorName: USERS[p.author].name, likeNames: p.likes.map((x) => USERS[x].name), comments: p.comments.map((c) => ({ ...c, name: USERS[c.user].name, mine: c.user === u })) });
app.get('/api/feed', auth, (req, res) => res.json(getFeed().slice().reverse().map((p) => pubPost(p, req.user))));
app.get('/api/feed/img/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  if (!/^[a-f0-9]{16}\.(png|jpg)$/.test(f)) return res.status(400).end();
  sendPrivateFile(req, res, path.join(FEED_DIR, f));
});
// Pubblica: { source: 'image'|'avatar'|'pending', ref, characterId?, caption?, autoCaption? }
app.post('/api/feed', auth, requireActivated, async (req, res) => {
  const { source, ref } = req.body;
  let buf, jpg;
  if (source === 'pending') { const p = takePending(req.user, String(ref)); if (!p || p.kind === 'video') return res.status(404).json({ error: 'Anteprima scaduta' }); buf = p.buf; jpg = p.jpg; }
  else if (source === 'image' && /^[a-f0-9]{16}\.(png|jpg)$/.test(String(ref))) { const f = path.join(userDir(req.user, 'images'), ref); if (!fs.existsSync(f)) return res.status(404).json({ error: 'Immagine non trovata' }); buf = fs.readFileSync(f); }
  else if (source === 'avatar' && AV_RE.test(String(ref))) { const f = avatarPath(String(ref).match(AV_RE)[1]); if (!fs.existsSync(f)) return res.status(404).json({ error: 'Avatar non trovato' }); buf = fs.readFileSync(f); }
  else return res.status(400).json({ error: 'Contenuto non valido' });
  jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const ch = getChars(req.user).find((c) => c.id === req.body.characterId) || null;
  let caption = String(req.body.caption || '').trim().slice(0, 500);
  const key = String(req.get('X-AI-Key') || '').trim();
  if (!caption && req.body.autoCaption && ch && key) { // didascalia scritta dal personaggio
    try {
      const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST', headers: aiHeaders(key),
        body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 120, messages: [
          { role: 'system', content: buildSystem(req.user, ch) },
          { role: 'user', content: `Scrivi una didascalia breve (max 2 frasi, in italiano, nel tuo stile) per questa foto da pubblicare nel nostro diario privato. ${req.body.context ? 'Contesto: ' + String(req.body.context).slice(0, 300) : ''} Rispondi solo con la didascalia.` }] }),
      });
      if (r.ok) caption = ((await r.json()).choices?.[0]?.message?.content || '').trim().replace(/^"|"$/g, '').slice(0, 500);
    } catch (e) { console.error('Didascalia non generata:', e.message); }
  }
  const file = `${newId()}.${jpg ? 'jpg' : 'png'}`;
  fs.writeFileSync(path.join(FEED_DIR, file), buf);
  const post = { id: newId(), author: req.user, character: ch ? { name: ch.name, emoji: AV_RE.test(ch.avatar) ? null : ch.avatar } : null, file, caption, likes: [], comments: [], createdAt: new Date().toISOString() };
  const feed = getFeed(); feed.push(post); writeJSON(FEED_FILE, feed.slice(-500));
  res.json(pubPost(post, req.user));
});
function withPost(req, res, fn) {
  const feed = getFeed(); const p = feed.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post non trovato' });
  const out = fn(p, feed); if (out === false) return;
  writeJSON(FEED_FILE, feed); res.json(pubPost(p, req.user));
}
app.post('/api/feed/:id/like', auth, (req, res) => withPost(req, res, (p) => { p.likes = p.likes.includes(req.user) ? p.likes.filter((x) => x !== req.user) : [...p.likes, req.user]; }));
app.post('/api/feed/:id/comments', auth, (req, res) => withPost(req, res, (p) => {
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) { res.status(400).json({ error: 'Commento vuoto' }); return false; }
  p.comments.push({ id: newId(), user: req.user, text, at: new Date().toISOString() });
}));
app.delete('/api/feed/:id/comments/:cid', auth, (req, res) => withPost(req, res, (p) => { p.comments = p.comments.filter((c) => !(c.id === req.params.cid && c.user === req.user)); }));
app.delete('/api/feed/:id', auth, (req, res) => {
  const feed = getFeed(); const p = feed.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post non trovato' });
  if (p.author !== req.user) return res.status(403).json({ error: 'Puoi eliminare solo i tuoi post' });
  fs.rmSync(path.join(FEED_DIR, p.file), { force: true });
  writeJSON(FEED_FILE, feed.filter((x) => x.id !== p.id)); res.json({ ok: true });
});


// ---------- AZIONI dell'avatar (v7): clip brevi (video xAI) o pose (immagini) preparate su richiesta ----------
// Preparazione SOLO con il pulsante "Prepara azioni" (spende crediti xAI della chiave di chi la avvia).
// Azioni adulti: solo con la modalità adulti attiva per ENTRAMBI e solo per personaggi con volto generato dall'IA
// (mai da una foto caricata: niente immagini intime con il volto di una persona reale).
const ACT_BASE = 'Same person, same face and identity, same hairstyle, same framing and background as the source image. Static camera, natural realistic motion, subtle and believable. ';
const ACTIONS = {
  capelli: { label: 'Si sistema i capelli', emoji: '💇‍♀️', motion: 'she gently runs her fingers through her hair and tidies it, then lowers her hand and looks back at the camera', pose: 'she is tidying her hair with one hand, smiling' },
  stiracchia: { label: 'Si stiracchia', emoji: '🙆‍♀️', motion: 'she stretches her arms up lazily with a small yawn and a relaxed smile, then returns to the starting pose', pose: 'she is stretching her arms up lazily with a relaxed smile' },
  caffe: { label: 'Beve un caffè', emoji: '☕', motion: 'she lifts a small cup of espresso, takes a sip, smiles, lowers the cup out of frame and returns to the starting pose', pose: 'she is sipping from a small cup of espresso, smiling' },
  ride: { label: 'Ride', emoji: '😂', motion: 'she laughs naturally and warmly, shoulders shaking slightly, then calms down with a smile', pose: 'she is laughing warmly and naturally' },
  saluta: { label: 'Saluta con la mano', emoji: '👋', motion: 'she smiles and waves her hand at the camera in greeting, then lowers the hand', pose: 'she is smiling and waving her hand at the camera' },
  girata: { label: 'Si appoggia e si gira', emoji: '↪️', motion: 'she leans to one side and turns her head and shoulders away as if looking at something, then turns back to the camera', pose: 'she is leaning to one side, head and shoulders turned slightly away, looking at something' },
  bacio: { label: 'Manda un bacio', emoji: '😘', motion: 'she blows a kiss to the camera with her hand and smiles', pose: 'she is blowing a kiss to the camera with her hand' },
  spoglia: { adult: true, label: 'Si spoglia', emoji: '🔥', motion: 'the fictional adult woman (25+) slowly and playfully takes off her top, sensual and confident, looking at the camera', pose: 'the fictional adult woman (25+) is slowly taking off her top, sensual and confident' },
  giochi: { adult: true, label: 'Scena intima con sex toy', emoji: '🔞', motion: 'solo intimate scene: the fictional adult woman (25+), alone, sensually uses an adult sex toy, tasteful cinematic lighting', pose: 'solo intimate scene: the fictional adult woman (25+), alone, sensually holding an adult sex toy, tasteful cinematic lighting' },
};
const ACT_DIR = () => sharedDir('actions');
const ACT_FILE_RE = /^([a-f0-9]{16})-([a-z]+)-([a-f0-9]{8})\.(mp4|png|jpg)$/;
// Volto generato dall'IA: avatar immagine creato dall'IA e MAI una foto caricata (avatarConsent resta per sempre se c'è stata una foto)
const aiFace = (c) => !!c && c.avatarSource === 'ai' && !c.avatarConsent && AV_RE.test(String(c.avatar || ''));
const actionAllowed = (c, aid) => !!ACTIONS[aid] && (!ACTIONS[aid].adult || (adultChat() && aiFace(c)));
function visibleActions(c) {
  const out = {};
  for (const [aid, a] of Object.entries(c.actions || {})) {
    if (!a || !actionAllowed(c, aid) || !ACT_FILE_RE.test(a.file || '') || !fs.existsSync(path.join(ACT_DIR(), a.file))) continue;
    out[aid] = { kind: a.kind === 'pose' ? 'pose' : 'video', url: `/api/actions/file/${a.file}`, at: a.at, by: a.by, avatar: a.avatar, stale: a.avatar !== c.avatar };
  }
  return out;
}
function actionsPrompt(c) {
  const ready = Object.entries(visibleActions(c)).filter(([, a]) => !a.stale).map(([aid]) => aid);
  if (!ready.length) return null;
  return `AZIONI VISIBILI: puoi compiere un gesto che Nico e Luisa vedono sull'avatar aggiungendo IN FONDO alla risposta un solo tag [azione:<nome>], solo quando è davvero naturale (non spesso). Azioni disponibili: ${ready.map((aid) => `${aid} (${ACTIONS[aid].label.toLowerCase()})`).join(', ')}.`;
}
function takeActionTag(text, c) {
  let action = null;
  const out = String(text).replace(/\s*\[azione:\s*([a-zà-ù]+)\s*\]/gi, (m, aid) => { aid = aid.toLowerCase(); if (!action && visibleActions(c)[aid]) action = aid; return ''; }).trim();
  return { text: out, action };
}
// dimensioni di PNG/JPEG (per chiedere le pose con lo stesso formato dell'avatar)
function imgSize(b) {
  if (b[0] === 0x89 && b.length > 24) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
function closestAspect(sz) {
  if (!sz || !sz.w || !sz.h) return null; const r = sz.w / sz.h;
  return ASPECTS.map((a) => { const [x, y] = a.split(':').map(Number); return { a, d: Math.abs(Math.log(r / (x / y))) }; }).sort((p, q) => p.d - q.d)[0].a;
}
const actionJobs = new Map(); // request_id -> { user, charId, aid, avatar, at }
const actionBusy = new Set(); // charId:aid in preparazione
const actionSpend = new Map(); // utente -> [timestamp] (al massimo ACTION_MAX_HOUR preparazioni l'ora)
const ACTION_MAX_HOUR = Math.max(1, Number(process.env.ACTION_MAX_HOUR) || 24);
async function saveAction(u, ch, aid, buf, kind, srcAvatar, ext) {
  const file = `${ch.id}-${aid}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(ACT_DIR(), file), buf);
  let old = null;
  await patchChar(ch.id, (c) => { c.actions = c.actions || {}; old = c.actions[aid] && c.actions[aid].file; c.actions[aid] = { file, kind, at: new Date().toISOString(), by: u, avatar: srcAvatar }; });
  if (old && old !== file && ACT_FILE_RE.test(old)) fs.rmSync(path.join(ACT_DIR(), old), { force: true });
  const fresh = getChars(u).find((c) => c.id === ch.id);
  return visibleActions(fresh)[aid];
}
async function poseFallback(u, key, ch, aid, srcAvatar, buf) {
  const A = ACTIONS[aid];
  const dataUrl = `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
  const r = await editImage(key, `${ACT_BASE}Still photo of the moment: ${A.pose}.`, [dataUrl], !!A.adult, closestAspect(imgSize(buf)));
  return saveAction(u, ch, aid, r.buf, 'pose', srcAvatar, r.jpg ? 'jpg' : 'png');
}
app.get('/api/actions', auth, (req, res) => {
  const adult = adultChat();
  res.json({ video: !!VIDEO_PATH, adult, seconds: ACTION_SECONDS,
    catalog: Object.entries(ACTIONS).filter(([, a]) => !a.adult || adult).map(([id, a]) => ({ id, label: a.label, emoji: a.emoji, adult: !!a.adult })) });
});
// Avvia la preparazione di UN'azione. Risposta: { status:'pending', rid } (video, poi /status) oppure { status:'done', action } (posa).
app.post('/api/characters/:id/actions/:aid', auth, requireActivated, requireKey, async (req, res) => {
  const { aid } = req.params;
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  if (!ACTIONS[aid]) return res.status(400).json({ error: 'Azione sconosciuta' });
  const A = ACTIONS[aid];
  if (A.adult && !adultChat()) return res.status(403).json({ error: 'Azione disponibile solo con la modalità adulti attiva per entrambi.' });
  if (A.adult && !aiFace(ch)) return res.status(403).json({ error: 'Le azioni per adulti si possono preparare solo per personaggi con il volto generato dall\'IA, mai da una foto caricata.' });
  const m = AV_RE.exec(String(ch.avatar || ''));
  if (!m || !fs.existsSync(avatarPath(m[1]))) return res.status(400).json({ error: 'Serve un avatar immagine (non emoji) per preparare le azioni.' });
  const key = `${ch.id}:${aid}`;
  if (actionBusy.has(key)) return res.status(409).json({ error: 'Questa azione è già in preparazione' });
  const now = Date.now(), spent = (actionSpend.get(req.user) || []).filter((t) => now - t < 3600e3);
  if (spent.length >= ACTION_MAX_HOUR) return res.status(429).json({ error: `Limite di ${ACTION_MAX_HOUR} preparazioni l'ora raggiunto: riprova più tardi.` });
  spent.push(now); actionSpend.set(req.user, spent);
  const buf = fs.readFileSync(avatarPath(m[1]));
  const dataUrl = `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
  actionBusy.add(key);
  try {
    if (VIDEO_PATH && req.body.mode !== 'pose') {
      const body = { model: ACTION_VIDEO_MODEL, prompt: imgPrefix(!!A.adult) + ACT_BASE + A.motion + (A.adult ? '' : ' It ends in exactly the same pose as the first frame.'), image: { url: dataUrl }, duration: ACTION_SECONDS, resolution: ACTION_RESOLUTION };
      if (!A.adult) body.last_frame = { url: dataUrl }; // loop pulito: l'ultimo fotogramma torna l'avatar
      let r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(body) });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && body.last_frame && r.status === 400 && /last_frame/i.test(JSON.stringify(j))) { // modello senza ultimo fotogramma fissato
        delete body.last_frame; r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(body) }); j = await r.json().catch(() => ({}));
      }
      if (r.ok && j.request_id) { actionJobs.set(j.request_id, { user: req.user, charId: ch.id, aid, avatar: ch.avatar, at: now }); return res.json({ status: 'pending', rid: j.request_id, kind: 'video' }); }
      const msg = aiErrorMsg(r.status, j);
      console.error(`Azione ${aid}: video non avviato (HTTP ${r.status})`);
      if (msg === 'Contenuto rifiutato dal servizio AI' || r.status === 401) return res.status(r.status === 401 ? 400 : 422).json({ error: msg, refused: msg === 'Contenuto rifiutato dal servizio AI' }); // 400: mai 401 (farebbe uscire dall'app)
      if (![404, 405, 501].includes(r.status)) return res.status(502).json({ error: msg });
      // video non disponibile con questa chiave/servizio: ripiego sulle pose (immagini)
    }
    const action = await poseFallback(req.user, req.aiKey, ch, aid, ch.avatar, buf);
    res.json({ status: 'done', kind: 'pose', action });
  } catch (e) {
    const refused = e.message === 'Contenuto rifiutato dal servizio AI';
    res.status(refused ? 422 : 502).json({ error: e.message, refused });
  } finally { actionBusy.delete(key); }
});
app.get('/api/characters/:id/actions/:aid/status/:rid', auth, requireKey, async (req, res) => {
  const job = actionJobs.get(req.params.rid);
  if (!job || job.user !== req.user || job.charId !== req.params.id || job.aid !== req.params.aid) return res.status(404).json({ error: 'Lavoro non trovato' });
  try {
    const r = await fetch(AI_BASE_URL + VIDEO_STATUS_PATH.replace('{id}', encodeURIComponent(req.params.rid)), { headers: aiHeaders(req.aiKey) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const msg = aiErrorMsg(r.status, j); if (r.status !== 429 && r.status < 500) actionJobs.delete(req.params.rid); return res.status(r.status === 429 || r.status >= 500 ? 502 : 422).json({ error: msg, refused: msg === 'Contenuto rifiutato dal servizio AI' }); }
    if (j.status === 'failed' || j.status === 'expired') {
      actionJobs.delete(req.params.rid);
      const raw = JSON.stringify(j.error || j);
      const refused = /moderat|safety|policy|content|nsfw|reject|refus|violat|block/i.test(raw);
      return res.json({ status: 'failed', refused, error: refused ? 'Contenuto rifiutato dal servizio AI' : `Video non riuscito (${j.status})` });
    }
    if (j.status !== 'done' || !j.video || !j.video.url) return res.json({ status: j.status || 'pending' });
    actionJobs.delete(req.params.rid);
    const ch = getChars(req.user).find((c) => c.id === job.charId);
    if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
    if (ACTIONS[job.aid].adult && !actionAllowed(ch, job.aid)) return res.status(403).json({ error: 'Modalità adulti non più attiva: clip scartata.' });
    const buf = Buffer.from(await (await fetch(j.video.url)).arrayBuffer());
    if (buf.length < 100) return res.json({ status: 'failed', error: 'Video vuoto' });
    res.json({ status: 'done', kind: 'video', action: await saveAction(req.user, ch, job.aid, buf, 'video', job.avatar, 'mp4') });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
});
app.delete('/api/characters/:id/actions/:aid', auth, async (req, res) => {
  try {
    let old = null;
    await patchChar(req.params.id, (c) => { if (!c.actions || !c.actions[req.params.aid]) return false; old = c.actions[req.params.aid].file; delete c.actions[req.params.aid]; });
    if (old && ACT_FILE_RE.test(old)) fs.rmSync(path.join(ACT_DIR(), old), { force: true });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get('/api/actions/file/:f', auth, (req, res) => {
  const f = path.basename(req.params.f); const m = ACT_FILE_RE.exec(f);
  if (!m || !ACTIONS[m[2]]) return res.status(400).end();
  if (ACTIONS[m[2]].adult) { // mai mostrate a modalità adulti spenta o per volti da foto
    const ch = getChars(req.user).find((c) => c.id === m[1]);
    if (!ch || !actionAllowed(ch, m[2])) return res.status(403).json({ error: 'Non disponibile' });
    res.setHeader('Cache-Control', 'no-store'); return res.sendFile(path.join(ACT_DIR(), f)); // nessuna copia in cache del browser
  }
  sendPrivateFile(req, res, path.join(ACT_DIR(), f));
});

// ---------- "Cancella tutto": azzera TUTTI i dati dell'app (entrambi i profili) ----------
// Richiede: sessione valida + PIN di chi lo chiede + parola "CANCELLA". I PIN restano, salvo { wipePins: true }.
app.post('/api/wipe', loginLimiter, auth, async (req, res) => {
  if (req.body.confirm !== 'CANCELLA') return res.status(400).json({ error: 'Scrivi CANCELLA per confermare.' });
  const rec = getPins()[req.user];
  if (!rec || !(await bcrypt.compare(String(req.body.pin || ''), rec.hash))) return res.status(401).json({ error: 'PIN errato' });
  // backup completo PRIMA di cancellare (in data/backups, fuori dalle cartelle azzerate), salvo richiesta esplicita
  const dropBackups = req.body.wipeBackups === true;
  if (!dropBackups) { const b = backupShared('prima-cancella-tutto', { force: true }); if (!b) return res.status(500).json({ error: 'Backup preliminare non riuscito: cancellazione annullata' }); }
  audit(req.user, 'cancella-tutto', { pins: req.body.wipePins === true, backups: dropBackups ? 'eliminati' : 'conservati' });
  for (const d of ['users', 'shared']) fs.rmSync(path.join(DATA_DIR, d), { recursive: true, force: true });
  if (dropBackups) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  for (const f of ['sessions.json', 'lockout.json', ...(req.body.wipePins === true ? ['pins.json'] : [])]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  for (const k of Object.keys(sessions)) delete sessions[k];
  for (const k of Object.keys(lock)) delete lock[k];
  pending.clear(); videoJobs.clear(); typing.clear(); autoBusy.clear(); actionJobs.clear(); actionBusy.clear();
  fs.mkdirSync(FEED_DIR, { recursive: true });
  writeJSON(MIGRATION_MARK(), { at: new Date().toISOString(), note: 'archivio azzerato con Cancella tutto: niente migrazione dai vecchi file' });
  console.log(`Cancella tutto eseguito da ${req.user} il ${new Date().toISOString()}${req.body.wipePins === true ? ' (PIN inclusi)' : ''}`);
  res.clearCookie(COOKIE, { path: '/' });
  res.setHeader('Clear-Site-Data', '"cache", "storage"'); // il browser svuota cache e archivi locali (dove supportato)
  res.json({ ok: true, pinsErased: req.body.wipePins === true });
});

// recupero personaggi (vedi recoverCharacters più sotto)
app.get('/api/recovery', auth, (req, res) => {
  try {
    res.json({
      candidates: recoveryCandidates().map((x) => ({ id: x.char.id, name: x.char.name, avatar: x.char.avatar, source: x.source, messages: x.messages.length, updatedAt: x.char.updatedAt || x.char.createdAt || null })),
      backups: listBackups().slice(-30).reverse(),
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post('/api/recovery', auth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((i) => ID_RE.test(i)) : null;
    if (!ids || !ids.length) return res.status(400).json({ error: 'Scegli almeno un personaggio' });
    res.json(await recoverCharacters(req.user, ids));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ---------- file statici (PWA) ----------
app.get('/sw.js', (req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); });
app.get('/manifest.json', (req, res, next) => { res.type('application/manifest+json'); next(); });
// File statici. MediaPipe (/vendor/mediapipe) servito dall'app stessa, mai da CDN: .wasm con il MIME corretto
// (necessario per WebAssembly.instantiateStreaming, Safari compreso) e cache lunga per i modelli pesanti.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
    else if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    else if (file.endsWith('.task')) res.setHeader('Content-Type', 'application/octet-stream');
    if (file.includes(`${path.sep}vendor${path.sep}mediapipe${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));

// ---------- protezione dati: backup automatici, registro eliminazioni, recupero personaggi ----------
// data/backups/<data>-<motivo>/ contiene: shared/*.json + chats + feed.json (copie) e avatar/immagini del Diario
// (hard link: nessuno spazio in più, restano anche se l'originale viene cancellato) + i vecchi file per utente
// (characters/memory/chats/avatars) usati per il recupero. Si conservano gli ultimi BACKUP_KEEP (predefinito 20)
// più gli ultimi 10 fatti prima di un'eliminazione/Cancella tutto/recupero.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = Math.max(5, Number(process.env.BACKUP_KEEP) || 20);
const BACKUP_EVERY_MS = 10 * 60e3; // al massimo un backup "modifica" ogni 10 minuti
const PROTECTED = /-(prima-eliminazione|prima-cancella-tutto|prima-recupero|prima-svuota-chat)$/;
let lastBackupAt = 0, lastBackupSig = '';
function linkOrCopy(src, dst) { try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } }
function snapDir(src, dst, binary) { // binary: hard link; altrimenti copia (i JSON sono sempre riscritti con rename, ma copiamo comunque)
  if (!fs.existsSync(src)) return 0; let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (!e.isFile() || e.name.endsWith('.tmp')) continue;
    fs.mkdirSync(dst, { recursive: true });
    if (binary || !e.name.endsWith('.json')) linkOrCopy(path.join(src, e.name), path.join(dst, e.name)); else fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
    n++;
  }
  return n;
}
function dataSig() {
  const parts = [];
  for (const f of [CHARS_FILE(), MEM_FILE()]) { try { const st = fs.statSync(f); parts.push(st.size, st.mtimeMs); } catch { parts.push(0); } }
  for (const d of [path.join(DATA_DIR, 'shared', 'chats'), path.join(DATA_DIR, 'shared', 'avatars')]) {
    try { for (const f of fs.readdirSync(d)) { const st = fs.statSync(path.join(d, f)); parts.push(f, st.mtimeMs); } } catch {}
  }
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}
function backupShared(reason, { force = false } = {}) {
  try {
    const shared = path.join(DATA_DIR, 'shared');
    const sig = dataSig();
    if (!force && !PROTECTED.test('-' + reason) && sig === lastBackupSig) return null; // niente di nuovo
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let dst = path.join(BACKUP_DIR, `${stamp}-${reason}`); if (fs.existsSync(dst)) dst += '-' + crypto.randomBytes(2).toString('hex');
    fs.mkdirSync(dst, { recursive: true });
    snapDir(shared, path.join(dst, 'shared'));
    snapDir(path.join(shared, 'chats'), path.join(dst, 'shared', 'chats'));
    snapDir(path.join(shared, 'avatars'), path.join(dst, 'shared', 'avatars'), true);
    snapDir(path.join(shared, 'feed'), path.join(dst, 'shared', 'feed'), true);
    for (const u of Object.keys(USERS)) {
      const ud = path.join(DATA_DIR, 'users', u); if (!fs.existsSync(ud)) continue;
      for (const f of ['characters.json', 'memory.json']) if (fs.existsSync(path.join(ud, f))) { fs.mkdirSync(path.join(dst, 'users', u), { recursive: true }); fs.copyFileSync(path.join(ud, f), path.join(dst, 'users', u, f)); }
      snapDir(path.join(ud, 'chats'), path.join(dst, 'users', u, 'chats'));
      snapDir(path.join(ud, 'avatars'), path.join(dst, 'users', u, 'avatars'), true);
    }
    const chars = readJSON(CHARS_FILE(), []) || [];
    let avatars = []; try { avatars = fs.readdirSync(path.join(shared, 'avatars')); } catch {}
    let chats = []; try { chats = fs.readdirSync(path.join(shared, 'chats')).filter((f) => f.endsWith('.json')); } catch {}
    fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), reason, characters: Array.isArray(chars) ? chars.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar })) : 'illeggibile', chats, avatars }, null, 2));
    lastBackupAt = Date.now(); lastBackupSig = sig;
    pruneBackups();
    return dst;
  } catch (e) { console.error('Backup non riuscito:', e.message); return null; }
}
function maybeBackup(reason) { if (Date.now() - lastBackupAt >= BACKUP_EVERY_MS) backupShared(reason); }
function listBackups() {
  try { return fs.readdirSync(BACKUP_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
}
function pruneBackups() {
  const all = listBackups();
  const prot = all.filter((n) => PROTECTED.test(n)), normal = all.filter((n) => !PROTECTED.test(n));
  for (const n of [...normal.slice(0, Math.max(0, normal.length - BACKUP_KEEP)), ...prot.slice(0, Math.max(0, prot.length - 10))]) fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
}
// File JSON illeggibile: lo mette da parte (mai sovrascritto) e ripristina l'ultima copia valida dai backup.
function restoreCorrupt(f, txt) {
  const rel = path.relative(DATA_DIR, f);
  try { fs.mkdirSync(path.join(BACKUP_DIR, 'illeggibili'), { recursive: true }); fs.writeFileSync(path.join(BACKUP_DIR, 'illeggibili', `${rel.replace(/[\\/]/g, '_')}.${Date.now()}`), txt); } catch {}
  for (const b of [null, ...listBackups().reverse()]) {
    const cand = b ? path.join(BACKUP_DIR, b, rel) : f + '.bak';
    try { const v = JSON.parse(fs.readFileSync(cand, 'utf8')); if (!Array.isArray(v) && /characters\.json$/.test(rel)) continue; writeJSON(f, v); console.error(`ATTENZIONE: ${rel} era illeggibile; ripristinato da ${b ? 'backup ' + b : 'copia speculare .bak'} (copia rotta conservata in backups/illeggibili).`); return v; } catch {}
  }
  console.error(`ATTENZIONE: ${rel} illeggibile e nessun backup valido: modifiche bloccate, file conservato.`);
  return undefined;
}
// Registro delle operazioni distruttive (chi, cosa, quando): log del server + data/audit.json (ultimi 500)
function audit(u, action, info = {}) {
  const e = { at: new Date().toISOString(), user: u, action, ...info };
  console.log(`[registro] ${action} da ${u}: ${JSON.stringify(info)}`);
  try { const f = path.join(DATA_DIR, 'audit.json'); const l = readJSON(f, []); writeJSON(f, [...(Array.isArray(l) ? l : []), e].slice(-500)); } catch {}
}

// Recupero personaggi (SOLO AGGIUNTIVO): cerca personaggi non presenti nell'elenco attuale nei vecchi file per utente
// e nei backup; non tocca né sovrascrive i personaggi presenti (stesso id = saltato) né le loro chat.
const isPristine = (c, msgs) => c.name === DEFAULT_CHAR.name && c.avatar === DEFAULT_CHAR.avatar && c.personality === DEFAULT_CHAR.personality && !c.updatedAt && !msgs;
function legacyChat(id) { // chat di un personaggio dai vecchi file per utente (stesso formato della migrazione)
  const out = [], seen = new Set();
  for (const u of Object.keys(USERS)) {
    const old = readJSON(path.join(DATA_DIR, 'users', u, 'chats', id + '.json'), null); if (!old) continue;
    for (const m of (Array.isArray(old) ? old : old.messages || [])) {
      if (!m || !m.content) continue; const k = `${m.role}|${m.at}|${m.content}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ id: ID_RE.test(m.id) ? m.id : newId(), role: m.role === 'assistant' ? 'assistant' : 'user', author: m.author || (m.role === 'assistant' ? id : u), content: m.content, at: m.at || null, migratedFrom: m.migratedFrom || u });
    }
  }
  out.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)); out.forEach((m, i) => { m.n = i + 1; });
  return out;
}
function recoveryCandidates() {
  const present = new Set((readJSONSafe(CHARS_FILE(), []) || []).map((c) => c.id));
  const ts = (x) => Date.parse(x && (x.updatedAt || x.createdAt)) || 0;
  const found = new Map(); // id -> { char, source, chat: () => messages }
  const offer = (c, source, chatFn, avatarDirs) => {
    if (!c || !ID_RE.test(c.id) || present.has(c.id)) return;
    const prev = found.get(c.id); if (prev && ts(prev.char) >= ts(c)) return;
    found.set(c.id, { char: c, source, chat: chatFn, avatarDirs });
  };
  for (const u of Object.keys(USERS)) {
    const list = readJSON(path.join(DATA_DIR, 'users', u, 'characters.json'), []);
    for (const c of Array.isArray(list) ? list : []) offer(c, `vecchi file di ${USERS[u].name}`, () => legacyChat(c.id), [path.join(DATA_DIR, 'users', u, 'avatars')]);
  }
  for (const b of listBackups()) {
    const list = readJSON(path.join(BACKUP_DIR, b, 'shared', 'characters.json'), []);
    for (const c of Array.isArray(list) ? list : []) offer(c, `backup ${b}`, () => normChat(readJSON(path.join(BACKUP_DIR, b, 'shared', 'chats', c.id + '.json'), null)).messages, [path.join(BACKUP_DIR, b, 'shared', 'avatars')]);
  }
  return [...found.values()].map((x) => ({ ...x, messages: x.chat() })).filter((x) => !isPristine(x.char, x.messages.length));
}
const avatarFiles = (c) => {
  const out = new Set(); const add = (a) => { const m = AV_RE.exec(String(a || '')); if (m) out.add(m[1]); };
  add(c.avatar); add(c.identity && c.identity.refAvatar); (c.lookHistory || []).forEach((h) => add(h.avatar));
  Object.values(c.scenes || {}).forEach((sc) => add(sc && sc.image)); return out;
};
async function recoverCharacters(u, ids = null, { orphans = false } = {}) {
  const cands = recoveryCandidates().filter((x) => !ids || ids.includes(x.char.id));
  const report = { at: new Date().toISOString(), by: u, restored: [], skipped: [] };
  if (!cands.length) return report;
  backupShared('prima-recupero', { force: true });
  const cutoff = Math.min(Date.now(), ...(readJSON(CHARS_FILE(), []) || []).map((c) => Date.parse(c.createdAt) || Date.now()));
  for (const x of cands) {
    const c = JSON.parse(JSON.stringify(x.char)); delete c.drawer;
    // avatar: copia nell'archivio condiviso quelli che mancano (dai vecchi file o dal backup)
    for (const f of avatarFiles(c)) {
      const dst = path.join(avatarDir(), f); if (fs.existsSync(dst)) continue;
      const src = x.avatarDirs.map((d) => path.join(d, f)).find((p) => fs.existsSync(p)) || avatarPath(f);
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    }
    c.recoveredAt = report.at; c.recoveredFrom = x.source; c.lookHistory = Array.isArray(c.lookHistory) ? c.lookHistory : [];
    let added = false;
    await mutateJSON(CHARS_FILE(), [], (list) => { if (list.some((y) => y.id === c.id)) return undefined; added = true; return [...list, c]; });
    if (!added) { report.skipped.push(c.id); continue; }
    // chat: ricreata solo se non esiste già (mai sovrascritta)
    let restoredMsgs = 0;
    await mutateJSON(chatFile(c.id), newChat, (raw) => {
      const cur = normChat(raw); if (cur.messages.length || !x.messages.length) return undefined;
      restoredMsgs = x.messages.length; return { epoch: newId(), messages: x.messages };
    });
    report.restored.push({ id: c.id, name: c.name, source: x.source, messages: restoredMsgs });
  }
  // avatar "orfani" (file presenti ma non collegati ad alcun personaggio, creati prima dei personaggi attuali):
  // aggiunti allo storico look del personaggio recuperato (se è uno solo), così si possono ripristinare dall'editor.
  if (orphans && report.restored.length === 1) {
    const all = readJSON(CHARS_FILE(), []) || []; const used = new Set(); all.forEach((c) => avatarFiles(c).forEach((f) => used.add(f)));
    let files = []; try { files = fs.readdirSync(avatarDir()).filter((f) => /^[a-f0-9]{16}\.(png|jpg)$/.test(f) && !used.has(f)); } catch {}
    files = files.map((f) => ({ f, t: fs.statSync(path.join(avatarDir(), f)).mtimeMs })).filter((o) => o.t < cutoff).sort((a, b) => b.t - a.t).slice(0, 30);
    if (files.length) {
      const id = report.restored[0].id;
      await patchChar(id, (c) => {
        c.lookHistory = [...files.map((o) => ({ id: newId(), at: new Date(o.t).toISOString(), avatar: `/api/avatars/${o.f}`, appearance: c.appearance, look: c.look, landmarks: c.landmarks, reason: 'recuperato' })), ...(c.lookHistory || [])].slice(0, 40);
      });
      report.restored[0].orphanAvatars = files.length;
    }
  }
  if (report.restored.length) {
    revs.set(CHARS_FILE(), (revs.get(CHARS_FILE()) || 0) + 1);
    audit(u, 'recupero-personaggi', { restored: report.restored });
  }
  return report;
}
// Recupero automatico una tantum (v6.1): rimette i personaggi persi accanto a quelli attuali.
function startupRecovery() {
  const mark = path.join(sharedDir(), 'recovery-v61.json');
  if (fs.existsSync(mark)) return Promise.resolve();
  const wiped = /Cancella tutto/.test(JSON.stringify(readJSON(MIGRATION_MARK(), {}) || {}));
  if (wiped) { writeJSON(mark, { at: new Date().toISOString(), note: 'archivio azzerato con Cancella tutto: nessun recupero' }); return Promise.resolve(); }
  return recoverCharacters('sistema', null, { orphans: true }).then((r) => {
    writeJSON(mark, r);
    if (r.restored.length) console.log(`Recupero personaggi: ${r.restored.map((x) => `${x.name} (${x.id}, ${x.messages} messaggi${x.orphanAvatars ? `, ${x.orphanAvatars} avatar orfani nello storico look` : ''}) da ${x.source}`).join('; ')}`);
    else console.log('Recupero personaggi: nulla da recuperare.');
  }).catch((e) => console.error('Recupero personaggi non riuscito (nessun dato modificato):', e.message));
}


// ---------- migrazione una tantum: dai vecchi archivi per utente all'archivio condiviso ----------
// Gira all'avvio solo se manca data/shared/migration.json. Non cancella i vecchi file in data/users/<utente>/.
function migrateToShared() {
  if (fs.existsSync(MIGRATION_MARK())) return;
  const users = Object.keys(USERS);
  const ts = (x) => Date.parse(x && (x.updatedAt || x.createdAt)) || 0;
  const report = { at: new Date().toISOString(), characters: 0, chats: 0, messages: 0, memory: 0, avatars: 0, skippedDefaults: 0 };
  // 1) avatar: copia i file nella cartella condivisa (nomi casuali, non collidono)
  for (const u of users) {
    const d = path.join(DATA_DIR, 'users', u, 'avatars');
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const dst = path.join(avatarDir(), f);
      if (/^[a-f0-9]{16}\.(png|jpg)$/.test(f) && !fs.existsSync(dst)) { fs.copyFileSync(path.join(d, f), dst); report.avatars++; }
    }
  }
  // 2) chat: per ogni utente, ogni file chats/<id>.json; i messaggi vengono etichettati con l'autore originale
  const chats = new Map(); // id -> messages
  const sharedChats = sharedDir('chats');
  for (const f of fs.readdirSync(sharedChats)) if (/^[a-f0-9]{16}\.json$/.test(f)) chats.set(f.slice(0, 16), readChat(f.slice(0, 16)).messages);
  for (const u of users) {
    const d = path.join(DATA_DIR, 'users', u, 'chats');
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/^[a-f0-9]{16}\.json$/.test(f)) continue;
      const id = f.slice(0, 16);
      const old = readJSON(path.join(d, f), []);
      const msgs = (Array.isArray(old) ? old : old.messages || []).filter((m) => m && m.content)
        .map((m) => ({ id: m.id || newId(), role: m.role === 'assistant' ? 'assistant' : 'user', author: m.author || (m.role === 'assistant' ? id : u), content: m.content, at: m.at || null, migratedFrom: u }));
      const cur = chats.get(id) || [];
      const seen = new Set(cur.map((m) => `${m.role}|${m.at}|${m.content}`));
      chats.set(id, [...cur, ...msgs.filter((m) => !seen.has(`${m.role}|${m.at}|${m.content}`))]);
    }
  }
  // 3) personaggi: unione per id; se lo stesso id è in entrambi i profili, vince il più recente
  const byId = new Map();
  for (const c of readJSON(CHARS_FILE(), []) || []) byId.set(c.id, c);
  for (const u of users) {
    for (const c of readJSON(path.join(DATA_DIR, 'users', u, 'characters.json'), []) || []) {
      if (!c || !ID_RE.test(c.id)) continue;
      const prev = byId.get(c.id);
      if (!prev || ts(c) > ts(prev)) byId.set(c.id, { ...c, migratedFrom: u });
    }
  }
  // l'"Aurora" di partenza creata in automatico per ciascun profilo, mai modificata e senza messaggi, non viene duplicata
  let list = [...byId.values()];
  const pristine = (c) => c.name === DEFAULT_CHAR.name && c.avatar === DEFAULT_CHAR.avatar && c.personality === DEFAULT_CHAR.personality && !c.updatedAt && !(chats.get(c.id) || []).length;
  const keepOne = list.find(pristine);
  if (list.length > 1) {
    const before = list.length;
    list = list.filter((c) => !pristine(c) || (c === keepOne && list.every((x) => pristine(x))));
    report.skippedDefaults = before - list.length;
  }
  if (list.length) { writeJSON(CHARS_FILE(), list); report.characters = list.length; }
  for (const [id, msgs] of chats) {
    if (!msgs.length) continue;
    msgs.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
    let n = 0; for (const m of msgs) { delete m.n; m.n = ++n; }
    writeJSON(chatFile(id), { epoch: newId(), messages: msgs }); report.chats++; report.messages += msgs.length;
  }
  // 4) memoria: unione (dedup per id e per testo), ogni fatto ricorda da quale profilo arriva
  const mem = readJSON(MEM_FILE(), []) || []; const ids = new Set(mem.map((m) => m.id)); const texts = new Set(mem.map((m) => String(m.text).toLowerCase()));
  for (const u of users) {
    for (const m of readJSON(path.join(DATA_DIR, 'users', u, 'memory.json'), []) || []) {
      const t = cleanFact(m && m.text); if (!t || ids.has(m.id) || texts.has(t.toLowerCase())) continue;
      ids.add(m.id); texts.add(t.toLowerCase());
      mem.push({ id: ID_RE.test(m.id) ? m.id : newId(), text: t, source: m.source === 'auto' ? 'auto' : 'manuale', by: u, createdAt: m.createdAt || new Date().toISOString(), migratedFrom: u });
    }
  }
  if (mem.length) { writeJSON(MEM_FILE(), mem.slice(-300)); report.memory = mem.length; }
  writeJSON(MIGRATION_MARK(), report);
  console.log(`Archivio condiviso: migrazione completata (personaggi ${report.characters}, chat ${report.chats}, messaggi ${report.messages}, ricordi ${report.memory}, avatar ${report.avatars}).`);
}
backupShared('avvio', { force: true }); // copia di sicurezza a ogni avvio, prima di qualsiasi modifica
try { migrateToShared(); } catch (e) { console.error('Migrazione archivio condiviso NON riuscita (i vecchi file restano intatti):', e.message); }
// recupero una tantum dei personaggi persi, poi memoria base per i personaggi che non l'hanno ancora
(async () => {
  await startupRecovery();
  for (const c of readJSON(CHARS_FILE(), []) || []) if (!c.memorySeededAt) await seedBaseMemory(c).catch((e) => console.error('Memoria base non creata:', e.message));
})();
setInterval(() => backupShared('orario'), 60 * 60e3).unref(); // ogni ora, solo se qualcosa è cambiato

app.listen(PORT, () => {
  console.log(`App privata avviata su http://localhost:${PORT}`);
  const pins = getPins();
  for (const [u, a] of Object.entries(USERS)) if (!pins[u]) console.log(`Profilo ${a.name}: PIN non ancora impostato (si crea al primo accesso dall'app).`);
});
