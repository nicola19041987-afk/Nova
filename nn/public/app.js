/* Ventuno — chat stile WhatsApp: testo, foto/video, vocali (tieni premuto), tempo reale (SSE + polling di riserva). */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const LS = window.localStorage;
  // --- chiave dal link segreto: salvata sul dispositivo e tolta dalla barra degli indirizzi
  const qs = new URLSearchParams(location.search);
  if (qs.get('k')) { LS.setItem('nn.k', qs.get('k')); history.replaceState(null, '', '/'); }
  else if (qs.get('r')) history.replaceState(null, '', '/');
  const key = () => LS.getItem('nn.k') || '';
  const sess = () => LS.getItem('nn.s') || '';
  let me = null, last = 0, es = null, pollT = 0;
  const seen = new Set();

  async function api(path, opt = {}) {
    const headers = Object.assign({ 'X-NN-Key': key(), 'X-NN-Sess': sess() }, opt.headers || {});
    let body = opt.body;
    if (body && !(body instanceof Blob) && typeof body === 'object') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await fetch(path, { method: opt.method || 'GET', headers, body, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('Errore ' + r.status)); e.status = r.status; e.data = j; throw e; }
    return j;
  }
  function status(t) { const s = $('#status'); s.hidden = !t; s.textContent = t || ''; if (t) setTimeout(() => { if (s.textContent === t) s.hidden = true; }, 5000); }

  // --- layout stabile con la tastiera (visualViewport): l'input resta sopra la tastiera, niente salti
  function fit() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    document.documentElement.style.setProperty('--vv-h', h + 'px');
    document.documentElement.style.setProperty('--vv-top', top + 'px');
    window.scrollTo(0, 0);
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', () => { const b = nearBottom(); fit(); if (b) bottom(); }); visualViewport.addEventListener('scroll', fit); }
  window.addEventListener('resize', fit); fit();

  const box = $('#messages');
  const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const bottom = () => { box.scrollTop = box.scrollHeight; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ruoli interni -> nomi: 'nico' = Luisa (con password), 'nicola' = Nico Franchino (proprietario)
  let NAMES = { nico: 'Luisa', nicola: 'Nico', nn: 'Idea' };
  function setNames(map) { if (map && typeof map === 'object') NAMES = Object.assign({ nico: 'Luisa', nicola: 'Nico', nn: 'Idea' }, map); }
  const mediaUrl = (id) => '/api/media/' + encodeURIComponent(id) + '?k=' + encodeURIComponent(key()) + '&s=' + encodeURIComponent(sess());
  function fileLabel(m) {
    const ext = String((m && m.name) || '').split('.').pop().toUpperCase() || 'FILE';
    const n = (m && m.size) || 0;
    const size = n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    return ext + ' · ' + size;
  }
  let lastDay = '';
  function add(m) {
    if (seen.has(m.id)) return; seen.add(m.id); last = Math.max(last, m.id);
    const stick = nearBottom();
    const d = new Date(m.at);
    const day = d.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const today = new Date().toDateString() === day;
      const el = document.createElement('div'); el.className = 'day';
      el.innerHTML = `<span>${today ? 'Oggi' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</span>`;
      box.appendChild(el);
    }
    const mine = me && m.author === me.role;
    const el = document.createElement('div');
    const isCall = !!m.call;
    const missed = isCall && m.call.kind === 'missed';
    el.className = 'msg ' + (isCall ? 'call-log' : (mine ? 'mine' : 'other'));
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const callLabel = missed ? 'Chiamata persa da Idea' : (isCall ? ('Chiamata con Idea · ' + (m.call.dur || '')) : '');
    el.innerHTML = (isCall ? '' : (mine ? '' : `<span class="au ${esc(m.author)}">${esc(NAMES[m.author] || m.author)}</span>`))
      + (m.media && m.media.kind === 'image' ? `<img class="ph" src="${esc(mediaUrl(m.media.id))}" alt="Foto" loading="lazy">` : '')
      + (m.media && m.media.kind === 'video' ? `<video class="vd" src="${esc(mediaUrl(m.media.id))}" controls playsinline preload="metadata"></video>` : '')
      + (m.media && m.media.kind === 'file' ? `<a class="doc" href="${esc(mediaUrl(m.media.id))}" download="${esc(m.media.name || 'documento')}" target="_blank" rel="noopener"><span class="doc-ico">📄</span><span><b>${esc(m.media.name || 'Documento')}</b><small>${esc(fileLabel(m.media))}</small></span></a>` : '')
      + (m.voice ? `<span class="vtag">🎤 Vocale · ${m.voice.sec || 1}s</span>` + (m.voice.audio ? `<audio class="au-pl" src="${esc(mediaUrl(m.voice.audio))}" controls playsinline preload="metadata"></audio>` : '') : '')
      + (isCall ? `<span class="ctag${missed ? ' missed' : ''}">📞 ${esc(callLabel)}</span>` : '')
      + (m.content && !m.voice ? `<span class="tx">${esc(m.content)}</span>` : '')
      + (m.voice && m.voice.text ? `<span class="vtr">${esc(m.voice.text)}</span>` : '')
      + (m.idea ? `<span class="itag">📝 ${esc(m.idea)}</span>` : '')
      + `<span class="meta">${time}</span>`;
    box.appendChild(el);
    el.querySelectorAll('img.ph, video.vd').forEach((x) => x.addEventListener(x.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => { if (stick || mine) bottom(); }, { once: true }));
    const ph = el.querySelector('img.ph'); if (ph) ph.addEventListener('click', () => { $('#viewer img').src = ph.src; $('#viewer').hidden = false; });
    if (stick || mine) bottom();
  }
  function ideas(list) {
    $('#ideas-count').textContent = list && list.length ? list.length : '';
    $('#ideas-list').innerHTML = (list || []).slice().reverse().map((i) => `<li><b>📝 ${esc(i.titolo)}</b>${esc(i.descrizione)}<br><small>${esc(i.data)} · ${esc(i.stato)}${i.autore ? " · di " + esc(i.autore) : ""}</small></li>`).join('') || '<li>Ancora nessuna nota. Scrivi «segna» o «segnala» per appuntarne una.</li>';
  }
  async function poll() {
    try { const j = await api('/api/messages?since=' + last); if (j.names) setNames(j.names); j.messages.forEach(add); ideas(j.ideas); } catch (e) { if (e.status === 401) return start(); }
  }
  function live() {
    if (es) es.close();
    es = new EventSource('/api/stream?k=' + encodeURIComponent(key()) + '&s=' + encodeURIComponent(sess()));
    es.addEventListener('message', (ev) => { add(JSON.parse(ev.data)); typing(false); });
    es.addEventListener('typing', (ev) => typing(JSON.parse(ev.data).on));
    es.addEventListener('ideas', (ev) => ideas(JSON.parse(ev.data)));
    es.addEventListener('incoming', (ev) => { try { showIncoming(JSON.parse(ev.data)); } catch {} });
    es.addEventListener('incoming-end', (ev) => { try { const d = JSON.parse(ev.data); if (d && d.id && $('#incoming').dataset.id === d.id) hideIncoming(); } catch {} });
    es.addEventListener('hello', () => poll());
    // polling di riserva ogni 2 s: se SSE cade, i messaggi arrivano comunque
    clearInterval(pollT); pollT = setInterval(poll, 2000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) { poll(); if (!es || es.readyState === 2) live(); } });

  function typing(on) { $('#typing').hidden = !on; const s = $('#sub'); s.textContent = on ? 'Idea sta scrivendo…' : 'online'; s.classList.toggle('typing', !!on); }

  // --- "+": menu Fotocamera / Video / Galleria / Allega (documenti)
  const fileIn = $('#file');
  const attachMenu = $('#attach-menu');
  function closeAttach() { attachMenu.hidden = true; $('#attach').setAttribute('aria-expanded', 'false'); }
  function openAttach() { attachMenu.hidden = false; $('#attach').setAttribute('aria-expanded', 'true'); }
  $('#attach').addEventListener('pointerdown', (e) => { if (document.activeElement === input) e.preventDefault(); });
  $('#attach').addEventListener('click', (e) => { e.stopPropagation(); if (attachMenu.hidden) openAttach(); else closeAttach(); });
  document.addEventListener('click', (e) => { if (!attachMenu.hidden && !attachMenu.contains(e.target) && e.target !== $('#attach') && !$('#attach').contains(e.target)) closeAttach(); });
  attachMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    closeAttach();
    const map = { camera: '#file-camera', video: '#file-video', gallery: '#file', file: '#file-doc' };
    const el = $(map[b.dataset.kind] || '#file'); if (el) el.click();
  });
  async function sendMedia(f, asDoc) {
    if (f.size > 50 * 1024 * 1024) return status('File troppo grande (max 50 MB).');
    const isVideo = /^video\//.test(f.type);
    const caption = input.value.trim();
    status(asDoc ? 'Invio il documento…' : isVideo ? 'Invio il video…' : 'Invio la foto…');
    try {
      if (asDoc) {
        const ext = String(f.name || '').split('.').pop().toLowerCase();
        const guess = { pdf:'application/pdf', txt:'text/plain', md:'text/markdown', csv:'text/csv', json:'application/json', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls:'application/vnd.ms-excel', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt:'application/vnd.oasis.opendocument.text', ods:'application/vnd.oasis.opendocument.spreadsheet', rtf:'application/rtf' }[ext];
        const type = f.type || guess || 'application/octet-stream';
        const j = await api('/api/file', { method: 'POST', body: f, headers: { 'Content-Type': type, 'X-NN-Caption': encodeURIComponent(caption), 'X-NN-Filename': encodeURIComponent(f.name || 'documento') } });
        if (caption) { input.value = ''; paint(); }
        status(''); add(j.message);
        return;
      }
      let body = f, type = f.type || (isVideo ? 'video/mp4' : 'image/jpeg');
      if (!isVideo) { const small = await shrink(f).catch(() => null); if (small) { body = small; type = 'image/jpeg'; } }
      const j = await api('/api/media', { method: 'POST', body, headers: { 'Content-Type': type, 'X-NN-Caption': encodeURIComponent(caption) } });
      if (caption) { input.value = ''; paint(); }
      status(''); add(j.message);
    } catch (err) { status(err.message || 'Invio non riuscito.'); }
  }
  fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) sendMedia(f, false); });
  $('#file-camera').addEventListener('change', async () => { const el = $('#file-camera'); const f = el.files && el.files[0]; el.value = ''; if (f) sendMedia(f, false); });
  $('#file-video').addEventListener('change', async () => { const el = $('#file-video'); const f = el.files && el.files[0]; el.value = ''; if (f) sendMedia(f, false); });
  $('#file-doc').addEventListener('change', async () => { const el = $('#file-doc'); const f = el.files && el.files[0]; el.value = ''; if (f) sendMedia(f, true); });
  // riduce le foto (max 1600 px, JPEG): più veloci da inviare e leggibili da Idea
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.85));
    } finally { URL.revokeObjectURL(url); }
  }
  $('#viewer').addEventListener('click', () => { $('#viewer').hidden = true; $('#viewer img').src = ''; });

  // --- invio testo
  const input = $('#input');
  function paint() { const empty = !input.value.trim(); $('#mic').hidden = !empty; $('#send').hidden = empty; input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; }
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('#bar').requestSubmit(); } });
  $('#bar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = ''; paint(); input.focus();
    try { const j = await api('/api/messages', { method: 'POST', body: { text } }); add(j.message); }
    catch (err) { status(err.message); input.value = text; paint(); }
  });
  // il tasto invio non deve far perdere il focus (tastiera ferma)
  $('#send').addEventListener('pointerdown', (e) => e.preventDefault());

  // --- vocali: tieni premuto per registrare, rilascia per inviare, scorri a sinistra per annullare
  let rec = null, stream = null, chunks = [], t0 = 0, ox = 0, cancel = false, timer = 0, pid = null;
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const mic = $('#mic');
  mic.addEventListener('contextmenu', (e) => e.preventDefault());
  mic.addEventListener('pointerdown', async (e) => {
    e.preventDefault(); if (rec) return;
    pid = e.pointerId; ox = e.clientX; cancel = false; chunks = [];
    try { mic.setPointerCapture(pid); } catch {}
    if (!navigator.mediaDevices || !window.MediaRecorder) return status('Registrazione non disponibile su questo browser.');
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { pid = null; return status('Microfono non consentito.'); }
    if (pid == null) { stream.getTracks().forEach((t) => t.stop()); stream = null; return; } // già rilasciato
    let mime = '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.start(200); t0 = performance.now();
    mic.classList.add('rec'); $('#rec-hud').hidden = false; $('#rec-hud').classList.remove('cancel');
    timer = setInterval(() => { $('#rec-time').textContent = fmt((performance.now() - t0) / 1000); }, 200);
  });
  mic.addEventListener('pointermove', (e) => {
    if (!rec || e.pointerId !== pid) return;
    cancel = e.clientX - ox < -80; $('#rec-hud').classList.toggle('cancel', cancel);
  });
  const up = (e) => { if (e.pointerId !== pid) return; pid = null; stop(); };
  mic.addEventListener('pointerup', up); mic.addEventListener('pointercancel', (e) => { cancel = true; up(e); });
  function stop() {
    clearInterval(timer); mic.classList.remove('rec'); $('#rec-hud').hidden = true; $('#rec-time').textContent = '0:00';
    const r = rec; rec = null; if (!r) return;
    const sec = (performance.now() - t0) / 1000;
    r.onstop = async () => {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      if (cancel) return status('Vocale annullato.');
      if (sec < 0.6) return status('Tieni premuto il microfono mentre parli.');
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      status('Invio il vocale…');
      try {
        const wav = await toWav(blob).catch(() => null);
        const body = wav || blob;
        const j = await api('/api/voice', { method: 'POST', body, headers: { 'Content-Type': wav ? 'audio/wav' : (blob.type || 'audio/webm'), 'X-NN-Sec': String(Math.round(sec)) } });
        status(''); add(j.message);
      } catch (err) { status(err.message || 'Vocale non inviato.'); }
    };
    try { r.stop(); } catch { r.onstop(); }
  }
  // decodifica e converte in WAV 16 kHz mono (formato sicuro per la trascrizione)
  async function toWav(blob) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const audio = await new Promise((res, rej) => { blob.arrayBuffer().then((ab) => ctx.decodeAudioData(ab, res, rej)).catch(rej); });
    ctx.close && ctx.close();
    const rate = 16000, src = audio.getChannelData(0), ratio = audio.sampleRate / rate;
    const n = Math.floor(src.length / ratio), pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, src[Math.floor(i * ratio)])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return new Blob([buf], { type: 'audio/wav' });
  }

  // --- idee
  $('#ideas-btn').addEventListener('click', () => { $('#ideas-panel').hidden = false; });
  // tasto Aggiorna: ricarica l'app con i file nuovi, senza perdere l'accesso
  $('#refresh-btn').addEventListener('click', async () => {
    $('#refresh-btn').classList.add('spin');
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch {}
          if (reg.waiting) {
            const done = new Promise((resolve) => {
              let settled = false;
              const finish = () => { if (!settled) { settled = true; resolve(); } };
              navigator.serviceWorker.addEventListener('controllerchange', finish, { once: true });
              setTimeout(finish, 1200);
            });
            reg.waiting.postMessage({ type: 'skipWaiting' });
            await done;
          }
        }
      }
      if (window.caches) {
        const ks = await caches.keys();
        await Promise.all(ks.map((k) => caches.delete(k)));
      }
    } catch {}
    const u = new URL(location.href);
    u.searchParams.set('r', String(Date.now()));
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    location.reload();
  });
  $('#ideas-close').addEventListener('click', () => { $('#ideas-panel').hidden = true; });
  $('#ideas-panel').addEventListener('click', (e) => { if (e.target.id === 'ideas-panel') $('#ideas-panel').hidden = true; });

  // --- preferenze e menu casetta (solo il proprietario vede la casetta)
  const PREF_DEF = { chatBg: '#0b141a', bubble: '#005c4b', header: '#202c33', textSize: 'normal' };
  const SW = {
    chatBg: ['#0b141a', '#12211c', '#1a1a1a', '#0f1c2e', '#1c1410', '#15202b', '#2a1a12'],
    bubble: ['#005c4b', '#075e54', '#1b6b93', '#6b4e16', '#5c2a4a', '#2d3436'],
    header: ['#202c33', '#111b21', '#1a2330', '#2a1f16', '#1c2a22', '#000000'],
  };
  let prefs = Object.assign({}, PREF_DEF);
  try { const s = LS.getItem('nn.prefs'); if (s) Object.assign(prefs, JSON.parse(s)); } catch {}
  function applyPrefs(pr) {
    prefs = Object.assign({}, PREF_DEF, pr || {});
    const a = $('#app');
    a.style.setProperty('--chat-bg', prefs.chatBg || PREF_DEF.chatBg);
    a.style.setProperty('--bubble-mine', prefs.bubble || PREF_DEF.bubble);
    a.style.setProperty('--header-bg', prefs.header || PREF_DEF.header);
    a.dataset.text = prefs.textSize || 'normal';
    document.documentElement.style.background = prefs.chatBg || PREF_DEF.chatBg;
    paintPrefs();
  }
  function savePrefsLocal() { try { LS.setItem('nn.prefs', JSON.stringify(prefs)); } catch {} }
  async function savePrefsAll() {
    savePrefsLocal();
    try { await api('/api/prefs', { method: 'PUT', body: { prefs } }); } catch {}
  }
  applyPrefs(prefs); // applica subito quelle del dispositivo
  function paintPrefs() {
    document.querySelectorAll('.swatches button').forEach((b) => b.classList.toggle('on', (prefs[b.parentElement.dataset.key] || '').toLowerCase() === b.dataset.color.toLowerCase()));
    const map = { 'col-chat': 'chatBg', 'col-bubble': 'bubble', 'col-header': 'header' };
    for (const [id, k] of Object.entries(map)) { const el = $('#' + id); if (el) el.value = (prefs[k] && /^#([0-9a-fA-F]{6})$/.test(prefs[k]) ? prefs[k] : PREF_DEF[k]); }
    document.querySelectorAll('#text-size button').forEach((b) => b.classList.toggle('on', b.dataset.size === (prefs.textSize || 'normal')));
  }
  function fillSwatches() {
    for (const [id, key] of [['sw-chat', 'chatBg'], ['sw-bubble', 'bubble'], ['sw-header', 'header']]) {
      const box = $('#' + id); if (!box || box.dataset.ready) continue;
      box.dataset.ready = '1';
      (SW[key] || []).forEach((c) => {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.color = c; b.style.background = c; b.setAttribute('aria-label', c);
        b.addEventListener('click', () => { prefs[key] = c; applyPrefs(prefs); savePrefsAll(); });
        box.appendChild(b);
      });
    }
    paintPrefs();
  }
  ['col-chat', 'col-bubble', 'col-header'].forEach((id) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('input', () => { prefs[el.dataset.key] = el.value; applyPrefs(prefs); });
    el.addEventListener('change', () => { prefs[el.dataset.key] = el.value; applyPrefs(prefs); savePrefsAll(); });
  });
  $('#text-size').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    prefs.textSize = b.dataset.size; applyPrefs(prefs); savePrefsAll();
  });
  $('#prefs-reset').addEventListener('click', () => { applyPrefs(PREF_DEF); savePrefsAll(); });

  function homeOpen(page) {
    $('#home-panel').hidden = false;
    $('#home-menu').hidden = !!page;
    $('#home-prefs').hidden = page !== 'prefs';
    $('#home-users').hidden = page !== 'users';
    $('#home-back').hidden = !page;
    $('#home-title').textContent = page === 'prefs' ? 'Personalizza' : page === 'users' ? 'Utenti' : 'Impostazioni';
    if (page === 'prefs') { fillSwatches(); paintPrefs(); }
    if (page === 'users') loadUsers();
  }
  function homeClose() { $('#home-panel').hidden = true; homeOpen(''); $('#home-panel').hidden = true; }
  $('#home-btn').addEventListener('click', () => homeOpen(''));
  $('#home-close').addEventListener('click', homeClose);
  $('#home-back').addEventListener('click', () => homeOpen(''));
  $('#home-panel').addEventListener('click', (e) => { if (e.target.id === 'home-panel') homeClose(); });
  $('#go-prefs').addEventListener('click', () => homeOpen('prefs'));
  $('#go-users').addEventListener('click', () => homeOpen('users'));

  function toggleEye(input, btn) {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁';
    btn.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
  }
  $('#user-pass-eye').addEventListener('click', () => toggleEye($('#user-pass'), $('#user-pass-eye')));
  $('#user-once-eye').addEventListener('click', () => toggleEye($('#user-once-pass'), $('#user-once-eye')));
  $('#user-once-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#user-once-pass').value); status('Password copiata.'); } catch { $('#user-once-pass').select(); document.execCommand('copy'); }
  });
  function showOnce(name, pass) {
    $('#user-once').hidden = false;
    $('#user-once-name').textContent = name;
    $('#user-once-pass').type = 'password'; $('#user-once-pass').value = pass;
    $('#user-once-eye').textContent = '👁';
  }
  async function loadUsers() {
    try {
      const j = await api('/api/admin/users');
      const ul = $('#users-list');
      ul.innerHTML = (j.users || []).map((u) => {
        const tag = u.owner ? 'proprietario' : u.builtin ? 'già presente' : 'aggiunto';
        const acts = u.builtin ? '' : `<button type="button" data-act="reset" data-id="${esc(u.id)}">Nuova password</button><button type="button" class="danger" data-act="del" data-id="${esc(u.id)}">Rimuovi</button>`;
        return `<li data-id="${esc(u.id)}"><span class="meta"><b>${esc(u.full || u.name)}</b><small>${esc(tag)}</small></span>${acts}</li>`;
      }).join('');
    } catch (e) { status(e.message || 'Elenco utenti non disponibile.'); }
  }
  $('#users-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'del') {
      if (!confirm('Togliere l’accesso a questa persona?')) return;
      try { await api('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }); $('#user-once').hidden = true; loadUsers(); } catch (err) { status(err.message); }
    } else if (b.dataset.act === 'reset') {
      try {
        const j = await api('/api/admin/users/' + encodeURIComponent(id) + '/reset', { method: 'POST', body: {} });
        showOnce(j.user && j.user.name || 'utente', j.pass); loadUsers();
      } catch (err) { status(err.message); }
    }
  });
  $('#user-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#user-name').value.trim();
    const pass = $('#user-pass').value.trim();
    if (!name) return;
    try {
      const j = await api('/api/admin/users', { method: 'POST', body: pass ? { name, pass } : { name } });
      $('#user-name').value = ''; $('#user-pass').value = '';
      showOnce(j.user && j.user.name || name, j.pass);
      loadUsers();
    } catch (err) { status(err.message || 'Aggiunta non riuscita.'); }
  });

  // --- accesso
  $('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const j = await api('/api/unlock', { method: 'POST', body: { pin: $('#pin-input').value } }); LS.setItem('nn.s', j.sess || ''); $('#pin-input').value = ''; start(); }
    catch (err) { $('#gate-msg').textContent = err.message; }
  });
  function askPass(msg) {
    $('#gate').hidden = false; $('#pin-form').hidden = true; $('#pass-form').hidden = false;
    $('#gate-msg').textContent = msg || 'Inserisci la password per entrare.';
    setTimeout(() => $('#pass-input').focus(), 50);
  }
  $('#pass-eye').addEventListener('click', () => {
    const i = $('#pass-input'); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; $('#pass-eye').textContent = show ? '🙈' : '👁';
    $('#pass-eye').setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password'); i.focus();
  });
  $('#pass-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = $('#pass-input').value.trim(); if (!p) return;
    LS.setItem('nn.k', p); LS.removeItem('nn.s'); $('#pass-input').value = ''; start(true);
  });
  async function start(fromForm) {
    if (!key()) {
      try { const r = await fetch('/api/restore', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.key) LS.setItem('nn.k', j.key); } } catch {}
    }
    if (!key()) { askPass(); return; }
    try { me = await api('/api/me'); }
    catch (err) {
      // password sbagliata o tolta: si richiede. Rete lenta, server che si sveglia o troppi tentativi: si riprova senza chiedere la password.
      if (err.status === 401 || err.status === 403) { LS.removeItem('nn.k'); askPass(fromForm ? 'Password errata, riprova.' : ''); return; }
      $('#sub').textContent = 'connessione…'; setTimeout(() => start(false), 3000); return;
    }
    if (me.pin) { $('#gate').hidden = false; $('#pass-form').hidden = true; $('#pin-form').hidden = false; $('#gate-msg').textContent = 'Ciao ' + me.name + '! Inserisci il PIN.'; setTimeout(() => $('#pin-input').focus(), 50); return; }
    $('#gate').hidden = true;
    $('#sub').textContent = 'online';
    if (me.names) setNames(me.names);
    $('#home-btn').hidden = me.role !== 'nicola';
    $('#push-btn').hidden = me.role === 'nicola';
    if (me.welcome) {
      $('#welcome-photo').src = '/api/welcome/photo?k=' + encodeURIComponent(key()) + '&s=' + encodeURIComponent(sess());
      $('#welcome').hidden = false;
      setTimeout(() => { api('/api/welcome/seen', { method: 'POST', body: {} }).catch(() => {}); }, 4000);
    }
    try {
      const j = await api('/api/prefs');
      const sp = (j && j.prefs) || {};
      const serverSet = !!(sp.chatBg || sp.bubble || sp.header || (sp.textSize && sp.textSize !== 'normal'));
      if (serverSet) { applyPrefs(Object.assign({}, PREF_DEF, sp)); savePrefsLocal(); }
      else { savePrefsAll(); }
    } catch {}
    await poll(); bottom(); live(); paint();
    maybeAskPush();
    checkIncoming();
  }
  $('#welcome-ok').addEventListener('click', () => {
    $('#welcome').hidden = true;
    api('/api/welcome/seen', { method: 'POST', body: {} }).catch(() => {});
  });
  // --- notifiche e chiamata in arrivo da Idea ---
  let ringCtx = null, ringTimer = 0, incomingId = '';
  function startRingtone() {
    stopRingtone();
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const c = ringCtx = new AC();
      const osc = c.createOscillator(); const g = c.createGain();
      osc.type = 'sine'; osc.frequency.value = 440; g.gain.value = 0;
      osc.connect(g); g.connect(c.destination); osc.start();
      const pulse = () => {
        if (!ringCtx) return;
        const t = c.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.05);
        g.gain.setValueAtTime(0.18, t + 0.35);
        g.gain.linearRampToValueAtTime(0, t + 0.4);
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.setValueAtTime(480, t + 0.2);
      };
      pulse(); ringTimer = setInterval(pulse, 900);
    } catch {}
  }
  function stopRingtone() {
    clearInterval(ringTimer); ringTimer = 0;
    if (ringCtx) { try { ringCtx.close(); } catch {} ringCtx = null; }
  }
  function showIncoming(p) {
    if (!p || !p.id) return;
    incomingId = p.id;
    $('#incoming').dataset.id = p.id;
    $('#incoming-reason').textContent = p.reason || '';
    $('#incoming').hidden = false;
    startRingtone();
  }
  function hideIncoming() {
    incomingId = '';
    $('#incoming').hidden = true;
    $('#incoming').dataset.id = '';
    stopRingtone();
  }
  async function checkIncoming() {
    const qs = new URLSearchParams(location.search);
    const fromUrl = qs.get('incoming');
    if (fromUrl) history.replaceState(null, '', '/');
    try {
      const j = await api('/api/call/pending');
      if (j && j.call) { showIncoming(j.call); return; }
    } catch {}
    if (fromUrl) {
      try { const j = await api('/api/call/pending'); if (j && j.call) showIncoming(j.call); } catch {}
    }
  }
  $('#incoming-ok').addEventListener('click', async () => {
    const id = incomingId || $('#incoming').dataset.id;
    hideIncoming();
    if (window.NNCall && window.NNCall.start) window.NNCall.start({ incomingId: id });
  });
  $('#incoming-no').addEventListener('click', async () => {
    const id = incomingId || $('#incoming').dataset.id;
    hideIncoming();
    if (id) try { await api('/api/call/decline', { method: 'POST', body: { id } }); } catch (e) { status(e.message || 'Chiamata già chiusa.'); }
  });
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'incoming') checkIncoming();
  });

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) {
      status('Le notifiche non sono disponibili su questo dispositivo.');
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { status('Permesso notifiche non concesso.'); return false; }
      const reg = await navigator.serviceWorker.register('/sw.js?v=11', { scope: '/' });
      await navigator.serviceWorker.ready;
      const vapid = await api('/api/push/vapid');
      const key = vapid.publicKey;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8(key),
      });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON ? sub.toJSON() : sub } });
      LS.setItem('nn.push.on', '1');
      $('#push-prompt').hidden = true;
      $('#push-btn').classList.add('on');
      status('Notifiche attivate.');
      return true;
    } catch (e) { status(e.message || 'Notifiche non attivate.'); return false; }
  }
  function urlBase64ToUint8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function maybeAskPush() {
    if (LS.getItem('nn.push.on') || LS.getItem('nn.push.skip')) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'denied') return;
    $('#push-prompt').hidden = false;
  }
  $('#push-enable').addEventListener('click', () => enablePush());
  $('#push-later').addEventListener('click', () => { LS.setItem('nn.push.skip', '1'); $('#push-prompt').hidden = true; });
  $('#push-btn').addEventListener('click', () => enablePush());
  $('#go-push').addEventListener('click', () => enablePush());

  window.NN = { api, key, sess, me: () => me, status, poll, showIncoming };
  start();
})();
