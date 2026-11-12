/* N&N — chat stile WhatsApp: testo, vocali (tieni premuto), tempo reale (SSE + polling di riserva). */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const LS = window.localStorage;
  // --- chiave dal link segreto: salvata sul dispositivo e tolta dalla barra degli indirizzi
  const qs = new URLSearchParams(location.search);
  if (qs.get('k')) { LS.setItem('nn.k', qs.get('k')); history.replaceState(null, '', '/'); }
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
  const NAMES = { nico: 'Nico', nicola: 'Nicola', nn: 'N&N' };
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
    el.className = 'msg ' + (mine ? 'mine' : 'other');
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = (mine ? '' : `<span class="au ${esc(m.author)}">${esc(NAMES[m.author] || m.author)}</span>`)
      + (m.voice ? `<span class="vtag">🎤 Vocale · ${m.voice.sec || 1}s</span>` : '')
      + `<span class="tx">${esc(m.content)}</span>`
      + (m.idea ? `<span class="itag">💡 Idea salvata: ${esc(m.idea)}</span>` : '')
      + `<span class="meta">${time}</span>`;
    box.appendChild(el);
    if (stick || mine) bottom();
  }
  function ideas(list) {
    $('#ideas-count').textContent = list && list.length ? list.length : '';
    $('#ideas-list').innerHTML = (list || []).slice().reverse().map((i) => `<li><b>${esc(i.titolo)}</b>${esc(i.descrizione)}<br><small>${esc(i.data)} · ${esc(i.stato)}</small></li>`).join('') || '<li>Ancora nessuna idea. Scrivine una!</li>';
  }
  async function poll() {
    try { const j = await api('/api/messages?since=' + last); j.messages.forEach(add); ideas(j.ideas); } catch (e) { if (e.status === 401) return start(); }
  }
  function live() {
    if (es) es.close();
    es = new EventSource('/api/stream?k=' + encodeURIComponent(key()) + '&s=' + encodeURIComponent(sess()));
    es.addEventListener('message', (ev) => { add(JSON.parse(ev.data)); $('#typing').hidden = true; });
    es.addEventListener('typing', (ev) => { $('#typing').hidden = !JSON.parse(ev.data).on; });
    es.addEventListener('ideas', (ev) => ideas(JSON.parse(ev.data)));
    es.addEventListener('hello', () => poll());
    // polling di riserva ogni 2 s: se SSE cade, i messaggi arrivano comunque
    clearInterval(pollT); pollT = setInterval(poll, 2000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) { poll(); if (!es || es.readyState === 2) live(); } });

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
      status('Trascrivo il vocale…');
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
  $('#ideas-close').addEventListener('click', () => { $('#ideas-panel').hidden = true; });
  $('#ideas-panel').addEventListener('click', (e) => { if (e.target.id === 'ideas-panel') $('#ideas-panel').hidden = true; });

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
  $('#pass-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = $('#pass-input').value.trim(); if (!p) return;
    LS.setItem('nn.k', p); LS.removeItem('nn.s'); $('#pass-input').value = ''; start(true);
  });
  async function start(fromForm) {
    if (!key()) { askPass(); return; }
    try { me = await api('/api/me'); }
    catch { LS.removeItem('nn.k'); askPass(fromForm ? 'Password errata, riprova.' : ''); return; }
    if (me.pin) { $('#gate').hidden = false; $('#pass-form').hidden = true; $('#pin-form').hidden = false; $('#gate-msg').textContent = 'Ciao ' + me.name + '! Inserisci il PIN.'; setTimeout(() => $('#pin-input').focus(), 50); return; }
    $('#gate').hidden = true;
    $('#sub').textContent = me.role === 'nicola' ? 'vedi tutto quello che scrive Nico, in tempo reale' : 'il tuo pezzetto di carta digitale';
    await poll(); bottom(); live(); paint();
  }
  start();
})();
