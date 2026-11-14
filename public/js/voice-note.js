/* Messaggi vocali: tieni premuto, scorri a sinistra per annullare, in alto per le mani libere. */
(function () {
  const $ = (s) => document.querySelector(s);
  const urls = new Map();
  const CANCEL_X = 72;
  const LOCK_Y = 64;
  let rec = null, stream = null, chunks = [], peaks = [], started = 0;
  let locked = false, cancel = false, pointer = null, ox = 0, oy = 0, raf = 0, recog = null, said = '';

  function fmt(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function status(t) {
    const el = $('#vn-status'); if (!el) return;
    el.hidden = !t; el.textContent = t || '';
  }
  function hud(on) {
    const h = $('#vn-hud'); if (h) h.hidden = !on;
  }
  function sample(list, n) {
    if (!list.length) return [0.3, 0.6, 0.4, 0.8, 0.5];
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * list.length / n);
      const b = Math.max(a + 1, Math.floor((i + 1) * list.length / n));
      let m = 0;
      for (let k = a; k < b && k < list.length; k++) m = Math.max(m, list[k]);
      out.push(Math.max(0.08, Math.min(1, m)));
    }
    return out;
  }
  function bars(wave) {
    return (wave || []).map((v) => `<i style="height:${Math.round(6 + v * 22)}px"></i>`).join('');
  }
  function box(m) {
    const v = m.voice || m.voiceReply || {};
    const wave = (v.wave && v.wave.length) ? v.wave : sample(String(m.content || 'nova').split('').map((c) => (c.charCodeAt(0) % 20) / 20), 18);
    const sec = Number(v.sec) || Math.min(30, Math.max(1, Math.round(String(m.content || '').length / 14)));
    const el = document.createElement('div');
    el.className = 'vn';
    el.innerHTML = `<button type="button" class="vn-play" aria-label="Riproduci">▶</button><span class="vn-wave">${bars(wave)}</span><span class="vn-dur">${fmt(sec)}</span>`;
    if (m.content && m.content !== 'Nota vocale') {
      const cap = document.createElement('span');
      cap.className = 'vn-cap';
      cap.textContent = m.content;
      el.appendChild(cap);
    }
    const play = el.querySelector('.vn-play');
    play.addEventListener('click', (e) => { e.stopPropagation(); playNote(m, play); });
    return el;
  }
  async function playNote(m, btn) {
    const v = m.voice || {};
    let url = v.url || (v.localId && urls.get(v.localId)) || '';
    if (!url && (m.voiceReply || m.role === 'assistant')) {
      btn.disabled = true;
      try {
        const r = await App.api('/api/tts', { method: 'POST', body: { text: String(m.content || '').slice(0, 1500), voice: App.xaiVoice ? App.xaiVoice(App.current) : 'eve', voiceExplicit: !!(App.xaiVoiceExplicit && App.xaiVoiceExplicit(App.current)) }, ai: true, raw: true });
        if (!r.ok) throw new Error('voce');
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
      } catch { btn.disabled = false; status('Voce non disponibile.'); return; }
      btn.disabled = false;
    }
    if (!url) return;
    const a = new Audio(url);
    a.play().catch(() => status('Tocca di nuovo per ascoltare.'));
  }
  function paintMic() {
    const input = $('#chat-input');
    const mic = $('#vn-mic');
    const send = document.querySelector('#chat-form button[type="submit"]');
    if (!input || !mic || !send) return;
    const empty = !input.value.trim();
    mic.hidden = !empty;
    send.hidden = empty;
  }
  function stopRecog() { try { if (recog) recog.stop(); } catch {} recog = null; }
  function stopStream() {
    if (stream) { stream.getTracks().forEach((t) => { try { t.stop(); } catch {} }); stream = null; }
  }
  function finish(discard) {
    const r = rec; rec = null; locked = false; pointer = null;
    if (raf) cancelAnimationFrame(raf);
    stopRecog();
    const dur = (performance.now() - started) / 1000;
    const mic = $('#vn-mic'); if (mic) { mic.classList.remove('rec'); mic.setAttribute('aria-pressed', 'false'); mic.setAttribute('aria-label', 'Tocca per un messaggio vocale'); }
    hud(false);
    const hint = $('#vn-hint'); if (hint) hint.textContent = '← annulla · ↑ blocca';
    if (!r) { stopStream(); return; }
    r.onstop = () => {
      stopStream();
      if (discard || dur < 0.35) { if (!discard) status('Troppo corto: tocca 🎙️, parla, poi tocca di nuovo.'); return; }
      const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
      const localId = 'vn' + Date.now().toString(36);
      const url = URL.createObjectURL(blob);
      urls.set(localId, url);
      const text = (said || '').trim() || 'Nota vocale';
      if (App.chat && App.chat.send) App.chat.send(text, false, null, { localId, url, sec: dur, wave: sample(peaks, 22) });
    };
    try { if (r.state !== 'inactive') r.stop(); else r.onstop(); } catch { stopStream(); }
  }
  function gesture(dx, dy, isLocked) {
    if (isLocked) return 'lock';
    if (dy < -LOCK_Y) return 'lock';
    if (dx < -CANCEL_X) return 'cancel';
    return 'record';
  }
  // v2d-36: interruttore. Un tocco avvia la registrazione, un secondo tocco la ferma e invia (niente «tieni premuto»).
  let starting = false;
  async function down(e) {
    if (e.button != null && e.button !== 0) return;
    if (rec) { e.preventDefault(); finish(false); return; }
    if (starting) return;
    starting = true;
    try { await startRec(e); } finally { starting = false; }
  }
  async function startRec(e) {
    e.preventDefault();
    status(''); cancel = false; locked = false; said = ''; chunks = []; peaks = [];
    pointer = e.pointerId; ox = e.clientX; oy = e.clientY;
    try { e.currentTarget.setPointerCapture(pointer); } catch {}
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      status('Registrazione non disponibile su questo browser.'); pointer = null; return;
    }
    // v2d-41: una richiesta di permesso senza risposta non blocca più il tasto (tempo massimo); microfono occupato -> si libera
    // il microfono «di prova» e si riprova una volta; messaggio chiaro con cosa fare.
    const gum = (c) => new Promise((ok, ko) => { let done = false; const t = setTimeout(() => { if (done) return; done = true; const e = new Error('nessuna risposta dal microfono'); e.name = 'TimeoutError'; ko(e); }, 12000); navigator.mediaDevices.getUserMedia(c).then((st) => { if (done) { st.getTracks().forEach((x) => x.stop()); return; } done = true; clearTimeout(t); ok(st); }, (e) => { if (done) return; done = true; clearTimeout(t); ko(e); }); });
    try {
      try { stream = await gum({ audio: true }); }
      catch (err) {
        if (App.audio && App.audio.micDenied && App.audio.micDenied(err)) throw err;
        const pr = App._micPrime; App._micPrime = null; if (pr) try { pr.getTracks().forEach((t) => t.stop()); } catch { /* */ }
        stream = await gum({ audio: true });
      }
    } catch (err) {
      const denied = !err || err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'PermissionDeniedError';
      status(App.audio && App.audio.micHelp ? App.audio.micHelp(err) : (denied ? 'Microfono non consentito.' : 'Microfono non avviato.'));
      pointer = null; stream = null; return;
    }
    // v2d-32: iPhone. Al primo uso dopo l'apertura/aggiornamento dell'app Safari chiede il permesso del microfono: per
    // toccare «Consenti» si alza il dito, e prima la registrazione finiva qui senza dire nulla («il microfono non parte»).
    // Ora il permesso resta dato e si avvisa: alla pressione successiva registra subito.
    if (false && pointer == null) { stopStream(); status('🎙️ Microfono pronto: tieni premuto di nuovo per registrare.'); setTimeout(() => { const el = $('#vn-status'); if (el && /Microfono pronto/.test(el.textContent)) status(''); }, 4000); return; }
    let mime = '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    try { rec.start(120); } catch { status('Registrazione non avviata.'); finish(true); return; }
    started = performance.now();
    hud(true);
    const mic = $('#vn-mic'); if (mic) { mic.classList.add('rec'); mic.setAttribute('aria-pressed', 'true'); mic.setAttribute('aria-label', 'Registrazione in corso: tocca per inviare'); }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 256; src.connect(an);
      const data = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!rec || rec.state === 'inactive') { try { ctx.close(); } catch {} return; }
        an.getByteTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; s += v * v; }
        peaks.push(Math.min(1, Math.sqrt(s / data.length) * 3));
        const t = $('#vn-time'); if (t) t.textContent = fmt((performance.now() - started) / 1000);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {}
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        recog = new SR(); recog.lang = 'it-IT'; recog.continuous = true; recog.interimResults = true;
        recog.onresult = (ev) => {
          let t = '';
          for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
          said = t.trim();
        };
        recog.start();
      }
    } catch {}
  }
  function move(e) {
    if (pointer == null || e.pointerId !== pointer) return;
    const g = gesture(e.clientX - ox, e.clientY - oy, locked);
    const hint = $('#vn-hint');
    if (g === 'lock' && !locked) { locked = true; if (hint) hint.textContent = 'Bloccato · tocca per inviare'; }
    else if (g === 'cancel') { cancel = true; if (hint) hint.textContent = 'Rilascia per annullare'; }
    else if (!locked) { cancel = false; if (hint) hint.textContent = '← annulla · ↑ blocca'; }
  }
  function up(e) { // v2d-36: alzare il dito non ferma più la registrazione (interruttore)
    if (pointer == null || (e && e.pointerId != null && e.pointerId !== pointer)) return;
    locked = !!rec; pointer = null;
    const hint = $('#vn-hint'); if (hint && rec) hint.textContent = 'Tocca 🎙️ per inviare · ← annulla';
  }

  const mic = $('#vn-mic');
  if (mic) {
    mic.addEventListener('pointerdown', down);
    mic.addEventListener('pointermove', move);
    mic.addEventListener('pointerup', up);
    mic.addEventListener('pointercancel', () => { pointer = null; }); // v2d-36: interruttore: la registrazione continua finché non si tocca di nuovo
    mic.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const cancelBtn = $('#vn-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); if (rec) finish(true); else hud(false); });
  const input = $('#chat-input');
  if (input) input.addEventListener('input', paintMic);
  paintMic();
  const plus = $('#vn-plus');
  if (plus) plus.addEventListener('click', () => {
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = 'image/*';
    pick.onchange = () => {
      const file = pick.files && pick.files[0]; if (!file || !App.chat) return;
      const url = URL.createObjectURL(file);
      App.chat.send('', false, { url, kind: 'image', w: 0, h: 0, localOnly: true });
    };
    pick.click();
  });

  App.voiceNote = { box, gesture, urls, paintMic };
})();
