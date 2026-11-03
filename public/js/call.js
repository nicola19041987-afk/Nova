/* call.js — v8 "Videochiamata": lei a tutto schermo (riquadro 9:16 fisso), tu parli a voce, lei risponde a voce con il labiale.
 * Ascolto continuo (riconoscimento vocale del telefono) con invio automatico; mentre lei parla l'ascolto è in pausa (niente eco).
 * Tocca il suo viso per interromperla. Fotocamera facoltativa nel riquadrino in alto (resta sul telefono, nessun video inviato). */
(function () {
  const stage = $('#stage'), ui = $('#call-ui');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let on = false, t0 = 0, tick = 0, prevTts = null, prevAuto = null, cam = null, muted = false, lastNod = 0;
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const GREET = ['Ciao {n}!', 'Eccomi! Ciao {n}.', 'Ehi, ciao {n}! Come va?', 'Ciao {n}, che bello vederti!'];
  function state() {
    if (!on) return;
    $('#call-timer').textContent = fmt(Date.now() - t0);
    const speaking = (App.tts && App.tts.playing) || App.avatarConv.speaking || (window.speechSynthesis && window.speechSynthesis.speaking);
    const micOk = SR && App.voice.listening && App.voice.listening();
    const st = App.chat.busy ? 'Sta pensando…' : speaking ? 'Sta parlando… (tocca per interrompere)' : muted ? 'Microfono spento' : !micOk ? 'Scrivi qui sotto (o usa il 🎙️ della tastiera)' : 'Ti ascolto…';
    $('#call-text').hidden = !!micOk || muted;
    $('#call-state').textContent = st;
    ui.classList.toggle('speaking', !!speaking); ui.classList.toggle('thinking', !!App.chat.busy);
    $('#call-mute').classList.toggle('off', muted); $('#call-mute').textContent = muted ? '🔇' : '🎙️';
  }
  async function start() {
    const ch = App.current; if (!ch) return;
    if (!App.key()) return App.toast('🔑 Per la videochiamata serve la chiave xAI (Account)');
    if (SR && !App.ls.get('micOn', false)) {
      if (!confirm('La videochiamata usa il microfono per ascoltarti (il riconoscimento resta sul telefono / nel browser). Attivarlo?')) return;
      App.ls.set('micOn', true); const cb = $('#set-mic'); if (cb) cb.checked = true; App.applyDevicePrefs && App.applyDevicePrefs();
    }
    on = true; t0 = Date.now(); muted = false;
    App.audio.unlock(); // dentro il tocco: sblocca l'audio su iPhone
    App.stageFs.exit(); stage.classList.add('fs', 'call'); document.body.classList.add('avatar-fs-on', 'in-call');
    ui.hidden = false; $('#call-name').textContent = ch.name; $('#call-caption').hidden = true;
    $('#act-menu').hidden = true; $('#scene-menu').hidden = true;
    prevTts = App.voice.ttsOn(); if (!prevTts) $('#tts-btn').click(); // in chiamata lei parla sempre
    prevAuto = $('#auto-send').checked; $('#auto-send').checked = true;
    App.call.active = true;
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    const greet = GREET[Math.floor(Math.random() * GREET.length)].replace('{n}', App.me.name);
    App.avatarConv.react('smile');
    setTimeout(() => { if (on) App.voice.sayNow(greet); }, 350);
    if (SR) setTimeout(() => { if (on && !muted) App.voice.start(); }, 600);
    clearInterval(tick); tick = setInterval(state, 250); state();
  }
  function end() {
    if (!on) return; on = false; App.call.active = false;
    clearInterval(tick); App.voice.stop(); App.voice.cancel();
    stopCam(); ui.hidden = true; stage.classList.remove('fs', 'call'); document.body.classList.remove('avatar-fs-on', 'in-call');
    if (prevTts === false && App.voice.ttsOn()) $('#tts-btn').click();
    if (prevAuto !== null) $('#auto-send').checked = prevAuto;
    App.toast('📞 Chiamata terminata · ' + fmt(Date.now() - t0));
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
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
    active: false, start, end,
    // mentre parli: ogni tanto annuisce (ascolto attivo), mai a raffica
    onInterim(text) { if (!on || !text) return; const now = Date.now(); if (now - lastNod > 2600 + Math.random() * 1500) { lastNod = now; App.avatarConv.react(Math.random() < 0.75 ? 'nod' : 'tilt'); } },
    // sottotitolo breve della sua risposta (utile anche ad audio spento)
    caption(text) { if (!on) return; const c = $('#call-caption'); const t = String(text || '').replace(/\s+/g, ' ').trim(); c.hidden = !t || !App.ls.get('callCaptions', true); c.textContent = t.length > 160 ? '…' + t.slice(-158) : t; },
  };
  $('#call-btn').addEventListener('click', (e) => { e.stopPropagation(); start(); });
  $('#call-btn2').addEventListener('click', (e) => { e.stopPropagation(); start(); });
  $('#call-end').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  $('#call-mute').addEventListener('click', (e) => { e.stopPropagation(); muted = !muted; if (muted) App.voice.stop(); else if (SR) App.voice.start(); state(); });
  $('#call-cam').addEventListener('click', (e) => { e.stopPropagation(); toggleCam(); });
  $('#call-cc').addEventListener('click', (e) => { e.stopPropagation(); const v = !App.ls.get('callCaptions', true); App.ls.set('callCaptions', v); $('#call-cc').classList.toggle('on', v); if (!v) $('#call-caption').hidden = true; });
  $('#call-cc').classList.toggle('on', App.ls.get('callCaptions', true));
  // tocco sul viso: la interrompi (come in una vera chiamata) e torna ad ascoltarti
  ui.addEventListener('click', (e) => {
    if (e.target.closest('button,form,input,video')) return;
    if ((App.tts && App.tts.playing) || App.avatarConv.speaking) { App.voice.cancel(); App.avatarConv.stopAudio(); if (SR && !muted) setTimeout(() => App.voice.start(), 200); }
  });
  $('#call-text').addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); const i = $('#call-input'); const t = i.value.trim(); i.value = ''; if (t) App.chat.send(t); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) end(); });
})();
