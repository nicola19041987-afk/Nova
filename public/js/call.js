/* call.js — v8 "Videochiamata": lei a tutto schermo (riquadro 9:16 fisso), tu parli a voce, lei risponde a voce con il labiale.
 * Ascolto continuo (riconoscimento vocale del telefono) con invio automatico; mentre lei parla l'ascolto è in pausa (niente eco).
 * Tocca il suo viso per interromperla. Fotocamera facoltativa nel riquadrino in alto (resta sul telefono, nessun video inviato). */
(function () {
  const stage = $('#stage'), ui = $('#call-ui');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let on = false, t0 = 0, tick = 0, prevTts = null, prevAuto = null, cam = null, muted = false, lastNod = 0;
  let rt = false, everVideo = false, warm = 0, connecting = false; // v8.4: conversazione in tempo reale (xAI Voice Agent)
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
    const micOk = SR && App.voice.listening && App.voice.listening();
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
    $('#call-cam').hidden = mode === 'voice'; $('#call-cc').hidden = mode === 'voice';
    if (mode === 'voice') { stopCam(); $('#call-caption').hidden = true; }
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
    try { if (navigator.audioSession) navigator.audioSession.type = v ? 'playback' : 'play-and-record'; } catch {}
    if (App.tts) App.tts.volume = v ? 1 : 0.45;
    if (rt) App.rt.setVolume(v ? 1 : 0.45);
  }
  async function start(m) {
    const ch = App.current; if (!ch) return;
    if (on) return setMode(m || mode);
    if (!App.key()) return App.toast('🔑 Per la videochiamata serve la chiave xAI (Impostazioni)');
    const useRt = App.rt && App.rt.enabled();
    if ((SR || useRt) && !App.ls.get('micOn', false)) {
      if (!confirm('La videochiamata usa il microfono per ascoltarti (il riconoscimento resta sul telefono / nel browser). Attivarlo?')) return;
      App.ls.set('micOn', true); const cb = $('#set-mic'); if (cb) cb.checked = true; App.applyDevicePrefs && App.applyDevicePrefs();
    }
    on = true; t0 = Date.now(); muted = false; everVideo = false; rt = false;
    App.audio.unlock(); // dentro il tocco: sblocca l'audio su iPhone
    App.stageFs.exit(); stage.classList.add('fs', 'call'); document.body.classList.add('avatar-fs-on', 'in-call');
    ui.hidden = false; $('#call-name').textContent = ch.name; $('#call-caption').hidden = true;
    setMode(m || 'video'); speaker = true; $('#call-speaker').classList.add('on'); $('#call-speaker').textContent = '🔊'; if (App.tts) App.tts.volume = 1;
    $('#act-menu').hidden = true; $('#scene-menu').hidden = true;
    prevTts = App.voice.ttsOn(); if (!prevTts) $('#tts-btn').click(); // in chiamata lei parla sempre
    prevAuto = $('#auto-send').checked; $('#auto-send').checked = true;
    App.call.active = true;
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    const greet = GREET[Math.floor(Math.random() * GREET.length)].replace('{n}', App.me.name);
    App.avatarConv.react('smile');
    clearInterval(tick); tick = setInterval(state, 250); App.chat.header && App.chat.header();
    if (useRt) { // v8.4: tempo reale (microfono e connessione partono insieme, già dentro il tocco)
      connecting = true; state();
      const p = App.rt.start(ch, mode, greet);
      try { await p; if (!on) { App.rt.stop(); return; } rt = true; connecting = false; state(); return; }
      catch (e) { connecting = false; if (!on) return; console.warn('Tempo reale non disponibile:', e.message); App.toast('⚡ Tempo reale non disponibile (' + e.message + '): uso la chiamata classica', 4500); }
    }
    classic(greet);
  }
  // chiamata classica: riconoscimento vocale del telefono + risposta in streaming + voce frase per frase
  function classic(greet) {
    rt = false; state();
    App.api('/api/ai-warm', { method: 'POST', ai: true }).catch(() => {}); // connessione calda verso xAI
    clearInterval(warm); warm = setInterval(() => { if (on && !rt) App.api('/api/ai-warm', { method: 'POST', ai: true }).catch(() => {}); }, 50000);
    if (greet) setTimeout(() => { if (on) App.voice.sayNow(greet); }, 350);
    if (SR) setTimeout(() => { if (on && !muted) App.voice.start(); }, greet ? 600 : 50);
  }
  function end() {
    if (!on) return; on = false; App.call.active = false; cancelAnimationFrame(raf);
    stage.classList.remove('voice'); ui.classList.remove('voice'); App.call.mode = null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} if (App.tts) App.tts.volume = 1;
    clearInterval(tick); clearInterval(warm); App.voice.stop(); App.voice.cancel();
    if (rt) { App.rt.stop(); rt = false; } connecting = false; ui.classList.remove('rt');
    const ch = App.current, secs = Math.round((Date.now() - t0) / 1000); // v8.4: registro chiamate (scheda Chiamate)
    if (ch) App.api('/api/calls', { method: 'POST', body: { characterId: ch.id, mode: everVideo ? 'video' : 'voice', startedAt: new Date(t0).toISOString(), seconds: secs } }).catch(() => {});
    stopCam(); ui.hidden = true; stage.classList.remove('fs', 'call'); document.body.classList.remove('avatar-fs-on', 'in-call');
    if (prevTts === false && App.voice.ttsOn()) $('#tts-btn').click();
    if (prevAuto !== null) $('#auto-send').checked = prevAuto;
    App.toast((mode === 'voice' ? '📞 Chiamata vocale terminata · ' : '📹 Videochiamata terminata · ') + fmt(Date.now() - t0));
    requestAnimationFrame(() => App.fitFrame && App.fitFrame()); App.chat.header && App.chat.header();
  }
  async function toggleCam() {
    if (cam) return stopCam();
    if (!App.ls.get('camOn', false)) {
      if (!confirm('Mostrare la tua fotocamera nel riquadrino? Il video resta sul telefono e non viene inviato a nessuno.')) return;
      App.ls.set('camOn', true); const cb = $('#set-cam'); if (cb) cb.checked = true; App.applyDevicePrefs && App.applyDevicePrefs();
    }
    try {
      cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } }, audio: false });
      const v = $('#call-self'); v.srcObject = cam; v.hidden = false; v.play().catch(() => {}); $('#call-cam').classList.add('on');
    } catch { cam = null; App.toast('Fotocamera non disponibile o permesso negato'); }
  }
  function stopCam() { if (cam) cam.getTracks().forEach((t) => t.stop()); cam = null; const v = $('#call-self'); v.srcObject = null; v.hidden = true; $('#call-cam').classList.remove('on'); }
  App.call = {
    active: false, mode: null, start, end, setMode,
    get realtime() { return rt; },
    // tempo reale caduto a chiamata in corso: si continua con la chiamata classica, senza chiudere
    fallback(why) { if (!on || !rt) return; App.rt.stop(); rt = false; App.toast('⚡ ' + (why || 'Tempo reale interrotto') + ': continuo con la chiamata classica', 4000); classic(null); },
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
  $('#call-mute').addEventListener('click', (e) => { e.stopPropagation(); muted = !muted; if (rt) App.rt.setMuted(muted); else if (muted) App.voice.stop(); else if (SR) App.voice.start(); state(); });
  $('#call-cam').addEventListener('click', (e) => { e.stopPropagation(); toggleCam(); });
  $('#call-cc').addEventListener('click', (e) => { e.stopPropagation(); const v = !App.ls.get('callCaptions', true); App.ls.set('callCaptions', v); $('#call-cc').classList.toggle('on', v); if (!v) $('#call-caption').hidden = true; });
  $('#call-cc').classList.toggle('on', App.ls.get('callCaptions', true));
  // tocco sul viso: la interrompi (come in una vera chiamata) e torna ad ascoltarti
  ui.addEventListener('click', (e) => {
    if (e.target.closest('button,form,input,video')) return;
    if (rt) { if (App.rt.speaking()) App.rt.interrupt(); return; }
    if ((App.tts && App.tts.playing) || App.avatarConv.speaking) { App.voice.cancel(); App.avatarConv.stopAudio(); if (SR && !muted) setTimeout(() => App.voice.start(), 200); }
  });
  $('#call-text').addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); const i = $('#call-input'); const t = i.value.trim(); i.value = ''; if (t && !(rt && App.rt.sendText(t))) App.chat.send(t); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) end(); });
})();
