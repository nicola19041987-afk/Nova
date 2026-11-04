/* call.js — v8 "Videochiamata": lei a tutto schermo (riquadro 9:16 fisso), tu parli a voce, lei risponde a voce con il labiale.
 * Ascolto continuo (riconoscimento vocale del telefono) con invio automatico; mentre lei parla l'ascolto è in pausa (niente eco).
 * Tocca il suo viso per interromperla. Fotocamera facoltativa nel riquadrino in alto (resta sul telefono, nessun video inviato). */
(function () {
  const stage = $('#stage'), ui = $('#call-ui');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let on = false, t0 = 0, tick = 0, prevTts = null, prevAuto = null, cam = null, muted = false, lastNod = 0;
  let rt = false, everVideo = false, warm = 0, connecting = false; // v8.4: conversazione in tempo reale (xAI Voice Agent)
  let why = '', micMode = ''; // v8.4.1: motivo della chiamata classica e microfono usato ('vad' = nostro, 'sr' = riconoscimento del telefono)
  // v8.4.1: indicatore sempre visibile del motore della chiamata (tocca per il motivo)
  function badge(kind, reason) {
    const b = $('#call-badge'); if (!b) return;
    b.hidden = !kind; b.dataset.kind = kind || ''; why = reason || '';
    b.textContent = kind === 'rt' ? '⚡ Tempo reale' : kind === 'classic' ? 'Classica' : kind === 'conn' ? '⏳ Collegamento…' : '';
    b.title = kind === 'classic' ? (why ? 'Chiamata classica: ' + why : 'Chiamata classica (scelta nelle Impostazioni)') + (micMode === 'sr' ? ' · microfono: riconoscimento del telefono' : micMode === 'vad' ? ' · microfono continuo + trascrizione xAI' : '') : kind === 'rt' ? 'Conversazione in tempo reale xAI' : '';
  }
  let mode = 'video', speaker = true, raf = 0, amp = 0; // v8.2: 'voice' = chiamata vocale stile WhatsApp, 'video' = videochiamata
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const GREET = ['Ehi, ciao!', 'Eccomi! Ciao.', 'Ehi! Come va?', 'Ciao, che bello vederti!', 'Ciao {n}!', 'Eccomi... ciao!']; // v8.1: il nome solo ogni tanto
  function state() {
    if (!on) return;
    $('#call-timer').textContent = fmt(Date.now() - t0);
    if (rt) { // tempo reale: stato dalla sessione (ottimista: "sta parlando…" appena hai finito)
      const st = App.rt.status() || 'Ti ascolto…', sp = App.rt.speaking() || st === 'Sta parlando…';
      $('#call-text').hidden = true; $('#call-state').textContent = st;
      ui.classList.toggle('speaking', sp); ui.classList.toggle('thinking', false); ui.classList.add('rt');
      $('#call-mute').classList.toggle('off', muted); $('#call-mute').textContent = muted ? '🔇' : '🎙️';
      return;
    }
    ui.classList.remove('rt');
    const speaking = (App.tts && App.tts.playing) || App.avatarConv.speaking || (window.speechSynthesis && window.speechSynthesis.speaking);
    const micOk = (App.callMic && App.callMic.active) || (SR && App.voice.listening && App.voice.listening());
    // v8.4: appena hai finito di parlare lo stato diventa subito "sta parlando…" (la voce parte frase per frase)
    const st = connecting ? 'Collegamento…' : App.chat.busy ? 'Sta parlando…' : speaking ? 'Sta parlando…' : muted ? 'Microfono spento' : !micOk ? 'Scrivi qui sotto (o usa il 🎙️ della tastiera)' : 'Ti ascolto…';
    $('#call-text').hidden = !!micOk || muted || connecting;
    $('#call-state').textContent = st;
    ui.classList.toggle('speaking', !!speaking); ui.classList.toggle('thinking', !!App.chat.busy);
    $('#call-mute').classList.toggle('off', muted); $('#call-mute').textContent = muted ? '🔇' : '🎙️';
  }
  // v8.2: modalità della chiamata (si può passare da vocale a video col tasto verde, il timer continua)
  function setMode(m) {
    mode = m === 'voice' ? 'voice' : 'video';
    stage.classList.toggle('voice', mode === 'voice'); ui.classList.toggle('voice', mode === 'voice');
    $('#call-kind').textContent = mode === 'voice' ? 'Chiamata vocale' : 'Videochiamata';
    $('#call-portrait').hidden = mode !== 'voice';
    $('#call-tovideo').hidden = mode !== 'voice'; $('#call-speaker').hidden = mode !== 'voice';
    $('#call-cam').hidden = mode === 'voice'; $('#call-cc').hidden = mode === 'voice'; $('#call-hot').hidden = mode === 'voice';
    if (mode === 'voice') { stopCam(); $('#call-caption').hidden = true; }
    else if (on && !cam) startCam(); // v8.4.4: passando a video (o iniziando in video) chiede la fotocamera, dentro il tocco
    App.call.mode = mode; if (mode === 'video') everVideo = true;
    if (on && rt) App.rt.setMode(mode);
    cancelAnimationFrame(raf); if (mode === 'voice') raf = requestAnimationFrame(portrait);
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    if (on) { state(); App.chat.header && App.chat.header(); }
  }
  // Ritratto rotondo: copiato a ogni fotogramma dal canvas dell'avatar (respiro, labiale, sguardo continuano);
  // l'alone pulsa con la voce. Il canvas grande resta dietro, sfocato, a tutto schermo.
  function portrait() {
    if (!on || mode !== 'voice') return;
    raf = requestAnimationFrame(portrait);
    const av = App.avatarConv, src = av.c, out = $('#call-face'), x = out.getContext('2d');
    const P = out.width; x.clearRect(0, 0, P, P);
    let sx = 0, sy = 0, sw = Math.min(src.width, src.height), cx = src.width / 2, cy = src.height * 0.32;
    const b = av._bounds, img = (av._shown && av._shown.img) || av.img, lm = (av._shown && av._shown.lm) || av.lm; // v8.3: anche seduta al tavolo
    if (b && b.x1 !== undefined && img && img.naturalWidth && lm && lm.eyeL) {
      const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2, k = (b.x1 - b.x0) / nw;
      const X = (p) => b.x0 + (p.x * s + ox) * k, Y = (p) => b.y0 + (p.y * s + oy) * k;
      const ed = Math.hypot(X(lm.eyeR) - X(lm.eyeL), Y(lm.eyeR) - Y(lm.eyeL));
      cx = (X(lm.eyeL) + X(lm.eyeR)) / 2; cy = (Y(lm.eyeL) + Y(lm.eyeR) + 2 * Y(lm.mouth)) / 4;
      sw = Math.max(40, Math.min(ed * 4.4, b.x1 - b.x0, b.y1 - b.y0));
    }
    sx = Math.max(0, Math.min(src.width - sw, cx - sw / 2)); sy = Math.max(0, Math.min(src.height - sw, cy - sw / 2));
    try { x.drawImage(src, sx, sy, sw, sw, 0, 0, P, P); } catch {}
    const tg = Math.max(0, Math.min(1, av.mouth * 1.6)); amp += (tg - amp) * (tg > amp ? 0.35 : 0.08);
    $('#call-portrait').style.setProperty('--amp', amp.toFixed(3));
  }
  // Altoparlante: dove il browser lo permette (iPhone: sessione audio "play-and-record" = auricolare), altrimenti volume ridotto
  function setSpeaker(v) {
    speaker = v; const b = $('#call-speaker'); b.classList.toggle('on', v); b.textContent = v ? '🔊' : '🔈';
    // v8.4.1: la sessione audio NON si cambia durante la chiamata (sarebbe un "clic" e un cambio di instradamento): solo volume
    if (App.tts) App.tts.volume = v ? 1 : 0.45;
    if (rt) App.rt.setVolume(v ? 1 : 0.45);
  }
  async function start(m) {
    const ch = App.current; if (!ch) return;
    if (on) return setMode(m || mode);
    if (!App.key()) return App.toast('🔑 Per la videochiamata serve la chiave xAI (Impostazioni)');
    const useRt = App.rt && App.rt.enabled();
    if ((SR || useRt || (App.callMic && App.callMic.supported())) && !App.ls.get('micOn', false)) {
      if (!confirm('La videochiamata usa il microfono per ascoltarti (il riconoscimento resta sul telefono / nel browser). Attivarlo?')) return;
      App.ls.set('micOn', true); const cb = $('#set-mic'); if (cb) cb.checked = true; App.applyDevicePrefs && App.applyDevicePrefs();
    }
    on = true; t0 = Date.now(); muted = false; everVideo = false; rt = false; camAsked = false;
    App.call.active = true; if (App.voice.isListening && App.voice.isListening()) App.voice.stop(); // v8.4.4: niente riconoscimento vocale del telefono in chiamata (suoni di attacco/stacco)
    App.audio.callSession(true); // v8.4.1: una sola sessione audio (registra + riproduce) per tutta la chiamata
    App.audio.unlock(); // dentro il tocco: sblocca l'AudioContext condiviso (in chiamata nessun <audio>/sintesi di "riscaldamento")
    App.audio.mic().catch(() => {}); // v8.4.4: il microfono si apre UNA volta, subito, dentro il tocco
    App.stageFs.exit(); stage.classList.add('fs', 'call'); document.body.classList.add('avatar-fs-on', 'in-call');
    ui.hidden = false; $('#call-name').textContent = ch.name; $('#call-caption').hidden = true;
    setMode(m || 'video'); speaker = true; $('#call-speaker').classList.add('on'); $('#call-speaker').textContent = '🔊'; if (App.tts) App.tts.volume = 1;
    $('#act-menu').hidden = true; $('#scene-menu').hidden = true;
    prevTts = null; if (App.tts) App.tts.fails = 0; // v8.4.5: in chiamata lei parla sempre (App.voice.ttsOn() è vero in chiamata), senza toccare «Lettura»
    prevAuto = $('#auto-send').checked; $('#auto-send').checked = true;
    App.call.active = true;
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    const greet = GREET[Math.floor(Math.random() * GREET.length)].replace('{n}', App.me.name);
    App.avatarConv.react('smile');
    clearInterval(tick); tick = setInterval(state, 250); App.chat.header && App.chat.header();
    if (useRt) { // v8.4: tempo reale (microfono e connessione partono insieme, già dentro il tocco)
      connecting = true; badge('conn'); state();
      const p = App.rt.start(ch, mode, greet);
      try { await p; if (!on) { App.rt.stop(); return; } rt = true; connecting = false; badge('rt'); state(); return; }
      catch (e) { connecting = false; if (!on) return; console.warn('Tempo reale non disponibile:', e.message); App.toast('⚡ Tempo reale non disponibile: ' + e.message + ' · uso la chiamata classica (dettagli: Impostazioni → Diagnostica voce)', 6000); classic(greet, e.message); return; }
    }
    classic(greet, !App.key() ? 'manca la chiave xAI' : App.ls.get('callEngine', 'realtime') !== 'realtime' ? 'scelta nelle Impostazioni' : App.rt && !App.rt.supported() ? 'browser non compatibile con il tempo reale' : '');
  }
  // chiamata classica: riconoscimento vocale del telefono + risposta in streaming + voce frase per frase
  // v8.4.1: microfono continuo + nostro rilevatore del parlato + trascrizione xAI (niente bip); riserva: riconoscimento continuo
  function classic(greet, reason) {
    rt = false; micMode = ''; badge('classic', reason); state();
    App.api('/api/ai-warm', { method: 'POST', ai: true }).catch(() => {}); // connessione calda verso xAI
    clearInterval(warm); warm = setInterval(() => { if (on && !rt) App.api('/api/ai-warm', { method: 'POST', ai: true }).catch(() => {}); }, 25000);
    if (greet) setTimeout(() => { if (on) App.voice.sayNow(greet); }, 350);
    // v8.4.4: mai il riconoscimento vocale del telefono in chiamata (su iPhone suona a ogni avvio/arresto): se la trascrizione xAI
    // non va, si continua scrivendo (il microfono resta aperto e la chiamata pure)
    const useSR = () => { micMode = ''; badge('classic', reason); state(); };
    if (App.callMic && App.callMic.supported() && App.ls.get('callMicVad', true)) {
      App.callMic.start({ onFail: (e) => { if (!on || rt) return; App.callMic.stop(); App.toast('🎙️ Trascrizione xAI non disponibile (' + e.message + '): scrivi qui sotto, la chiamata continua', 5000); useSR(); } })
        .then(() => { if (!on || rt) { App.callMic.stop(); return; } micMode = 'vad'; badge('classic', reason); if (muted) App.callMic.setMuted(true); state(); })
        .catch((e) => { console.warn('Microfono continuo non disponibile:', e.message); if (on && !rt) useSR(); });
    } else useSR();
  }
  function end() {
    if (!on) return; on = false; App.call.active = false; cancelAnimationFrame(raf);
    stage.classList.remove('voice'); ui.classList.remove('voice'); App.call.mode = null;
    if (App.tts) App.tts.volume = 1;
    clearInterval(tick); clearInterval(warm); App.voice.cancel(); if (App.callMic) App.callMic.stop(); micMode = ''; badge('');
    if (rt) { App.rt.stop(); rt = false; } connecting = false; ui.classList.remove('rt');
    App.audio.releaseMic(); // v8.4.4: il microfono si chiude solo qui, riattaccando
    App.audio.callSession(false);
    const ch = App.current, secs = Math.round((Date.now() - t0) / 1000); // v8.4: registro chiamate (scheda Chiamate)
    if (ch) App.api('/api/calls', { method: 'POST', body: { characterId: ch.id, mode: everVideo ? 'video' : 'voice', startedAt: new Date(t0).toISOString(), seconds: secs } }).catch(() => {});
    stopCam(); ui.hidden = true; stage.classList.remove('fs', 'call'); document.body.classList.remove('avatar-fs-on', 'in-call');
    if (prevTts === false && App.voice.ttsOn()) $('#tts-btn').click();
    if (prevAuto !== null) $('#auto-send').checked = prevAuto;
    App.toast((mode === 'voice' ? '📞 Chiamata vocale terminata · ' : '📹 Videochiamata terminata · ') + fmt(Date.now() - t0));
    requestAnimationFrame(() => App.fitFrame && App.fitFrame()); App.chat.header && App.chat.header();
  }
  // v8.4.4: fotocamera nella videochiamata (anche Safari/iPhone): chiesta passando a video (getUserMedia SOLO video: il microfono
  // della chiamata resta quello, mai fermato), anteprima piccola in alto (playsinline + muted + autoplay). Se negata: istruzioni chiare.
  let camAsked = false;
  function camHelp(e) {
    const n = (e && e.name) || '';
    if (!window.isSecureContext) return '📷 La fotocamera richiede una connessione sicura (https).';
    if (n === 'NotAllowedError' || n === 'SecurityError') return (window.Motion && Motion.isIOS ? Motion.isIOS() : /iP(hone|ad|od)/.test(navigator.userAgent))
      ? '📷 Fotocamera non consentita. Su iPhone: Impostazioni → Safari → Fotocamera → Consenti (oppure in Safari tocca «aA» → Impostazioni sito web → Fotocamera → Consenti), poi tocca 📷.'
      : '📷 Fotocamera non consentita: consentila nelle impostazioni del sito (icona accanto all\'indirizzo → Fotocamera → Consenti), poi tocca 📷.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return '📷 Nessuna fotocamera trovata su questo dispositivo.';
    if (n === 'NotReadableError' || n === 'AbortError') return '📷 La fotocamera è usata da un\'altra app: chiudila e tocca 📷.';
    return '📷 Fotocamera non disponibile (' + (e && e.message || n || 'errore') + ').';
  }
  async function startCam() {
    if (cam || !on || mode !== 'video') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { App.toast(camHelp({ name: 'NotFoundError' }), 6000); return; }
    camAsked = true;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: false });
      if (!on || mode !== 'video') { st.getVideoTracks().forEach((t) => t.stop()); return; }
      cam = st; App.ls.set('camOn', true);
      const v = $('#call-self'); v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.autoplay = true;
      v.srcObject = cam; v.hidden = false; v.play().catch(() => {}); $('#call-cam').classList.add('on');
      if (!App.audio.micLive()) App.audio.mic().catch(() => {}); // se il sistema avesse chiuso il microfono, si riapre (chi ascolta si ricollega)
    } catch (e) { cam = null; console.warn('Fotocamera:', e && e.name, e && e.message); App.toast(camHelp(e), 9000); }
  }
  function toggleCam() { if (cam) return stopCam(); return startCam(); }
  function stopCam() { if (cam) cam.getVideoTracks().forEach((t) => t.stop()); cam = null; /* solo video: il microfono non si tocca */ const v = $('#call-self'); v.srcObject = null; v.hidden = true; $('#call-cam').classList.remove('on'); }
  App.call = {
    active: false, mode: null, start, end, setMode,
    get realtime() { return rt; },
    engine: () => (!on ? null : rt ? 'realtime' : connecting ? 'connecting' : 'classic'),
    why: () => why, micMode: () => micMode,
    // tempo reale caduto a chiamata in corso: si continua con la chiamata classica, senza chiudere
    fallback(w) { if (!on || !rt) return; App.rt.stop(); rt = false; App.toast('⚡ ' + (w || 'Tempo reale interrotto') + ': continuo con la chiamata classica', 5000); App.audio.callSession(true); classic(null, w || 'tempo reale interrotto'); },
    // mentre parli: ogni tanto annuisce (ascolto attivo), mai a raffica
    onInterim(text) { if (!on || !text) return; const now = Date.now(); if (now - lastNod > 2600 + Math.random() * 1500) { lastNod = now; App.avatarConv.react(Math.random() < 0.75 ? 'nod' : 'tilt'); } },
    // sottotitolo breve della sua risposta (utile anche ad audio spento)
    caption(text) { if (!on || mode === 'voice') return; const c = $('#call-caption'); const t = String(text || '').replace(/\s+/g, ' ').trim(); c.hidden = !t || !App.ls.get('callCaptions', true); c.textContent = t.length > 160 ? '…' + t.slice(-158) : t; },
  };
  $('#call-btn').addEventListener('click', (e) => { e.stopPropagation(); start('video'); });
  $('#call-btn2').addEventListener('click', (e) => { e.stopPropagation(); start('video'); });
  $('#wa-video').addEventListener('click', (e) => { e.stopPropagation(); start('video'); });
  $('#wa-voice').addEventListener('click', (e) => { e.stopPropagation(); start('voice'); });
  $('#call-tovideo').addEventListener('click', (e) => { e.stopPropagation(); setMode('video'); });
  $('#call-speaker').addEventListener('click', (e) => { e.stopPropagation(); setSpeaker(!speaker); });
  $('#call-end').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  $('#call-mute').addEventListener('click', (e) => { e.stopPropagation(); muted = !muted; if (rt) App.rt.setMuted(muted); else if (micMode === 'vad') App.callMic.setMuted(muted); state(); }); // v8.4.4: muto via software (il microfono resta aperto)
  const eb = $('#call-badge'); if (eb) eb.addEventListener('click', (e) => { e.stopPropagation(); App.toast(eb.title || eb.textContent, 5000); });
  $('#call-cam').addEventListener('click', (e) => { e.stopPropagation(); toggleCam(); });
  $('#call-cc').addEventListener('click', (e) => { e.stopPropagation(); const v = !App.ls.get('callCaptions', true); App.ls.set('callCaptions', v); $('#call-cc').classList.toggle('on', v); if (!v) $('#call-caption').hidden = true; });
  $('#call-cc').classList.toggle('on', App.ls.get('callCaptions', true));
  // tocco sul viso: la interrompi (come in una vera chiamata) e torna ad ascoltarti
  ui.addEventListener('click', (e) => {
    if (e.target.closest('button,form,input,video')) return;
    if (rt) { if (App.rt.speaking()) App.rt.interrupt(); return; }
    if ((App.tts && App.tts.playing) || App.avatarConv.speaking) { App.voice.cancel(); App.avatarConv.stopAudio(); }
  });
  $('#call-text').addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); const i = $('#call-input'); const t = i.value.trim(); i.value = ''; if (t && !(rt && App.rt.sendText(t))) App.chat.send(t); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) end(); });
})();
