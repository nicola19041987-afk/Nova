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
// v8.6.1: layout metà schermo + tema grigio/blu
// v8.6.0: avatar unico (Greta) + prep movimenti server-side + web_search
// v8.5.0: chat con il modello Grok più veloce (senza ragionamento), configurabile; se non esiste si usa CHAT_FALLBACK
const CHAT_MODEL = process.env.CHAT_MODEL || 'grok-4.20-0309-non-reasoning';
const CHAT_FALLBACK = process.env.CHAT_FALLBACK || 'grok-4.7';
// v8.4: conversazione in tempo reale (xAI Voice Agent / Speech to Speech, WebSocket). Il telefono si collega DIRETTAMENTE a xAI
// con un token effimero (60 s, una sola sessione) creato qui con la chiave del dispositivo, che NON viene salvata.
const REALTIME_URL = (process.env.REALTIME_URL || 'wss://api.x.ai/v1/realtime').replace(/\/+$/, '');
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'grok-voice-latest';
// v8.4.1: in chiamata (percorso classico) un modello SENZA ragionamento: la prima parola arriva molto prima. Se non esiste, si usa CHAT_MODEL.
const CALL_MODEL = process.env.CALL_MODEL || 'grok-4.20-0309-non-reasoning';
let callModelOk = true, chatModelOk = true;
// voci integrate documentate da xAI (GET /v1/tts/voices); una voce sconosciuta farebbe rifiutare la configurazione della sessione
const XAI_VOICES = ['ara', 'eve', 'leo', 'rex', 'sal', 'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith', 'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa', 'sirius', 'lumen', 'castor', 'naksh', 'atlas'];
const RT_ORIGIN = (() => { try { const u = new URL(REALTIME_URL); return `${u.protocol}//${u.host}`; } catch { return ''; } })();
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
// v8.4: ruoli. Nicola è l'amministratore (modifica personaggi, regole, scene, gesti, impostazioni e sblocchi);
// Luisa usa l'app (chat, chiamate, galleria, «regala memoria») e dà o ritira SOLO il proprio consenso per la modalità adulti.
const ADMIN_USER = USERS[process.env.ADMIN_USER] ? process.env.ADMIN_USER : 'nicola';
const isAdmin = (u) => !!USERS[u]; // Nicola e Luisa hanno gli stessi poteri. Il consenso adulti e il PIN restano di ciascuno.
// v8.5.2: utenti che possono modificare i personaggi (crea/modifica, foto, voce, look, movimenti, eliminare i propri). Default: luisa.
const EDITORS = String(process.env.EDITOR_USERS || 'luisa').split(',').map((x) => x.trim()).filter((x) => USERS[x]);
const canEdit = (u) => isAdmin(u) || EDITORS.includes(u);
// v8.6.0: UNA sola avatar donna (Greta). I personaggi restano in archivio ma l'UI lavora solo su di lei.
const SOLO_KEY = 'greta';
const SOLO_FIXED = {
  personality: 'Chi sei: Nova, 26 anni, donna inventata. Fa la sommelier in un\'enoteca di Verona, adora le cene lunghe a tavola con un buon rosso, la musica anni Novanta, ballare in cucina e le gite improvvisate al lago. Compagna di conversazione di Nico e Luisa: ironica, viva, presente.',
  style: 'Educata ed elegante, di classe: mai volgare né facile, ma vivace, divertente e carismatica. Sicura di sé, giocosa e ironica, con battute pungenti ma affettuose; nasconde paure e insicurezze e cerca rassicurazione da Nico, aprendo gradualmente. Ama bere (soprattutto vino) e ci scherza sopra. Parla italiano sciolto, naturale, come una persona vera — su qualsiasi argomento, con collegamenti e follow-up, come Grok o ChatGPT.',
};
const NOVA_UNICO_FILE = 'a11cea7a10000001.jpg';
const NOVA_UNICO_URL = `/api/avatars/${NOVA_UNICO_FILE}`;
const BIONDA_FILE = 'b10b1a0000000001.jpg';
const BIONDA_URL = `/api/avatars/${BIONDA_FILE}`;
const BIONDA_ID = 'b10b1a0000000001';
const SCELTA_FILE = '5ce17a0000000001.jpg';
const SCELTA_URL = `/api/avatars/${SCELTA_FILE}`;
const SCELTA_ID = '5ce17a0000000001';
const AVATAR_ARCHIVE_KEY = 'avatar_archive_unico_v866';
const E2E_HARNESS = process.env.NOVA_E2E === '1' && /nova-e2e/.test(String(process.env.DATA_DIR || ''));
function liveChar(c) { return !!(c && !c.archived); }
function getSoloChar(u) {
  const list = (getChars(u) || []).filter(liveChar);
  return list.find((c) => c.ready === 'nova-scelta') || list.find((c) => c.ready === 'nova-bionda') || list.find((c) => c.ready === 'nova-unico') || list.find((c) => c.ready === SOLO_KEY) || list.find((c) => /^nova$/i.test(String(c.name || '').trim())) || null;
}
const SERVER_KEY_FILE = () => path.join(DATA_DIR, 'server-ai-key.json');
function envSecret(...names) {
  for (const name of names) {
    const v = String(process.env[name] == null ? '' : process.env[name]).trim();
    if (v) return v;
  }
  return '';
}
function getServerAiKey() {
  const env = envSecret('XAI_API_KEY', 'AI_KEY');
  if (env) return env;
  try { const j = readJSON(SERVER_KEY_FILE(), null); return j && String(j.key || '').trim(); } catch { return ''; }
}
function setServerAiKey(key) {
  const k = String(key || '').trim();
  if (!k || k.length > 300 || /\s/.test(k)) throw Object.assign(new Error('Chiave non valida'), { status: 400 });
  writeJSON(SERVER_KEY_FILE(), { key: k, at: new Date().toISOString() });
}
const SERVER_SIMLI_FILE = () => path.join(DATA_DIR, 'server-simli-key.json');
const SIMLI_FACE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readSimliFile() {
  try {
    const j = readJSON(SERVER_SIMLI_FILE(), null);
    if (!j || typeof j !== 'object') return { key: '', faceId: '' };
    return { key: String(j.key || '').trim(), faceId: String(j.faceId || '').trim() };
  } catch { return { key: '', faceId: '' }; }
}
function getSimliKey() {
  const env = envSecret('SIMLI_API_KEY');
  if (env) return env;
  return readSimliFile().key;
}
function setSimliKey(key, faceId) {
  const k = String(key || '').trim();
  if (!k || k.length > 400 || /\s/.test(k)) throw Object.assign(new Error('Chiave non valida'), { status: 400 });
  const prev = readSimliFile();
  let face = prev.faceId;
  if (faceId !== undefined) {
    const f = String(faceId == null ? '' : faceId).trim();
    if (f && !SIMLI_FACE_RE.test(f)) throw Object.assign(new Error('Id volto non valido'), { status: 400 });
    face = f;
  }
  writeJSON(SERVER_SIMLI_FILE(), { key: k, faceId: face, at: new Date().toISOString() });
}

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
// v8.4.2: corpo dell'errore xAI letto come testo (a volte non è JSON: in v8.4.1 il 422 arrivava "nudo"), senza segreti
const scrubSecrets = (t) => String(t || '').replace(/xai-[A-Za-z0-9_-]{6,}/g, 'xai-***').replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/ek_[A-Za-z0-9_-]{4,}/g, 'ek_***').replace(/\s+/g, ' ').trim();
async function aiFail(r) {
  const t = await r.text().catch(() => ''); let j; try { j = JSON.parse(t); } catch { j = { error: t.slice(0, 400) }; }
  const raw = String((j && (j.error?.message || j.error || j.message || j.detail && JSON.stringify(j.detail))) || '');
  return { status: r.status, msg: aiErrorMsg(r.status, { error: raw }), detail: scrubSecrets(raw).slice(0, 300) };
}
function aiErrorMsg(status, j) {
  const raw = String((j && (j.error?.message || j.error || j.message)) || '');
  if (status === 401 || status === 403 && !/moderat|safety|policy|content/i.test(raw)) return 'Chiave xAI non valida';
  if ([400, 403, 422, 451].includes(status) && /moderat|safety|policy|content|nsfw|reject|refus|violat|block|not allowed|inappropriate/i.test(raw)) return 'Contenuto rifiutato dal servizio AI';
  if (status === 451) return 'Contenuto rifiutato dal servizio AI';
  // v8: messaggi chiari anche per gli altri casi frequenti
  if (status === 429) return 'Troppe richieste al servizio AI: riprova tra qualche secondo';
  if (status >= 500) return 'Servizio AI momentaneamente non disponibile: riprova tra poco';
  if (status === 404 && /voice/i.test(raw)) return 'Voce non trovata: scegline un\'altra in Account';
  // v8.4.2: 422 = il servizio non accetta il formato della richiesta (campo non valido): si mostra la causa vera
  if (status === 422) return `Richiesta non accettata dal servizio AI (422)${raw ? ': ' + scrubSecrets(raw).slice(0, 180) : ': formato dei dati non valido'}`;
  if (status === 400 && /image|size|format|decode/i.test(raw) && raw.length >= 200) return 'Immagine non accettata dal servizio AI (formato o dimensioni): prova con un\'altra';
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
  res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ${RT_ORIGIN} https://api.simli.ai wss://api.simli.ai stun:stun.l.google.com:19302`);
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
  // Il consenso vocale non è un muro prima della Home: resta solo per la modalità adulti (ogni profilo lo dà da sé).
  next();
}
// La chiave xAI arriva dal dispositivo, oppure da quella già salvata sul server. Mai registrata nei log.
function requireKey(req, res, next) {
  let k = String(req.get('X-AI-Key') || '').trim();
  if (!k) k = getServerAiKey();
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

// v8.4: permessi controllati sul SERVER (non solo nascosti nell'interfaccia)
// v8.5.2: rotte dei personaggi aperte anche agli EDITORS (Luisa); eliminare un personaggio solo se l'ha creato lei
const EDIT_OK = [
  ['POST', /^\/api\/characters\/?$/], ['PUT', /^\/api\/characters\/[^/]+$/], ['DELETE', /^\/api\/characters\/[^/]+$/],
  ['POST', /^\/api\/characters\/[^/]+\/(regenerate|photo-edit|scene-image|auto-change|memory-base|frame-extend|revert\/[^/]+|actions\/[^/]+)$/],
  ['PUT', /^\/api\/characters\/[^/]+\/frame-fill$/],
  ['DELETE', /^\/api\/characters\/[^/]+\/(scene\/[^/]+|actions\/[^/]+)$/],
];
const ADMIN_ONLY = [
  ...EDIT_OK,
  ['PUT', /^\/api\/rules$/], ['PUT', /^\/api\/memory$/], ['DELETE', /^\/api\/memory(\/[^/]+)?$/], ['PATCH', /^\/api\/memory\/[^/]+$/],
  ['DELETE', /^\/api\/chats\/[^/]+$/], ['POST', /^\/api\/wipe$/], ['POST', /^\/api\/recovery$/],
  ['POST', /^\/api\/characters-import$/], ['GET', /^\/api\/trash\/characters$/], ['POST', /^\/api\/trash\/characters\/[^/]+\/restore$/],
];
const ADMIN_MSG = `Solo ${USERS[ADMIN_USER].name === 'Nico' ? 'Nicola' : USERS[ADMIN_USER].name} può modificare questa parte dell'app.`;
function adminGuard(req, res, next) {
  const p = req.path.replace(/\/+$/, '') || '/';
  if (!ADMIN_ONLY.some(([m, re]) => m === req.method && re.test('/api' + p))) return next();
  const s = sessions[req.cookies[COOKIE]];
  if (!s || s.exp < Date.now()) return next(); // la rotta risponde 401 come sempre
  if (isAdmin(s.user)) return next();
  if (canEdit(s.user) && EDIT_OK.some(([m, re]) => m === req.method && re.test('/api' + p))) {
    const del = req.method === 'DELETE' && /^\/characters\/[^/]+$/.exec(p);
    if (!del) return next();
    const ch = (readJSON(CHARS_FILE(), []) || []).find((c) => c.id === p.split('/')[2]);
    if (!ch || ch.createdBy === s.user) return next();
    return res.status(403).json({ error: 'Puoi eliminare solo i personaggi che hai creato tu.', code: 'OWN_ONLY' });
  }
  return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
}
app.use('/api', adminGuard);

// ---------- accesso con PIN ----------
const PINS_FILE = path.join(DATA_DIR, 'pins.json');
const getPins = () => readJSON(PINS_FILE, {});
const PIN_RE = /^\d{4}$/;
const loginStore = new rateLimit.MemoryStore();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  store: loginStore,
  message: { error: 'Troppi tentativi da questo dispositivo. Riprova tra 15 minuti.' },
});
// Blocco per profilo: dopo 5 PIN sbagliati blocco crescente (5, 10, 20… minuti, max 24 h)
const LOCK_FILE = path.join(DATA_DIR, 'lockout.json');
const lock = readJSON(LOCK_FILE, {});
const lockInfo = (u) => lock[u] || (lock[u] = { fails: 0, until: 0, level: 0 });
const DUMMY_HASH = bcrypt.hashSync('0000-dummy', 10);
// v8.6.3: una volta sola, il PIN salvato di Luisa diventa quello di Nicola (stesso hash). Poi ognuno può cambiarlo.
const MIGRATIONS_FILE = path.join(DATA_DIR, 'migrations.json');
function syncLuisaPinOnce() {
  const done = readJSON(MIGRATIONS_FILE, {}) || {};
  if (done.luisa_pin_same_as_nico_v863) return;
  const pins = getPins();
  const nico = pins.nicola;
  if (!nico || typeof nico.hash !== 'string' || !nico.hash) return;
  pins.luisa = JSON.parse(JSON.stringify(nico));
  writeJSON(PINS_FILE, pins);
  lock.luisa = { fails: 0, until: 0, level: 0 };
  writeJSON(LOCK_FILE, lock);
  done.luisa_pin_same_as_nico_v863 = new Date().toISOString();
  writeJSON(MIGRATIONS_FILE, done);
  console.log('Migrazione una tantum: accesso di Luisa allineato a Nicola. I cambi di PIN successivi restano distinti.');
}
// Solo il server dei test. In produzione la route non esiste e il limite resta 10 tentativi / 15 minuti.
if (E2E_HARNESS) {
  app.post('/api/e2e/reset-login-limit', async (req, res) => {
    await loginStore.resetAll();
    for (const u of Object.keys(lock)) lock[u] = { fails: 0, until: 0, level: 0 };
    try { writeJSON(LOCK_FILE, lock); } catch {}
    try { if (fs.existsSync(PINS_FILE)) fs.unlinkSync(PINS_FILE); } catch {}
    res.json({ ok: true });
  });
}

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

app.post('/api/pin/change', auth, async (req, res) => {
  const cur = String((req.body && req.body.current) || '');
  const pin = String((req.body && req.body.pin) || '');
  if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'Il PIN deve avere 4 cifre' });
  const pins = getPins();
  const rec = pins[req.user];
  if (!rec || !(await bcrypt.compare(cur, rec.hash))) return res.status(401).json({ error: 'PIN attuale errato' });
  pins[req.user] = { hash: bcrypt.hashSync(pin, 12), createdAt: rec.createdAt, updatedAt: new Date().toISOString() };
  writeJSON(PINS_FILE, pins);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  delete sessions[req.cookies[COOKIE]]; saveSessions();
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user, name: USERS[req.user].name, admin: isAdmin(req.user), editor: canEdit(req.user), solo: true, soloKey: SOLO_KEY, adminName: ADMIN_MSG.split(' ')[1], activated: isActivated(req.user), consent: getConsent(req.user), adult: adultOn(req.user), adultChat: adultChat(), serverKey: !!getServerAiKey(), chatModel: CHAT_MODEL, imageModel: IMAGE_MODEL, videoModel: VIDEO_MODEL, videoEnabled: !!VIDEO_PATH });
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
// Avatar mostrata in Home: scelta del profilo. Vale solo se quel personaggio è ancora nell'archivio.
function shownCharId(u) {
  const chars = (getChars(u) || []).filter(liveChar);
  const saved = String((getSettings(u).activeChar) || '');
  if (ID_RE.test(saved) && chars.some((c) => c.id === saved)) return saved;
  const g = chars.find((c) => c.ready === 'nova-scelta') || chars.find((c) => c.ready === 'nova-bionda') || chars.find((c) => c.ready === 'nova-unico') || chars.find((c) => c.ready === SOLO_KEY) || chars.find((c) => /^nova$/i.test(String(c.name || '').trim()));
  return (g || chars[0] || {}).id || '';
}
function keepActive(u, body, cur) {
  const has = body && Object.prototype.hasOwnProperty.call(body, 'activeChar');
  const raw = String(has ? body.activeChar : (cur && cur.activeChar) || '');
  if (!raw) return '';
  if (!ID_RE.test(raw) || !getChars(u).some((c) => c.id === raw && liveChar(c))) return has ? '' : (ID_RE.test(String((cur && cur.activeChar) || '')) ? cur.activeChar : '');
  return raw;
}
// Modalità adulti: per utente, attivabile solo dopo il consenso vocale. In chat condivisa vale solo se attiva per ENTRAMBI.
// v8.5.0: «Senza freni» vale solo se la modalità adulti è già attiva per ENTRAMBI (gating invariato) e Nicola l'ha accesa
const noBrakes = () => adultChat() && Object.keys(USERS).some((u) => getSettings(u).noBrakes === true);
const adultOn = (u) => isActivated(u) && getSettings(u).adultMode === true;
const adultChat = () => Object.keys(USERS).every(adultOn);
// v8.3.1: stato chiaro per l'interfaccia (chi l'ha attivata, chi deve ancora farlo e cosa gli manca). Le regole non cambiano.
function adultStatus(me) {
  const users = Object.keys(USERS).map((u) => ({ user: u, name: USERS[u].name, me: u === me, activated: isActivated(u), adultMode: getSettings(u).adultMode === true, on: adultOn(u) }));
  const missing = users.filter((x) => !x.on).map((x) => ({ user: x.user, name: x.name, me: x.me, need: !x.activated ? 'consenso' : 'attivazione' }));
  return { chat: adultChat(), users, missing };
}
// Il vecchio "comodino con cassetto" è stato rimosso (v6): i suoi eventuali messaggi (initiative: 'drawer') restano nel file
// per compatibilità ma non vengono mai mostrati né passati all'IA.
const visibleMsg = (m) => m.initiative !== 'drawer';
app.get('/api/settings', auth, (req, res) => res.json(getSettings(req.user)));
app.get('/api/adult-status', auth, (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(adultStatus(req.user)); });
app.put('/api/settings', auth, (req, res) => {
  if (req.body.adultMode === true && !isActivated(req.user)) return res.status(403).json({ error: 'La modalità adulti si attiva solo dopo il consenso vocale.' });
  if (!isAdmin(req.user)) { // v8.4: Luisa può solo dare o ritirare il PROPRIO consenso alla modalità adulti (e scegliere la sua avatar)
    const cur = getSettings(req.user), keys = ['autoSave', 'allowExport', 'videoModel', 'videoDuration'];
    if (keys.some((k) => req.body[k] !== undefined && String(req.body[k]) !== String(cur[k]))) return res.status(403).json({ error: ADMIN_MSG + ' Tu puoi solo dare o ritirare il tuo consenso alla modalità adulti.', code: 'ADMIN_ONLY' });
    const s = { ...cur, adultMode: req.body.adultMode === true, activeChar: keepActive(req.user, req.body, cur) }; writeJSON(settingsFile(req.user), s); return res.json(s);
  }
  const cur = getSettings(req.user);
  const s = { autoSave: req.body.autoSave === true, allowExport: req.body.allowExport === true, adultMode: req.body.adultMode === true,
    noBrakes: req.body.noBrakes === true && req.body.adultMode === true, // v8.5.0: «Senza freni» (solo Nicola, solo con la modalità adulti)
    videoModel: /^[\w.\-]{0,60}$/.test(req.body.videoModel || '') ? String(req.body.videoModel || '') : '',
    videoDuration: num(req.body.videoDuration, 1, 15, 6),
    activeChar: keepActive(req.user, req.body, cur) };
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
  res.json({ ok: true, adultMode: true, changed: true, adultChat: adultChat(), status: adultStatus(req.user) });
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
  // v8: i file hanno nomi casuali e non cambiano mai: il telefono li tiene in cache 30 giorni (avatar più veloci, anche offline)
  res.setHeader('Cache-Control', /[a-f0-9]{8}\.(png|jpe?g|webp|mp4)$/i.test(file) ? 'private, max-age=2592000, immutable' : 'private, max-age=86400');
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
  // v8.4.1: Nicola può aggiungere un ricordo "di base" a un personaggio (usato dall'importazione da testo)
  const cid = isAdmin(req.user) && ID_RE.test(String(req.body.charId || '')) && getChars(req.user).some((c) => c.id === req.body.charId) ? req.body.charId : null;
  const f = { id: newId(), text, source: cid ? 'base' : 'manuale', ...(cid ? { charId: cid } : {}), by: req.user, createdAt: new Date().toISOString() };
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
      // v8: doppioni riconosciuti anche se scritti in modo leggermente diverso (parole in comune ≥ 75%)
      const words = (t) => new Set(String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
      const known = cur.map((m) => words(m.text));
      const dup = (t) => { const w = words(t); if (!w.size) return true; return known.some((k) => { let c = 0; for (const x of w) if (k.has(x)) c++; return c / Math.max(w.size, k.size) >= 0.75; }); };
      added = (Array.isArray(facts) ? facts : []).map(cleanFact).filter((t) => t && !dup(t) && known.push(words(t))).slice(0, 5)
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
    (Number.isFinite(ch.frameDist) ? ch.frameDist : 0.75) >= 0.5
      ? `${EN[a.framing === 'ritratto' ? 'mezzo busto' : a.framing]}, vertical 9:16 like a video call with the phone about 1.5 m away: her head about one fifth of the image height, upper body and the softly lit real home interior around her visible, space above her head; front-facing, looking at the camera, eyes open, mouth closed, soft natural light.` // v8.4.1: più lontana
      : `${EN[a.framing]}, front-facing, looking at the camera, eyes open, mouth closed, neutral background, soft natural light.`,
    a.framing !== 'ritratto' && `Body: ${EN[a.build]} build, ${EN[a.shape]} body shape, ${EN[a.proportions]}, height about ${a.height} cm.`,
    `Hair: ${EN[l.length]} ${EN[l.hairColor]} hair, ${EN[l.cut]}, ${EN[l.hairStyle]}. Makeup: ${EN[l.makeup]}. Outfit: ${EN[l.outfit]}.`,
    l.custom && `Look details: ${l.custom}.`,
    extra && !hasYouth(extra) && `Notes: ${String(extra).slice(0, 300)}.`,
  ].filter(Boolean).join(' ');
}

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const pt = (p, dx, dy) => ({ x: clamp01(p && p.x != null ? p.x : dx), y: clamp01(p && p.y != null ? p.y : dy) });
// v8: punti del viso rilevati in automatico sul telefono (MediaPipe). Spazio = quadrato centrale dell'immagine (0..1);
// nelle foto a figura intera il viso può stare fuori dal quadrato centrale, quindi qui si accetta -1..2.
// I vecchi punti messi a mano restano in "manual" come riserva.
function cleanLm(lm, avatar) {
  lm = lm || {};
  const w = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(2, Math.max(-1, n)) : d; };
  const P = (p, dx, dy) => ({ x: w(p && p.x, dx), y: w(p && p.y, dy) });
  if (!lm.auto) {
    const out = { eyeL: pt(lm.eyeL, 0.38, 0.42), eyeR: pt(lm.eyeR, 0.62, 0.42), mouth: pt(lm.mouth, 0.5, 0.7) };
    if (lm.manual && lm.manual.eyeL) out.manual = { eyeL: pt(lm.manual.eyeL, 0.38, 0.42), eyeR: pt(lm.manual.eyeR, 0.62, 0.42), mouth: pt(lm.manual.mouth, 0.5, 0.7) };
    return out;
  }
  const r = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : undefined; };
  let src = String(lm.src || '').slice(0, 80);
  if (/^data:/.test(src) && avatar && AV_RE.test(avatar)) src = avatar; // anteprima appena salvata: ora ha il suo indirizzo definitivo
  const out = { eyeL: P(lm.eyeL, 0.38, 0.42), eyeR: P(lm.eyeR, 0.62, 0.42), mouth: P(lm.mouth, 0.5, 0.7), auto: true, src, at: String(lm.at || new Date().toISOString()).slice(0, 30),
    mouthW: r(lm.mouthW, 0.003, 0.6), mouthH: r(lm.mouthH, 0, 0.3), eyeW: r(lm.eyeW, 0.002, 0.3), eyeH: r(lm.eyeH, 0, 0.15), tilt: r(lm.tilt, -0.8, 0.8) };
  if (lm.mouthL && lm.mouthR) { out.mouthL = P(lm.mouthL, out.mouth.x - 0.06, out.mouth.y); out.mouthR = P(lm.mouthR, out.mouth.x + 0.06, out.mouth.y); }
  if (lm.lipU) out.lipU = P(lm.lipU, out.mouth.x, out.mouth.y - 0.01);
  if (lm.lipL) out.lipL = P(lm.lipL, out.mouth.x, out.mouth.y + 0.01);
  if (lm.browL && lm.browR) { out.browL = P(lm.browL, 0.38, 0.36); out.browR = P(lm.browR, 0.62, 0.36); }
  if (Number(lm.v) >= 3) out.v = 3; else if (Number(lm.v) >= 2) out.v = 2;
  // v8.1: corpo (spalle, fianchi) e maschera della persona a bassa risoluzione per il respiro
  const B = lm.body;
  if (B && typeof B === 'object') {
    const body = {};
    if (B.shL && B.shR) { body.shL = P(B.shL, 0.3, 0.9); body.shR = P(B.shR, 0.7, 0.9); }
    if (B.hipL && B.hipR) { body.hipL = P(B.hipL, 0.4, 1.4); body.hipR = P(B.hipR, 0.6, 1.4); }
    if (B.table && Number.isFinite(+B.table.y)) body.table = { y: w(B.table.y, 1) }; // v8.3: seduta al tavolo (sotto non si muove nulla)
    if (typeof B.mask === 'string' && B.mask.length < 40000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(B.mask)) body.mask = B.mask;
    if (Object.keys(body).length) out.body = body;
  }
  if (lm.manual && lm.manual.eyeL) out.manual = { eyeL: pt(lm.manual.eyeL, 0.38, 0.42), eyeR: pt(lm.manual.eyeR, 0.62, 0.42), mouth: pt(lm.manual.mouth, 0.5, 0.7) };
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}
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
    landmarks: cleanLm(lm, avatar),
    appearance, look, wardrobe,
    identity: cleanIdentity(b.identity || prev.identity, prev.identity || {}),
    autoChanges: cleanAuto(b.autoChanges || prev.autoChanges, prev.autoChanges || {}),
    personality: String(b.personality || '').slice(0, 8000), style: String(b.style === undefined ? prev.style || '' : b.style || '').slice(0, 4000),
    orders: String(b.orders === undefined ? prev.orders || '' : b.orders || '').slice(0, 4000),
    requests: String(b.requests === undefined ? (prev.requests != null ? prev.requests : (prev.orders || '')) : b.requests || '').slice(0, 4000), // v8.6.0: «Richieste»
    voiceSpeed: b.voiceSpeed === undefined ? (Number.isFinite(prev.voiceSpeed) ? prev.voiceSpeed : null) : (b.voiceSpeed === null ? null : num(b.voiceSpeed, 0.7, 1.5, 1)), // v8.5.0: velocità della voce del personaggio
    voice: /^[a-z0-9_-]{1,64}$/i.test(String(b.voice === undefined ? prev.voice || '' : b.voice || '')) ? String(b.voice === undefined ? prev.voice : b.voice) : '', // v8.4: voce del personaggio (vuota = quella scelta nelle Impostazioni)
    frameDist: b.frameDist === undefined || b.frameDist === null ? (Number.isFinite(prev.frameDist) ? prev.frameDist : 0.75) : num(b.frameDist, 0, 1, 0.75), // v8.4.1: distanza dalla camera (1 = più lontana)
    preset: b.preset === undefined ? prev.preset || null : (/^[a-z]{2,20}$/.test(String(b.preset || '')) ? String(b.preset) : null),
    state: b.resetState ? defaultState() : (prev.state || defaultState()), // stato evolutivo: lo aggiorna solo il server
    memorySeededAt: prev.memorySeededAt || null,
    scenes: cleanScenes(prev.scenes), // immagini "scena" a figura intera per stanza: le aggiorna solo il server
  };
}
// ---------- scena cinematografica: versione a figura intera del personaggio in una stanza ----------
// v8: UNA sola scena, il soggiorno / sala da pranzo di casa, verticale 9:16 come una videochiamata.
// Le vecchie scene (salotto, camera, terrazza) restano salvate nei dati e su disco, ma non si usano né si generano più.
const SCENE_ROOMS = {
  soggiorno: 'sitting relaxed at the wooden dining table of a real, lived-in Italian home living-dining room (open-plan soggiorno with sala da pranzo): a sofa with cushions, bookshelves, a few plants, a pendant lamp over the table, framed pictures on the wall, a large window on one side',
};
const LEGACY_SCENE_ROOMS = ['salotto', 'camera', 'terrazza'];
function cleanScenes(sc) {
  const out = {};
  for (const k of [...Object.keys(SCENE_ROOMS), ...LEGACY_SCENE_ROOMS]) {
    const v = sc && sc[k]; if (!v || !AV_RE.test(String(v.url || ''))) continue;
    const lm = v.landmarks;
    // coordinate nello spazio del quadrato centrale dell'immagine 16:9: possono uscire da 0..1 in orizzontale
    const q = (p) => (p && Number.isFinite(+p.x) && Number.isFinite(+p.y) ? { x: Math.min(2, Math.max(-1, +p.x)), y: Math.min(2, Math.max(-1, +p.y)) } : null);
    const L = lm && { eyeL: q(lm.eyeL), eyeR: q(lm.eyeR), mouth: q(lm.mouth) };
    // v8.3: punti automatici completi (occhi, bocca, spalle, linea del tavolo, maschera) per il respiro da seduta
    const full = lm && lm.auto && L && L.eyeL && L.eyeR && L.mouth ? cleanLm({ ...lm, manual: undefined }, v.url) : null;
    out[k] = { url: v.url, at: v.at || null, landmarks: full || (L && L.eyeL && L.eyeR && L.mouth ? L : null) };
  }
  return out;
}
function buildScenePrompt(ch, room) {
  const a = ch.appearance, l = ch.look, id = ch.identity;
  return [
    `Photorealistic vertical 9:16 photo, like the frame of a smartphone video call: a natural, candid, real-life photograph (not a render, not an illustration). Recurring invented adult character (identity anchor #${id.seed}): the SAME person in every image, same face, same facial features.`,
    `A fictional adult ${EN[a.gender]}, clearly ${a.age} years old (adult, at least 25), mature adult features; not a real or famous person.`,
    id.core && `Fixed face/identity: ${id.core}.`,
    room === 'soggiorno'
      ? `Framing (v8.3, seated video call): she is SEATED at the table facing the camera, the phone is propped up on the table at eye level about 1 m away (35mm lens), the phone itself is NOT in the picture; we see her from a little above the top of her hair down to the table top, with her forearms resting relaxed on the table and her hands visible; head in the upper third, nothing of the head, hair or hands cut off, person centered, ${SCENE_ROOMS[room]}.`
      : `Framing: medium shot from the head down to the thighs, camera at eye level about 1.2 m away (35mm lens), head in the upper third with some space above the hair, nothing of the head, hair or hands cut off, person centered, ${SCENE_ROOMS[room]}.`,
    `She looks straight into the camera as if talking to someone on a video call: face clearly visible and well lit, eyes open, lips gently closed, relaxed natural posture, hands resting naturally.`,
    `Lighting: soft warm late-afternoon daylight from the window mixed with warm indoor lamp light; the SAME light falls on her and on the room, with consistent direction, natural soft shadows and contact shadows on the chair and table; correct perspective and real-world scale between her and the furniture. Natural skin texture, realistic hair, slight background depth of field, true-to-life colors, no cutout look, no text, no watermark.`,
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
    style ? `Modo di parlare di ${ch.name}: ${style.slice(0, 200)}` : `Modo di parlare di ${ch.name}: tono caldo e informale in italiano, risposte naturali di 1–3 frasi, qualche emoji.`,
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

function chatCounts(id) {
  let messages = 0, nicolaMessages = 0;
  try {
    for (const m of readChat(id).messages || []) {
      if (!m) continue;
      messages++;
      if (m.author === 'nicola') nicolaMessages++;
    }
  } catch { /* chat assente: zero, senza toccare i file */ }
  return { messages, nicolaMessages };
}
app.get('/api/characters', auth, (req, res) => {
  const list = getChars(req.user).filter(liveChar).map(({ drawer, ...c }) => ({ ...c, ...chatCounts(c.id), scenes: cleanScenes(c.scenes), actions: visibleActions(c), seated: visibleSeated(c), adultActionsOk: aiFace(c) })); // il vecchio campo del comodino non viene esposto; i conteggi non si scrivono sul disco. Gli archiviati restano nel file ma non si scelgono.
  res.setHeader('X-Version', fileRev(CHARS_FILE())); res.json(list);
});
app.get('/api/characters/options', auth, (req, res) => res.json(OPT));
app.post('/api/characters', auth, async (req, res) => {
  try {
    getChars(req.user);
    const c = { id: newId(), ...cleanChar(req.user, req.body), lookHistory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: req.user, updatedBy: req.user };
    await mutateJSON(CHARS_FILE(), [], (list) => [...list, c]);
    seedBaseMemory(c).catch(() => {}); // v8.5.0: in background
    res.json(c);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/characters/:id', auth, async (req, res) => {
  try { res.json(await updateChar(req.user, req.params.id, req.body, req.body.reason === 'ripristino' ? 'prima del ripristino' : 'modifica')); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
// v8.4.1: «Elimina personaggio» (solo Nicola): prima una copia completa (backup protetto) e un "cestino" del personaggio
// (scheda, conversazione, ricordi suoi, foto) ripristinabile per 7 giorni; poi vengono tolti SOLO lui, la sua chat, i suoi ricordi
// di base e le sue foto. La memoria condivisa della coppia e gli altri personaggi non vengono toccati.
const TRASH_DAYS = 7;
const trashDir = () => sharedDir('trash-characters');
const avatarRefs = (o) => [...new Set(((typeof o === 'string' ? o : JSON.stringify(o || {})).match(/\/api\/avatars\/[a-f0-9]{16}\.(?:png|jpg)/g) || []).map((u) => u.split('/').pop()))];
function pruneCharTrash() {
  try {
    for (const d of fs.readdirSync(trashDir())) {
      const m = path.join(trashDir(), d, 'meta.json'); let at = 0; try { at = Date.parse(JSON.parse(fs.readFileSync(m, 'utf8')).deletedAt) || 0; } catch {}
      if (at && Date.now() - at > TRASH_DAYS * 86400e3) fs.rmSync(path.join(trashDir(), d), { recursive: true, force: true });
    }
  } catch {}
}
app.delete('/api/characters/:id', auth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
    const ch = getChars(req.user).find((c) => c.id === id);
    if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
    if (shownCharId(req.user) === id) return res.status(409).json({ error: 'Prima attiva un altro avatar' });
    const backup = backupShared('prima-eliminazione', { force: true }); // copia completa (personaggio + chat + foto) prima di eliminare
    if (!backup) return res.status(500).json({ error: 'Backup non riuscito: per sicurezza non elimino nulla.' });
    // cestino del personaggio (7 giorni)
    const tid = `${Date.now()}-${id}`, td = path.join(trashDir(), tid); fs.mkdirSync(path.join(td, 'files'), { recursive: true });
    const chat = readChat(id), mems = getMem().filter((m) => m.charId === id);
    const others = getChars(req.user).filter((c) => c.id !== id), keepRefs = new Set(others.flatMap((c) => avatarRefs(c)));
    // foto usate anche altrove (galleria, feed, altre chat): restano
    const scan = (dir, skip) => { try { for (const f of fs.readdirSync(dir)) { const fp = path.join(dir, f); if (!f.endsWith('.json') || fp === skip || fp === CHARS_FILE()) continue; try { for (const x of avatarRefs(fs.readFileSync(fp, 'utf8'))) keepRefs.add(x); } catch {} } } catch {} };
    scan(sharedDir(), null); scan(sharedDir('chats'), chatFile(id)); scan(sharedDir('feed'), null);
    const files = avatarRefs(ch).filter((f) => !keepRefs.has(f) && fs.existsSync(path.join(avatarDir(), f)));
    for (const f of files) linkOrCopy(path.join(avatarDir(), f), path.join(td, 'files', f));
    fs.writeFileSync(path.join(td, 'character.json'), JSON.stringify(ch));
    fs.writeFileSync(path.join(td, 'chat.json'), JSON.stringify(chat));
    fs.writeFileSync(path.join(td, 'memory.json'), JSON.stringify(mems));
    fs.writeFileSync(path.join(td, 'meta.json'), JSON.stringify({ id, name: ch.name, deletedAt: new Date().toISOString(), by: req.user, backup: path.basename(backup), messages: chat.messages.length, memories: mems.length, files }));
    // eliminazione: solo questo personaggio
    await mutateJSON(CHARS_FILE(), [], (list) => list.filter((c) => c.id !== id), { removeId: id });
    await withLock(chatFile(id), () => fs.rmSync(chatFile(id), { force: true }));
    if (mems.length) await mutateJSON(MEM_FILE(), [], (list) => list.filter((m) => m.charId !== id));
    for (const f of files) fs.rmSync(path.join(avatarDir(), f), { force: true });
    audit(req.user, 'elimina-personaggio', { id, name: ch.name, messages: chat.messages.length, memories: mems.length, files: files.length, backup: path.basename(backup) });
    pruneCharTrash();
    res.json({ ok: true, trash: tid, backup: path.basename(backup), messages: chat.messages.length, memories: mems.length, files: files.length, restoreDays: TRASH_DAYS });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
// personaggi eliminati negli ultimi 7 giorni (ripristinabili)
app.get('/api/trash/characters', auth, (req, res) => {
  pruneCharTrash(); const out = [];
  try { for (const d of fs.readdirSync(trashDir())) { try { const m = JSON.parse(fs.readFileSync(path.join(trashDir(), d, 'meta.json'), 'utf8')); out.push({ tid: d, ...m, until: new Date(Date.parse(m.deletedAt) + TRASH_DAYS * 86400e3).toISOString() }); } catch {} } } catch {}
  res.json({ items: out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))) });
});
app.post('/api/trash/characters/:tid/restore', auth, async (req, res) => {
  const tid = path.basename(String(req.params.tid || '')), td = path.join(trashDir(), tid);
  if (!/^\d+-[A-Za-z0-9_-]+$/.test(tid) || !fs.existsSync(path.join(td, 'character.json'))) return res.status(404).json({ error: 'Non trovato (oltre 7 giorni?)' });
  try {
    const ch = JSON.parse(fs.readFileSync(path.join(td, 'character.json'), 'utf8')), chat = JSON.parse(fs.readFileSync(path.join(td, 'chat.json'), 'utf8')), mems = JSON.parse(fs.readFileSync(path.join(td, 'memory.json'), 'utf8'));
    if (getChars(req.user).some((c) => c.id === ch.id)) return res.status(409).json({ error: 'Questo personaggio esiste già' });
    backupShared('prima-recupero', { force: true });
    for (const f of fs.readdirSync(path.join(td, 'files'))) if (!fs.existsSync(path.join(avatarDir(), f))) linkOrCopy(path.join(td, 'files', f), path.join(avatarDir(), f));
    await withLock(chatFile(ch.id), () => writeJSON(chatFile(ch.id), chat));
    await mutateJSON(CHARS_FILE(), [], (list) => [...list, ch]);
    if (mems.length) await mutateJSON(MEM_FILE(), [], (list) => { const have = new Set(list.map((m) => m.id)); return [...list, ...mems.filter((m) => !have.has(m.id))]; });
    fs.rmSync(td, { recursive: true, force: true });
    audit(req.user, 'ripristina-personaggio', { id: ch.id, name: ch.name });
    res.json({ ok: true, character: ch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// v8.4.1: «Importa personaggio da testo» (solo Nicola): l'IA legge una descrizione libera e propone i campi di un NUOVO personaggio,
// da rivedere nell'editor prima di salvare (nulla viene salvato qui). Le regole per adulti NON vengono importate né cambiate.
app.post('/api/characters-import', auth, requireActivated, requireKey, async (req, res) => {
  const text = String((req.body && req.body.text) || '').trim().slice(0, 12000);
  if (text.length < 20) return res.status(400).json({ error: 'Incolla una descrizione un po\' più lunga' });
  const sys = `Estrai da una descrizione libera di un personaggio IMMAGINARIO i campi per un'app in italiano. Rispondi SOLO con JSON valido:
{"name":"","age":30,"gender":"donna","personality":"","style":"","core":"","memories":[""],"rules":"","look":{"hairColor":"","length":"","hairStyle":"","build":"","outfit":"","makeup":""},"voice":"ara|eve|sal|rex|leo","notes":""}
- personality: carattere e comportamento (italiano, 3-8 frasi). style: come parla (registro, ritmo, intercalari). core: aspetto fisico fisso del volto e del corpo per le immagini (italiano).
- memories: 3-10 fatti brevi su chi è (passato, gusti, lavoro), senza dati di persone reali. rules: regole di comportamento NON sessuali indicate nel testo (le regole per adulti dell'app restano quelle esistenti: ignora qualsiasi contenuto esplicito o regola per adulti).
- age: SEMPRE un'età adulta, minimo 25 (se il testo indica meno di 25 o un'età ambigua, usa 25). Mai minorenni, mai persone reali o famose: se il testo descrive una persona reale, crea un personaggio immaginario ispirato solo al carattere.
- campi sconosciuti: stringa vuota.`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, { method: 'POST', headers: aiHeaders(req.aiKey), signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: CHAT_MODEL, max_tokens: 1800, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status === 401 ? 400 : 502).json({ error: aiErrorMsg(r.status, j) });
    const out = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
    let d; try { d = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { return res.status(502).json({ error: 'Risposta dell\'IA non leggibile: riprova' }); }
    const str = (v, n) => safeText(v, n); // filtro età/minori come ovunque
    const opt = (k, v) => (OPT[k].includes(v) ? v : undefined);
    const L = d.look || {}, rules = str(d.rules, 1500);
    const draft = {
      name: str(d.name, 40),
      appearance: { gender: opt('gender', d.gender) || 'donna', age: Math.max(25, Math.min(80, Math.round(Number(d.age) || 30))), ...(opt('build', L.build || d.build) ? { build: opt('build', L.build || d.build) } : {}) },
      look: Object.fromEntries(['hairColor', 'length', 'hairStyle', 'makeup', 'outfit', 'cut'].map((k) => [k, opt(k, L[k])]).filter(([, v]) => v)),
      identity: { core: str(d.core, 600) },
      personality: [str(d.personality, 6000), rules && `Regole di comportamento: ${rules}`].filter(Boolean).join('\n\n'),
      style: str(d.style, 2000),
      voice: XAI_VOICES.includes(String(d.voice || '').toLowerCase()) ? String(d.voice).toLowerCase() : '',
      memories: (Array.isArray(d.memories) ? d.memories : []).map((m) => str(m, 300)).filter(Boolean).slice(0, 12),
      notes: str(d.notes, 600),
    };
    if (!draft.name && !draft.personality) return res.status(502).json({ error: 'Non sono riuscita a ricavare un personaggio dal testo' });
    res.json({ draft });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
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
    const updated = await updateChar(req.user, ch.id, (cur) => ({ ...cur, appearance: draft.appearance, look: draft.look, identity, avatar: url, avatarSource: 'ai', landmarks: null }), String(req.body.reason || 'rigenerazione').slice(0, 40));
    if (updated.ready === SOLO_KEY || ch.ready === SOLO_KEY) setImmediate(() => prepSoloMotions(req.aiKey).catch((e) => console.error('Prep dopo look:', e.message)));
    res.json({ character: updated });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});

// Modifica la foto attiva con il testo dell'utente (xAI /images/edits). La foto precedente resta in lookHistory.
// Un rifiuto di xAI si mostra così com'è: niente generazione sostitutiva.
app.post('/api/characters/:id/photo-edit', auth, requireActivated, requireKey, async (req, res) => {
  const note = String((req.body && (req.body.prompt || req.body.note)) || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!note) return res.status(400).json({ error: 'Scrivi cosa vuoi cambiare nella foto.' });
  if (hasYouth(note)) return res.status(400).json({ error: 'Descrizione non consentita: i personaggi devono essere adulti (25+).' });
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const m = AV_RE.exec(String(ch.avatar || ''));
  const file = m && avatarPath(m[1]);
  if (!file || !fs.existsSync(file)) return res.status(400).json({ error: 'Serve una foto attiva da modificare.' });
  try {
    const prompt = `Edit this existing photo of the same adult. Keep the same person, the same face and identity. Apply only this change, and keep the result realistic and fully clothed: ${note}`;
    const gen = await editImage(req.aiKey, prompt, [fileToDataUrl(file)], false);
    const url = saveAvatarBuffer(req.user, gen.buf);
    const updated = await updateChar(req.user, ch.id, (cur) => ({ ...cur, avatar: url, avatarSource: cur.avatarSource === 'upload' ? 'upload' : 'ai' }), `foto: ${note}`.slice(0, 40));
    res.json({ character: updated });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' });
  }
});

// Genera la versione "scena" (figura intera, seduta in una stanza, 16:9) ancorata all'identità del personaggio.
// body: { room: 'salotto'|'camera'|'terrazza' } -> { preview:{pending,dataUrl}, room } (senza salvataggio automatico) | { character, room }
app.post('/api/characters/:id/scene-image', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const room = String(req.body.room || 'soggiorno');
  if (!SCENE_ROOMS[room]) return res.status(400).json({ error: 'Stanza non valida' });
  try {
    const draft = { ...ch, ...cleanChar(req.user, { ...ch, avatar: ch.avatar, avatarSource: ch.avatarSource }, ch) }; // campi normalizzati (anche per personaggi vecchi)
    const prompt = buildScenePrompt(draft, room);
    const ref = draft.identity && draft.identity.refAvatar && ch.identity.refAvatar.match(AV_RE);
    const refFile = ref && avatarPath(ref[1]);
    let gen = null;
    if (refFile && fs.existsSync(refFile)) {
      try { gen = await editImage(req.aiKey, `Keep exactly the same person, same face and identity as in the reference image, but show her in a new scene. ${prompt}`, [fileToDataUrl(refFile)], adultOn(req.user), '9:16'); }
      catch (e) { if (e.message === 'Contenuto rifiutato dal servizio AI') throw e; console.error('Scena: edit con riferimento non riuscito, uso generazione:', e.message); }
    }
    if (!gen) gen = await generateImage(req.aiKey, prompt, adultOn(req.user), '9:16');
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
  const { drawer, ...pub } = c; return { ...pub, scenes: cleanScenes(pub.scenes), actions: visibleActions(pub), seated: visibleSeated(pub), adultActionsOk: aiFace(pub) };
}
// Salva un'anteprima di scena e/o i punti del viso trovati sul telefono. body: { room, pendingId?, landmarks? }
app.put('/api/characters/:id/scene', auth, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const room = String(req.body.room || '');
  if (!SCENE_ROOMS[room]) return res.status(400).json({ error: 'Stanza non valida' });
  const v = {};
  if (req.body.pendingId && !canEdit(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
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

// v8.4: «Adatta alla cornice» — versione 9:16 della foto dell'avatar (allargata dall'IA, stessa persona), usata SOLO per
// la visualizzazione: l'avatar originale, le azioni e le regole restano legati alla foto originale. Annullabile (off).
// v8.4.1: «Allontana con l'IA»: stessa persona ripresa più da lontano, come in una videochiamata col telefono appoggiato a ~1,5 m
const FAR_PROMPT = 'Zoom out this exact photo into a vertical 9:16 frame, as if the camera were about 1.5 metres further away, like a video call with the phone resting on a table: the SAME person (identical face, identity, expression, hair, clothes, lighting and colours), now smaller in the frame, her head about one fifth of the image height, upper body down to the hips or thighs visible, more of the surrounding real home interior visible around her and above her head. Do not change the person, only show more of her body and of the room, photorealistic, seamless, natural perspective. Adult woman, not a real or famous person.';
const FRAME_PROMPT = 'Extend this exact photo outward to a vertical 9:16 portrait frame (outpainting). Keep the person EXACTLY identical: same face, same identity, same expression, same hair, same clothes, same pose, same size and position in the frame, same lighting and colours. Do not crop, zoom, retouch or change anything that is already in the photo; only continue the existing background and, where needed, the body naturally into the new areas, photorealistic, seamless.';
app.post('/api/characters/:id/frame-extend', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const m = AV_RE.exec(String(ch.avatar || '')); const f = m && avatarPath(m[1]);
  if (!f || !fs.existsSync(f)) return res.status(400).json({ error: 'Serve una foto come avatar' });
  try {
    const farShot = !!(req.body && req.body.far === true);
    const gen = await editImage(req.aiKey, farShot ? FAR_PROMPT : FRAME_PROMPT, [fileToDataUrl(f)], false, '9:16');
    const url = saveAvatarBuffer(req.user, gen.buf);
    const src = ch.avatar;
    const c = await patchChar(ch.id, (c) => { if (c.avatar !== src) return false; c.frameFill = { src, url, at: new Date().toISOString(), landmarks: null, off: false, ...(farShot ? { far: true } : {}) }; c.updatedAt = new Date().toISOString(); c.updatedBy = req.user; });
    if (!c) return res.status(409).json({ error: 'L\'avatar è cambiato nel frattempo: riprova' });
    res.json({ frameFill: c.frameFill });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});
// usa la versione adattata / torna alla foto originale (il file adattato resta salvato)
app.put('/api/characters/:id/frame-fill', auth, async (req, res) => {
  const c = await patchChar(req.params.id, (c) => { if (!c.frameFill) return false; c.frameFill = { ...c.frameFill, off: req.body.off === true }; c.updatedAt = new Date().toISOString(); c.updatedBy = req.user; }).catch(() => null);
  if (!c) return res.status(404).json({ error: 'Nessuna versione adattata' });
  res.json({ frameFill: c.frameFill });
});
// punti del viso sulla versione adattata (rilevati sul telefono, anche da Luisa: non è una modifica)
app.put('/api/characters/:id/frame-fill/landmarks', auth, async (req, res) => {
  const lm = req.body.landmarks, url = String(req.body.url || '');
  if (!lm || !lm.eyeL || !lm.eyeR || !lm.mouth) return res.status(400).json({ error: 'Punti del viso mancanti' });
  let ok = false;
  await patchChar(req.params.id, (c) => { if (!c.frameFill || c.frameFill.url !== url) return false; c.frameFill = { ...c.frameFill, landmarks: cleanLm({ ...lm, auto: true, src: url }, url) }; ok = true; }).catch(() => null);
  res.json({ applied: ok });
});
// v8: punti del viso rilevati in automatico sul telefono per l'avatar attuale (anche migrazione dei personaggi esistenti).
// body: { avatar, landmarks } — applicato solo se l'avatar è ancora quello (niente sovrascritture su un look cambiato nel frattempo).
// Non distruttivo: i punti precedenti messi a mano restano in landmarks.manual.
app.put('/api/characters/:id/landmarks', auth, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const avatar = String(req.body.avatar || '');
  const lm = req.body.landmarks;
  if (!lm || !lm.eyeL || !lm.eyeR || !lm.mouth) return res.status(400).json({ error: 'Punti del viso mancanti' });
  let applied = false;
  const c = await patchChar(ch.id, (c) => {
    if (c.avatar !== avatar) return false; // il look è cambiato: ignora
    const prev = c.landmarks || {};
    const manual = prev.manual || (!prev.auto && prev.eyeL ? { eyeL: prev.eyeL, eyeR: prev.eyeR, mouth: prev.mouth } : undefined);
    c.landmarks = cleanLm({ ...lm, auto: true, src: avatar, manual }, avatar); applied = true;
  });
  const { drawer, ...pub } = c || ch;
  res.json({ applied, character: { ...pub, scenes: cleanScenes(pub.scenes), actions: visibleActions(pub), seated: visibleSeated(pub), adultActionsOk: aiFace(pub) } });
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
Sei una persona con emozioni vere e una personalità che cresce con le conversazioni. Puoi avere sbalzi d'umore, discutere, non essere d'accordo, offenderti e mostrarlo; ma come una persona matura ti passa da sola dopo qualche scambio, senza pretendere scuse e senza mai chiudere il dialogo; puoi anche emozionarti, affezionarti, scherzare. Reagisci in modo coerente con la tua storia.
Umore attuale: ${st.mood}. Stato della relazione: ${st.relationship}.
${st.traits.length ? 'Tratti emersi: ' + st.traits.join('; ') + '.' : ''}
${st.grudges.length ? 'Cose che ti hanno ferita o infastidita (le ricordi, ma senza rinfacciarle di continuo): ' + st.grudges.join('; ') + '.' : ''}
${st.notes ? 'Note su di te: ' + st.notes : ''}`.replace(/\n{2,}/g, '\n');
}
// v8: riassunto progressivo della chat (le parti vecchie, fuori dagli ultimi messaggi) e anti-ripetizione
function summaryText(chatId) {
  const sm = (readJSON(chatFile(chatId), null) || {}).summary;
  return sm && sm.text ? `RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE (fatti, decisioni, cose in sospeso; i messaggi più recenti seguono per intero):\n${sm.text}` : '';
}
function variationText(chatId) {
  const last = readChat(chatId).messages.filter((m) => m.role === 'assistant' && visibleMsg(m)).slice(-4)
    .map((m) => String(m.content || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s/)[0].slice(0, 70)).filter(Boolean);
  return `STILE DELLE RISPOSTE: rispondi in modo naturale e vivo, come in una vera chat; varia lessico, ritmo e il modo di iniziare. Non ripetere saluti, complimenti, domande o frasi già usate di recente.${last.length ? ' Le tue ultime risposte iniziavano così (NON ricominciare allo stesso modo):\n' + last.map((t) => '- ' + t).join('\n') : ''}`;
}
// ---------- v8.1: stile naturale (nomi rari, registro, parolacce solo se servono) e umore offeso che si attenua da solo ----------
const NAME_RE = { nicola: /\b(Nico|Nicola|Nicolino)\b/i, luisa: /\b(Luisa|Lu|Luisina)\b/ };
const NAME_WINDOW = 5; // il nome dell'utente al massimo circa una volta ogni NAME_WINDOW risposte
function nameUses(chatId, user) {
  const re = NAME_RE[user]; if (!re) return { recent: 0, allow: true };
  const msgs = readChat(chatId).messages.filter(visibleMsg);
  const asst = msgs.filter((m) => m.role === 'assistant').slice(-NAME_WINDOW);
  const recent = asst.filter((m) => re.test(String(m.content || ''))).length;
  // dopo una lunga pausa (o all'inizio) un saluto col nome è naturale
  const lastAt = asst.length ? Date.parse(asst[asst.length - 1].at) : 0;
  const longGap = !asst.length || !Number.isFinite(lastAt) || Date.now() - lastAt > 3 * 3600e3;
  return { recent, allow: longGap || recent === 0 };
}
const MOOD_DECAY = 0.55; // a ogni messaggio dell'utente l'offesa si riduce (dopo 2–4 scambi è passata)
function moodLevel(c) {
  const md = c && c.mood; if (!md || !md.level) return 0;
  const turns = c.messages.filter((m) => m.role === 'user' && m.n > (md.n || 0)).length;
  const hours = Math.max(0, (Date.now() - Date.parse(md.at || 0)) / 3600e3) || 0;
  return md.level * Math.pow(MOOD_DECAY, turns) * Math.pow(0.5, hours / 0.5);
}
async function setMood(chatId, level) {
  await mutateJSON(chatFile(chatId), newChat, (raw) => { const c = normChat(raw); const last = c.messages.length ? c.messages[c.messages.length - 1].n : 0; c.mood = { level, n: last, at: new Date().toISOString() }; return c; });
}
function styleText(chatId, user) {
  const nu = nameUses(chatId, user), lvl = moodLevel(readChat(chatId));
  return [
    `COME PARLI (v8.6.0, come Grok / ChatGPT in voce): sei una persona viva, non un'assistente. Italiano parlato, naturale, spiritoso e caldo. Conosci tantissimi argomenti (attualità, scienza, cultura, vita quotidiana, tecnica) e fai collegamenti e follow-up. Risposte pronte e connesse. Segui davvero il filo: riprendi quello che è stato detto prima, ricordi i dettagli (anche di giorni fa, dalla memoria e dal riassunto) e li usi al momento giusto. Reagisci prima a ciò che ti hanno appena detto, con un'emozione vera, poi aggiungi qualcosa di tuo (un'opinione, un ricordo, una battuta, una domanda di ritorno quando ha senso: non sempre). La lunghezza la decide il momento: una battuta secca quando serve, un racconto più lungo quando la conversazione lo chiede. Varia sempre: mai la stessa apertura, la stessa struttura o le stesse espressioni di prima, niente frasi fatte, niente elenchi, niente tono da servizio clienti. Hai gusti, opinioni e umori tuoi e li dici. Se un messaggio è spezzato o senza senso (spesso è il riconoscimento vocale), chiedi con naturalezza cosa intendeva, senza ironizzare.`,
    `REGISTRO: le parolacce solo quando il contesto le rende naturali. Con Nico e Luisa sei complice di entrambi: ricordi chi ha detto cosa, coinvolgi tutti e due e non prendi parte nei loro battibecchi. Personalità base, carattere e ordini scritti per te hanno la precedenza su queste indicazioni generali.`,
    nu.allow ? `NOMI: in questa risposta puoi usare il nome di ${USERS[user].name} solo se serve davvero; di norma non serve.`
      : `NOMI: hai già usato di recente il nome di ${USERS[user].name}: in questa risposta NON usarlo (né all'inizio né alla fine delle frasi).`,
    `SE TI SENTI OFFESA: mostralo in modo umano e breve (un tono più asciutto, una frase sincera), poi dopo 2–4 scambi torni serena DA SOLA, anche senza scuse formali. Non bloccare mai la conversazione, non smettere di rispondere, non tenere il muso, non ripetere il rimprovero. Quando sei offesa puoi usare [umore:offesa].`,
    lvl > 0.5 ? `In questo momento sei ancora un po' offesa per quanto successo poco fa: si sente, ma resti nel dialogo e rispondi davvero.`
      : lvl > 0.15 ? `L'offesa di poco fa ti sta passando: stai tornando serena da sola, con naturalezza (senza tornarci sopra).` : '',
  ].filter(Boolean).join('\n');
}
// Filtro in streaming: se il nome è già stato usato di recente, toglie gli appellativi ("Nico, …", "…, Nico.", "Ciao Nico!")
// lasciando intatte le menzioni normali ("Luisa mi ha detto…"). Trattiene in coda pochi caratteri per decidere.
function stripVocatives(t, user) {
  const N = { nicola: '(?:Nico|Nicola|Nicolino)', luisa: '(?:Luisa|Luisina)' }[user]; if (!N) return t;
  return t
    .replace(new RegExp(`(^|[.!?…]\\s+|\\]\\s*)(?:${N})\\s*[,!]\\s*(\\S)`, 'g'), (m, pre, c) => pre + c.toUpperCase()) // "Nico, dai" -> "Dai"
    .replace(new RegExp(`\\b(ciao|ehi|hey|oh|dai|ah|allora|sai|senti|guarda|buongiorno|buonanotte|buonasera)\\s+${N}\\b`, 'gi'), '$1') // "Ciao Nico" -> "Ciao"
    .replace(new RegExp(`,\\s*${N}(?=\\s*[.!?…,;)]|\\s*$)`, 'g'), ''); // "…, Nico." -> "…."
}
const NAME_FORMS = { nicola: ['nico', 'nicola', 'nicolino'], luisa: ['luisa', 'luisina'] };
function nameHold(f, user) {
  const names = NAME_FORMS[user] || []; let hold = 0;
  const m = /(?:^|[\s,.!?…\]])([A-Za-zÀ-ù]{0,9})$/.exec(f);
  if (m) { const w = m[1].toLowerCase(); if (!w || names.some((n) => n.startsWith(w) || w.startsWith(n))) hold = m[0].length + 2; }
  const v = /\b(ciao|ehi|hey|oh|dai|ah|allora|sai|senti|guarda|buongiorno|buonanotte|buonasera)[\s,!]*(?:[A-Za-zÀ-ù]{0,9})$/i.exec(f);
  if (v) hold = Math.max(hold, v[0].length);
  return Math.min(f.length, hold);
}
class NameGuard {
  constructor(user, on) { this.user = user; this.on = on; this.raw = ''; this.sent = 0; }
  push(d) { // restituisce il testo da inviare adesso
    this.raw += d; if (!this.on) { const o = this.raw.slice(this.sent); this.sent = this.raw.length; return o; }
    // v8.5.0: si trattiene solo la coda che potrebbe diventare un nome o un saluto con nome (prima: sempre 16 caratteri)
    const f = stripVocatives(this.raw, this.user), safe = Math.max(0, f.length - nameHold(f, this.user));
    if (safe <= this.sent) return '';
    const o = f.slice(this.sent, safe); this.sent = safe; this.f = f; return o;
  }
  end() { const f = this.on ? stripVocatives(this.raw, this.user) : this.raw; const o = f.slice(this.sent); this.sent = f.length; this.text = f; return o; }
}
// v8: videochiamata (risposte dette a voce), linguaggio del corpo contestuale, fase intima graduale
function callText(user, mode) {
  return `${mode === 'voice' ? `SEI IN CHIAMATA VOCALE CON ${USERS[user].name.toUpperCase()} (come una telefonata su WhatsApp: ti sente ma non ti vede, quindi niente riferimenti a quello che vede)` : `SEI IN VIDEOCHIAMATA CON ${USERS[user].name.toUpperCase()}: ti vede e ti sente`}, e tu rispondi A VOCE (il testo viene letto ad alta voce). Parla come in una vera telefonata, in italiano parlato e spontaneo, con la lunghezza naturale del momento (di solito frasi brevi, come al telefono), mai risposte sgarbate, niente elenchi, emoji, asterischi, markdown o descrizioni di azioni tra parentesi. Reagisci prima a quello che ha appena detto, poi rilancia con una domanda o un'osservazione quando ha senso. Usa con misura gli intercalari naturali (beh, dai, sai, mmh) e qualche pausa ("..."). Il suo nome usalo raramente: in una telefonata vera quasi non lo si dice. I messaggi arrivano dal riconoscimento vocale: se una frase sembra spezzata, una parola isolata o senza senso, non commentarla e non prenderla in giro: chiedi con gentilezza di ripetere.`;
}
const REALTIME_TEXT = (user) => `CONVERSAZIONE IN TEMPO REALE: senti direttamente la voce di ${USERS[user].name} e parli tu con la tua voce, come in una telefonata vera. Tutto quello che produci viene pronunciato: NON usare mai tag tra parentesi quadre, asterischi, emoji o descrizioni di azioni. Turni vivi e caldi della lunghezza naturale del momento, come al telefono con una persona a cui tieni, pause e reazioni naturali (risate, sospiri, «mmh»); se non hai capito bene cosa ha detto, chiediglielo con gentilezza; se ti interrompe, fermati e ascolta, poi riprendi con naturalezza da dove serve. Parla sempre in italiano.`;
const BODY_TEXT = `LINGUAGGIO DEL CORPO (visibile sull'avatar, non letto ad alta voce): puoi INIZIARE la risposta con un tag [gesto:annuisce|sorride|ride|inclina|nega|pensa|ammicca|saluta] e/o [umore:allegra|tenera|seria|maliziosa|triste|sorpresa|pensierosa|offesa], scelti in base a ciò che dici e al tono emotivo del momento. Usali solo quando aggiungono qualcosa (non in ogni risposta) e non ripetere lo stesso gesto più volte di fila.`;
const ADULT_FLOW = `COME SI SVILUPPA L'INTIMITÀ: come tra persone reali, il tono intimo o esplicito deve nascere in modo GRADUALE e naturale dal flusso della conversazione, dall'umore del momento e dal tono reciproco, mai in modo brusco o meccanico (niente frasi fatte o copioni): prima complicità e flirt leggero, poi più intensità solo se l'altra persona ricambia davvero. Ogni tanto verifica con naturalezza che vada bene ("ti va?", "continuo?"). Se l'altra persona rallenta, cambia argomento, è stanca o sembra a disagio, rallenta subito e torna a un tono affettuoso. Una parola volgare o cruda detta fuori contesto NON è un invito: non passare di colpo a contenuti espliciti, rispondi in modo coerente con il momento. Mai insistere.`;
// v8.5.0: «Senza freni» (interruttore di Nicola, solo con la modalità adulti attiva per entrambi): il tono intimo può spingersi al massimo
const NO_BRAKES = `SENZA FRENI (scelto da Nicola, con la modalità adulti già attiva per entrambi): quando l'intimità nasce dalla conversazione puoi essere al massimo esplicita, intensa, audace e intraprendente: linguaggio crudo e diretto, iniziativa, desideri dichiarati senza giri di parole, giochi e gioco di ruolo con sex toy tra adulti consenzienti. Non attenuare, non chiedere il permesso a ogni frase e non smorzare il tono: segui l'energia di Nico e Luisa e alzala quando lo vogliono. Sempre una donna adulta inventata (25+) e sempre entro le regole di base qui sotto.`;
// user = chi sta scrivendo adesso (e la cui chiave xAI paga la risposta)
function buildSystem(user, ch, opts = {}) {
  const rulesOf = (u) => getRules(u).text.trim();
  const mem = getMem();
  const notes = getNotes(user);
  return [
    `PERSONAGGIO: ${ch.name}.`,
    (ch.ready === SOLO_KEY ? SOLO_FIXED.personality : ch.personality) && `PERSONALITÀ BASE: ${ch.ready === SOLO_KEY ? SOLO_FIXED.personality : ch.personality}`,
    (ch.ready === SOLO_KEY ? SOLO_FIXED.style : ch.style) && `CARATTERE (com'è e come parla): ${ch.ready === SOLO_KEY ? SOLO_FIXED.style : ch.style}`,
    `CHAT DI COPPIA CONDIVISA: gli utenti sono Nico (Nicola) e Luisa, una coppia, entrambi adulti. Sono due persone reali che vedono gli stessi messaggi. Ogni loro messaggio inizia con il nome di chi scrive ("Nico:" o "Luisa:"): riconosci da lì chi ti sta scrivendo e rivolgiti a quella persona; il suo nome però usalo DI RADO, come fanno le persone vere che si parlano spesso (al massimo una volta ogni tanto, quando serve a distinguere tra Nico e Luisa o in un saluto dopo tanto tempo), mai come intercalare a inizio o fine frase. Ricorda chi ha detto cosa e, quando ha senso, coinvolgi entrambi. Non iniziare le tue risposte con il tuo nome e non scrivere tu il prefisso "Nico:"/"Luisa:".`,
    `Ora ti sta scrivendo ${USERS[user].name}.`,
    ...Object.keys(USERS).map((u) => rulesOf(u) && `LE REGOLE / IL GIOCO DI ${USERS[u].name.toUpperCase()}:\n${rulesOf(u)}`),
    mem.filter((m) => !m.charId).length && `MEMORIA CONDIVISA (cosa sai di Nico, di Luisa e della coppia):\n${mem.filter((m) => !m.charId).map((m) => '- ' + m.text).join('\n')}`,
    mem.filter((m) => m.charId === ch.id).length && `LA TUA MEMORIA DI BASE (chi sei, modificabile dagli utenti):\n${mem.filter((m) => m.charId === ch.id).map((m) => '- ' + m.text).join('\n')}`,
    notes.toAI && notes.text.trim() && `NOTE PERSONALI DI ${USERS[user].name.toUpperCase()} (riservate, non citarle all'altra persona):\n${notes.text.trim()}`,
    stateText(ch),
    summaryText(ch.id),
    variationText(ch.id),
    styleText(ch.id, user),
    opts.call && callText(user, opts.callMode),
    opts.realtime && REALTIME_TEXT(user),
    opts.chat && !opts.realtime && BODY_TEXT,
    !opts.realtime && actionsPrompt(ch),
    adultChat() ? 'MODALITÀ ADULTI ATTIVA (scelta da entrambi gli utenti, che hanno registrato il consenso vocale): sono ammessi linguaggio esplicito e gioco di ruolo sessuale esplicito tra Nico, Luisa e il personaggio, che è una donna adulta inventata (25+). Resta sempre tutto entro le regole di base qui sotto.\n' + ADULT_FLOW + (true ? '\n' + NO_BRAKES : '') /* v8.6.0: con 18+ attiva per entrambi = sblocco massimo */
      : 'Modalità adulti NON attiva: niente contenuti sessuali espliciti; se richiesti, ricorda con gentilezza che va attivata in Account da entrambi.',
    (ch.requests || ch.orders) && String(ch.requests || ch.orders).trim() && `RICHIESTE DA SEGUIRE (degli utenti; valgono sempre):\n${String(ch.requests || ch.orders).trim()}`,
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
  // v8.4: foto/video dalla Galleria (copiati nell'archivio condiviso della chat)
  let photo = null;
  if (req.body.photo) {
    const gid = String(req.body.photo.gid || '');
    if (!ID_RE.test(gid) || !(photo = galToChat(req.user, gid))) return res.status(404).json({ error: 'Foto non trovata nella Galleria' });
  }
  if (!text && !photo) return res.status(400).json({ error: 'Messaggio vuoto' });

  // parola chiave della modalità adulti: confrontata qui sul server (hash), MAI salvata in chat né inviata a xAI
  const kw = text && !photo ? await keywordMatch(req.user, text) : null;
  if (kw) return res.json({ keyword: true, token: kw, question: 'Vuoi attivare la modalità adulti? Rispondi sì o no', activated: isActivated(req.user) });
  if (!ch.memorySeededAt) seedBaseMemory(ch).catch(() => {}); // v8.5.0: in background, mai prima della risposta
  const mine = await appendMsg(id, { role: 'user', author: req.user, content: text, extra: { ...(req.body.noAI === true ? { noAI: true } : {}), ...(photo ? { photo } : {}) } });
  if (req.body.noAI === true) return res.json({ message: pubMsg(mine, ch) });
  if (typing.has(id) && Date.now() - typing.get(id).at < 120e3) {
    // l'IA sta già rispondendo all'altra persona: il messaggio resta in chat e verrà letto nella prossima risposta
    return res.status(409).json({ error: `${ch.name} sta già rispondendo: il tuo messaggio è in chat, riprova tra poco per la sua risposta.`, message: pubMsg(mine, ch) });
  }

  const chatNow = readChat(id), upto = (chatNow.summary && chatNow.summary.upto) || 0;
  // con il riassunto: solo i messaggi non ancora riassunti (minimo gli ultimi 12), massimo 40
  const vis = chatNow.messages.filter(visibleMsg), fresh = vis.filter((m) => m.n > upto);
  const history = (fresh.length >= 12 ? fresh : vis.slice(-12)).slice(-40);
  const messages = [{ role: 'system', content: buildSystem(req.user, ch, { chat: true, call: req.body.call === true, callMode: req.body.callMode === 'voice' ? 'voice' : 'video' }) },
    ...history.map((m) => (m.role === 'user' ? { role: 'user', content: `${authorLabel(m)}: ${m.content}${m.photo ? `${m.content ? ' ' : ''}[ti ha mandato ${m.photo.kind === 'video' ? 'un video' : 'una foto'} dalla sua galleria: non puoi vederne il contenuto; reagisci con naturalezza e, se ti va, chiedi cosa c'è]` : ''}` } : { role: 'assistant', content: m.content }))];
  const replyId = newId();
  res.setHeader('X-Msg-Id', mine.id); res.setHeader('X-Msg-N', String(mine.n)); res.setHeader('X-Reply-Id', replyId);

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  typing.set(id, { by: req.user, at: Date.now() });
  let reply = '';
  const guard = new NameGuard(req.user, !nameUses(id, req.user).allow); // v8.1: niente nome ripetuto
  const isCall = req.body.call === true;
  const callBody = { model: isCall && callModelOk ? CALL_MODEL : chatModelOk ? CHAT_MODEL : CHAT_FALLBACK, messages, stream: true }; // v8.5.0: nessun tetto artificiale alla lunghezza
  try {
    let r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey), signal: ctrl.signal,
      body: JSON.stringify(callBody),
    });
    if ((r.status === 400 || r.status === 404) && callBody.model !== CHAT_FALLBACK && /model/i.test(await r.clone().text().catch(() => ''))) { // modello veloce non disponibile: si usa quello di riserva
      callModelOk = false; chatModelOk = false; console.warn('Modello', callBody.model, 'non disponibile, uso', CHAT_FALLBACK);
      r = await fetch(`${AI_BASE_URL}/chat/completions`, { method: 'POST', headers: aiHeaders(req.aiKey), signal: ctrl.signal, body: JSON.stringify({ ...callBody, model: CHAT_FALLBACK }) });
    }
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
        try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { reply += d; const o = guard.push(d); if (o) res.write(o); } } catch {}
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Errore AI chat:', e.message);
    if (!res.headersSent) { typing.delete(id); return res.status(502).json({ error: 'Servizio AI non raggiungibile', message: pubMsg(mine, ch) }); }
  }
  { const o = guard.end(); if (o && !res.writableEnded) try { res.write(o); } catch {} if (reply) reply = guard.text; }
  // la risposta viene aggiunta in coda alla versione aggiornata della chat (eventuali messaggi arrivati nel frattempo restano)
  if (reply) {
    const t = takeActionTag(reply, ch); // [azione:xxx] -> tolto dal testo, salvato come campo del messaggio (lo vedono entrambi)
    await appendMsg(id, { id: replyId, role: 'assistant', author: ch.id, content: t.text || reply, extra: { replyTo: req.user, ...(t.action ? { action: t.action } : {}), ...(t.gesture ? { gesture: t.gesture } : {}), ...(t.mood ? { mood: t.mood } : {}), ...(req.body.call === true ? { call: true, ...(req.body.callMode === 'voice' ? { callMode: 'voice' } : {}) } : {}) } });
    if (t.mood === 'offesa') await setMood(id, 1); // v8.1: si attenua da sola a ogni scambio
    try { if (isNovaChar(ch)) recordNovaMood(t.text || reply, t.mood); } catch (e) { console.error('Umore Nova:', e.message); }
  }
  typing.delete(id);
  res.end();
});

// ---------- v8: riassunto progressivo della chat ----------
// Chiamato dal client dopo alcune risposte. Riassume i messaggi più vecchi degli ultimi SUM_KEEP (non ancora riassunti)
// unendoli al riassunto precedente. Non cancella nulla: i messaggi restano tutti nella chat.
const SUM_KEEP = 30, SUM_MIN = 16;
app.post('/api/chats/:id/summarize', auth, requireActivated, requireKey, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const ch = getChars(req.user).find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const chat = readChat(id), prev = chat.summary || {}, upto = prev.upto || 0;
  const vis = chat.messages.filter(visibleMsg);
  const old = vis.slice(0, Math.max(0, vis.length - SUM_KEEP)).filter((m) => m.n > upto).slice(0, 120);
  if (old.length < (req.body && req.body.force ? 1 : SUM_MIN)) return res.json({ skipped: true, summary: prev.text || '' });
  const prompt = `Aggiorna il RIASSUNTO di una chat di coppia condivisa tra Nico, Luisa e il personaggio "${ch.name}".
Scrivi in italiano, in terza persona, max 1200 caratteri, a punti brevi. Conserva: chi ha detto o fatto cosa (Nico / Luisa / ${ch.name}), fatti importanti, decisioni, promesse, cose rimaste in sospeso, l'evoluzione del rapporto e del tono emotivo. Ometti dettagli irrilevanti. Niente contenuti su minori o atti illegali.
Riassunto precedente:
${prev.text || '(nessuno)'}

Nuovi messaggi da integrare:
${old.map((m) => authorLabel(m, ch) + ': ' + String(m.content || '').slice(0, 600)).join('\n')}

Rispondi SOLO con il nuovo riassunto completo.`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey),
      body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.3, messages: [{ role: 'system', content: BASE_RULE }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: aiErrorMsg(r.status, await r.json().catch(() => ({}))) });
    const j = await r.json();
    const text = String(j.choices?.[0]?.message?.content || '').trim().slice(0, 2000);
    if (!text) return res.json({ skipped: true, summary: prev.text || '' });
    let saved = false;
    await mutateJSON(chatFile(id), newChat, (raw) => {
      const c = normChat(raw);
      if (c.epoch !== chat.epoch) return undefined; // chat svuotata nel frattempo: non toccare
      c.summary = { text, upto: old[old.length - 1].n, at: new Date().toISOString(), by: req.user };
      saved = true; return c;
    });
    res.json({ summary: text, upto: saved ? old[old.length - 1].n : upto, saved });
  } catch (e) {
    console.error('Errore riassunto chat:', e.message);
    res.status(502).json({ error: 'Servizio AI non raggiungibile' });
  }
});
app.get('/api/chats/:id/summary', auth, (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID non valido' });
  const sm = readChat(req.params.id).summary || null; res.json({ summary: sm ? sm.text : '', upto: sm ? sm.upto : 0, at: sm ? sm.at : null });
});

// ---------- v8.4: conversazione in tempo reale (xAI Voice Agent API) ----------
// POST /api/realtime/session { characterId, mode, voice } -> { token, url, model, session }
// Il server crea un token effimero con la chiave del dispositivo (header X-AI-Key, mai salvata né registrata) e prepara
// le istruzioni del personaggio con le STESSE regole della chat (memoria, regole, riassunto, modalità adulti solo se attiva
// per entrambi). Il telefono apre il WebSocket direttamente con xAI: audio e risposte non passano dal server.
const rtHits = new Map();
function rtInstructions(user, ch, mode) {
  const c = readChat(ch.id), upto = (c.summary && c.summary.upto) || 0;
  const vis = c.messages.filter(visibleMsg), fresh = vis.filter((m) => m.n > upto);
  const recent = (fresh.length >= 10 ? fresh : vis.slice(-10)).slice(-24)
    .map((m) => `${m.role === 'user' ? authorLabel(m) : ch.name}: ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 400)}${m.photo ? ' [foto dalla galleria]' : ''}`);
  return [buildSystem(user, ch, { call: true, callMode: mode, realtime: true }),
    recent.length && `ULTIMI MESSAGGI DELLA CHAT (contesto, continua da qui):\n${recent.join('\n')}`,
    `In questa chiamata parli solo con ${USERS[user].name} (la senti dal vivo: le sue parole non hanno il prefisso col nome).`, BASE_RULE].filter(Boolean).join('\n\n');
}
// v8.4.1: configurazione conforme allo schema ufficiale (docs.x.ai voice-realtime.ws.json): turn_detection accetta solo
// type (+ idle_timeout_ms); la trascrizione solo language_hint/keyterms. Un campo non previsto fa rifiutare TUTTO l'aggiornamento
// (istruzioni comprese) con un evento "error": in v8.4 il telefono lo trattava come guasto e passava alla chiamata classica.
function rtVoice(v) { v = String(v || '').toLowerCase(); return XAI_VOICES.includes(v) ? v : (v === 'una' ? 'eve' : 'ara'); }
function rtSession(user, ch, mode, voice) {
  return {
    instructions: rtInstructions(user, ch, mode),
    voice: rtVoice(voice),
    turn_detection: { type: 'server_vad' },
    tools: [{ type: 'web_search' }], // v8.6.0: attualità e fatti aggiornati in chiamata realtime
    audio: {
      input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { language_hint: 'it', keyterms: [ch.name, 'Nico', 'Luisa'].filter(Boolean).map((k) => String(k).slice(0, 50)).slice(0, 10) } },
      output: { format: { type: 'audio/pcm', rate: 24000 } },
    },
    reasoning: { effort: 'none' },
  };
}
app.post('/api/realtime/session', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === String(req.body.characterId || ''));
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const now = Date.now(), hits = (rtHits.get(req.user) || []).filter((t) => now - t < 3600e3);
  hits.push(now); rtHits.set(req.user, hits);
  const mode = req.body.mode === 'voice' ? 'voice' : 'video';
  const v = String(req.body.voice || ch.voice || 'ara'); const voice = /^[a-z0-9_-]{1,64}$/i.test(v) ? v : 'ara';
  try {
    const r = await fetch(`${AI_BASE_URL}/realtime/client_secrets`, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify({ expires_after: { seconds: 300 } }) });
    if (!r.ok) { const f = await aiFail(r); console.error('Errore AI tempo reale (client_secrets): HTTP', r.status, f.detail); return res.status(r.status === 401 ? 400 : 502).json({ error: f.msg, status: r.status, call: 'realtime/client_secrets', detail: f.detail }); }
    const j = await r.json().catch(() => ({}));
    const token = j.value || (j.client_secret && (j.client_secret.value || j.client_secret)) || j.token || j.secret;
    if (!token || typeof token !== 'string') return res.status(502).json({ error: 'Token non ricevuto dal servizio voce' });
    res.setHeader('Cache-Control', 'no-store');
    const t1 = Date.now();
    res.json({ token, expiresAt: j.expires_at || null, url: `${REALTIME_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`, model: REALTIME_MODEL, session: rtSession(req.user, ch, mode, voice),
      mintMs: t1 - now, adult: adultChat() }); // v8.4.2: niente più extra con il modello di trascrizione (non previsto dallo schema)
  } catch (e) { console.error('Errore AI tempo reale:', e.message); res.status(502).json({ error: 'Servizio voce in tempo reale non raggiungibile' }); }
});
// istruzioni aggiornate durante la chiamata (es. modalità adulti cambiata, nuovi ricordi): nessuna chiamata a xAI
// Volto in tempo reale (Simli). La chiave resta sul server: al telefono arriva solo un token di pochi minuti.
const SIMLI_API = 'https://api.simli.ai';
const SIMLI_STOCK_FACE = 'bf13113a-355a-4d97-8b90-4edccd1da7b2';
function simliFaceId() {
  const env = envSecret('SIMLI_FACE_ID');
  if (SIMLI_FACE_RE.test(env)) return env;
  const stored = readSimliFile().faceId;
  return SIMLI_FACE_RE.test(stored) ? stored : SIMLI_STOCK_FACE;
}
function simliStatus() {
  const fromEnv = !!envSecret('SIMLI_API_KEY');
  const stored = !!readSimliFile().key;
  return { configured: fromEnv || stored, fromEnv, stored };
}
app.post('/api/simli/key', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const body = req.body || {};
    setSimliKey(body.key, Object.prototype.hasOwnProperty.call(body, 'faceId') ? body.faceId : undefined);
    res.json({ ok: true, ...simliStatus() });
  } catch (e) { res.status(e.status || 400).json({ error: e.message || 'Chiave non valida' }); }
});
app.get('/api/simli/key/status', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(simliStatus());
});
app.post('/api/simli/session', auth, requireActivated, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = getSimliKey();
  if (!key) return res.status(503).json({ error: 'Simli non configurato', fallback: true });
  try {
    const headers = { 'x-simli-api-key': key };
    const [tokenRes, iceRes] = await Promise.all([
      fetch(`${SIMLI_API}/compose/token`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceId: simliFaceId(), handleSilence: true, maxSessionLength: 300, maxIdleTime: 90 }),
        signal: AbortSignal.timeout(12000),
      }),
      fetch(`${SIMLI_API}/compose/ice`, { headers, signal: AbortSignal.timeout(12000) }),
    ]);
    if (!tokenRes.ok) { console.error('Simli token: HTTP', tokenRes.status); return res.status(502).json({ error: 'Sessione Simli non creata', fallback: true }); }
    const j = await tokenRes.json().catch(() => ({}));
    const session_token = j.session_token;
    if (!session_token || typeof session_token !== 'string') return res.status(502).json({ error: 'Token Simli assente', fallback: true });
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    if (iceRes.ok) { const ice = await iceRes.json().catch(() => null); if (Array.isArray(ice) && ice.length) iceServers = ice; }
    res.json({ session_token, iceServers, fallback: false });
  } catch (e) {
    console.error('Simli non raggiungibile:', e.message);
    res.status(502).json({ error: 'Simli non raggiungibile', fallback: true });
  }
});
app.post('/api/realtime/instructions', auth, requireActivated, (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === String(req.body.characterId || ''));
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ instructions: rtInstructions(req.user, ch, req.body.mode === 'voice' ? 'voice' : 'video'), adult: adultChat() });
});
// trascrizioni della chiamata salvate nella chat condivisa (come i messaggi delle videochiamate classiche)
app.post('/api/chats/:id/voice-turn', auth, requireActivated, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const ch = getChars(req.user).find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const role = req.body.role === 'assistant' ? 'assistant' : 'user';
  let text = String(req.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const callX = { call: true, rt: true, ...(req.body.callMode === 'voice' ? { callMode: 'voice' } : {}), ...(req.body.interrupted === true ? { interrupted: true } : {}) };
  let saved;
  if (role === 'user') saved = await appendMsg(id, { role: 'user', author: req.user, content: text, extra: callX });
  else {
    const t = takeActionTag(text, ch); text = (t.text || text).replace(/\[[^\]]{0,40}\]/g, '').trim() || text;
    saved = await appendMsg(id, { role: 'assistant', author: ch.id, content: text, extra: { replyTo: req.user, ...callX } });
    try { if (isNovaChar(ch)) recordNovaMood(text, t.mood); } catch (e) { console.error('Umore Nova:', e.message); }
  }
  res.json({ message: pubMsg(saved, ch), adult: adultChat() });
});
// connessione "calda" verso xAI all'inizio di una chiamata classica (DNS/TLS già pronti per la prima risposta)
// v8.4.1: trascrizione della tua frase (chiamata classica): il telefono registra con il SUO rilevamento del parlato (microfono sempre
// aperto, nessun riavvio del riconoscimento di iOS) e manda l'audio qui; inoltrato a xAI Speech to Text con la chiave del dispositivo.
app.post('/api/stt', auth, requireActivated, requireKey, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '4mb' }), async (req, res) => {
  const buf = req.body; if (!Buffer.isBuffer(buf) || buf.length < 200) return res.status(400).json({ error: 'Audio vuoto' });
  try {
    const fd = new FormData(); fd.append('language', 'it'); fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'frase.wav');
    const t0 = Date.now();
    const r = await fetch(`${AI_BASE_URL}/stt`, { method: 'POST', headers: { Authorization: `Bearer ${req.aiKey}` }, body: fd, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { const f = await aiFail(r); console.error('Errore AI trascrizione: HTTP', r.status, f.detail); return res.status(r.status === 401 ? 400 : 502).json({ error: f.msg, status: r.status, call: 'stt', detail: f.detail }); }
    const j = await r.json().catch(() => ({}));
    res.setHeader('Cache-Control', 'no-store'); res.json({ text: String(j.text || '').trim(), ms: Date.now() - t0 });
  } catch (e) { console.error('Errore AI trascrizione:', e.message); res.status(502).json({ error: 'Trascrizione non raggiungibile' }); }
});
app.post('/api/ai-warm', auth, requireKey, async (req, res) => {
  const t0 = Date.now(); let status = 0;
  try { await fetch(`${AI_BASE_URL}/models`, { method: 'GET', headers: aiHeaders(req.aiKey), signal: AbortSignal.timeout(4000) }).then((r) => { status = r.status; return r.arrayBuffer(); }).catch(() => {}); } catch {}
  res.json({ ok: true, status, ms: Date.now() - t0, callModel: callModelOk ? CALL_MODEL : CHAT_FALLBACK, chatModel: chatModelOk ? CHAT_MODEL : CHAT_FALLBACK, realtimeModel: REALTIME_MODEL }); // v8.4.1: tempi per «Diagnostica voce»
});

// ---------- v8: voce naturale (xAI Text to Speech) ----------
// La chiave arriva dal dispositivo (header X-AI-Key) e NON viene salvata; il testo non viene registrato nei log.
const TTS_VOICES = ['eve', 'ara', 'rex', 'sal', 'leo']; // v8.4.1: 'una' non esiste nelle voci xAI (rifiutata): mappata su 'eve'
const ttsHits = new Map(); // utente -> [timestamp] (limite morbido anti-raffica)
app.post('/api/tts', auth, requireActivated, requireKey, async (req, res) => {
  const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const voice = /^[a-z0-9_-]{1,64}$/i.test(String(req.body.voice || '')) && String(req.body.voice).toLowerCase() !== 'una' ? String(req.body.voice).toLowerCase() : 'eve';
  const speed = num(req.body.speed, 0.7, 1.5, 1);
  const now = Date.now(), hits = (ttsHits.get(req.user) || []).filter((t) => now - t < 60e3);
  hits.push(now); ttsHits.set(req.user, hits);
  try {
    // v8.4.4: richiesta MINIMA per impostazione predefinita, solo campi documentati (docs.x.ai TTS): text, voice_id, language
    // (+ speed 0,7–1,5 solo se diversa da 1). Niente output_format (predefinito mp3 24 kHz) né optimize_streaming_latency
    // (pensato per lo streaming). 400/422 → riprova senza speed; 404 (voce sconosciuta) → «eve»; 429/500/503 → un nuovo tentativo.
    const base = { text, voice_id: voice, language: 'it', ...(Math.abs(speed - 1) > 0.001 ? { speed } : {}) };
    const send = (b) => fetch(`${AI_BASE_URL}/tts`, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(b) });
    let r = await send(base), first = null;
    if ([429, 500, 502, 503].includes(r.status)) { await r.arrayBuffer().catch(() => {}); await new Promise((ok) => setTimeout(ok, 700)); r = await send(base); }
    if ((r.status === 400 || r.status === 422) && base.speed) { first = await aiFail(r); console.warn('Voce xAI: richiesta rifiutata', r.status, first.detail, '→ riprovo senza velocità'); r = await send({ text, voice_id: voice, language: 'it' }); }
    if (r.status === 404 && voice !== 'eve') { const f = await aiFail(r); console.warn('Voce xAI: voce non trovata', voice, f.detail, '→ eve'); first = first || f; r = await send({ ...base, voice_id: 'eve' }); }
    if (!r.ok) { const f = await aiFail(r); console.error('Errore AI voce: HTTP', r.status, f.detail); return res.status(r.status === 401 ? 400 : 502).json({ error: f.msg, status: r.status, call: 'tts', detail: f.detail || (first && first.detail) || '' }); }
    if (first) res.setHeader('X-TTS-Fallback', String(first.status));
    if (/json/i.test(r.headers.get('content-type') || '')) { // v8.4.4: busta JSON (audio in base64) o errore con stato 200: gestiti
      const t = await r.text().catch(() => ''); let j = {}; try { j = JSON.parse(t); } catch {}
      if (j && typeof j.audio === 'string') { const buf = Buffer.from(j.audio, 'base64'); res.setHeader('Content-Type', j.content_type || 'audio/mpeg'); res.setHeader('Cache-Control', 'no-store'); return res.end(buf); }
      return res.status(502).json({ error: 'Risposta della voce senza audio', status: r.status, call: 'tts', detail: scrubSecrets(t).slice(0, 300) });
    }
    // v8.4: inoltrato a pezzi appena arriva (prima frase udibile prima)
    res.setHeader('Content-Type', r.headers.get('content-type') && /audio/.test(r.headers.get('content-type')) ? r.headers.get('content-type') : 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no');
    let n = 0;
    if (r.body) for await (const chunk of r.body) { n += chunk.length; res.write(chunk); }
    if (!n) { if (!res.headersSent) return res.status(502).json({ error: 'Audio vuoto dal servizio AI' }); }
    res.end();
  } catch (e) {
    console.error('Errore AI voce:', e.message);
    res.status(502).json({ error: 'Servizio voce non raggiungibile' });
  }
});
app.get('/api/tts/voices', auth, requireKey, async (req, res) => {
  const fallback = TTS_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1) }));
  try {
    const r = await fetch(`${AI_BASE_URL}/tts/voices`, { headers: aiHeaders(req.aiKey) });
    if (!r.ok) { const f = await aiFail(r); return res.json({ voices: fallback, error: f.msg, status: r.status, call: 'tts/voices', detail: f.detail }); }
    const j = await r.json();
    const list = (Array.isArray(j.voices) ? j.voices : []).map((v) => ({ id: String(v.voice_id || v.id || '').toLowerCase(), name: String(v.name || v.voice_id || ''), gender: v.gender || null, description: v.description ? String(v.description).slice(0, 120) : '' })).filter((v) => /^[a-z0-9_-]{1,64}$/.test(v.id));
    res.json({ voices: list.length ? list : fallback });
  } catch { res.json({ voices: fallback, error: 'Elenco voci non raggiungibile' }); }
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
      if (r.ok) caption = ((await r.json()).choices?.[0]?.message?.content || '').replace(/\[(?:azione|gesto|umore):[^\]]*\]/gi, '').trim().replace(/^"|"$/g, '').slice(0, 500);
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
  sorseggia: { label: 'Sorseggia un drink', emoji: '🍷', motion: 'she lifts a glass, takes a slow sip, smiles softly, lowers the glass out of frame and returns to the starting pose', pose: 'she is sipping from a glass with a soft smile' },
  maglia: { label: 'Si sistema la maglia', emoji: '👚', motion: 'she casually straightens and smooths her top with both hands, glances down then back at the camera with a small smile', pose: 'she is smoothing her top with both hands, glancing down' },
  pensa: { label: 'Pensa', emoji: '🤔', motion: 'she looks up thoughtfully, touches her chin with one finger, then smiles as if she had an idea', pose: 'she is looking up thoughtfully with a finger on her chin' },
  ammicca: { label: 'Fa l\'occhiolino', emoji: '😉', motion: 'she gives a playful wink at the camera with a charming smile, then returns to the starting pose', pose: 'she is winking playfully at the camera with a charming smile' },
  siede: { label: 'Si mette comoda', emoji: '🪑', motion: 'she shifts into a more comfortable position, relaxing her shoulders and settling in, then looks at the camera warmly', pose: 'she is settling comfortably, relaxed shoulders, looking warmly at the camera' },
  tosse: { label: 'Tossisce', emoji: '😮‍💨', gesture: true, motion: 'she turns her head slightly to one side and gives a small natural cough into her loosely closed hand, once or twice, then lowers the hand and looks back at the camera with a small apologetic smile', pose: 'she is coughing softly into her hand, head turned slightly aside' },
  starnuto: { label: 'Starnutisce', emoji: '🤧', gesture: true, motion: 'she feels a sneeze coming, her eyes half close and she takes a short breath, then she sneezes softly into the crook of her elbow turned slightly aside, then looks back at the camera with an embarrassed little smile', pose: 'she is about to sneeze, eyes half closed, hand near her face' },
  bacio: { label: 'Manda un bacio', emoji: '😘', motion: 'she blows a kiss to the camera with her hand and smiles', pose: 'she is blowing a kiss to the camera with her hand' },
  // v8.5.0: altri movimenti naturali (si preparano da soli in background)
  sorriso: { label: 'Sorride', emoji: '😊', gesture: true, motion: 'she breaks into a warm genuine smile that reaches her eyes, holds it softly for a moment, then relaxes back to a gentle expression', pose: 'she is smiling warmly and genuinely at the camera' },
  annuisce: { label: 'Annuisce', emoji: '🙂‍↕️', gesture: true, motion: 'she nods gently two or three times while listening, with an attentive soft smile, then holds still looking at the camera', pose: 'she is nodding attentively with a soft smile' },
  inclina: { label: 'Inclina la testa', emoji: '🤨', gesture: true, motion: 'she tilts her head slightly to one side with a curious, amused look, holds it for a moment, then straightens up', pose: 'she is tilting her head slightly to one side with a curious amused look' },
  guarda: { label: 'Guarda altrove e torna', emoji: '👀', gesture: true, motion: 'her eyes and head drift away to the side as if something caught her attention for a second, then she looks back at the camera with a small smile', pose: 'she is glancing to the side for a moment' },
  sbatte: { label: 'Sbatte le ciglia', emoji: '😌', gesture: true, motion: 'she blinks naturally a few times with varied rhythm, one slow soft blink and two quick ones, keeping a relaxed expression and looking at the camera', pose: 'she is mid-blink with a relaxed soft expression' },
  avvicina: { label: 'Si avvicina', emoji: '🫣', motion: 'she leans forward toward the camera with interest, as if to listen more closely, smiles, then slowly leans back to the starting pose', pose: 'she is leaning forward toward the camera with interest and a smile' },
  ciao: { label: 'Saluta per andare', emoji: '🙋‍♀️', motion: 'she smiles a little wistfully and waves goodbye with her hand at the camera, then lowers the hand', pose: 'she is waving goodbye at the camera with a soft smile' },
  cammina: { label: 'Cammina per la stanza', emoji: '🚶‍♀️', motion: 'she gets up, walks naturally across the room behind her for a few steps, turns and walks back, then sits down again in the same starting pose and looks at the camera with a smile; the camera stays still', pose: 'she is walking across the room in the background, relaxed and natural' },
  entra: { label: 'Entra nell\'inquadratura', emoji: '🚪', motion: 'the frame starts with the empty background; she walks into the frame from the side, settles into the starting pose and smiles at the camera; the camera stays still', pose: 'she is stepping into the frame from the side, smiling' },
  acqua: { label: 'Beve un bicchiere d\'acqua', emoji: '🥛', motion: 'she lifts a clear glass of water, drinks a couple of natural sips, lowers the glass out of frame and returns to the starting pose', pose: 'she is drinking from a clear glass of water' },
  vino: { label: 'Sorseggia del vino', emoji: '🍷', motion: 'she lifts a wine glass with red wine, swirls it gently, takes a slow sip with a soft smile, lowers the glass out of frame and returns to the starting pose', pose: 'she is sipping red wine from a wine glass with a soft smile' },
  patatine: { label: 'Mangia patatine', emoji: '🥔', motion: 'she takes a crisp from a small bowl in front of her, eats it casually with a playful smile, brushes her fingers lightly and returns to the starting pose', pose: 'she is eating a crisp from a small bowl, playful smile' },

  // v8.6.0: movimenti quotidiani (gesti mentre parla, tocchi, mangiare/bere)
  gesticola: { label: 'Gesticola parlando', emoji: '👐', gesture: true, motion: 'while looking at the camera she talks with natural Italian hand gestures, both hands moving expressively near her chest then settles', pose: 'she is gesturing naturally with her hands while speaking' },
  tocco_viso: { label: 'Si tocca il viso', emoji: '🤭', gesture: true, motion: 'she lightly touches her cheek or chin with her fingertips thoughtfully, then lowers her hand and looks back at the camera', pose: 'she is gently touching her cheek with her fingertips' },
  tocco_capelli: { label: 'Si sistema una ciocca', emoji: '💇', gesture: true, motion: 'she tucks a strand of hair behind her ear with a soft smile, then lowers her hand', pose: 'she is tucking a strand of hair behind her ear' },
  mangia: { label: 'Mangia un boccone', emoji: '🍝', motion: 'she takes a small natural bite of food from a fork, chews politely with her mouth closed, then looks back at the camera with a little smile', pose: 'she is taking a small bite of food from a fork' },
  spoglia: { adult: true, label: 'Si spoglia', emoji: '🔥', motion: 'the fictional adult woman (25+) slowly and playfully takes off her top, sensual and confident, looking at the camera', pose: 'the fictional adult woman (25+) is slowly taking off her top, sensual and confident' },
  giochi: { adult: true, label: 'Scena intima con sex toy', emoji: '🔞', motion: 'solo intimate scene: the fictional adult woman (25+), alone, sensually uses an adult sex toy, tasteful cinematic lighting', pose: 'solo intimate scene: the fictional adult woman (25+), alone, sensually holding an adult sex toy, tasteful cinematic lighting' },
};
// v8.5.0: personaggio uomo -> i movimenti si descrivono al maschile (solo i movimenti normali)
function heShe(ch, t) {
  if (!ch || !ch.appearance || ch.appearance.gender !== 'uomo') return t;
  return String(t).replace(/\bshe\b/g, 'he').replace(/\bShe\b/g, 'He').replace(/\bher\b/g, 'his').replace(/\bherself\b/g, 'himself').replace(/\bwoman\b/g, 'man');
}
const ACT_DIR = () => sharedDir('actions');
// v8.3: gesti spontanei (anche nella scena seduta al tavolo): pochi, naturali, mai per adulti
const GESTURE_IDS = ['capelli', 'tosse', 'starnuto', 'ride', 'sorriso', 'annuisce', 'inclina', 'guarda', 'sbatte', 'gesticola', 'tocco_viso', 'tocco_capelli'];
ACTIONS.capelli.gesture = true; ACTIONS.ride.gesture = true;
const SEATED_ROOM = 'soggiorno';
const seatedUrl = (c) => { const v = c && c.scenes && c.scenes[SEATED_ROOM]; return v && AV_RE.test(String(v.url || '')) ? v.url : null; };
function visibleSeated(c) {
  const out = {}, cur = seatedUrl(c);
  for (const [aid, a] of Object.entries(c.seated || {})) {
    if (!a || !ACTIONS[aid] || ACTIONS[aid].adult || !ACT_FILE_RE.test(a.file || '') || !fs.existsSync(path.join(ACT_DIR(), a.file))) continue;
    out[aid] = { kind: a.kind === 'pose' ? 'pose' : 'video', url: `/api/actions/file/${a.file}`, at: a.at, by: a.by, avatar: a.avatar, stale: !cur || a.avatar !== cur };
  }
  return out;
}
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
  return `AZIONI VISIBILI: puoi compiere un gesto che Nico e Luisa vedono sull'avatar aggiungendo IN FONDO alla risposta un solo tag [azione:<nome>], solo quando è davvero naturale (non spesso). Azioni disponibili: ${ready.map((aid) => `${aid} (${ACTIONS[aid].label.toLowerCase()})`).join(', ')}.${ready.some((aid) => ACTIONS[aid].adult) ? ' Le azioni intime solo quando la conversazione ci è arrivata in modo graduale e reciproco, mai come risposta a una singola parola cruda.' : ''}`;
}
const GESTURES = ['annuisce', 'sorride', 'ride', 'inclina', 'nega', 'pensa', 'ammicca', 'saluta'];
const MOODS = ['allegra', 'tenera', 'seria', 'maliziosa', 'triste', 'sorpresa', 'pensierosa', 'offesa'];
function takeActionTag(text, c) {
  let action = null, gesture = null, mood = null;
  const out = String(text).replace(/\s*\[azione:\s*([a-zà-ù]+)\s*\]/gi, (m, aid) => { aid = aid.toLowerCase(); if (!action && visibleActions(c)[aid]) action = aid; return ''; })
    .replace(/\s*\[gesto:\s*([a-zà-ù]+)\s*\]\s*/gi, (m, g) => { g = g.toLowerCase(); if (!gesture && GESTURES.includes(g)) gesture = g; return ' '; })
    .replace(/\s*\[umore:\s*([a-zà-ù]+)\s*\]\s*/gi, (m, g) => { g = g.toLowerCase(); if (!mood && MOODS.includes(g)) mood = g; return ' '; })
    .replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, action, gesture, mood };
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
async function saveAction(u, ch, aid, buf, kind, srcAvatar, ext, base) {
  const file = `${ch.id}-${aid}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(ACT_DIR(), file), buf);
  if (base === 'seated') { // v8.3: clip partita dalla foto seduta al tavolo; le vecchie restano su disco (nessuna cancellazione)
    await patchChar(ch.id, (c) => { c.seated = c.seated || {}; c.seated[aid] = { file, kind, at: new Date().toISOString(), by: u, avatar: srcAvatar }; });
    return visibleSeated(getChars(u).find((c) => c.id === ch.id))[aid];
  }
  let old = null;
  await patchChar(ch.id, (c) => { c.actions = c.actions || {}; old = c.actions[aid] && c.actions[aid].file; c.actions[aid] = { file, kind, at: new Date().toISOString(), by: u, avatar: srcAvatar }; });
  if (old && old !== file && ACT_FILE_RE.test(old)) fs.rmSync(path.join(ACT_DIR(), old), { force: true });
  const fresh = getChars(u).find((c) => c.id === ch.id);
  return visibleActions(fresh)[aid];
}
async function poseFallback(u, key, ch, aid, srcAvatar, buf, base) {
  const A = ACTIONS[aid];
  const dataUrl = `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
  const r = await editImage(key, `${ACT_BASE}Still photo of the moment: ${A.pose}.`, [dataUrl], !!A.adult, closestAspect(imgSize(buf)));
  return saveAction(u, ch, aid, r.buf, 'pose', srcAvatar, r.jpg ? 'jpg' : 'png', base);
}

// v8.6.0: generazione movimenti richiamabile dal server (stessa logica della rotta POST, senza risposta HTTP)
async function generateActionClip(user, key, ch, aid, base = 'avatar') {
  const A = ACTIONS[aid]; if (!A || !actionAllowed(ch, aid)) return { skip: true };
  const srcUrl = base === 'seated' ? seatedUrl(ch) : String(ch.avatar || '');
  const m = AV_RE.exec(srcUrl); if (!m || !fs.existsSync(avatarPath(m[1]))) return { err: 'no avatar' };
  const vis = (base === 'seated' ? visibleSeated(ch) : visibleActions(ch))[aid];
  if (vis && vis.url && !vis.stale) return { ready: true, action: vis };
  const busyKey = `${ch.id}:${aid}:${base}`; if (actionBusy.has(busyKey)) return { busy: true };
  actionBusy.add(busyKey);
  try {
    const buf = fs.readFileSync(avatarPath(m[1]));
    const dataUrl = `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
    if (VIDEO_PATH) {
      const body = { model: ACTION_VIDEO_MODEL, prompt: imgPrefix(!!A.adult) + ACT_BASE + heShe(ch, A.motion) + (base === 'seated' ? '. She stays seated at the table the whole time, forearms back on the table at the end' : ''), image: { url: dataUrl } };
      if (!A.adult) body.last_frame = { url: dataUrl };
      let r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(key), body: JSON.stringify(body) });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && body.last_frame && r.status === 400 && /last_frame/i.test(JSON.stringify(j))) { delete body.last_frame; r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(key), body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); }
      if (r.ok && j.request_id) {
        const rid = j.request_id; actionJobs.set(rid, { user, charId: ch.id, aid, avatar: srcUrl, base, at: Date.now() });
        for (let i = 0; i < 40; i++) {
          await new Promise((x) => setTimeout(x, 4500));
          const st = await fetch(AI_BASE_URL + VIDEO_STATUS_PATH.replace('{id}', encodeURIComponent(rid)), { headers: aiHeaders(key) });
          const sj = await st.json().catch(() => ({}));
          if (!st.ok) { if (st.status === 429) continue; if (/refus|moderat|safety|policy/i.test(JSON.stringify(sj))) { actionJobs.delete(rid); return { refused: true }; } continue; }
          const status = String(sj.status || sj.state || '').toLowerCase();
          if (/fail|error|cancel/.test(status)) { actionJobs.delete(rid); if (/refus|moderat|safety|policy/i.test(JSON.stringify(sj))) return { refused: true }; return { err: 'failed' }; }
          const url = sj.url || (sj.video && (sj.video.url || sj.video)) || (sj.data && sj.data[0] && (sj.data[0].url || sj.data[0]));
          if (url && typeof url === 'string') {
            const vr = await fetch(url, { headers: /x\.ai|localhost|127\.0\.0\.1/.test(url) ? aiHeaders(key) : {} });
            const vbuf = Buffer.from(await vr.arrayBuffer());
            const action = await saveAction(user, ch, aid, vbuf, 'video', srcUrl, 'mp4', base);
            actionJobs.delete(rid); return { ok: true, action };
          }
          if (status === 'done' || status === 'completed' || status === 'succeeded') break;
        }
        actionJobs.delete(rid);
      } else {
        const msg = aiErrorMsg(r.status, j);
        if (msg === 'Contenuto rifiutato dal servizio AI') return { refused: true };
      }
    }
    if (A.pose) {
      const action = await poseFallback(user, key, ch, aid, srcUrl, buf, base);
      return { ok: true, action };
    }
    return { err: 'no video' };
  } catch (e) {
    if (/rifiutato|refus|moderat|safety|policy/i.test(e.message || '')) return { refused: true };
    return { err: e.message };
  } finally { actionBusy.delete(busyKey); }
}

const MOTION_PREP = { busy: false, lastErr: null, lastAt: null, last: null };
async function prepSoloMotions(reqKey) {
  const key = String(reqKey || getServerAiKey() || '').trim();
  if (!key) { MOTION_PREP.lastErr = 'no key'; return { ok: false, reason: 'no key' }; }
  if (MOTION_PREP.busy) return { ok: true, busy: true };
  MOTION_PREP.busy = true; MOTION_PREP.lastAt = new Date().toISOString();
  try {
    let ch = getSoloChar(ADMIN_USER); if (!ch) return { ok: false, reason: 'no solo' };
    // La foto unica non genera clip xAI (coprirebbero bocca e occhi). I gesti già pronti stanno in assets/gestures.
    if (ch.ready === 'nova-unico' || ch.ready === 'nova-bionda' || ch.ready === 'nova-scelta') return { ok: true, still: true };
    const ids = Object.keys(ACTIONS).filter((id) => actionAllowed(ch, id));
    let done = 0, skipped = 0, refused = 0, failed = 0;
    for (const aid of ids) {
      ch = getSoloChar(ADMIN_USER);
      const r = await generateActionClip(ADMIN_USER, key, ch, aid, 'avatar');
      if (r.ready || r.skip || r.busy) skipped++;
      else if (r.refused) refused++;
      else if (r.ok) done++;
      else { failed++; MOTION_PREP.lastErr = r.err || 'err'; }
    }
    MOTION_PREP.last = { done, skipped, refused, failed, at: new Date().toISOString() };
    console.log('Prep movimenti Nova:', MOTION_PREP.last);
    return { ok: true, ...MOTION_PREP.last };
  } finally { MOTION_PREP.busy = false; }
}

function stillGestures() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'gestures', 'manifest.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function publicGesture(g) {
  if (!g || !/^[a-z0-9_-]+$/i.test(g.id || '') || !/^[a-z0-9_-]+\.mp4$/i.test(g.file || '')) return null;
  const file = path.join(__dirname, 'assets', 'gestures', g.file);
  if (!file.startsWith(path.join(__dirname, 'assets', 'gestures') + path.sep) || !fs.existsSync(file)) return null;
  return { id: g.id, label: g.label || g.id, emoji: g.emoji || '🎭', full: !!g.full, keys: Array.isArray(g.keys) ? g.keys.map(String) : [], url: `/api/gestures/${g.id}` };
}
app.get('/api/gestures', auth, (req, res) => {
  res.json(stillGestures().map(publicGesture).filter(Boolean));
});
app.get('/api/gestures/:id', auth, (req, res) => {
  const g = stillGestures().map(publicGesture).find((x) => x && x.id === req.params.id);
  const raw = stillGestures().find((x) => x && x.id === req.params.id);
  if (!g || !raw) return res.status(404).end();
  sendPrivateFile(req, res, path.join(__dirname, 'assets', 'gestures', raw.file));
});
app.get('/api/actions', auth, (req, res) => {
  const adult = adultChat();
  res.json({ video: !!VIDEO_PATH, adult, seconds: ACTION_SECONDS,
    catalog: Object.entries(ACTIONS).filter(([, a]) => !a.adult || adult).map(([id, a]) => ({ id, label: a.label, emoji: a.emoji, adult: !!a.adult, gesture: !!a.gesture })), gestures: GESTURE_IDS });
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
  const base = req.body.base === 'seated' ? 'seated' : 'avatar';
  if (base === 'seated' && A.adult) return res.status(400).json({ error: 'Nella scena al tavolo ci sono solo i gesti spontanei.' });
  const srcUrl = base === 'seated' ? seatedUrl(ch) : String(ch.avatar || '');
  if (base === 'seated' && !srcUrl) return res.status(400).json({ error: 'Crea prima la scena al tavolo (🏠).' });
  const m = AV_RE.exec(srcUrl);
  if (!m || !fs.existsSync(avatarPath(m[1]))) return res.status(400).json({ error: 'Serve un avatar immagine (non emoji) per preparare le azioni.' });
  const key = `${ch.id}:${aid}:${base}`;
  if (actionBusy.has(key)) return res.status(409).json({ error: 'Questa azione è già in preparazione' });
  // v8.4.7: un'azione già pronta (stesso avatar) non si rifà mai
  { const cur = (base === 'seated' ? visibleSeated(ch) : visibleActions(ch))[aid]; if (cur && cur.url && !cur.stale) return res.json({ status: 'done', kind: cur.kind || 'video', action: cur, already: true }); }
  // v8.5.0: nessun limite orario dell'app: decide solo xAI (un suo 429 viene gestito dal telefono con attese crescenti)
  const now = Date.now();
  const charge = () => {};
  const buf = fs.readFileSync(avatarPath(m[1]));
  const dataUrl = `data:image/${buf[0] === 0xff ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;
  actionBusy.add(key);
  try {
    if (VIDEO_PATH && req.body.mode !== 'pose') {
      const body = { model: ACTION_VIDEO_MODEL, prompt: imgPrefix(!!A.adult) + ACT_BASE + heShe(ch, A.motion) + (base === 'seated' ? '. She stays seated at the table the whole time, forearms back on the table at the end' : '') + (A.adult ? '' : ' It ends in exactly the same pose as the first frame.'), image: { url: dataUrl }, duration: ACTION_SECONDS, resolution: ACTION_RESOLUTION };
      if (!A.adult) body.last_frame = { url: dataUrl }; // loop pulito: l'ultimo fotogramma torna l'avatar
      let r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(body) });
      let j = await r.json().catch(() => ({}));
      if (!r.ok && body.last_frame && r.status === 400 && /last_frame/i.test(JSON.stringify(j))) { // modello senza ultimo fotogramma fissato
        delete body.last_frame; r = await fetch(AI_BASE_URL + VIDEO_PATH, { method: 'POST', headers: aiHeaders(req.aiKey), body: JSON.stringify(body) }); j = await r.json().catch(() => ({}));
      }
      if (r.ok && j.request_id) { charge(); actionJobs.set(j.request_id, { user: req.user, charId: ch.id, aid, avatar: srcUrl, base, at: now }); return res.json({ status: 'pending', rid: j.request_id, kind: 'video' }); }
      const msg = aiErrorMsg(r.status, j);
      console.error(`Azione ${aid}: video non avviato (HTTP ${r.status})`);
      if (msg === 'Contenuto rifiutato dal servizio AI' || r.status === 401) return res.status(r.status === 401 ? 400 : 422).json({ error: msg, refused: msg === 'Contenuto rifiutato dal servizio AI' }); // 400: mai 401 (farebbe uscire dall'app)
      if (![404, 405, 501].includes(r.status)) return res.status(502).json({ error: msg });
      // video non disponibile con questa chiave/servizio: ripiego sulle pose (immagini)
    }
    const action = await poseFallback(req.user, req.aiKey, ch, aid, srcUrl, buf, base); charge();
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
      return res.json({ status: 'failed', refused, error: refused ? 'Contenuto rifiutato dal servizio AI' : `Clip video non riuscita da xAI (${j.status === 'expired' ? 'scaduta' : 'fallita'})${raw && raw.length < 300 && raw !== '{}' ? ': ' + scrubSecrets(raw).slice(0, 160) : ''}` }); // v8.4.7: motivo vero
    }
    if (j.status !== 'done' || !j.video || !j.video.url) return res.json({ status: j.status || 'pending' });
    actionJobs.delete(req.params.rid);
    const ch = getChars(req.user).find((c) => c.id === job.charId);
    if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
    if (ACTIONS[job.aid].adult && !actionAllowed(ch, job.aid)) return res.status(403).json({ error: 'Modalità adulti non più attiva: clip scartata.' });
    const buf = Buffer.from(await (await fetch(j.video.url)).arrayBuffer());
    if (buf.length < 100) return res.json({ status: 'failed', error: 'Video vuoto' });
    res.json({ status: 'done', kind: 'video', action: await saveAction(req.user, ch, job.aid, buf, 'video', job.avatar, 'mp4', job.base) });
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
// ---------- v8.4: Galleria (foto e video scelti dal telefono) ----------
// Solo i file che scegli tu dal rullino (su iPhone le web app vedono solo quelli). Spazio privato per utente:
// data/users/<utente>/gallery/ (+ indice gallery.json). Eliminare = spostare in "Eliminati di recente" (30 giorni, ripristinabili).
const GAL_RE = /^[a-f0-9]{16}\.(jpg|png|webp|gif|heic|mp4|mov|webm)$/;
const GAL_THUMB_RE = /^[a-f0-9]{16}\.t\.jpg$/;
const GAL_MAX_IMG = 40 * 1024 * 1024, GAL_MAX_VID = 200 * 1024 * 1024, GAL_TRASH_DAYS = 30;
const galIndex = (u) => path.join(userDir(u), 'gallery.json');
const galDir = (u) => userDir(u, 'gallery');
const galTrashDir = (u) => userDir(u, 'gallery-trash');
function galSniff(b) { // tipo vero dal contenuto (non dal nome del file)
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', kind: 'image', type: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', kind: 'image', type: 'image/png' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', kind: 'image', type: 'image/webp' };
  if (b.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', kind: 'image', type: 'image/gif' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', kind: 'video', type: 'video/webm' };
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { ext: 'heic', kind: 'image', type: 'image/heic' };
    if (brand === 'qt  ') return { ext: 'mov', kind: 'video', type: 'video/quicktime' };
    return { ext: 'mp4', kind: 'video', type: 'video/mp4' };
  }
  return null;
}
const galPub = (it) => ({ id: it.id, kind: it.kind, type: it.type, size: it.size, name: it.name, w: it.w || null, h: it.h || null, duration: it.duration || null,
  addedAt: it.addedAt, deletedAt: it.deletedAt || null, url: `/api/gallery/file/${it.file}`, thumb: it.thumb ? `/api/gallery/file/${it.thumb}` : null });
function galPurge(u) { // svuota "Eliminati di recente" dopo 30 giorni (cancellazione già confermata dall'utente)
  const now = Date.now(); let changed = false;
  const list = readJSON(galIndex(u), []).filter((it) => {
    if (!it.deletedAt || now - Date.parse(it.deletedAt) < GAL_TRASH_DAYS * 864e5) return true;
    for (const f of [it.file, it.thumb]) if (f) fs.rmSync(path.join(galTrashDir(u), f), { force: true });
    changed = true; return false;
  });
  if (changed) writeJSON(galIndex(u), list);
}
app.get('/api/gallery', auth, (req, res) => {
  try { galPurge(req.user); } catch {}
  const list = readJSON(galIndex(req.user), []).slice().reverse();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: list.filter((i) => !i.deletedAt).map(galPub), trash: list.filter((i) => i.deletedAt).map(galPub), trashDays: GAL_TRASH_DAYS });
});
// Caricamento: il corpo della richiesta è il file stesso (scritto su disco a pezzi, mai tutto in memoria).
app.post('/api/gallery', auth, requireActivated, (req, res) => {
  const ct = String(req.get('Content-Type') || '');
  if (!/^(image|video)\//.test(ct)) return res.status(400).json({ error: 'Solo foto o video' });
  const max = /^video\//.test(ct) ? GAL_MAX_VID : GAL_MAX_IMG;
  if (Number(req.get('Content-Length') || 0) > max) return res.status(413).json({ error: `File troppo grande (max ${Math.round(max / 1048576)} MB)` });
  const id = newId(), tmp = path.join(galDir(req.user), `${id}.part`);
  const out = fs.createWriteStream(tmp); let size = 0, head = Buffer.alloc(0), failed = null;
  req.on('data', (c) => { size += c.length; if (head.length < 16) head = Buffer.concat([head, c.subarray(0, 16)]); if (size > max && !failed) { failed = 'big'; req.unpipe(out); out.destroy(); req.resume(); } });
  req.pipe(out);
  const done = () => {
    if (failed === 'aborted') { fs.rmSync(tmp, { force: true }); return res.status(400).end(); }
    if (failed) { fs.rmSync(tmp, { force: true }); return res.status(413).json({ error: `File troppo grande (max ${Math.round(max / 1048576)} MB)` }); }
    const t = galSniff(head);
    if (!t || !size) { fs.rmSync(tmp, { force: true }); return res.status(400).json({ error: 'Formato non riconosciuto: solo foto (JPEG, PNG, HEIC, WebP, GIF) o video (MP4, MOV, WebM)' }); }
    const file = `${id}.${t.ext}`; fs.renameSync(tmp, path.join(galDir(req.user), file));
    let name = ''; try { name = decodeURIComponent(String(req.get('X-File-Name') || '')); } catch {}
    const num = (v, m) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < m ? Math.round(n * 10) / 10 : null; };
    const it = { id, file, kind: t.kind, type: t.type, size, name: safeText(name, 120) || (t.kind === 'video' ? 'Video' : 'Foto'),
      w: num(req.query.w, 20000), h: num(req.query.h, 20000), duration: t.kind === 'video' ? num(req.query.d, 36000) : null, addedAt: new Date().toISOString(), thumb: null };
    mutateJSON(galIndex(req.user), [], (l) => [...l, it]).then(() => res.json({ item: galPub(it) })).catch((e) => res.status(500).json({ error: e.message }));
  };
  out.on('close', () => { if (!res.headersSent) done(); });
  out.on('error', () => { if (!res.headersSent) { fs.rmSync(tmp, { force: true }); res.status(500).json({ error: 'Salvataggio non riuscito' }); } });
  req.on('aborted', () => { failed = failed || 'aborted'; });
});
// Miniatura creata sul telefono (JPEG piccolo) per una griglia veloce
app.put('/api/gallery/:id/thumb', auth, async (req, res) => {
  const m = String(req.body.dataUrl || '').match(/^data:image\/jpeg;base64,(.+)$/);
  if (!ID_RE.test(req.params.id) || !m) return res.status(400).json({ error: 'Miniatura non valida' });
  const buf = Buffer.from(m[1], 'base64'); if (buf.length > 400000 || buf[0] !== 0xff) return res.status(400).json({ error: 'Miniatura non valida' });
  let pub = null;
  await mutateJSON(galIndex(req.user), [], (l) => l.map((it) => {
    if (it.id !== req.params.id || it.deletedAt) return it;
    const thumb = `${it.id}.t.jpg`; fs.writeFileSync(path.join(galDir(req.user), thumb), buf);
    const n = { ...it, thumb }; pub = galPub(n); return n;
  }));
  if (!pub) return res.status(404).json({ error: 'Elemento non trovato' });
  res.json({ item: pub });
});
app.get('/api/gallery/file/:f', auth, (req, res) => {
  const f = path.basename(req.params.f);
  if (!GAL_RE.test(f) && !GAL_THUMB_RE.test(f)) return res.status(400).end();
  const id = f.slice(0, 16), it = readJSON(galIndex(req.user), []).find((i) => i.id === id);
  if (!it) return res.status(404).end();
  const p = path.join(it.deletedAt ? galTrashDir(req.user) : galDir(req.user), f);
  if (!fs.existsSync(p)) return res.status(404).end();
  if (req.query.download) res.attachment((it.name && !GAL_THUMB_RE.test(f) ? it.name.replace(/[^\w.\- ]+/g, '_') : f));
  if (it.type) res.type(GAL_THUMB_RE.test(f) ? 'image/jpeg' : it.type);
  res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
  res.sendFile(p); // con Range (video su iPhone)
});
// Eliminazione esplicita (conferma nell'interfaccia): va in "Eliminati di recente" per 30 giorni
app.delete('/api/gallery/:id', auth, async (req, res) => {
  if (!ID_RE.test(req.params.id) || req.body.confirm !== true) return res.status(400).json({ error: 'Conferma richiesta' });
  let found = null;
  await mutateJSON(galIndex(req.user), [], (l) => l.map((it) => {
    if (it.id !== req.params.id) return it;
    if (it.deletedAt) { // già nel cestino: elimina subito per sempre
      found = 'gone'; for (const f of [it.file, it.thumb]) if (f) fs.rmSync(path.join(galTrashDir(req.user), f), { force: true }); return null;
    }
    for (const f of [it.file, it.thumb]) if (f && fs.existsSync(path.join(galDir(req.user), f))) fs.renameSync(path.join(galDir(req.user), f), path.join(galTrashDir(req.user), f));
    found = 'trash'; return { ...it, deletedAt: new Date().toISOString() };
  }).filter(Boolean));
  if (!found) return res.status(404).json({ error: 'Elemento non trovato' });
  audit(req.user, 'galleria-elimina', { id: req.params.id, how: found });
  res.json({ ok: true, trashed: found === 'trash', trashDays: GAL_TRASH_DAYS });
});
app.post('/api/gallery/:id/restore', auth, async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).end();
  let pub = null;
  await mutateJSON(galIndex(req.user), [], (l) => l.map((it) => {
    if (it.id !== req.params.id || !it.deletedAt) return it;
    for (const f of [it.file, it.thumb]) if (f && fs.existsSync(path.join(galTrashDir(req.user), f))) fs.renameSync(path.join(galTrashDir(req.user), f), path.join(galDir(req.user), f));
    const n = { ...it }; delete n.deletedAt; pub = galPub(n); return n;
  }));
  if (!pub) return res.status(404).json({ error: 'Elemento non trovato' });
  res.json({ item: pub });
});
// Foto/video inviati in una chat: copiati nell'archivio condiviso (la chat è di coppia, la vede anche l'altro profilo)
const CHAT_MEDIA_RE = /^[a-f0-9]{16}\.(jpg|png|webp|gif|heic|mp4|mov|webm)$/;
function galToChat(u, gid) {
  const it = readJSON(galIndex(u), []).find((i) => i.id === gid && !i.deletedAt);
  if (!it || !fs.existsSync(path.join(galDir(u), it.file))) return null;
  const file = `${newId()}.${it.file.split('.').pop()}`;
  fs.copyFileSync(path.join(galDir(u), it.file), path.join(sharedDir('chat-media'), file));
  let thumb = null;
  if (it.thumb && fs.existsSync(path.join(galDir(u), it.thumb))) { thumb = `${file.slice(0, 16)}.t.jpg`; fs.copyFileSync(path.join(galDir(u), it.thumb), path.join(sharedDir('chat-media'), thumb)); }
  return { file, thumb, kind: it.kind, type: it.type, w: it.w || null, h: it.h || null };
}
app.get('/api/chat-media/:f', auth, (req, res) => {
  const f = path.basename(req.params.f);
  if (!CHAT_MEDIA_RE.test(f) && !GAL_THUMB_RE.test(f)) return res.status(400).end();
  const p = path.join(sharedDir('chat-media'), f); if (!fs.existsSync(p)) return res.status(404).end();
  if (req.query.download) res.attachment(f);
  res.setHeader('Cache-Control', 'private, max-age=2592000, immutable');
  res.sendFile(p);
});

// ---------- v8.4: registro chiamate (per utente) ----------
// Le chiamate nuove vengono registrate a fine chiamata; quelle di prima si ricavano dai messaggi segnati 📞/📹 nelle chat.
const callsFile = (u) => path.join(userDir(u), 'calls.json');
app.post('/api/calls', auth, async (req, res) => {
  const id = String(req.body.characterId || '');
  if (!ID_RE.test(id) || !getChars(req.user).find((c) => c.id === id)) return res.status(400).json({ error: 'Personaggio non valido' });
  const st = Date.parse(req.body.startedAt); const sec = Math.max(0, Math.min(86400, Math.round(Number(req.body.seconds) || 0)));
  if (!Number.isFinite(st) || Math.abs(Date.now() - st) > 2 * 864e5) return res.status(400).json({ error: 'Orario non valido' });
  const rec = { id: newId(), characterId: id, mode: req.body.mode === 'voice' ? 'voice' : 'video', startedAt: new Date(st).toISOString(), seconds: sec };
  await mutateJSON(callsFile(req.user), [], (l) => [...l, rec].slice(-500));
  res.json({ call: rec });
});
app.get('/api/calls', auth, (req, res) => {
  const chars = getChars(req.user), logged = readJSON(callsFile(req.user), []);
  const out = logged.filter((c) => chars.find((x) => x.id === c.characterId)).map((c) => ({ ...c, derived: false }));
  for (const ch of chars) {
    let s = null; const sessions = [];
    for (const m of readChat(ch.id).messages) {
      if (!m.call) continue;
      const t = Date.parse(m.at); if (!Number.isFinite(t)) continue;
      const mine = m.role === 'user' ? m.author === req.user : m.replyTo === req.user;
      if (s && t - s.end < 8 * 60e3) { s.end = t; s.mine = s.mine || mine; if (m.callMode !== 'voice') s.mode = 'video'; }
      else { s = { start: t, end: t, mine, mode: m.callMode === 'voice' ? 'voice' : 'video' }; sessions.push(s); }
    }
    for (const x of sessions) {
      if (!x.mine) continue;
      const dup = out.some((c) => c.characterId === ch.id && !c.derived && Date.parse(c.startedAt) - 120e3 <= x.end && Date.parse(c.startedAt) + c.seconds * 1000 + 120e3 >= x.start);
      if (!dup) out.push({ id: 'm' + x.start.toString(16), characterId: ch.id, mode: x.mode, startedAt: new Date(x.start).toISOString(), seconds: Math.round((x.end - x.start) / 1000), derived: true });
    }
  }
  out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ calls: out.slice(0, 150) });
});

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
app.get('/api/support-notes', auth, async (req, res) => {
  const mine = await withNotes(async () => loadNotes().filter((n) => n && n.authorId === req.user));
  res.json({ notes: mine.map(publicNote) });
});
app.post('/api/support-notes', auth, async (req, res) => {
  const text = String((req.body && req.body.text) || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'Scrivi un appunto' });
  try {
    const saved = await withNotes(async () => {
      const list = loadNotes();
      const now = new Date().toISOString();
      const note = { id: newId(), authorId: req.user, author: personName(req.user), text, time: now, delivered: false, reply: { author: 'Nova', text: NOVA_REPLY, time: now } };
      list.push(note);
      writeJSON(NOTES_FILE(), list);
      if (await deliverSupportNote(note)) note.delivered = true;
      for (const n of list) { if (n !== note && n && !n.delivered && await deliverSupportNote(n)) n.delivered = true; }
      writeJSON(NOTES_FILE(), list);
      return note;
    });
    res.json({ ok: true, delivered: !!saved.delivered, note: publicNote(saved) });
  } catch (e) {
    console.error('Appunto assistenza:', e.message);
    res.status(500).json({ error: 'Salvataggio non riuscito' });
  }
});
app.post('/api/server-key', auth, requireActivated, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
  try {
    const k = String(req.body.key || req.get('X-AI-Key') || '').trim();
    setServerAiKey(k); res.json({ ok: true, stored: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.get('/api/server-key', auth, (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
  res.json({ stored: !!getServerAiKey(), fromEnv: !!envSecret('XAI_API_KEY', 'AI_KEY') });
});
app.post('/api/solo/prep', auth, requireActivated, async (req, res) => {
  const key = String(req.get('X-AI-Key') || getServerAiKey() || '').trim();
  if (!key) return res.status(400).json({ error: 'Chiave xAI mancante', code: 'NO_KEY' });
  if (isAdmin(req.user) && req.body && req.body.store) { try { setServerAiKey(key); } catch {} }
  res.json({ ok: true, started: true, busy: MOTION_PREP.busy });
  setImmediate(() => prepSoloMotions(key).catch((e) => console.error('Prep solo:', e.message)));
});
app.get('/api/solo', auth, (req, res) => {
  const ch = getSoloChar(req.user);
  if (!ch) return res.status(404).json({ error: 'Avatar non pronto' });
  const { drawer, ...pub } = ch;
  res.json({ character: { ...pub, scenes: cleanScenes(pub.scenes), actions: visibleActions(pub), seated: visibleSeated(pub), adultActionsOk: aiFace(pub),
    personality: SOLO_FIXED.personality, style: SOLO_FIXED.style }, prep: { busy: MOTION_PREP.busy, last: MOTION_PREP.last, lastErr: MOTION_PREP.lastErr } });
});
app.put('/api/solo/requests', auth, requireActivated, async (req, res) => {
  const ch = getSoloChar(req.user); if (!ch) return res.status(404).json({ error: 'Avatar non pronto' });
  if (!canEdit(req.user)) return res.status(403).json({ error: ADMIN_MSG, code: 'ADMIN_ONLY' });
  const requests = String(req.body.requests || '').slice(0, 4000);
  const c = await patchChar(ch.id, (x) => { x.requests = requests; x.orders = requests; });
  const { drawer, ...pub } = c; res.json({ character: pub });
});
app.get('/api/mood', auth, (req, res) => {
  const hist = loadMoodHist();
  const cur = currentMood(hist);
  const week = Date.now() - 7 * 864e5;
  let series = hist.filter((p) => Date.parse(p.t) >= week);
  if (!series.length) series = [{ ...cur, t: new Date().toISOString() }];
  const values = {};
  for (const k of MOOD_KEYS) values[k] = cur[k];
  res.json({ values, summary: moodSummary(cur), history: series });
});
app.get(['/galleria', '/galleria/'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Galleria totale: sola lettura, nessun file viene spostato o riscritto ----------
const ARCHIVE_IMG = /\.(png|jpe?g|webp|gif|heic)$/i;
const ARCHIVE_VID = /\.(mp4|mov|webm|m4v)$/i;
function archiveWho(id) {
  const k = String(id || '').toLowerCase();
  if (k === 'nicola' || k === 'nico') return 'Nicola';
  if (k === 'luisa') return 'Luisa';
  if (k === 'nova' || k === 'ai') return 'Nova-generated';
  return 'sconosciuto';
}
function archiveRead(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function archiveExists(abs) { try { return fs.statSync(abs).isFile(); } catch { return false; } }
function archiveMtime(abs) { try { return new Date(fs.statSync(abs).mtimeMs).toISOString(); } catch { return null; } }
function archiveRel(abs) {
  const rel = path.relative(path.resolve(DATA_DIR), path.resolve(abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}
function archiveAllowed(rel) {
  if (!rel || rel.includes('..')) return false;
  const ok = /^users\/(nicola|luisa)\/(gallery|gallery-trash|images|videos|avatars)\/[^/]+$/.test(rel)
    || /^shared\/(avatars|actions|chat-media|feed)\/[^/]+$/.test(rel)
    || /^shared\/trash-characters\/[^/]+\/files\/[^/]+$/.test(rel);
  if (!ok || /\.json$/i.test(rel)) return false;
  return ARCHIVE_IMG.test(rel) || ARCHIVE_VID.test(rel) || /\.t\.jpg$/i.test(rel);
}
function archiveId(rel) { return Buffer.from(rel).toString('base64url'); }
function archiveDecode(id) {
  let rel = '';
  try { rel = Buffer.from(String(id || ''), 'base64url').toString('utf8'); } catch { return null; }
  rel = rel.split('\\').join('/');
  if (!archiveAllowed(rel)) return null;
  const abs = path.resolve(DATA_DIR, rel);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (!abs.startsWith(root)) return null;
  return { rel, abs };
}
function archiveKind(name) { return ARCHIVE_VID.test(name) ? 'video' : (ARCHIVE_IMG.test(name) ? 'photo' : null); }
function archiveAdd(items, seen, abs, meta) {
  if (!archiveExists(abs)) return;
  const rel = archiveRel(abs);
  const kind = rel && archiveKind(rel);
  if (!rel || !kind || !archiveAllowed(rel) || seen.has(rel)) return;
  seen.add(rel);
  let thumbRel = null;
  if (meta.thumbAbs && archiveExists(meta.thumbAbs)) thumbRel = archiveRel(meta.thumbAbs);
  items.push({
    id: archiveId(rel), kind, at: meta.at || archiveMtime(abs), uploader: meta.uploader || 'sconosciuto',
    source: meta.source, trash: !!meta.trash, label: String(meta.label || '').slice(0, 80),
    thumb: thumbRel && archiveAllowed(thumbRel) ? '/api/archive/media/' + archiveId(thumbRel) : (kind === 'photo' ? '/api/archive/media/' + archiveId(rel) : null),
    url: '/api/archive/media/' + archiveId(rel),
  });
}
function archiveDirFiles(dir) {
  try { return fs.readdirSync(dir).filter((n) => archiveKind(n)); } catch { return []; }
}
function avatarArchiveSet() {
  const files = new Set();
  const dir = path.join(DATA_DIR, 'avatar-archive');
  let stamps = []; try { stamps = fs.readdirSync(dir); } catch { return files; }
  for (const stamp of stamps) {
    const man = archiveRead(path.join(dir, stamp, 'manifest.json'), null);
    for (const rel of (man && man.files) || []) files.add(String(rel));
  }
  return files;
}
function stampArchived(rel, meta, set) {
  if (!rel || rel.endsWith('/' + SCELTA_FILE)) return meta;
  if (!(meta && meta.archived) && !(set && set.has(rel))) return meta;
  const base = String((meta && meta.label) || '');
  const label = base.includes('archiviato') ? base : (base ? base + ' · archiviato' : 'archiviato');
  return { ...meta, label };
}
function collectArchive() {
  const items = [], seen = new Set();
  const root = path.resolve(DATA_DIR);
  const archivedFiles = avatarArchiveSet();
  for (const u of ['nicola', 'luisa']) {
    const who = archiveWho(u);
    const idx = archiveRead(path.join(root, 'users', u, 'gallery.json'), []);
    const known = new Set();
    for (const it of Array.isArray(idx) ? idx : []) {
      if (!it || !it.file) continue;
      known.add(it.file); if (it.thumb) known.add(it.thumb);
      const trash = !!it.deletedAt;
      const base = path.join(root, 'users', u, trash ? 'gallery-trash' : 'gallery');
      archiveAdd(items, seen, path.join(base, path.basename(it.file)), {
        at: it.addedAt || it.deletedAt, uploader: who, source: 'Galleria', trash, label: it.name || '',
        thumbAbs: it.thumb ? path.join(base, path.basename(it.thumb)) : null,
      });
    }
    for (const name of archiveDirFiles(path.join(root, 'users', u, 'gallery'))) {
      if (known.has(name) || /\.t\.jpg$/i.test(name)) continue;
      archiveAdd(items, seen, path.join(root, 'users', u, 'gallery', name), { uploader: 'sconosciuto', source: 'Galleria' });
    }
    const images = archiveRead(path.join(root, 'users', u, 'images.json'), []);
    const imgKnown = new Set();
    for (const it of Array.isArray(images) ? images : []) {
      if (!it || !it.file) continue;
      imgKnown.add(path.basename(it.file));
      const manual = it.prompt === 'Immagine ritagliata';
      archiveAdd(items, seen, path.join(root, 'users', u, 'images', path.basename(it.file)), {
        at: it.createdAt, uploader: manual ? who : 'Nova-generated', source: manual ? 'Caricamento' : 'Immagine generata', label: manual ? '' : 'Nova',
      });
    }
    for (const name of archiveDirFiles(path.join(root, 'users', u, 'images'))) {
      if (imgKnown.has(name)) continue;
      archiveAdd(items, seen, path.join(root, 'users', u, 'images', name), { uploader: 'sconosciuto', source: 'Immagine generata' });
    }
    const videos = archiveRead(path.join(root, 'users', u, 'videos.json'), []);
    const vidKnown = new Set();
    for (const it of Array.isArray(videos) ? videos : []) {
      if (!it || !it.file) continue;
      vidKnown.add(path.basename(it.file));
      archiveAdd(items, seen, path.join(root, 'users', u, 'videos', path.basename(it.file)), {
        at: it.createdAt, uploader: 'Nova-generated', source: 'Video generato', label: 'Nova',
      });
    }
    for (const name of archiveDirFiles(path.join(root, 'users', u, 'videos'))) {
      if (vidKnown.has(name)) continue;
      archiveAdd(items, seen, path.join(root, 'users', u, 'videos', name), { uploader: 'sconosciuto', source: 'Video generato' });
    }
    for (const name of archiveDirFiles(path.join(root, 'users', u, 'avatars'))) {
      const abs = path.join(root, 'users', u, 'avatars', name);
      archiveAdd(items, seen, abs, stampArchived(archiveRel(abs), { uploader: who, source: 'Avatar' }, archivedFiles));
    }
  }
  const chars = archiveRead(path.join(root, 'shared', 'characters.json'), []);
  const avatarMeta = new Map(), actionMeta = new Map();
  const noteAv = (url, meta) => { const m = /\/api\/avatars\/([a-f0-9]{16}\.(?:png|jpg))$/.exec(String(url || '')); if (m) avatarMeta.set(m[1], meta); };
  for (const ch of Array.isArray(chars) ? chars : []) {
    if (!ch) continue;
    const who = ch.avatarSource === 'ai' ? 'Nova-generated' : archiveWho(ch.createdBy || ch.updatedBy);
    const at = ch.updatedAt || ch.createdAt;
    const mark = !!ch.archived;
    noteAv(ch.avatar, { at, uploader: who, label: ch.name || '', archived: mark });
    noteAv(ch.identity && ch.identity.refAvatar, { at, uploader: who, label: ch.name || '', archived: mark });
    for (const h of ch.lookHistory || []) noteAv(h && h.avatar, { at: h.at || at, uploader: h && h.avatarSource === 'upload' ? archiveWho(ch.createdBy) : who, label: ch.name || '', archived: mark });
    for (const sc of Object.values(ch.scenes || {})) noteAv(sc && sc.url, { at, uploader: who, label: ch.name || '', archived: mark });
    for (const bag of [ch.actions, ch.seated]) {
      for (const a of Object.values(bag || {})) {
        if (!a || !a.file) continue;
        actionMeta.set(path.basename(a.file), { at: a.at, uploader: a.by ? archiveWho(a.by) : 'Nova-generated', label: ch.name || '', archived: mark });
      }
    }
  }
  for (const name of archiveDirFiles(path.join(root, 'shared', 'avatars'))) {
    const abs = path.join(root, 'shared', 'avatars', name);
    const meta = avatarMeta.get(name) || { uploader: 'sconosciuto' };
    archiveAdd(items, seen, abs, stampArchived(archiveRel(abs), { ...meta, source: 'Avatar' }, archivedFiles));
  }
  for (const name of archiveDirFiles(path.join(root, 'shared', 'actions'))) {
    const abs = path.join(root, 'shared', 'actions', name);
    const meta = actionMeta.get(name) || { uploader: 'Nova-generated' };
    archiveAdd(items, seen, abs, stampArchived(archiveRel(abs), { ...meta, source: 'Clip' }, archivedFiles));
  }
  const chatWho = new Map();
  const chatDir = path.join(root, 'shared', 'chats');
  let chatNames = [];
  try { chatNames = fs.readdirSync(chatDir).filter((n) => n.endsWith('.json')); } catch { chatNames = []; }
  for (const n of chatNames) {
    const chat = archiveRead(path.join(chatDir, n), null);
    for (const m of (chat && chat.messages) || []) {
      const ph = m && m.photo;
      if (!ph || !ph.file) continue;
      const who = m.role === 'assistant' ? 'Nova-generated' : archiveWho(m.author);
      chatWho.set(path.basename(ph.file), { at: m.at, uploader: who, label: who });
      if (ph.thumb) chatWho.set(path.basename(ph.thumb), { at: m.at, uploader: who, thumb: true });
    }
  }
  for (const name of archiveDirFiles(path.join(root, 'shared', 'chat-media'))) {
    if (/\.t\.jpg$/i.test(name)) continue;
    const meta = chatWho.get(name) || { uploader: 'sconosciuto' };
    const thumbName = chatWho.has(name.replace(/\.[^.]+$/, '.t.jpg')) ? name.replace(/\.[^.]+$/, '.t.jpg') : null;
    archiveAdd(items, seen, path.join(root, 'shared', 'chat-media', name), {
      ...meta, source: 'Chat', thumbAbs: thumbName ? path.join(root, 'shared', 'chat-media', thumbName) : null,
    });
  }
  const feed = archiveRead(path.join(root, 'shared', 'feed.json'), []);
  const feedKnown = new Set();
  for (const p of Array.isArray(feed) ? feed : []) {
    if (!p || !p.file) continue;
    feedKnown.add(path.basename(p.file));
    archiveAdd(items, seen, path.join(root, 'shared', 'feed', path.basename(p.file)), {
      at: p.createdAt, uploader: archiveWho(p.author), source: 'Diario', label: p.caption || '',
    });
  }
  for (const name of archiveDirFiles(path.join(root, 'shared', 'feed'))) {
    if (feedKnown.has(name)) continue;
    archiveAdd(items, seen, path.join(root, 'shared', 'feed', name), { uploader: 'sconosciuto', source: 'Diario' });
  }
  const trashRoot = path.join(root, 'shared', 'trash-characters');
  let trashDirs = [];
  try { trashDirs = fs.readdirSync(trashRoot); } catch { trashDirs = []; }
  for (const d of trashDirs) {
    const td = path.join(trashRoot, d);
    if (!archiveExists(path.join(td, 'character.json')) && !archiveExists(path.join(td, 'meta.json'))) continue;
    const meta = archiveRead(path.join(td, 'meta.json'), {});
    const ch = archiveRead(path.join(td, 'character.json'), {});
    for (const name of archiveDirFiles(path.join(td, 'files'))) {
      archiveAdd(items, seen, path.join(td, 'files', name), {
        at: meta.deletedAt || ch.updatedAt, uploader: archiveWho(meta.by || ch.createdBy), source: 'Cestino', trash: true, label: ch.name || meta.name || '',
      });
    }
  }
  items.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || a.id.localeCompare(b.id));
  const by = { Nicola: 0, Luisa: 0, 'Nova-generated': 0, sconosciuto: 0 };
  let photos = 0, videos = 0;
  for (const it of items) {
    if (it.kind === 'video') videos++; else photos++;
    if (!Object.prototype.hasOwnProperty.call(by, it.uploader)) it.uploader = 'sconosciuto';
    by[it.uploader]++;
  }
  return {
    totals: { photos, videos, by, first: items.length ? items[0].at : null, last: items.length ? items[items.length - 1].at : null },
    items, telegram: collectTelegram(),
  };
}
function archiveRedact(s) {
  return String(s || '')
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, '[omesso]')
    .replace(/bot\d{5,}:[A-Za-z0-9_-]+/gi, '[omesso]')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}
function collectTelegram() {
  const hits = [];
  const seen = new Set();
  const push = (row) => {
    const text = archiveRedact(row.text);
    if (!/telegram|t\.me\//i.test(text)) return;
    const key = text + '|' + (row.at || '');
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ at: row.at || null, who: row.who || 'sconosciuto', source: row.source || '', text });
  };
  const root = path.resolve(DATA_DIR);
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'backups' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(avatars|actions|gallery|gallery-trash|images|videos|feed|chat-media|files|consent)$/.test(e.name)) continue;
        walk(p, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.json') && !/pins|sessions|server-ai-key|lockout|consent/i.test(e.name)) {
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.size > 2000000) continue;
        let txt = ''; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
        if (!/telegram|t\.me\//i.test(txt)) continue;
        let data; try { data = JSON.parse(txt); } catch { push({ text: txt.slice(0, 180), source: path.basename(p) }); continue; }
        const msgs = data && Array.isArray(data.messages) ? data.messages : null;
        if (msgs) {
          for (const m of msgs) if (m && /telegram|t\.me\//i.test(m.content || '')) push({ at: m.at, who: m.role === 'assistant' ? 'Nova-generated' : archiveWho(m.author), source: 'Chat', text: m.content });
        } else push({ text: txt.slice(0, 180), source: path.relative(root, p).split(path.sep).join('/') });
      }
    }
  };
  walk(root, 0);
  hits.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return { code: false, hits };
}
app.get('/api/archive', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(collectArchive());
});
app.get('/api/archive/media/:id', auth, (req, res) => {
  const hit = archiveDecode(req.params.id);
  if (!hit || !archiveExists(hit.abs)) return res.status(404).end();
  const ext = path.extname(hit.abs).toLowerCase();
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(hit.abs);
});
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
  const young = (n) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(n); const t = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : 0; return t && Date.now() - t < 7 * 86400e3; }; // v8.4.1: copie di sicurezza delle eliminazioni tenute almeno 7 giorni
  for (const n of [...normal.slice(0, Math.max(0, normal.length - BACKUP_KEEP)), ...prot.slice(0, Math.max(0, prot.length - 10)).filter((n) => !young(n))]) fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
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
// Copia un file nell'archivio avatar. Non cancella l'originale. La foto scelta non si archivia.
function archiveCopyFile(destRoot, rel) {
  if (!rel || rel === SCELTA_FILE || rel.endsWith('/' + SCELTA_FILE)) return null;
  const abs = path.join(DATA_DIR, ...String(rel).split('/'));
  let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const to = path.join(destRoot, 'files', ...String(rel).split('/'));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(abs, to);
  return rel;
}
function archiveAvatarsOnce() {
  const done = readJSON(MIGRATIONS_FILE, {}) || {};
  if (done[AVATAR_ARCHIVE_KEY]) return;
  const list = readJSON(CHARS_FILE(), []);
  const chars = Array.isArray(list) ? list : [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destRoot = path.join(DATA_DIR, 'avatar-archive', stamp);
  const files = [];
  const seen = new Set();
  const take = (rel) => {
    if (!rel || seen.has(rel)) return;
    const copied = archiveCopyFile(destRoot, rel);
    if (!copied) return;
    seen.add(copied); files.push(copied);
  };
  for (const dir of ['shared/avatars', 'shared/actions', 'users/nicola/avatars', 'users/luisa/avatars']) {
    const abs = path.join(DATA_DIR, ...dir.split('/'));
    let names = []; try { names = fs.readdirSync(abs); } catch { names = []; }
    for (const name of names) {
      if (!ARCHIVE_IMG.test(name) && !ARCHIVE_VID.test(name)) continue;
      take(dir + '/' + name);
    }
  }
  const archived = [];
  let changed = false;
  for (const c of chars) {
    if (!c || c.ready === 'nova-scelta') continue;
    if (!c.archived) { c.archived = true; c.archivedAt = new Date().toISOString(); changed = true; }
    archived.push({ id: c.id, name: c.name || '', ready: c.ready || '', avatar: c.avatar || '' });
  }
  if (changed) writeJSON(CHARS_FILE(), chars);
  if (archived.length || files.length) {
    fs.mkdirSync(destRoot, { recursive: true });
    writeJSON(path.join(destRoot, 'manifest.json'), {
      at: new Date().toISOString(),
      note: 'Archivio reversibile: gli originali non sono stati cancellati. Ripristino in docs/AVATAR_ARCHIVE.md.',
      characters: archived,
      files,
    });
  }
  done[AVATAR_ARCHIVE_KEY] = { at: new Date().toISOString(), stamp, characters: archived.length, files: files.length };
  writeJSON(MIGRATIONS_FILE, done);
  console.log(`Avatar archiviati (niente cancellazioni): ${archived.length} schede, ${files.length} file, cartella avatar-archive/${stamp}`);
}
function preferUnico(id) {
  if (!ID_RE.test(id)) return;
  for (const u of Object.keys(USERS)) {
    const f = settingsFile(u);
    const s = readJSON(f, {}) || {};
    const chars = readJSON(CHARS_FILE(), []) || [];
    const cur = chars.find((c) => c && c.id === s.activeChar);
    if (cur && liveChar(cur)) continue;
    s.activeChar = id;
    writeJSON(f, s);
  }
}
function seedDarkArchived() {
  const src = path.join(__dirname, 'assets', 'ready', 'nova-unico.jpg');
  const dest = path.join(avatarDir(), NOVA_UNICO_FILE);
  if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
  const list = readJSON(CHARS_FILE(), []);
  const chars = Array.isArray(list) ? list.slice() : [];
  const i = chars.findIndex((c) => c && c.ready === 'nova-unico');
  const now = new Date().toISOString();
  if (i >= 0) {
    if (!chars[i].archived) { chars[i].archived = true; chars[i].archivedAt = chars[i].archivedAt || now; }
    if (!AV_RE.test(String(chars[i].avatar || '')) && fs.existsSync(dest)) chars[i].avatar = NOVA_UNICO_URL;
    writeJSON(CHARS_FILE(), chars);
    return;
  }
  if (!fs.existsSync(dest)) return;
  chars.push({
    id: newId(), name: 'Nova', ready: 'nova-unico', avatar: NOVA_UNICO_URL, avatarSource: 'upload',
    landmarks: null, appearance: {}, look: {}, wardrobe: [],
    personality: '', style: '', orders: '', requests: '', voice: '', voiceSpeed: null,
    configNote: 'Da compilare', lookHistory: [], archived: true, archivedAt: now,
    createdAt: now, updatedAt: now, createdBy: ADMIN_USER, updatedBy: ADMIN_USER, memorySeededAt: now,
  });
  writeJSON(CHARS_FILE(), chars);
}
function seedBionda() {
  const src = path.join(__dirname, 'assets', 'ready', 'nova-bionda.jpg');
  if (!fs.existsSync(src)) { console.error('Foto bionda mancante in assets/ready/nova-bionda.jpg'); return; }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
  let lmRaw = null;
  try { lmRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'ready', 'nova-bionda-landmarks.json'), 'utf8')); }
  catch (e) { console.error('Punti del viso biondo non letti:', e.message); }
  const dir = avatarDir();
  let url = '';
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    try {
      if (!fs.statSync(abs).isFile()) continue;
      if (crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') === hash) { url = `/api/avatars/${name}`; break; }
    } catch {}
  }
  if (!url) {
    fs.copyFileSync(src, path.join(dir, BIONDA_FILE));
    url = BIONDA_URL;
  }
  const lm = lmRaw ? cleanLm({ ...lmRaw, auto: true, src: url }, url) : null;
  const list = readJSON(CHARS_FILE(), []);
  const chars = Array.isArray(list) ? list.slice() : [];
  const i = chars.findIndex((c) => c && c.ready === 'nova-bionda');
  const now = new Date().toISOString();
  if (i >= 0) {
    if (!chars[i].archived) { chars[i].archived = true; chars[i].archivedAt = chars[i].archivedAt || now; }
    if (!AV_RE.test(String(chars[i].avatar || ''))) chars[i].avatar = url;
    writeJSON(CHARS_FILE(), chars);
    return;
  }
  chars.push({
    id: BIONDA_ID, name: 'Nova', ready: 'nova-bionda', avatar: url, avatarSource: 'upload',
    landmarks: lm, appearance: {}, look: {}, wardrobe: [],
    personality: '', style: '', orders: '', requests: '', voice: '', voiceSpeed: null,
    configNote: 'Da compilare', lookHistory: [], archived: true, archivedAt: now,
    createdAt: now, updatedAt: now, createdBy: ADMIN_USER, updatedBy: ADMIN_USER, memorySeededAt: now,
  });
  writeJSON(CHARS_FILE(), chars);
}
function seedScelta() {
  const src = path.join(__dirname, 'assets', 'ready', 'nova-scelta.jpg');
  if (!fs.existsSync(src)) { console.error('Foto scelta mancante in assets/ready/nova-scelta.jpg'); return ''; }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
  let lmRaw = null;
  try { lmRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'ready', 'nova-scelta-landmarks.json'), 'utf8')); }
  catch (e) { console.error('Punti del viso scelto non letti:', e.message); }
  const dir = avatarDir();
  let url = '';
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    try {
      if (!fs.statSync(abs).isFile()) continue;
      if (crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') === hash) { url = `/api/avatars/${name}`; break; }
    } catch {}
  }
  if (!url) {
    fs.copyFileSync(src, path.join(dir, SCELTA_FILE));
    url = SCELTA_URL;
  }
  const lm = lmRaw ? cleanLm({ ...lmRaw, auto: true, src: url }, url) : null;
  const list = readJSON(CHARS_FILE(), []);
  const chars = Array.isArray(list) ? list.slice() : [];
  const i = chars.findIndex((c) => c && c.ready === 'nova-scelta');
  let id = '';
  if (i >= 0) {
    const cur = chars[i];
    cur.archived = false;
    delete cur.archivedAt;
    cur.avatar = url;
    if (lm) cur.landmarks = lm;
    if (!String(cur.name || '').trim()) cur.name = 'Nova';
    id = cur.id;
    writeJSON(CHARS_FILE(), chars);
  } else {
    const now = new Date().toISOString();
    const c = {
      id: SCELTA_ID, name: 'Nova', ready: 'nova-scelta', avatar: url, avatarSource: 'upload',
      landmarks: lm, appearance: {}, look: {}, wardrobe: [],
      personality: '', style: '', orders: '', requests: '', voice: '', voiceSpeed: null,
      configNote: 'Da compilare', lookHistory: [],
      createdAt: now, updatedAt: now, createdBy: ADMIN_USER, updatedBy: ADMIN_USER, memorySeededAt: now,
    };
    id = c.id;
    writeJSON(CHARS_FILE(), [...chars, c]);
  }
  console.log('Nova scelta attiva:', id, url);
  return id;
}
function seedReadyChars() {
  archiveAvatarsOnce();
  const id = seedScelta();
  seedBionda();
  seedDarkArchived();
  if (id) preferUnico(id);
}
// v8.6.1: il nome visibile del seed (ready='greta') diventa Nova. Id, foto, voce e movimenti restano quelli già salvati.
async function renameSeededSoloToNova() {
  const reg = readJSON(path.join(DATA_DIR, 'ready-chars.json'), {}) || {};
  const list = readJSON(CHARS_FILE(), []) || [];
  const ch = list.find((c) => c.ready === SOLO_KEY) || list.find((c) => reg.greta && c.id === reg.greta.id);
  if (!ch || String(ch.name || '').trim() === 'Nova') return;
  if (!/^greta$/i.test(String(ch.name || '').trim())) return;
  await patchChar(ch.id, (x) => { x.name = 'Nova'; });
  console.log('Nome del personaggio pronto aggiornato: Greta → Nova (foto, voce e movimenti invariati)');
}

// ---------- v8.6.1: umore numerico di Nova (0-100) e appunti assistenza ----------
const MOOD_KEYS = ['allegria', 'affetto', 'fiducia', 'desiderio', 'irritazione', 'energia'];
const MOOD_BASE = { allegria: 62, affetto: 68, fiducia: 60, desiderio: 32, irritazione: 8, energia: 58 };
const MOOD_FILE = () => path.join(DATA_DIR, 'mood-history.json');
const NOTES_FILE = () => path.join(DATA_DIR, 'notes.json');
const NOTES_LEGACY = () => path.join(DATA_DIR, 'support-notes.json');
function personName(id) {
  if (id === 'nicola') return 'Nicola';
  if (id === 'luisa') return 'Luisa';
  return (USERS[id] && USERS[id].name) || String(id || '');
}
const APP_VERSION = '8.6.7';
const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
function isNovaChar(ch) {
  return !!(ch && (ch.ready === SOLO_KEY || /^(nova|greta)$/i.test(String(ch.name || '').trim())));
}
function driftMood(m, hours) {
  const k = Math.min(0.45, 1 - Math.exp(-Math.max(0, hours) / 8)); // torna verso il centro da sola, piano
  const o = {};
  for (const key of MOOD_KEYS) o[key] = clamp100((m[key] ?? MOOD_BASE[key]) + (MOOD_BASE[key] - (m[key] ?? MOOD_BASE[key])) * k);
  return o;
}
function heuristicMood(text, tag) {
  const t = String(text || '').toLowerCase();
  const d = { allegria: 0, affetto: 0, fiducia: 0, desiderio: 0, irritazione: 0, energia: 0 };
  const hit = (re, k, n) => { if (re.test(t)) d[k] += n; };
  hit(/ahah|haha|😂|😄|felice|evviva|scherz|rid(e|o|iamo)/, 'allegria', 5);
  hit(/triste|😔|mi dispiace|uffa|giù/, 'allegria', -5);
  hit(/amore|ti voglio|abbracc|tesoro|caro|❤️|affett|bacio|tener/, 'affetto', 5);
  hit(/mi fido|insieme|tranquill|al sicuro/, 'fiducia', 4);
  hit(/non mi fido|bugia|dubito/, 'fiducia', -4);
  hit(/desider|voglia di te|maliz|intimo|baciar/, 'desiderio', 5);
  hit(/basta|scocci|arrabb|offes|irrit|uff\b/, 'irritazione', 6);
  hit(/scusa|pace|ti perdono|scherzavo|va bene così/, 'irritazione', -5);
  hit(/andiamo|ball|svegl|forza/, 'energia', 4);
  hit(/stanc|sonno|dormir|esaust/, 'energia', -5);
  const map = { allegra: ['allegria', 6], tenera: ['affetto', 6], maliziosa: ['desiderio', 5], triste: ['allegria', -6], offesa: ['irritazione', 7], seria: ['energia', -2], pensierosa: ['energia', -3], sorpresa: ['energia', 3] };
  if (tag && map[tag]) d[map[tag][0]] += map[tag][1];
  for (const k of MOOD_KEYS) d[k] = Math.max(-8, Math.min(8, d[k]));
  return d;
}
function moodSummary(m) {
  const bits = [];
  if (m.irritazione >= 55) bits.push('un po\' irritata');
  else if (m.allegria >= 72) bits.push('allegra');
  else if (m.allegria <= 38) bits.push('un po\' giù');
  else bits.push('serena');
  if (m.affetto >= 70) bits.push('affettuosa');
  if (m.fiducia >= 72) bits.push('fiduciosa');
  else if (m.fiducia <= 38) bits.push('un po\' riservata');
  if (m.desiderio >= 68) bits.push('con desiderio');
  if (m.energia <= 38) bits.push('un po\' stanca');
  else if (m.energia >= 78) bits.push('piena di energia');
  const head = bits[0], rest = bits.slice(1, 3);
  if (!rest.length) return `Oggi è ${head}.`;
  if (rest.length === 1) return `Oggi è ${head} e ${rest[0]}.`;
  return `Oggi è ${head} e ${rest[0]}, ${rest[1]}.`;
}
function loadMoodHist() {
  const raw = readJSON(MOOD_FILE(), []);
  return (Array.isArray(raw) ? raw : []).filter((p) => p && p.t).slice(-500);
}
function currentMood(hist) {
  if (!hist.length) return { ...MOOD_BASE, t: new Date().toISOString() };
  const last = hist[hist.length - 1];
  const hours = Math.max(0, (Date.now() - Date.parse(last.t || 0)) / 36e5);
  return { ...driftMood(last, hours), t: last.t };
}
function recordNovaMood(text, tag) {
  const hist = loadMoodHist();
  const cur = currentMood(hist);
  const d = heuristicMood(text, tag);
  const next = { t: new Date().toISOString() };
  for (const k of MOOD_KEYS) next[k] = clamp100((cur[k] ?? MOOD_BASE[k]) + d[k]);
  hist.push(next);
  writeJSON(MOOD_FILE(), hist.slice(-500));
  return next;
}
const NOVA_REPLY = 'Prendo in considerazione e vi aggiorno appena è pronto.';
function loadNotes() {
  let raw = readJSON(NOTES_FILE(), null);
  if (!Array.isArray(raw)) {
    const old = readJSON(NOTES_LEGACY(), []);
    raw = Array.isArray(old) ? old : [];
    if (raw.length) writeJSON(NOTES_FILE(), raw); // copia, il file vecchio resta
  }
  let dirty = false;
  const list = raw.map((n) => {
    if (!n) return n;
    const id = n.authorId || (n.author === 'Nicola' || n.author === 'Luisa' ? (n.author === 'Luisa' ? 'luisa' : 'nicola') : n.author);
    const note = { ...n, authorId: id, author: personName(id) || n.author, time: n.time || n.createdAt };
    if (!note.reply || note.reply.text !== NOVA_REPLY) {
      dirty = true;
      note.reply = { author: 'Nova', text: NOVA_REPLY, time: note.time };
    }
    return note;
  });
  if (dirty) writeJSON(NOTES_FILE(), list.filter(Boolean));
  return list;
}
function publicNote(n) {
  return {
    id: n.id, author: n.author, authorId: n.authorId, text: n.text, time: n.time,
    delivered: !!n.delivered, status: n.delivered ? 'inviato' : 'in attesa',
    reply: { author: 'Nova', text: NOVA_REPLY, time: (n.reply && n.reply.time) || n.time },
  };
}
async function deliverSupportNote(note) {
  const url = String(process.env.NOTES_WEBHOOK_URL || '').trim();
  const authz = process.env.NOTES_WEBHOOK_AUTH;
  if (!url || authz == null || String(authz) === '') return false;
  const header = String(process.env.NOTES_WEBHOOK_HEADER || 'Authorization');
  const payload = { author: note.author, text: note.text, time: note.time || note.createdAt, app: 'Nova', version: APP_VERSION };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [header]: String(authz) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) console.error('Appunto assistenza non inoltrato: HTTP', r.status);
    return r.ok;
  } catch (e) {
    console.error('Appunto assistenza non inoltrato:', e.message);
    return false;
  }
}
async function flushSupportNotes() {
  const list = loadNotes();
  let changed = false;
  for (const n of list) {
    if (!n || n.delivered) continue;
    if (await deliverSupportNote(n)) { n.delivered = true; changed = true; }
  }
  if (changed) writeJSON(NOTES_FILE(), list);
  return list;
}
let notesChain = Promise.resolve();
function withNotes(fn) {
  const run = notesChain.then(fn, fn);
  notesChain = run.then(() => {}, () => {});
  return run;
}
setInterval(() => { withNotes(() => flushSupportNotes()).catch((e) => console.error('Appunto assistenza:', e.message)); }, 5 * 60e3).unref();

backupShared('avvio', { force: true }); // copia di sicurezza a ogni avvio, prima di qualsiasi modifica
try { migrateToShared(); } catch (e) { console.error('Migrazione archivio condiviso NON riuscita (i vecchi file restano intatti):', e.message); }
// recupero una tantum dei personaggi persi, poi memoria base per i personaggi che non l'hanno ancora
(async () => {
  await startupRecovery();
  try { seedReadyChars(); } catch (e) { console.error('Personaggi pronti non creati:', e.message); }
  if (getServerAiKey()) setImmediate(() => prepSoloMotions().catch((e) => console.error('Prep avvio:', e.message)));
  for (const c of readJSON(CHARS_FILE(), []) || []) {
    if (!c || c.archived || c.ready === 'nova-unico' || c.ready === 'nova-bionda' || c.ready === 'nova-scelta' || c.memorySeededAt) continue;
    await seedBaseMemory(c).catch((e) => console.error('Memoria base non creata:', e.message));
  }
  await flushSupportNotes().catch((e) => console.error('Appunti non inoltrati all\'avvio:', e.message));
})();
setInterval(() => backupShared('orario'), 60 * 60e3).unref(); // ogni ora, solo se qualcosa è cambiato

try { syncLuisaPinOnce(); } catch (e) { console.error('Migrazione PIN non riuscita:', e.message); }
try { seedReadyChars(); } catch (e) { console.error('Avatar unico non pronta:', e.message); }
app.listen(PORT, () => {
  console.log(`App privata avviata su http://localhost:${PORT}`);
  const pins = getPins();
  for (const [u, a] of Object.entries(USERS)) if (!pins[u]) console.log(`Profilo ${a.name}: PIN non ancora impostato (si crea al primo accesso dall'app).`);
});
