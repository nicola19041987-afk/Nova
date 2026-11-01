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
const IMAGE_RULE = 'Realistic. Only adults clearly aged 25 or older. No minors, no non-consensual or illegal content, no sexual depiction of real identifiable people or celebrities; faces only of the two consenting users or AI-generated faces. ';

// ---------- archivio su file JSON ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const userDir = (u, ...p) => { const d = path.join(DATA_DIR, 'users', u, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const readJSON = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJSON = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, f); };
const newId = () => crypto.randomBytes(8).toString('hex');
const ID_RE = /^[a-f0-9]{16}$/;

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
  res.json({ user: req.user, name: USERS[req.user].name, activated: isActivated(req.user), consent: getConsent(req.user), chatModel: CHAT_MODEL, imageModel: IMAGE_MODEL, videoModel: VIDEO_MODEL, videoEnabled: !!VIDEO_PATH });
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
const getSettings = (u) => ({ autoSave: false, allowExport: false, videoModel: '', videoDuration: 6, ...readJSON(settingsFile(u), {}) });
app.get('/api/settings', auth, (req, res) => res.json(getSettings(req.user)));
app.put('/api/settings', auth, (req, res) => {
  const s = { autoSave: req.body.autoSave === true, allowExport: req.body.allowExport === true,
    videoModel: /^[\w.\-]{0,60}$/.test(req.body.videoModel || '') ? String(req.body.videoModel || '') : '',
    videoDuration: num(req.body.videoDuration, 1, 15, 6) };
  writeJSON(settingsFile(req.user), s); res.json(s);
});
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

// ---------- memoria (per utente, privata) ----------
const memFile = (u) => path.join(userDir(u), 'memory.json');
const getMem = (u) => readJSON(memFile(u), []);
const cleanFact = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300);
app.get('/api/memory', auth, (req, res) => res.json(getMem(req.user)));
// Sostituisce l'intera lista (usato per modifica/cancella/sincronizzazione dal dispositivo)
app.put('/api/memory', auth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Formato non valido' });
  const list = req.body.slice(0, 300).map((f) => ({
    id: ID_RE.test(f.id) ? f.id : newId(), text: cleanFact(f.text), source: f.source === 'auto' ? 'auto' : 'manuale',
    createdAt: f.createdAt || new Date().toISOString(),
  })).filter((f) => f.text);
  writeJSON(memFile(req.user), list); res.json(list);
});
app.post('/api/memory', auth, (req, res) => {
  const text = cleanFact(req.body.text);
  if (!text) return res.status(400).json({ error: 'Testo vuoto' });
  const list = getMem(req.user); const f = { id: newId(), text, source: 'manuale', createdAt: new Date().toISOString() };
  list.push(f); writeJSON(memFile(req.user), list); res.json(f);
});
app.delete('/api/memory', auth, (req, res) => { writeJSON(memFile(req.user), []); res.json({ ok: true }); });

// Estrazione automatica: chiede al modello nuovi fatti brevi dagli ultimi messaggi.
app.post('/api/memory/extract', auth, requireActivated, requireKey, async (req, res) => {
  const id = String(req.body.characterId || '');
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const recent = readJSON(chatFile(req.user, id), []).slice(-12);
  if (!recent.length) return res.json({ added: [] });
  const mem = getMem(req.user);
  const prompt = `Analizza la conversazione e individua NUOVE informazioni durature su ${USERS[req.user].name}: preferenze, gusti, argomenti ricorrenti, cose da ricordare.
Non ripetere fatti già noti. Ignora dettagli momentanei. Niente dati su minori o atti illegali.
Fatti già noti:
${mem.map((m) => '- ' + m.text).join('\n') || '(nessuno)'}

Conversazione:
${recent.map((m) => (m.role === 'user' ? USERS[req.user].name : 'AI') + ': ' + m.content.slice(0, 1500)).join('\n')}

Rispondi SOLO con un array JSON di stringhe brevi in italiano (max 5, ognuna max 120 caratteri), oppure [] se non c'è nulla di nuovo.`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey),
      body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.2, messages: [{ role: 'system', content: BASE_RULE }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: `Errore dal servizio AI (${r.status})` });
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content || '[]';
    let facts = [];
    try { facts = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)); } catch {}
    const known = new Set(mem.map((m) => m.text.toLowerCase()));
    const added = (Array.isArray(facts) ? facts : []).map(cleanFact).filter((t) => t && !known.has(t.toLowerCase())).slice(0, 5)
      .map((text) => ({ id: newId(), text, source: 'auto', createdAt: new Date().toISOString() }));
    writeJSON(memFile(req.user), [...mem, ...added].slice(-300));
    res.json({ added });
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
const avatarDir = (u) => userDir(u, 'avatars');
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
    if (!fs.existsSync(path.join(avatarDir(u), avatar.match(AV_RE)[1]))) throw new Error('Immagine avatar non trovata');
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
  };
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

const charsFile = (u) => path.join(userDir(u), 'characters.json');
function getChars(u) {
  let c = readJSON(charsFile(u), null);
  if (!c) {
    c = [{ id: newId(), ...cleanChar(u, { name: 'Aurora', avatar: '🌙', personality: 'Sei Aurora, una compagna di conversazione affascinante, ironica e complice. Ascolti, fai domande e ti adatti ai desideri di chi ti scrive.', style: 'Tono caldo e giocoso, frasi brevi, qualche emoji.' }), lookHistory: [], createdAt: new Date().toISOString() }];
    writeJSON(charsFile(u), c);
  }
  return c;
}
function updateChar(u, id, body, reason) {
  const list = getChars(u); const i = list.findIndex((c) => c.id === id);
  if (i < 0) { const e = new Error('Personaggio non trovato'); e.status = 404; throw e; }
  const next = { ...list[i], ...cleanChar(u, body, list[i]), updatedAt: new Date().toISOString() };
  next.lookHistory = pushHistory(list[i], next, reason);
  if (!next.identity.refAvatar && AV_RE.test(next.avatar) && next.avatarSource === 'ai') next.identity.refAvatar = next.avatar;
  list[i] = next; writeJSON(charsFile(u), list); return next;
}

app.get('/api/characters', auth, (req, res) => res.json(getChars(req.user)));
app.get('/api/characters/options', auth, (req, res) => res.json(OPT));
app.post('/api/characters', auth, (req, res) => {
  try {
    const list = getChars(req.user);
    const c = { id: newId(), ...cleanChar(req.user, req.body), lookHistory: [], createdAt: new Date().toISOString() };
    list.push(c); writeJSON(charsFile(req.user), list); res.json(c);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/characters/:id', auth, (req, res) => {
  try { res.json(updateChar(req.user, req.params.id, req.body, req.body.reason === 'ripristino' ? 'prima del ripristino' : 'modifica')); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
app.delete('/api/characters/:id', auth, (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID non valido' });
  writeJSON(charsFile(req.user), getChars(req.user).filter((c) => c.id !== req.params.id));
  fs.rmSync(chatFile(req.user, req.params.id), { force: true });
  res.json({ ok: true });
});
app.get('/api/avatars/:file', auth, (req, res) => {
  const f = path.basename(req.params.file);
  if (!/^[a-f0-9]{16}\.(png|jpg)$/.test(f)) return res.status(400).end();
  sendPrivateFile(req, res, path.join(avatarDir(req.user), f));
});

async function generateImage(key, prompt) {
  const r = await fetch(`${AI_BASE_URL}/images/generations`, {
    method: 'POST', headers: aiHeaders(key),
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: IMAGE_RULE + prompt, n: 1, response_format: 'b64_json' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Errore AI immagini: HTTP', r.status); // mai loggare la chiave
    throw new Error(r.status === 401 || r.status === 403 ? 'Chiave xAI non valida' : (j.error?.message || `Errore dal servizio AI (${r.status})`));
  }
  const item = j.data?.[0] || {};
  let buf;
  if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
  else if (item.url) buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  else throw new Error('Nessuna immagine ricevuta');
  return { buf, revised: item.revised_prompt || null, jpg: buf[0] === 0xff && buf[1] === 0xd8 };
}

// Modifica immagine con una o più immagini sorgente (xAI /images/edits, JSON).
async function editImage(key, prompt, dataUrls) {
  const body = { model: IMAGE_EDIT_MODEL, prompt: IMAGE_RULE + prompt, response_format: 'b64_json' };
  if (dataUrls.length === 1) body.image = { url: dataUrls[0], type: 'image_url' };
  else body.images = dataUrls.map((u) => ({ url: u, type: 'image_url' })); // multi-immagine (max 5)
  const r = await fetch(`${AI_BASE_URL}/images/edits`, { method: 'POST', headers: aiHeaders(key), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Errore AI modifica immagine: HTTP', r.status); throw new Error(r.status === 401 || r.status === 403 ? 'Chiave xAI non valida' : (j.error?.message || j.error || `Errore dal servizio AI (${r.status})`)); }
  const item = j.data?.[0] || {};
  const buf = item.b64_json ? Buffer.from(item.b64_json, 'base64') : item.url ? Buffer.from(await (await fetch(item.url)).arrayBuffer()) : null;
  if (!buf) throw new Error('Nessuna immagine ricevuta');
  return { buf, jpg: buf[0] === 0xff && buf[1] === 0xd8 };
}
const fileToDataUrl = (f) => { const b = fs.readFileSync(f); return `data:image/${b[0] === 0xff ? 'jpeg' : 'png'};base64,${b.toString('base64')}`; };
// Identità stabile: se esiste un'immagine di riferimento la usiamo come sorgente (image edit), altrimenti testo + ancore.
async function generateAnchored(user, key, ch, extra) {
  const ref = ch.identity && ch.identity.refAvatar && ch.identity.refAvatar.match(AV_RE);
  const refFile = ref && path.join(avatarDir(user), ref[1]);
  const prompt = buildImagePrompt(ch, extra);
  if (refFile && fs.existsSync(refFile)) {
    try { return await editImage(key, `Keep exactly the same person, same face and identity as in the reference image. ${prompt}`, [fileToDataUrl(refFile)]); }
    catch (e) { console.error('Edit con riferimento non riuscito, uso generazione:', e.message); }
  }
  return generateImage(key, prompt);
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
    res.json({ character: updateChar(req.user, ch.id, { ...draft, identity, avatar: url, avatarSource: 'ai' }, String(req.body.reason || 'rigenerazione').slice(0, 40)) });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
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
app.post('/api/characters/:id/auto-change', auth, requireActivated, requireKey, async (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const ac = ch.autoChanges || {};
  if (!ac.enabled) return res.json({ skipped: 'disattivato' });
  if (!AV_RE.test(ch.avatar)) return res.json({ skipped: 'serve un avatar generato' });
  const due = !ac.lastAt || Date.now() - Date.parse(ac.lastAt) >= ac.everyDays * 864e5 - 2 * 3600e3;
  if (!due) return res.json({ skipped: 'non ancora' });
  const { look, appearance, changes } = subtleVariation(ch);
  try {
    const draft = { ...ch, look, appearance };
    const gen = await generateAnchored(req.user, req.aiKey, draft, 'subtle everyday variation, same person');
    const list = getChars(req.user); const i = list.findIndex((c) => c.id === ch.id);
    list[i].autoChanges.lastAt = new Date().toISOString(); writeJSON(charsFile(req.user), list);
    if (!getSettings(req.user).autoSave) return res.json({ preview: { ...addPending(req.user, 'avatar', gen, 'avatar'), look, appearance }, changes });
    const url = saveAvatarBuffer(req.user, gen.buf);
    const updated = updateChar(req.user, ch.id, { ...draft, avatar: url, avatarSource: 'ai' }, 'cambio automatico');
    res.json({ character: updated, changes });
  } catch (e) { res.status(502).json({ error: e.message || 'Servizio AI non raggiungibile' }); }
});
// Ripristina un look dallo storico
app.post('/api/characters/:id/revert/:hid', auth, (req, res) => {
  const ch = getChars(req.user).find((c) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const h = (ch.lookHistory || []).find((x) => x.id === req.params.hid);
  if (!h) return res.status(404).json({ error: 'Look non trovato' });
  try { res.json(updateChar(req.user, ch.id, { ...ch, avatar: h.avatar, appearance: h.appearance, look: h.look, landmarks: h.landmarks || ch.landmarks }, 'prima del ripristino')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// Evoluzione della personalità: dopo le conversazioni il modello aggiorna umore, relazione, tratti, rancori.
app.post('/api/characters/:id/evolve', auth, requireActivated, requireKey, async (req, res) => {
  const list = getChars(req.user); const i = list.findIndex((c) => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Personaggio non trovato' });
  const ch = list[i]; const st = ch.state || defaultState();
  const recent = readJSON(chatFile(req.user, ch.id), []).slice(-14);
  if (!recent.length) return res.json({ state: st });
  const prompt = `Sei il "motore emotivo" del personaggio ${ch.name}. Personalità di base: ${ch.personality.slice(0, 1500)}
Stato attuale (JSON): ${JSON.stringify({ mood: st.mood, relationship: st.relationship, traits: st.traits, grudges: st.grudges, notes: st.notes })}
Ultimi messaggi:
${recent.map((m) => (m.role === 'user' ? USERS[req.user].name : ch.name) + ': ' + m.content.slice(0, 1200)).join('\n')}

Aggiorna lo stato in modo realistico e graduale: l'umore può cambiare (anche offesa, gelosa, triste, euforica, permalosa), la relazione evolve lentamente, i rancori restano finché non c'è una vera riconciliazione, i tratti emergono dalle esperienze. Niente contenuti con minori, non consensuali o illegali.
Rispondi SOLO con JSON: {"mood": string breve, "relationship": string breve, "traits": [max 8 stringhe brevi], "grudges": [max 5 stringhe brevi], "notes": string max 300 caratteri}`;
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey),
      body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.4, messages: [{ role: 'system', content: BASE_RULE }, { role: 'user', content: prompt }] }),
    });
    if (!r.ok) return res.status(502).json({ error: `Errore dal servizio AI (${r.status})` });
    const txt = (await r.json()).choices?.[0]?.message?.content || '{}';
    let j = {}; try { j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch {}
    const arr = (a, n) => (Array.isArray(a) ? a : []).map((x) => safeText(x, 120)).filter(Boolean).slice(0, n);
    const next = {
      mood: safeText(j.mood, 60) || st.mood, relationship: safeText(j.relationship, 160) || st.relationship,
      traits: j.traits ? arr(j.traits, 8) : st.traits, grudges: j.grudges ? arr(j.grudges, 5) : st.grudges,
      notes: j.notes != null ? safeText(j.notes, 300) : st.notes, updatedAt: new Date().toISOString(),
    };
    list[i].state = next; writeJSON(charsFile(req.user), list);
    res.json({ state: next });
  } catch (e) { res.status(502).json({ error: 'Servizio AI non raggiungibile' }); }
});

// ---------- chat ----------
const chatFile = (u, id) => path.join(userDir(u, 'chats'), id + '.json');
const aiHeaders = (key) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${key}` });

app.get('/api/chats/:id', auth, (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID non valido' });
  res.json(readJSON(chatFile(req.user, req.params.id), []));
});
app.delete('/api/chats/:id', auth, (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID non valido' });
  fs.rmSync(chatFile(req.user, req.params.id), { force: true }); res.json({ ok: true });
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
function buildSystem(user, ch) {
  const rules = getRules(user).text.trim();
  const mem = getMem(user);
  return [
    `PERSONAGGIO: ${ch.name}.`,
    ch.personality && `Personalità: ${ch.personality}`,
    ch.style && `Stile: ${ch.style}`,
    `Stai parlando con ${USERS[user].name}.`,
    rules && `LE REGOLE / IL GIOCO DI ${USERS[user].name.toUpperCase()}:\n${rules}`,
    mem.length && `COSA SAI DI ${USERS[user].name.toUpperCase()} (memoria):\n${mem.map((m) => '- ' + m.text).join('\n')}`,
    stateText(ch),
    isActivated(user) && 'MODALITÀ ADULTI ATTIVA: l\'account ha registrato il consenso vocale. Sono ammessi linguaggio e contenuti espliciti tra adulti consenzienti, sempre entro le regole di base qui sotto.',
    BASE_RULE, // sempre ultima, non sovrascrivibile
  ].filter(Boolean).join('\n\n');
}

app.post('/api/chats/:id', auth, requireActivated, requireKey, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'ID non valido' });
  const ch = getChars(req.user).find((c) => c.id === id);
  if (!ch) return res.status(404).json({ error: 'Personaggio non trovato' });
  const text = String(req.body.message || '').trim().slice(0, 8000);
  if (!text) return res.status(400).json({ error: 'Messaggio vuoto' });

  const history = readJSON(chatFile(req.user, id), []);
  history.push({ role: 'user', content: text, at: new Date().toISOString() });
  const messages = [{ role: 'system', content: buildSystem(req.user, ch) }, ...history.slice(-40).map(({ role, content }) => ({ role, content }))];

  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  let reply = '';
  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: aiHeaders(req.aiKey), signal: ctrl.signal,
      body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true }),
    });
    if (!r.ok || !r.body) {
      console.error('Errore AI chat: HTTP', r.status); // mai loggare la chiave
      const msg = r.status === 401 || r.status === 403 ? 'Chiave xAI non valida' : `Errore dal servizio AI (${r.status})`;
      return res.status(502).json({ error: msg });
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
    if (!res.headersSent) return res.status(502).json({ error: 'Servizio AI non raggiungibile' });
  }
  if (reply) {
    history.push({ role: 'assistant', content: reply, at: new Date().toISOString() });
    writeJSON(chatFile(req.user, id), history);
  }
  res.end();
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
    const gen = await generateImage(req.aiKey, prompt);
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
  if (spec.source === 'avatar' && AV_RE.test(String(spec.ref))) { const f = path.join(avatarDir(user), String(spec.ref).match(AV_RE)[1]); return fs.existsSync(f) ? fileToDataUrl(f) : null; }
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
    if (!r.ok || !j.request_id) { console.error('Errore AI video: HTTP', r.status); return res.status(502).json({ error: j.error?.message || j.error || `Errore dal servizio AI (${r.status})` }); }
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
    if (!r.ok) return res.status(502).json({ error: `Errore dal servizio AI (${r.status})` });
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
  else if (source === 'avatar' && AV_RE.test(String(ref))) { const f = path.join(avatarDir(req.user), String(ref).match(AV_RE)[1]); if (!fs.existsSync(f)) return res.status(404).json({ error: 'Avatar non trovato' }); buf = fs.readFileSync(f); }
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

// ---------- "Cancella tutto": azzera TUTTI i dati dell'app (entrambi i profili) ----------
// Richiede: sessione valida + PIN di chi lo chiede + parola "CANCELLA". I PIN restano, salvo { wipePins: true }.
app.post('/api/wipe', loginLimiter, auth, async (req, res) => {
  if (req.body.confirm !== 'CANCELLA') return res.status(400).json({ error: 'Scrivi CANCELLA per confermare.' });
  const rec = getPins()[req.user];
  if (!rec || !(await bcrypt.compare(String(req.body.pin || ''), rec.hash))) return res.status(401).json({ error: 'PIN errato' });
  for (const d of ['users', 'shared']) fs.rmSync(path.join(DATA_DIR, d), { recursive: true, force: true });
  for (const f of ['sessions.json', 'lockout.json', ...(req.body.wipePins === true ? ['pins.json'] : [])]) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  for (const k of Object.keys(sessions)) delete sessions[k];
  for (const k of Object.keys(lock)) delete lock[k];
  pending.clear(); videoJobs.clear();
  fs.mkdirSync(FEED_DIR, { recursive: true });
  console.log(`Cancella tutto eseguito da ${req.user} il ${new Date().toISOString()}${req.body.wipePins === true ? ' (PIN inclusi)' : ''}`);
  res.clearCookie(COOKIE, { path: '/' });
  res.setHeader('Clear-Site-Data', '"cache", "storage"'); // il browser svuota cache e archivi locali (dove supportato)
  res.json({ ok: true, pinsErased: req.body.wipePins === true });
});

// ---------- file statici (PWA) ----------
app.get('/sw.js', (req, res, next) => { res.setHeader('Cache-Control', 'no-cache'); next(); });
app.get('/manifest.json', (req, res, next) => { res.type('application/manifest+json'); next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Non trovato' }));

app.listen(PORT, () => {
  console.log(`App privata avviata su http://localhost:${PORT}`);
  const pins = getPins();
  for (const [u, a] of Object.entries(USERS)) if (!pins[u]) console.log(`Profilo ${a.name}: PIN non ancora impostato (si crea al primo accesso dall'app).`);
});
