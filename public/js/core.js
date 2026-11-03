/* core.js — stato condiviso, chiamate API, utilità. Tutti i moduli usano l'oggetto globale App. */
window.App = {
  SETTINGS_NAME: 'Account', // v8.3.1: nome della scheda impostazioni (in v8.4 diventa «Impostazioni»)
  me: null,          // { user, name, activated, consent, ... }
  chars: [],         // personaggi dell'utente
  opts: {},          // opzioni aspetto/look dal server
  settings: { autoSave: false, allowExport: false },
  current: null,     // personaggio aperto in chat
  previews: {},      // anteprime avatar NON salvate (solo in memoria): charId -> {pending, dataUrl, ...}
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// localStorage separato per utente (es. "ap:nicola:key")
App.ls = {
  get(k, def = null) { try { const v = localStorage.getItem(`ap:${App.me.user}:${k}`); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { localStorage.setItem(`ap:${App.me.user}:${k}`, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(`ap:${App.me.user}:${k}`); },
};
App.key = () => (App.me ? App.ls.get('key', '') : '');

// fetch verso il nostro server. opts.ai = true aggiunge la chiave xAI del dispositivo (mai salvata dal server).
App.api = async function (path, { method = 'GET', body, ai = false, raw = false, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'app-privata', ...headers };
  if (body !== undefined && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
  if (ai) { const k = App.key(); if (!k) { App.toast('🔑 Inserisci la chiave xAI in Account'); throw new Error('NO_KEY'); } h['X-AI-Key'] = k; }
  const r = await fetch(path, { method, headers: h, credentials: 'same-origin', body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !['/api/login', '/api/pin/setup'].includes(path)) { App.showLogin(); throw new Error('Accesso richiesto'); }
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && /non attivato/.test(j.error || '')) { App.showActivation(); }
  if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
  return j;
};

App.toast = function (msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(App._tt); App._tt = setTimeout(() => { t.hidden = true; }, ms);
};
App.showView = function (name) { $$('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; }); };

// Scarica/condividi: SOLO su azione manuale e solo se "Consenti esportazione/condivisione" è attivo.
App.canExport = () => !!App.settings.allowExport;
App.download = async function (url, name) {
  if (!App.canExport()) return App.toast('Esportazione disattivata (Account > Privacy)');
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'download=1', { credentials: 'same-origin' });
  if (!r.ok) return App.toast('Download non consentito');
  const b = await r.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = name || 'immagine'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
App.share = async function (url, name, text) {
  if (!App.canExport()) return App.toast('Condivisione disattivata (Account > Privacy)');
  try {
    const b = url.startsWith('data:') ? await (await fetch(url)).blob() : await (await fetch(url + (url.includes('?') ? '&' : '?') + 'download=1', { credentials: 'same-origin' })).blob();
    const file = new File([b], name || 'immagine.png', { type: b.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: text || '' });
    else App.toast('Condivisione non supportata da questo browser: usa Scarica');
  } catch (e) { if (e.name !== 'AbortError') App.toast('Condivisione non riuscita'); }
};
// Pulsanti Scarica/Condividi (vuoto se l'esportazione è disattivata)
App.exportButtons = (url, name) => (App.canExport() ? `<button data-dl="${esc(url)}" data-name="${esc(name)}">⬇️</button><button data-share="${esc(url)}" data-name="${esc(name)}">📤</button>` : '');
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-dl]'); if (d) { e.preventDefault(); App.download(d.dataset.dl, d.dataset.name); }
  const s = e.target.closest('[data-share]'); if (s) { e.preventDefault(); App.share(s.dataset.share, s.dataset.name); }
});

// Ridimensiona un'immagine scelta sul telefono -> dataURL JPEG
App.fileToDataUrl = (file, max = 768) => new Promise((resolve, reject) => {
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/jpeg', 0.88));
  };
  img.onerror = reject; img.src = url;
});
App.avatarHtml = (ch, cls = 'avatar') => {
  const a = (App.previews[ch.id] && App.previews[ch.id].dataUrl) || ch.avatar;
  return `<div class="${cls}">${a && (a.startsWith('/api/') || a.startsWith('data:')) ? `<img src="${esc(a)}" alt="">` : esc(a || '🙂')}</div>`;
};
App.charById = (id) => App.chars.find((c) => c.id === id);
App.loadChars = async () => { App.chars = await App.api('/api/characters'); };
