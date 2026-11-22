/* call.js — v8 "Videochiamata": lei a tutto schermo (riquadro 9:16 fisso), tu parli a voce, lei risponde a voce con il labiale.
 * Ascolto continuo (riconoscimento vocale del telefono) con invio automatico; mentre lei parla l'ascolto è in pausa (niente eco).
 * Tocca il suo viso per interromperla. Fotocamera facoltativa nel riquadrino in alto (resta sul telefono, nessun video inviato). */
(function () {
  if (window.__novaCallBound) return;
  window.__novaCallBound = true;
  const stage = $('#stage'), ui = $('#call-ui');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let on = false, t0 = 0, tick = 0, prevTts = null, prevAuto = null, cam = null, muted = false, lastNod = 0, minimized = false;
  let rt = false, everVideo = false, warm = 0, connecting = false; // v8.4: conversazione in tempo reale (xAI Voice Agent)
  let starting = false, mediaOpening = false; // v2d-64: evita una seconda getUserMedia mentre l'avvio apre già microfono+camera
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
  const GREET = ['Ehi, ciao!', 'Ciao.', 'Ehi! Come va?', 'Ciao, che bello vederti!', 'Ciao {n}!']; // v2d-66: niente «eccomi» (solo se un clip è davvero visibile)
  function state() {
    if (!on) return;
    $('#call-timer').textContent = fmt(Date.now() - t0);
    if (rt) { // tempo reale: stato dalla sessione (ottimista: "sta parlando…" appena hai finito)
      const st = App.rt.status() || 'Ti ascolto…', sp = App.rt.speaking() || st === 'Sta parlando…';
      paintCallText(); $('#call-state').textContent = st;
      ui.classList.toggle('speaking', sp); ui.classList.toggle('thinking', false); ui.classList.add('rt');
      $('#call-mute').classList.toggle('off', muted); $('#call-mute').textContent = muted ? '🔇' : '🎙️';
      return;
    }
    ui.classList.remove('rt');
    const speaking = (App.tts && App.tts.playing) || App.avatarConv.speaking || (window.speechSynthesis && window.speechSynthesis.speaking);
    const micOk = (App.callMic && App.callMic.active) || (SR && App.voice.listening && App.voice.listening());
    // v8.4: appena hai finito di parlare lo stato diventa subito "sta parlando…" (la voce parte frase per frase)
    const st = connecting ? 'Collegamento…' : App.chat.busy ? 'Sta parlando…' : speaking ? 'Sta parlando…' : muted ? 'Microfono spento' : !micOk ? 'Scrivi qui sotto (o usa il 🎙️ della tastiera)' : 'Ti ascolto…';
    paintCallText();
    $('#call-state').textContent = st;
    ui.classList.toggle('speaking', !!speaking); ui.classList.toggle('thinking', !!App.chat.busy);
    $('#call-mute').classList.toggle('off', muted); $('#call-mute').textContent = muted ? '🔇' : '🎙️';
  }
  // v8.2: modalità della chiamata (si può passare da vocale a video col tasto verde, il timer continua)
  // v2d-67b: Simli non parte se un luogo è già scelto, se si usano i clip di luogo, o se esiste un pacchetto luogo pronto
  // (altrimenti setMode avviava la sessione prima di onCallStart e il volto vecchio lampeggiava).
  function locationBlocksSimli() {
    try {
      const L = App.locationCall;
      if (!L) return false;
      if (L.place && L.place()) return true;
      if (L.usingClips && L.usingClips()) return true;
      const places = L.places && L.places();
      if (Array.isArray(places) && places.some((x) => x && x.ready)) return true;
    } catch { /* location-call non pronto */ }
    return false;
  }
  function setMode(m) {
    mode = m === 'voice' ? 'voice' : 'video';
    // v2d-40: nell'app di Nova (solo-mode) la chiamata vocale resta vocale (niente fotocamera), ma lei si vede viva a tutto
    // schermo come in videochiamata: lo stage NON prende lo stile «voice» (sfondo scuro sfocato, ritratto rotondo, altezza
    // ridotta) ma «nv-voicecall», e il disegno (avatar.js, vista voce) compone clip, foto col labiale e inquadratura.
    const soloVoice = mode === 'voice' && document.body.classList.contains('solo-mode');
    stage.classList.toggle('voice', mode === 'voice' && !soloVoice); ui.classList.toggle('voice', mode === 'voice');
    stage.classList.toggle('nv-voicecall', soloVoice);
    if (App.avatarConv && App.avatarConv.setVoiceView) App.avatarConv.setVoiceView(soloVoice && on && !minimized);
    $('#call-kind').textContent = mode === 'voice' ? 'Chiamata vocale' : 'Videochiamata';
    $('#call-portrait').hidden = mode !== 'voice';
    $('#call-tovideo').hidden = mode !== 'voice'; $('#call-speaker').hidden = mode !== 'voice';
    $('#call-cam').hidden = mode === 'voice'; $('#call-cc').hidden = mode === 'voice'; $('#call-hot').hidden = mode === 'voice';
    if (mode === 'voice') { stopCam(); $('#call-caption').hidden = true; }
    else if (on && !cam && App.call && App.call.active && !starting && !mediaOpening) startCam(); // v2d-41: passando al video la fotocamera parte subito (non durante l'avvio combinato)
    paintCam();
    App.call.mode = mode; if (mode === 'video') everVideo = true;
    paintVideoToggle(); paintCallText();
    if (on && rt) App.rt.setMode(mode);
    cancelAnimationFrame(raf); if (mode === 'voice' && !soloVoice) raf = requestAnimationFrame(portrait);
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    if (on) { state(); App.chat.header && App.chat.header(); }
    // v2d-67b: un solo strato visivo — con un luogo pronto/scelto Simli non parte affatto (niente sessione prima del clip).
    const locLayer = locationBlocksSimli();
    if (App.simli) { if (on && mode === 'video' && App.me && App.me.simliFace && !locLayer) App.simli.start(); else App.simli.stop(); }
    if (App.locationCall && App.locationCall.onMode) App.locationCall.onMode(mode);
    if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
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
  // v2d-64: un nuovo avvio (tasto video) mentre una chiamata è solo ridotta (✕, spesso scambiata per riaggancio)
  // chiude prima la sessione precedente (una sola voce, una sola chat) e ne apre una nuova.
  // Se la chiamata è già a tutto schermo, non se ne avvia una seconda: al massimo si cambia modalità.
  function requestStart(m) {
    if (on && minimized) end({ silent: true });
    return start(m);
  }
  async function start(m) {
    const ch = App.current; if (!ch) return;
    if (on) { if (minimized) restore(); return setMode(m || mode); }
    if (!App.hasAi()) return App.toast('🔑 Per la videochiamata serve la chiave xAI (Impostazioni)');
    // eventuale sessione vocale rimasta da un avvio precedente o da uno script ricaricato
    if (App.rt && App.rt.live && App.rt.live()) { try { App.rt.stop(); } catch {} }
    const useRt = App.rt && App.rt.enabled();
    App.ls.set('micOn', true);
    App.audio._autoRetried = false; App.audio.micError = null;
    starting = true;
    on = true; t0 = Date.now(); muted = false; everVideo = false; rt = false; camAsked = false;
    App.call.active = true; if (App.voice.isListening && App.voice.isListening()) App.voice.stop(); // v8.4.4: niente riconoscimento vocale del telefono in chiamata (suoni di attacco/stacco)
    App.audio.callSession(true); // v8.4.1: una sola sessione audio (registra + riproduce) per tutta la chiamata
    App.audio.unlock(); // dentro il tocco: sblocca l'AudioContext condiviso (in chiamata nessun <audio>/sintesi di "riscaldamento")
    // v2d-64: in videochiamata un solo getUserMedia (microfono + camera anteriore). Niente secondo permesso, niente traccia che ne ferma un'altra.
    const mediaP = openCallMedia();
    micWatchStart();
    if (App.avatarConv) App.avatarConv.setCharacter(ch);
    App.stageFs.exit(); stage.classList.add('fs', 'call'); document.body.classList.add('avatar-fs-on', 'in-call'); if (App.fullscreenFix) App.fullscreenFix();
    document.body.classList.remove('simli-on');
    ui.hidden = false; $('#call-name').textContent = ch.name; $('#call-caption').hidden = true;
    // v2d-67b: prima si sceglie il luogo, poi setMode decide su Simli (mai /api/simli/session prima del luogo).
    const wantMode = m || 'video';
    if (App.locationCall && App.locationCall.onCallStart) App.locationCall.onCallStart(wantMode);
    setMode(wantMode);
    if (App.simli && locationBlocksSimli()) App.simli.stop();
    speaker = true; $('#call-speaker').classList.add('on'); $('#call-speaker').textContent = '🔊'; if (App.tts) App.tts.volume = 1;
    $('#act-menu').hidden = true; $('#scene-menu').hidden = true;
    prevTts = null; if (App.tts) App.tts.fails = 0; // v8.4.5: in chiamata lei parla sempre (App.voice.ttsOn() è vero in chiamata), senza toccare «Lettura»
    prevAuto = $('#auto-send').checked; $('#auto-send').checked = true;
    App.call.active = true;
    requestAnimationFrame(() => App.fitFrame && App.fitFrame());
    const greet = GREET[Math.floor(Math.random() * GREET.length)].replace('{n}', App.me.name);
    App.avatarConv.react('smile');
    clearInterval(tick); tick = setInterval(state, 250); App.chat.header && App.chat.header();
    try {
    if (useRt) { // v8.4: tempo reale (microfono e connessione partono insieme, già dentro il tocco)
      connecting = true; badge('conn'); state();
      const p = App.rt.start(ch, mode, greet);
      try { await p; if (!on) { App.rt.stop(); return; } rt = true; connecting = false; badge('rt'); state(); return; }
      catch (e) { connecting = false; if (!on) return; console.warn('Tempo reale non disponibile:', e.message); retryRt(ch, mode); if (App.audio.micError && !App.audio.micLive()) { micFail(App.audio.micError); classic(greet, 'microfono non avviato'); return; } App.toast('⚡ Tempo reale non disponibile: ' + e.message + ' · per ora chiamata classica, riprovo da sola (dettagli: Impostazioni → Diagnostica voce)', 6000); classic(greet, e.message); return; }
    }
    classic(greet, !App.hasAi() ? 'manca la chiave xAI' : App.rt && !App.rt.supported() ? 'browser non compatibile con il tempo reale' : App.rt && App.rt.classicOnly ? 'prova tecnica (solo in memoria)' : '');
    } finally { try { await mediaP; } catch {} starting = false; }
  }
  // v2d-37: se il tempo reale non si collega all'avvio, si riprova da solo e appena si collega la chiamata passa al tempo
  // reale senza toccare nulla. v2d-40: il tempo reale è SEMPRE inserito (nessuna impostazione lo spegne): la chiamata classica
  // è solo una riserva temporanea dentro la chiamata, e si continua a riprovare (2,5 s, 6 s, 12 s, poi ogni 20 s) finché la
  // chiamata è aperta, anche dopo una caduta a chiamata in corso (fallback). Un solo ciclo di tentativi per volta.
  const RT_RETRY_MS = [2500, 6000, 12000, 20000];
  let retryT = 0, retryAt = 0;
  function retryRt(ch, m, firstMs) {
    const callAt = t0; let n = 0;
    clearTimeout(retryT); retryAt = callAt;
    const go = async () => {
      retryT = 0;
      if (callAt !== t0 || retryAt !== callAt || !on || rt || !(App.rt && App.rt.enabled())) return;
      if (connecting) { retryT = setTimeout(go, 2000); return; }
      connecting = true;
      try {
        await App.rt.start(ch, mode || m, '');
        if (callAt !== t0 || !on) { App.rt.stop(); connecting = false; return; }
        if (App.callMic) App.callMic.stop(); App.voice.cancel(); micMode = ''; clearInterval(warm);
        rt = true; connecting = false; badge('rt'); micBanner(''); if (muted && App.rt.setMuted) App.rt.setMuted(true); state();
      } catch (e) { if (on && callAt === t0 && App.audio.micError && !App.audio.micLive()) micFail(App.audio.micError); connecting = false; console.warn('Tempo reale, nuovo tentativo:', e.message); if (on && callAt === t0) retryT = setTimeout(go, RT_RETRY_MS[Math.min(++n, RT_RETRY_MS.length - 1)]); }
    };
    retryT = setTimeout(go, firstMs != null ? firstMs : RT_RETRY_MS[0]);
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
  // ---------- v2d-41: microfono che parte sempre ----------
  // Prima (v2d-40) un errore del microfono veniva inghiottito: niente messaggio, nessun modo di riprovare, e il tempo reale
  // ritentava senza microfono. Ora: avviso con il motivo e cosa fare, tasto «Riprova» (nuova richiesta di permesso DENTRO il
  // tocco, audio sbloccato), e appena il microfono c'è si torna SUBITO al tempo reale. Nessuna impostazione salvata lo spegne.
  let micWatchT = 0, ctxSusp = 0;
  function micBanner(text, btn) {
    let b = $('#call-micfix');
    if (!text) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'call-micfix'; b.className = 'call-micfix'; b.setAttribute('role', 'alert');
      b.innerHTML = '<p class="cmf-text"></p><button type="button" class="cmf-btn">Riprova</button>';
      b.querySelector('.cmf-btn').addEventListener('click', (e) => { e.stopPropagation(); micRetry(); });
      ['pointerdown', 'pointerup', 'touchstart'].forEach((k) => b.addEventListener(k, (e) => e.stopPropagation()));
      ui.appendChild(b);
    }
    b.querySelector('.cmf-text').textContent = text;
    b.querySelector('.cmf-btn').textContent = btn || 'Riprova';
    b.hidden = false;
  }
  function micFail(e) {
    if (!on) return;
    console.warn('Microfono non avviato:', e && (e.name || e.message));
    micBanner('🎙️ ' + App.audio.micHelp(e));
  }
  function micOk(after) {
    if (!on) return;
    micBanner('');
    if (after !== true) return; // all'avvio ci pensano già il tempo reale e la classica
    // il microfono c'è: se la chiamata è in classica (o senza microfono) si torna SUBITO al tempo reale
    if (!rt && !connecting && App.rt && App.rt.enabled() && App.current) { clearTimeout(retryT); retryAt = 0; retryNow(App.current); }
    else if (!rt && micMode !== 'vad' && App.callMic && App.callMic.supported()) {
      App.callMic.start({ onFail: () => {} }).then(() => { if (!on || rt) { App.callMic.stop(); return; } micMode = 'vad'; if (muted) App.callMic.setMuted(true); state(); }).catch(() => {});
    }
  }
  async function micRetry() {
    if (!on) return;
    App.audio.unlock(); // dentro il tocco: audio sbloccato
    try { if (App.audio.ctx && App.audio.ctx.state !== 'running') App.audio.ctx.resume().catch(() => {}); } catch { /* */ } // senza attendere: il microfono si chiede subito, dentro il tocco (Safari)
    micBanner('🎙️ Attivo il microfono…', 'Attendi');
    try {
      App.audio._micP = null; // nuova richiesta di permesso vera, dentro il tocco
      if (!App.audio.micLive()) await App.audio.mic();
      micOk(true);
    } catch (e) { micFail(e); }
  }
  // tempo reale subito (stesso ciclo di tentativi di retryRt, primo tentativo senza attesa)
  function retryNow(ch) { retryRt(ch, mode, 0); }
  // audio del telefono rimasto in pausa (contesto nato fuori dal tocco): il microfono è «aperto» ma non sente niente
  function micWatchStart() {
    clearInterval(micWatchT); ctxSusp = 0;
    micWatchT = setInterval(() => {
      if (!on) { clearInterval(micWatchT); micWatchT = 0; return; }
      const c = App.audio.ctx;
      if (c && c.state === 'suspended') { c.resume().catch(() => {}); if (++ctxSusp === 3) micBanner('🔈 Tocca «Attiva» per far partire microfono e audio.', 'Attiva'); }
      else if (ctxSusp) { if (ctxSusp >= 3 && !App.audio.micError) micBanner(''); ctxSusp = 0; }
      // microfono perso o mai partito a chiamata in corso: lo si richiede una volta da solo, poi resta il tasto
      if (!App.audio.micLive() && !App.audio._micP && App.audio.micError && !App.audio.micDenied(App.audio.micError) && !App.audio._autoRetried) {
        App.audio._autoRetried = true; App.audio.mic().then(() => micOk(true), micFail);
      }
    }, 1000);
  }
  document.addEventListener('nova-mic-late', () => { if (on) micOk(true); });
  // ogni tocco durante la chiamata riprende l'audio se il telefono l'ha messo in pausa
  ['pointerdown', 'touchend'].forEach((k) => document.addEventListener(k, () => {
    if (!on) return; const c = App.audio.ctx; if (c && c.state !== 'running') c.resume().catch(() => {});
  }, { capture: true, passive: true }));
  function end(opts) {
    if (App.locationCall && App.locationCall.onCallEnd) App.locationCall.onCallEnd();
    if (App.callVideo && App.callVideo.onCallEnd) App.callVideo.onCallEnd();
    if (!on) return; on = false; App.call.active = false; starting = false; mediaOpening = false;
    if (App.audio) App.audio.preferCallVideo = false;
    cancelAnimationFrame(raf); clearTimeout(retryT); retryT = 0; retryAt = 0;
    micBanner(''); clearInterval(micWatchT); micWatchT = 0;
    stage.classList.remove('voice', 'nv-voicecall'); ui.classList.remove('voice'); App.call.mode = null;
    if (App.avatarConv && App.avatarConv.setVoiceView) App.avatarConv.setVoiceView(false); // v2d-40: inquadratura normale
    if (App.tts) App.tts.volume = 1;
    clearInterval(tick); clearInterval(warm); App.voice.cancel(); if (App.callMic) App.callMic.stop(); micMode = ''; badge('');
    if (rt) { App.rt.stop(); rt = false; } connecting = false; ui.classList.remove('rt');
    if (App.simli) App.simli.stop();
    App.audio.releaseMic(); // v8.4.4: il microfono si chiude solo qui, riattaccando
    App.audio.callSession(false);
    const ch = App.current, secs = Math.round((Date.now() - t0) / 1000); // v8.4: registro chiamate (scheda Chiamate)
    if (ch) App.api('/api/calls', { method: 'POST', body: { characterId: ch.id, mode: everVideo ? 'video' : 'voice', startedAt: new Date(t0).toISOString(), seconds: secs } }).catch(() => {});
    stopCam(); clearCallImg(); ui.hidden = true; stage.classList.remove('fs', 'call'); document.body.classList.remove('avatar-fs-on', 'in-call', 'call-min'); minimized = false; paintCallText();
    if (prevTts === false && App.voice.ttsOn()) $('#tts-btn').click();
    if (prevAuto !== null) $('#auto-send').checked = prevAuto;
    if (!(opts && opts.silent)) App.toast((mode === 'voice' ? '📞 Chiamata vocale terminata · ' : '📹 Videochiamata terminata · ') + fmt(Date.now() - t0));
    requestAnimationFrame(() => { App.fitFrame && App.fitFrame(); App.chat.scroll && App.chat.scroll(); }); App.chat.header && App.chat.header();
    if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
  }
  function minimize() {
    if (!on) return;
    minimized = true;
    if (App.avatarConv && App.avatarConv.setVoiceView) App.avatarConv.setVoiceView(false); // v2d-40: ridotta = vista normale
    stopCam(); // v2d-39: ✕ = camera spenta davvero (tracce fermate, anteprima tolta), si riaccende col tasto 📷
    ui.hidden = true;
    stage.classList.remove('fs');
    document.body.classList.remove('avatar-fs-on');
    document.body.classList.add('call-min');
    paintCallText();
    requestAnimationFrame(() => { App.fitFrame && App.fitFrame(); App.chat.scroll && App.chat.scroll(); });
    if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
  }
  function restore() {
    if (!on) return;
    // v2d-39: ripresa da Home/Impostazioni: prima si torna alla vista della chiamata (altrimenti restava dietro la Home, invisibile)
    if (document.body.classList.contains('solo-mode') && !document.body.classList.contains('solo-chat') && App.solo && App.solo.showChat) { try { App.solo.showChat(); } catch { /* */ } }
    minimized = false;
    ui.hidden = false;
    document.body.classList.remove('call-min');
    if (App.avatarConv && App.avatarConv.setVoiceView) App.avatarConv.setVoiceView(stage.classList.contains('nv-voicecall')); // v2d-40
    stage.classList.add('fs', 'call');
    document.body.classList.add('avatar-fs-on', 'in-call');
    paintCallText(); paintVideoToggle();
    if (App.fullscreenFix) App.fullscreenFix(); // v2d-36: a tutto schermo anche se la tastiera era aperta
    requestAnimationFrame(() => { App.fitFrame && App.fitFrame(); App.chat.scroll && App.chat.scroll(); });
    if (App.solo && App.solo.syncMotion) App.solo.syncMotion();
  }
  // v8.4.4: fotocamera nella videochiamata (anche Safari/iPhone): chiesta passando a video (getUserMedia SOLO video: il microfono
  // della chiamata resta quello, mai fermato), anteprima piccola in alto (playsinline + muted + autoplay). Se negata: istruzioni chiare.
  let camAsked = false, facing = 'user';
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
  function paintCam() {
    const b = $('#call-cam'); if (!b) return;
    const onCam = !!cam;
    b.classList.toggle('on', onCam);
    b.setAttribute('aria-pressed', onCam ? 'true' : 'false');
    const f = $('#call-flip'); if (f) f.hidden = !onCam || mode !== 'video'; // v2d-41: cambia fotocamera sempre a portata
    const hang = $('#call-hangup'); if (hang) hang.hidden = !on || minimized;
  }
  function camConstraints() {
    // facingMode anteriore, 3:4 naturale, niente ritaglio extra (evita inquadratura solo capelli/muro)
    return { facingMode: { ideal: facing || 'user' }, width: { ideal: 720 }, height: { ideal: 960 }, aspectRatio: { ideal: 0.75 } };
  }
  function attachCam(st) {
    if (!st) return;
    if (!on || mode !== 'video') { try { st.getVideoTracks().forEach((t) => t.stop()); } catch {} return; }
    cam = st;
    const v = $('#call-self');
    if (v) {
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.autoplay = true;
      v.style.objectFit = 'cover'; v.style.objectPosition = '50% 40%';
      v.srcObject = cam; v.hidden = false; v.play().catch(() => {});
    }
    paintCam();
    if (App.sight && App.sight.watch) App.sight.watch(cam);
  }
  async function openCallMedia() {
    const wantVideo = (mode === 'video');
    mediaOpening = true;
    if (App.audio) {
      App.audio.preferCallVideo = !!wantVideo;
      if (wantVideo) App.audio.videoConstraints = camConstraints();
    }
    try {
      if (wantVideo && App.audio && App.audio.adoptCombined && !App.audio.micLive() && !App.audio._micP) {
        const st = await App.audio.adoptCombined({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: camConstraints(),
        });
        if (App.audio.micLive()) micOk();
        if (on && mode === 'video' && !cam && st && st.getVideoTracks && st.getVideoTracks().length) {
          attachCam(new MediaStream(st.getVideoTracks()));
        }
        return;
      }
      if (App.audio._micP) await App.audio._micP.catch(() => {});
      if (App.audio.micLive()) micOk();
      else { await App.audio.mic(); micOk(); }
    } catch (e) { micFail(e); }
    finally { mediaOpening = false; if (App.audio) App.audio.preferCallVideo = false; }
    if (on && mode === 'video' && !cam) await startCam();
  }
  async function startCam() {
    if (cam || !on || mode !== 'video') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (mediaOpening || (App.audio && App.audio._micP)) {
      const t0 = Date.now();
      while ((mediaOpening || (App.audio && App.audio._micP)) && !cam && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 40));
      if (cam || !on || mode !== 'video') return;
    }
    camAsked = true;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: camConstraints(), audio: false });
      if (!on || mode !== 'video') { st.getVideoTracks().forEach((t) => t.stop()); return; }
      attachCam(st);
    } catch (e) { cam = null; paintCam(); if (camAsked) App.toast(camHelp(e), 6000); }
  }
  function toggleCam() { if (cam) return stopCam(); return startCam(); } // v2d-41: interruttore; in videochiamata parte accesa
  function stopCam() {
    if (App.sight && App.sight.active && App.sight.active() && App.sight.stop) App.sight.stop();
    if (cam) cam.getVideoTracks().forEach((t) => t.stop());
    cam = null;
    const v = $('#call-self'); if (v) { v.srcObject = null; v.hidden = true; }
    paintCam();
  }
  async function flipCam() {
    if (!on || mode !== 'video') return;
    facing = facing === 'user' ? 'environment' : 'user';
    if (!cam) return startCam();
    stopCam();
    await startCam();
  }

  // v2d-50: tasto video al posto della cornetta (acceso in videochiamata, spento in chiamata vocale)
  function paintVideoToggle() {
    const b = $('#call-videotoggle'); if (!b) return;
    const onVid = mode === 'video';
    b.setAttribute('aria-pressed', onVid ? 'true' : 'false');
    b.title = onVid ? 'Torna alla chiamata vocale' : 'Videochiamata';
    b.setAttribute('aria-label', b.title);
  }
  // v2d-50: riga +/testo solo in videochiamata (anche con il microfono attivo)
  function paintCallText() {
    const form = $('#call-text'); if (!form) return;
    form.hidden = true; // v2d-67: niente riga «Scrivile» sotto la videochiamata a tutto schermo
  }
  let callImg = null;
  function clearCallImg() {
    if (callImg && callImg.url) try { URL.revokeObjectURL(callImg.url); } catch {}
    callImg = null;
    const p = $('#call-att-preview');
    if (p) { p.hidden = true; p.innerHTML = ''; }
  }
  function paintCallAtt() {
    const p = $('#call-att-preview'); if (!p) return;
    p.hidden = !callImg;
    p.innerHTML = callImg ? '<img src="' + callImg.url + '" alt=""><button type="button" class="att-x" aria-label="Togli">×</button>' : '';
  }
  // copia JPEG lato lungo 1200 px, sotto il limite di /api/chats/:id/sight (base64 max 700000)
  async function smallJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Foto non leggibile')); i.src = url; });
      const w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1200 / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      let q = 0.82, out = c.toDataURL('image/jpeg', q);
      while (out.length > 680000 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
      return out;
    } finally { URL.revokeObjectURL(url); }
  }
  App.call = {
    active: false, mode: null, start, requestStart, end, setMode,
    get realtime() { return rt; },
    engine: () => (!on ? null : rt ? 'realtime' : connecting ? 'connecting' : 'classic'),
    why: () => why, micMode: () => micMode,
    // tempo reale caduto a chiamata in corso: si continua con la chiamata classica, senza chiudere
    fallback(w) { if (!on || !rt) return; App.rt.stop(); rt = false; App.toast('⚡ ' + (w || 'Tempo reale interrotto') + ': per ora chiamata classica, riprovo da sola', 5000); App.audio.callSession(true); classic(null, w || 'tempo reale interrotto'); if (App.current) retryRt(App.current, mode); }, // v2d-40: si torna al tempo reale
    get minimized() { return minimized; },
    minimize, restore,
    // mentre parli: ogni tanto annuisce (ascolto attivo), mai a raffica
    onInterim(text) { if (!on || !text) return; const now = Date.now(); if (now - lastNod > 2600 + Math.random() * 1500) { lastNod = now; App.avatarConv.react(Math.random() < 0.75 ? 'nod' : 'tilt'); } },
    // sottotitolo breve della sua risposta (utile anche ad audio spento)
    // v2d-36: Nicola: nessun sottotitolo o trascrizione sopra il video, mai. La voce resta solo audio.
    caption() { const c = $('#call-caption'); if (c) { c.hidden = true; c.textContent = ''; } },
    _captionOld(text) { if (!on || mode === 'voice') return; const c = $('#call-caption'); const t = String(text || '').replace(/\s+/g, ' ').trim(); c.hidden = !t || !App.ls.get('callCaptions', true); c.textContent = t.length > 160 ? '…' + t.slice(-158) : t; },
  };
  $('#call-btn').addEventListener('click', (e) => { e.stopPropagation(); requestStart('video'); });
  $('#call-btn2').addEventListener('click', (e) => { e.stopPropagation(); requestStart('video'); });
  const videoBtn = $('#wa-video');
  if (videoBtn) {
    let videoTap = 0;
    const openVideo = (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - videoTap < 600) return;
      videoTap = now;
      requestStart('video');
    };
    videoBtn.addEventListener('pointerup', openVideo);
    videoBtn.addEventListener('click', openVideo);
  }
  const voiceBtn = $('#wa-voice');
  if (voiceBtn) voiceBtn.addEventListener('click', (e) => { e.stopPropagation(); requestStart('voice'); });
  $('#call-tovideo').addEventListener('click', (e) => { e.stopPropagation(); setMode('video'); });
  $('#call-speaker').addEventListener('click', (e) => { e.stopPropagation(); setSpeaker(!speaker); });
  const vtg = $('#call-videotoggle');
  if (vtg) vtg.addEventListener('click', (e) => { e.stopPropagation(); if (on) setMode(mode === 'video' ? 'voice' : 'video'); });
  $('#call-hangup').addEventListener('click', (e) => { e.stopPropagation(); end(); });
  $('#call-min').addEventListener('click', (e) => { e.stopPropagation(); minimize(); });
  $('#call-mute').addEventListener('click', (e) => { e.stopPropagation(); muted = !muted; if (rt) App.rt.setMuted(muted); else if (micMode === 'vad') App.callMic.setMuted(muted); state(); }); // v8.4.4: muto via software (il microfono resta aperto)
  const eb = $('#call-badge'); if (eb) eb.addEventListener('click', (e) => { e.stopPropagation(); App.toast(eb.title || eb.textContent, 5000); });
  $('#call-cam').addEventListener('click', (e) => { e.stopPropagation(); toggleCam(); });
  const flipBtn = $('#call-flip');
  if (flipBtn) flipBtn.addEventListener('click', (e) => { e.stopPropagation(); flipCam(); });
  const selfView = $('#call-self');
  if (selfView) {
    let drag = null;
    selfView.addEventListener('pointerdown', (e) => {
      if (!cam) return;
      const r = selfView.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, l: r.left, t: r.top, moved: false };
      try { selfView.setPointerCapture(e.pointerId); } catch {}
    });
    selfView.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      selfView.style.left = Math.max(8, drag.l + dx) + 'px';
      selfView.style.top = Math.max(8, drag.t + dy) + 'px';
      selfView.style.right = 'auto';
    });
    selfView.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved; drag = null;
      if (!moved && cam) stopCam();
    });
  }
  $('#call-cc').addEventListener('click', (e) => { e.stopPropagation(); const v = !App.ls.get('callCaptions', true); App.ls.set('callCaptions', v); $('#call-cc').classList.toggle('on', v); if (!v) $('#call-caption').hidden = true; });
  $('#call-cc').classList.toggle('on', App.ls.get('callCaptions', true));
  // tocco sul viso: la interrompi (come in una vera chiamata) e torna ad ascoltarti
  ui.addEventListener('click', (e) => {
    if (e.target.closest('button,form,input,video')) return;
    if (rt) { if (App.rt.speaking()) App.rt.interrupt(); return; }
    if ((App.tts && App.tts.playing) || App.avatarConv.speaking) { App.voice.cancel(); App.avatarConv.stopAudio(); }
  });
  const attBtn = $('#call-attach');
  if (attBtn) attBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = 'image/*'; pick.hidden = true;
    pick.onchange = () => {
      const f = pick.files && pick.files[0]; pick.remove();
      if (!f || !/^image\//.test(f.type || '') && !/\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name || '')) { if (f) App.toast('Allega una foto'); return; }
      clearCallImg(); callImg = { file: f, url: URL.createObjectURL(f) }; paintCallAtt();
    };
    document.body.appendChild(pick); pick.click();
  });
  const attPrev = $('#call-att-preview');
  if (attPrev) attPrev.addEventListener('click', (e) => { const b = e.target.closest('.att-x'); if (!b) return; e.preventDefault(); e.stopPropagation(); clearCallImg(); });
  $('#call-text').addEventListener('submit', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mode !== 'video') return;
    const i = $('#call-input'); const t = i.value.trim();
    if (!t && !callImg) return;
    if (!App.rt || !App.rt.sendInstruction) { App.toast('Aspetta il collegamento…'); return; }
    let imageUrl = '';
    if (callImg) {
      try { imageUrl = await smallJpeg(callImg.file); }
      catch (err) { App.toast('Foto non leggibile'); return; }
    }
    const ok = await App.rt.sendInstruction(t, imageUrl ? { imageUrl } : {});
    if (!ok) { App.toast('Aspetta il collegamento…'); return; }
    i.value = ''; clearCallImg();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) end(); });
})();
