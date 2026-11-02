/* voice.js — comandi vocali continui (Web Speech API) e lettura delle risposte (speechSynthesis).
 * L'ascolto si riavvia da solo a ogni evento "end" finché il microfono è acceso: nessun limite di durata.
 * Mentre l'avatar parla l'ascolto è in pausa, per evitare l'eco. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, on = false, pausedForTTS = false, ttsOn = false;
  // ---- v7.3: sblocco dell'audio su iPhone ----
  // iOS Safari/PWA: la sintesi vocale e l'audio Web restano muti finché non partono la prima volta DENTRO un tocco dell'utente.
  // Le risposte arrivano dopo una richiesta di rete (fuori dal tocco), quindi senza sblocco la prima lettura veniva scartata in silenzio.
  const SS = window.speechSynthesis || null;
  let voices = [], lastSpoken = null, keep = [];
  const loadVoices = () => { try { voices = SS ? SS.getVoices() : []; } catch { voices = []; } };
  if (SS) { loadVoices(); try { SS.addEventListener('voiceschanged', loadVoices); } catch { SS.onvoiceschanged = loadVoices; } }
  const pickVoice = () => { if (!voices.length) loadVoices(); const v = voices.filter((x) => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith('it')); return v.find((x) => /female|donna|alice|elsa|federica|paola/i.test(x.name)) || v[0] || null; };
  App.audio = {
    unlocked: false, ctx: null,
    unlock() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          if (!this.ctx) this.ctx = new AC();
          if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
          const b = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource(); src.buffer = b; src.connect(this.ctx.destination); src.start(0); // buffer muto
        }
      } catch {}
      try {
        if (this.pending && SS) { // c'è una lettura bloccata: la dico subito, dentro il tocco (vale anche come sblocco)
          const t = this.pending; this.pending = null; this._warm = true; this._spokeAt = performance.now(); speakNow(t.text, { ...t.opts, sync: true });
        } else if (SS && !this._warm) { // "scalda" la sintesi vocale dentro il tocco (frase vuota a volume zero)
          const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'it-IT'; keep.push(u); if (SS.paused) SS.resume(); SS.speak(u); this._warm = true;
        }
      } catch {}
      this.unlocked = true; App.audio.hint(false);
    },
    // pillola "🔊 Tocca per attivare l'audio": visibile solo se una lettura è stata bloccata
    hint(show) { const el = document.getElementById('audio-unlock'); if (el) el.hidden = !show; },
    clipSound: () => ttsOn && App.audio.unlocked, // clip delle azioni con il loro audio solo a lettura attiva e audio sbloccato
  };
  const onGesture = () => { App.audio.unlock(); if (App.audio.unlocked && App.audio._warm) ['touchend', 'click', 'keydown'].forEach((ev) => document.removeEventListener(ev, onGesture, true)); };
  ['touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, onGesture, true));
  // Lettura effettiva: niente cancel()+speak() immediati (su iOS a volte la nuova frase viene scartata), controllo che parta davvero
  function speakNow(text, opts = {}) {
    if (!SS) return null;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'it-IT'; u.volume = 1; u.rate = 1;
    const v = pickVoice(); if (v) u.voice = v;
    let started = false; u.addEventListener('start', () => { started = true; App.audio.hint(false); });
    u.addEventListener('end', () => { keep = keep.filter((x) => x !== u); }); u.addEventListener('error', (e) => { keep = keep.filter((x) => x !== u); if (e && /not-allowed/.test(e.error || '')) { App.audio.pending = { text, opts }; App.audio.hint(true); } });
    if (opts.before) opts.before(u);
    keep.push(u); lastSpoken = { text, opts }; // riferimento tenuto: Safari a volte "perde" le frasi raccolte dalla memoria
    const go = () => { try { if (SS.paused) SS.resume(); SS.speak(u); } catch {} };
    if (SS.speaking || SS.pending) { SS.cancel(); if (opts.sync) go(); else setTimeout(go, 80); } else go(); // sync: dentro un tocco, senza ritardi
    // se dopo 2,5 s non è partita (audio bloccato), mostra "Tocca per attivare l'audio" e tienila in sospeso
    setTimeout(() => { if (!started && !SS.speaking && keep.includes(u)) { App.audio.pending = { text, opts }; App.audio.hint(true); } }, 2500);
    return u;
  }
  const status = (t) => { const el = $('#voice-status'); el.hidden = !t; el.textContent = t || ''; };
  function setBtn() {
    $('#mic-btn').classList.toggle('on', on); $('#mic-btn span').textContent = on ? 'Voce: on' : 'Voce: off';
    $('#tts-btn').classList.toggle('on', ttsOn); $('#tts-btn').firstChild.textContent = ttsOn ? '🔊 ' : '🔇 ';
    $('#tts-btn span').textContent = ttsOn ? 'Lettura: on' : 'Lettura: off';
  }
  function build() {
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const t = r[0].transcript.trim(); if (!t) continue;
          if ($('#auto-send').checked) { $('#chat-input').value = ''; App.chat.send(t); }
          else { const inp = $('#chat-input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; }
        } else interim += r[0].transcript;
      }
      status(interim ? '🎙️ ' + interim : '🎙️ In ascolto…');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; setBtn(); status('Permesso microfono negato.'); }
      else if (e.error === 'network') status('Riconoscimento vocale non raggiungibile (serve connessione).');
    };
    rec.onend = () => { if (on && !pausedForTTS) setTimeout(() => { try { rec.start(); } catch {} }, 250); }; // riavvio automatico
  }
  App.voice = {
    start() {
      if (!SR) { status('Il riconoscimento vocale non è supportato da questo browser (su iPhone il supporto è parziale). Puoi usare il microfono della tastiera.'); return; }
      if (!App.ls.get('micOn', false)) return App.toast('Attiva il microfono in Account');
      if (!rec) build();
      on = true; setBtn(); status('🎙️ In ascolto…'); try { rec.start(); } catch {}
    },
    ttsOn: () => ttsOn,
    // Frase detta dall'avatar anche con la lettura spenta (es. domanda di conferma)
    sayNow(text) {
      if (!SS) return;
      speakNow(text, { before: (u) => App.avatarConv.speakUtterance(u, text) });
    },
    stop() { on = false; setBtn(); status(''); if (rec) try { rec.stop(); } catch {} },
    speak(text) {
      if (!ttsOn || !window.speechSynthesis) return;
      const clean = text.replace(/[*_#`>~]/g, '').replace(/\p{Extended_Pictographic}/gu, '').trim(); if (!clean) return;
      speakNow(clean, { before: (u) => {
        // pausa ascolto durante la lettura (anti-eco)
        u.addEventListener('start', () => { if (on && rec) { pausedForTTS = true; try { rec.stop(); } catch {} } });
        const resume = () => { if (pausedForTTS) { pausedForTTS = false; if (on) try { rec.start(); } catch {} } };
        u.addEventListener('end', resume); u.addEventListener('error', resume);
        App.avatarConv.speakUtterance(u, clean); // labiale + gesti
        if (App.avatarPresence && !$('#presence').hidden) App.avatarPresence.speakUtterance(u, clean);
      } });
    },
  };
  $('#mic-btn').addEventListener('click', () => (on ? App.voice.stop() : App.voice.start()));
  $('#tts-btn').addEventListener('click', () => {
    ttsOn = !ttsOn; App.ls.set('tts', ttsOn); setBtn();
    if (!SS) { ttsOn = false; setBtn(); App.toast('Lettura vocale non supportata'); return; }
    if (!ttsOn) { SS.cancel(); App.audio.hint(false); App.audio.pending = null; }
    else { App.audio.unlock(); speakNow('Lettura attiva.', { sync: true }); } // conferma udibile, detta dentro il tocco (sblocca iOS)
  });
  // v7.3: lettura ACCESA di default (chi l'ha spenta a mano resta spenta). Sull'app installata (PWA) le preferenze sono separate da Safari.
  App.voice.init = () => { ttsOn = App.ls.get('tts', true) && !!SS; setBtn(); loadVoices(); };
  const au = document.getElementById('audio-unlock');
  if (au) au.addEventListener('click', (e) => { e.stopPropagation(); App.audio.unlock(); if (performance.now() - (App.audio._spokeAt || 0) > 1500 && lastSpoken && SS && !SS.speaking) { App.audio._spokeAt = performance.now(); speakNow(lastSpoken.text, { ...lastSpoken.opts, sync: true }); } });
})();
