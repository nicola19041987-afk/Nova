/* voice.js — comandi vocali continui (Web Speech API) e lettura delle risposte (speechSynthesis).
 * L'ascolto si riavvia da solo a ogni evento "end" finché il microfono è acceso: nessun limite di durata.
 * Mentre l'avatar parla l'ascolto è in pausa, per evitare l'eco. */
(function () {
  const speechRec = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  let xMode = false, xFailed = false; // v8.4.5: modalità voce con trascrizione xAI
  let rec = null, on = false, pausedForTTS = false, ttsOn = false, composerOnly = false;
  let lastResAt = 0, eosT = 0, early = ''; // v8.4: fine del parlato anticipata (chiamate)
  let ignoreUntil = 0; // v8.4.1: in chiamata il riconoscimento NON si ferma mentre lei parla (niente bip di iOS): i risultati vengono ignorati
  const inCall = () => !!(App.call && App.call.active);
  // v8.4.5: microfono aperto (chiamata o modalità voce con trascrizione xAI): la voce passa SOLO dall'AudioContext condiviso
  const live = () => inCall() || xMode;
  // v8.4.5: in chiamata lei parla SEMPRE a voce, a prescindere dall'interruttore «Lettura» della chat
  const speakOn = () => true; // v8.6.0: parla sempre (mai silenziosa)
  const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\d ]+/gu, '').replace(/\s+/g, ' ').trim();
  // ---- v7.3: sblocco dell'audio su iPhone ----
  // iOS Safari/PWA: la sintesi vocale e l'audio Web restano muti finché non partono la prima volta DENTRO un tocco dell'utente.
  // Le risposte arrivano dopo una richiesta di rete (fuori dal tocco), quindi senza sblocco la prima lettura veniva scartata in silenzio.
  const SS = window.speechSynthesis || null;
  let voices = [], lastSpoken = null, keep = [];
  const loadVoices = () => { try { voices = SS ? SS.getVoices() : []; } catch { voices = []; } };
  if (SS) { loadVoices(); try { SS.addEventListener('voiceschanged', loadVoices); } catch { SS.onvoiceschanged = loadVoices; } }
  const pickVoice = () => { if (!voices.length) loadVoices(); const v = voices.filter((x) => x.lang && x.lang.toLowerCase().replace('_', '-').startsWith('it')); return v.find((x) => /female|donna|alice|elsa|federica|paola/i.test(x.name)) || v[0] || null; };
  App.audio = {
    unlocked: false, ctx: null, inCall: false, _born: null,
    // v2d-37: livello REALE della voce in uscita (non una stima dal testo): bus gain -> analizzatore -> altoparlante sullo stesso
    // AudioContext della chiamata, più l'inviluppo del buffer che sta suonando (Safari spesso lascia l'analizzatore a zero).
    _bus: null, _cur: null,
    bus(c) {
      if (this._bus && this._bus.c === c) return this._bus.g;
      const g = c.createGain(), an = c.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.1; g.connect(an); an.connect(c.destination);
      this._bus = { c, g, an, td: new Float32Array(an.fftSize) }; return g;
    },
    classicActive() { const k = this._cur, c = this.ctx; if (!k || !c || k.h.el.ended) return false; const n = c.currentTime; return n >= k.t0 - 0.005 && n <= k.end + 0.01; },
    classicLevel() {
      if (!this.classicActive()) return 0;
      const k = this._cur, c = this.ctx, n = c.currentTime; if (n < k.t0) return 0;
      let v = -1; if (k.env && k.env.length) { const i = Math.floor((n - k.t0) * 60); v = i >= 0 && i < k.env.length ? k.env[i] : 0; }
      const b = this._bus; let r = 0;
      if (b && b.c === c) { try { b.an.getFloatTimeDomainData(b.td); let e = 0; for (let i = 0; i < b.td.length; i++) e += b.td[i] * b.td[i]; r = Math.min(1, Math.sqrt(e / b.td.length) * 5); } catch {} }
      return v < 0 ? (r > 0 ? r : 0.5) : Math.max(v, r);
    },
    // v8.4.1: per tutta la chiamata una sola sessione audio iOS "play-and-record" (microfono + voce insieme): cambiarla a ogni frase
    // faceva sentire il "suono di attacco e stacco". A chiamata finita si torna a "playback" (suona anche col tasto silenzioso).
    callSession(on) { this.inCall = !!on; if (!on) this._reacq = false; try { if (navigator.audioSession) navigator.audioSession.type = (on || this.micLive() || this._micP || (App.micAnyLive && App.micAnyLive())) ? 'play-and-record' : 'playback'; } catch {} }, // v8.5.0: mai 'playback' col microfono aperto
    // v8.4.4: UN solo microfono per tutta la chiamata (vocale e video, tempo reale e classica): un solo getUserMedia, mai fermato
    // fra un turno e l'altro né passando da vocale a video; si chiude solo riattaccando (releaseMic). Su iPhone ogni start/stop
    // del microfono è il "suono di attacco e stacco". Se il sistema lo chiude da solo (traccia «ended»), lo si riapre e si avvisa chi ascolta.
    _mic: null, _micP: null, _micL: new Set(), micStats: { gum: 0, stops: 0, lost: 0 },
    micLive() { const s = this._mic; return !!(s && s.getAudioTracks().some((t) => t.readyState === 'live')); },
    // v2d-41 (Luisa: «il microfono non parte»): l'errore del microfono non si inghiotte più. Una richiesta di permesso rimasta
    // appesa (nessuna risposta del sistema) non blocca per sempre i tentativi successivi (tempo massimo), i vincoli audio troppo
    // stretti o il microfono occupato si riprovano con {audio:true} liberando il microfono «di prova» dell'avvio, e l'ultimo
    // errore resta leggibile (micError) per il messaggio di aiuto e il tasto «Riprova» in chiamata.
    micError: null,
    micHelp(e) {
      const n = (e && e.name) || '';
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const android = /Android/i.test(navigator.userAgent);
      if (!window.isSecureContext) return 'Il microfono funziona solo con la connessione sicura (https).';
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') {
        if (ios) return 'Microfono bloccato. Su iPhone: Impostazioni → Safari → Microfono → Consenti (o «aA» nella barra → Impostazioni sito → Microfono), poi tocca «Riprova».';
        if (android) return 'Microfono bloccato. Su Android: tocca il lucchetto accanto all\'indirizzo → Autorizzazioni → Microfono → Consenti, poi tocca «Riprova».';
        return 'Microfono bloccato. Consenti il microfono per questo sito, poi tocca «Riprova».';
      }
      if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Nessun microfono trovato su questo telefono.';
      if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'Il microfono è occupato da un\'altra app (chiamata, WhatsApp, registratore). Chiudila e tocca «Riprova».';
      if (n === 'TimeoutError') return 'Il telefono non ha risposto alla richiesta del microfono. Tocca «Riprova» e, se compare, scegli «Consenti».';
      return 'Microfono non avviato' + (e && e.message ? ' (' + e.message + ')' : '') + '. Tocca «Riprova».';
    },
    // «Consenti» toccato dopo il tempo massimo: il microfono arrivato in ritardo non si butta, diventa quello della chiamata
    adoptLate(st) {
      if (!st) return;
      if (this.micLive() || !(this.inCall || (App.call && App.call.active))) { try { st.getTracks().forEach((x) => x.stop()); } catch { /* */ } return; }
      this._mic = st; this.micError = null; this.micStats.late = (this.micStats.late || 0) + 1;
      st.getAudioTracks().forEach((t) => { t.onended = () => { if (this._mic !== st) return; this._mic = null; this.micStats.lost++; if (this.inCall) this._micL.forEach((f) => { try { f(); } catch {} }); }; });
      try { document.dispatchEvent(new CustomEvent('nova-mic-late')); } catch { /* */ }
    },
    micDenied(e) { const n = (e && e.name) || ''; return n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError'; },
    async mic() {
      if (this.micLive()) return this._mic;
      if (this._micP) {
        // una richiesta appesa da più di 15 s (permesso mai risposto) non deve bloccare il nuovo tentativo
        if (this._micPAt && performance.now() - this._micPAt > 15000) { this._micP = null; this.micStats.stale = (this.micStats.stale || 0) + 1; }
        else return this._micP;
      }
      this.micStats.gum++;
      // v8.4.7 (iPhone): la sessione audio diventa 'play-and-record' UNA volta, PRIMA del microfono. Un AudioContext nato in
      // 'playback' (sblocco audio) dopo il cambio di sessione riceve solo silenzio (livello 0,1%): lo si ricrea DOPO getUserMedia.
      let prevType = null;
      try { if (navigator.audioSession) { prevType = navigator.audioSession.type; if (prevType !== 'play-and-record') navigator.audioSession.type = 'play-and-record'; } } catch { /* */ }
      this.micStats.session = prevType;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error('microfono non disponibile su questo browser'); e.name = window.isSecureContext ? 'NotFoundError' : 'SecurityError'; this.micError = e; return Promise.reject(e); }
      const md = navigator.mediaDevices;
      const withTimeout = (p, ms) => new Promise((ok, ko) => { let done = false; const t = setTimeout(() => { if (done) return; done = true; const e = new Error('nessuna risposta dal microfono'); e.name = 'TimeoutError'; ko(e); }, ms); p.then((v) => { if (done) { this.adoptLate(v); return; } done = true; clearTimeout(t); ok(v); }, (e) => { if (done) return; done = true; clearTimeout(t); ko(e); }); });
      const dropPrime = () => { const pr = App._micPrime; App._micPrime = null; if (pr && pr !== this._mic) try { pr.getTracks().forEach((t) => t.stop()); } catch { /* */ } };
      const ask = async () => {
        try { return await withTimeout(md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }), 9000); }
        catch (e) {
          if (this.micDenied(e)) throw e; // permesso negato: un nuovo tentativo senza tocco non servirebbe
          // microfono occupato (anche dal microfono «di prova» dell'avvio), vincoli non accettati o richiesta appesa: un secondo tentativo semplice
          this.micStats.retry = (this.micStats.retry || 0) + 1; this.micStats.firstErr = (e && e.name) || 'errore';
          dropPrime();
          return await withTimeout(md.getUserMedia({ audio: true }), 6000);
        }
      };
      this._micPAt = performance.now();
      const P = this._micP = ask()
        .then((st) => {
          this.micError = null;
          // Il contesto nato in 'playback' (lo sblocco del tocco arriva prima della sessione) su iPhone riceve solo silenzio.
          if (navigator.audioSession && this.ctx && (prevType !== 'play-and-record' || this._born !== 'play-and-record')) this.renewCtx(prevType !== 'play-and-record' ? 'sessione cambiata' : 'contesto nato prima del microfono');
          this._mic = st;
          st.getAudioTracks().forEach((t) => { t.onmute = () => { this.micStats.muted = (this.micStats.muted || 0) + 1; }; });
          st.getAudioTracks().forEach((t) => { t.onended = () => { if (this._mic !== st) return; this._mic = null; this.micStats.lost++; if (this.inCall) this._micL.forEach((f) => { try { f(); } catch {} }); }; });
          return st;
        }, (e) => { this.micError = e || new Error('microfono non avviato'); this.micStats.lastErr = (e && e.name) || 'errore'; throw this.micError; })
        .finally(() => { if (this._micP === P) { this._micP = null; this._micPAt = 0; } });
      return P;
    },
    // v8.4.7: nuovo AudioContext (dopo il microfono, con la sessione giusta); chi lo usa lo rilegge da App.audio.ctx
    renewCtx(why) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      const old = this.ctx; this.ctx = new AC(); this.ctx.resume().catch(() => {}); this.noteCtx(); this.micStats.renew = (this.micStats.renew || 0) + 1; this.micStats.renewWhy = why;
      if (old) setTimeout(() => { try { old.close(); } catch { /* */ } }, 300);
      return this.ctx;
    },
    // v8.4.7: microfono «muto» (traccia muted, o livello quasi zero): lo si riapre UNA volta con un contesto audio nuovo
    async reacquire(why) {
      if (this._reacq) return this._mic; this._reacq = true; this.micStats.reacq = (this.micStats.reacq || 0) + 1; this.micStats.reacqWhy = why;
      const old = this._mic; this._mic = null;
      if (old) old.getTracks().forEach((t) => { try { t.stop(); } catch { /* */ } });
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* */ }
      const st = await this.mic(); this.renewCtx('microfono riaperto');
      this._micL.forEach((f) => { try { f(); } catch { /* */ } });
      return st;
    },
    noteCtx() { try { this._born = (navigator.audioSession && navigator.audioSession.type) || 'none'; } catch { this._born = 'none'; } },
    onMicLost(f) { this._micL.add(f); return () => this._micL.delete(f); },
    releaseMic() { const s = this._mic; this._mic = null; this._micL.clear(); if (s) s.getTracks().forEach((t) => { this.micStats.stops++; t.onended = null; t.stop(); }); },
    unlock() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
          if (!this.ctx) { this.ctx = new AC(); this.noteCtx(); }
          if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
          const b = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource(); src.buffer = b; src.connect(this.ctx.destination); src.start(0); // buffer muto
        }
      } catch {}
      try { if (!this.inCall && !this.micLive() && !this._micP && !App.micOpen && !(App.micAnyLive && App.micAnyLive()) && navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch {} // iOS 17+: suona anche col tasto silenzioso (mai durante una chiamata)
      if (this.inCall) { this.unlocked = true; App.audio.hint(false); return; } // v8.4.4: in chiamata solo l'AudioContext condiviso
      try {
        const a = NX.audio();
        if (this.pending && this.pending.resume) { const p = this.pending; this.pending = null; this._warm = true; this._spokeAt = performance.now(); p.resume(); }
        else if (!NX.blessed && !NX.playing) { a.src = SILENT_WAV; const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); }
        NX.blessed = true;
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
    clipSound: () => ttsOn && App.audio.unlocked && !live(), // v8.4.5: mai clip con audio a microfono aperto (cambio di sessione su iPhone) // clip delle azioni con il loro audio solo a lettura attiva e audio sbloccato
  };
  // ---- v8: voce naturale xAI (Text to Speech) ----
  // Le frasi arrivano mentre la risposta viene scritta: la prima si sente dopo pochi istanti, le altre sono già pronte in coda.
  // Un solo elemento <audio>, "sbloccato" al primo tocco: su iPhone suona anche col tasto silenzioso, senza nuovi tocchi.
  // Se la voce xAI non è disponibile (chiave, rete, credito) si torna in automatico alla voce del telefono.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
  function cleanTTS(t) {
    return String(t || '').replace(/\[(?:azione|action|gesto|umore)[^\]]*\]/gi, ' ').replace(/\[[^\]]{12,}\]/g, ' ')
      .replace(/\*[^*\n]{1,200}\*/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[_#`>~*|]/g, '')
      .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, '').replace(/\b(?:a?h[ae]h[ae]h?[ah]*|ahah\w*)\b/gi, '[laugh]')
      .replace(/\s+/g, ' ').trim();
  }
  async function envelope(blob) { // inviluppo RMS a 60 punti/s per il labiale
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const ctx = App.audio.ctx || (App.audio.ctx = new AC());
    const ab = await blob.arrayBuffer();
    const buf = await new Promise((ok, ko) => { try { const p = ctx.decodeAudioData(ab, ok, ko); if (p && p.then) p.then(ok, ko); } catch (e) { ko(e); } });
    const d = buf.getChannelData(0), win = Math.max(1, Math.floor(buf.sampleRate / 60)), n = Math.ceil(d.length / win), env = new Float32Array(n);
    let mx = 0;
    for (let i = 0; i < n; i++) { let s2 = 0; const e = Math.min(d.length, (i + 1) * win); for (let k = i * win; k < e; k += 2) s2 += d[k] * d[k]; env[i] = Math.sqrt(s2 / Math.max(1, (e - i * win) / 2)); if (env[i] > mx) mx = env[i]; }
    if (mx > 0) for (let i = 0; i < n; i++) { const v = env[i] / (mx * 0.75); env[i] = v < 0.06 ? 0 : Math.min(1, Math.pow(v, 0.8)); }
    return { env, buf }; // v8.4.1: in chiamata la frase si suona dal buffer già decodificato (stesso AudioContext, dissolvenze)
  }
  // v8.4.1: riproduzione in chiamata sull'AudioContext unico, con dissolvenza in entrata/uscita (niente click, niente cambi di sessione)
  function playBuffer(buf, vol) {
    const c = App.audio.ctx; if (c.state !== 'running') c.resume().catch(() => {});
    const g = c.createGain(), src = c.createBufferSource(); src.buffer = buf; src.connect(g); g.connect(App.audio.bus ? App.audio.bus(c) : c.destination); // v2d-37: voce della chiamata sul bus con analizzatore
    const t = c.currentTime + 0.02, end = t + buf.duration, gg = g.gain;
    gg.setValueAtTime(0, t); gg.linearRampToValueAtTime(vol, t + 0.012); gg.setValueAtTime(vol, Math.max(t + 0.013, end - 0.018)); gg.linearRampToValueAtTime(0, end);
    src.start(t);
    if (App.simli && App.simli.feedBuffer) App.simli.feedBuffer(buf);
    const el = { get currentTime() { return Math.max(0, c.currentTime - t); }, paused: false, ended: false }; // per il labiale (come un <audio>)
    const h = { src, g, el, t0: t, stop() { if (el.ended) return; el.ended = true; const n = c.currentTime; try { gg.cancelScheduledValues(n); gg.setValueAtTime(gg.value, n); gg.linearRampToValueAtTime(0, n + 0.03); src.onended = null; src.stop(n + 0.035); } catch {} } };
    App.audio._cur = { t0: t, end, h, env: null }; // v2d-37: la frase che sta suonando davvero (orologio audio)
    return h;
  }
  const NX = {
    el: null, q: [], playing: null, buf: '', streaming: false, sent: 0, gen: 0, fails: 0, cache: new Map(), devBuf: '', degraded: false, blessed: false,
    enabled() { return App.ls.get('voiceEngine', 'xai') === 'xai' && !!(App.hasAi && App.hasAi()) && this.fails < 3; },
    voice() { return App.xaiVoice ? App.xaiVoice(App.current) : 'eve'; },
    speed() { const c = App.current; if (c && Number.isFinite(c.voiceSpeed) && c.voiceSpeed) return c.voiceSpeed; return Number(App.ls.get('ttsSpeed', 1)) || 1; }, // v8.5.0: velocità del personaggio
    audio() { if (!this.el) { const a = new Audio(); a.preload = 'auto'; a.setAttribute('playsinline', ''); this.el = a; } return this.el; },
    stop() {
      this.gen++; this.q = []; this.buf = ''; this.streaming = false; this.sent = 0; this.devBuf = ''; this.degraded = false;
      if (this.playing && this.el && !this.el.paused) { try { this.el.pause(); } catch {} } // v8.4.5: nessun pause() inutile
      if (this.wa) { this.wa.stop(); this.wa = null; }
      this.playing = null; this.done();
    },
    begin() { this.stop(); this.streaming = true; },
    feed(delta) { this.buf += delta; this.split(false); },
    end() { this.split(true); this.streaming = false; if (this.degraded && this.devBuf) { const t = this.devBuf; this.devBuf = ''; speakDevice(t); } },
    say(text) { this.begin(); this.feed(text); this.end(); },
    split(force) { // frasi intere; la prima corta (si sente subito), le altre più lunghe (meno richieste, intonazione migliore)
      const re = /[.!?…]+["»”')]*\s+|\n+/g; let m, last = 0, acc = '';
      while ((m = re.exec(this.buf))) { acc += this.buf.slice(last, m.index + m[0].length); last = m.index + m[0].length; if (acc.trim().length >= (this.sent === 0 ? 8 : 60)) { this.enqueue(acc); acc = ''; } }
      this.buf = acc + this.buf.slice(last);
      // v8.4: la prima frase parte anche a una virgola (dopo ~5 parole), così la voce inizia prima
      if (!force && this.sent === 0) { const c = this.buf.search(/[,;:]\s/); if (c >= 14 && c < 160) { this.enqueue(this.buf.slice(0, c + 1)); this.buf = this.buf.slice(c + 2); } }
      if (!force && this.buf.length > 420) { const cut = Math.max(this.buf.lastIndexOf(', ', 400), this.buf.lastIndexOf(' ', 400)); if (cut > 40) { this.enqueue(this.buf.slice(0, cut + 1)); this.buf = this.buf.slice(cut + 1); } }
      if (force && this.buf.trim()) { this.enqueue(this.buf); this.buf = ''; }
    },
    enqueue(text) {
      const t = cleanTTS(text); if (!t || !/[\p{L}\d]/u.test(t)) return;
      this.sent++;
      if (this.degraded) { this.devBuf += ' ' + t; return; }
      const item = { text: t, gen: this.gen }; item.p = this.fetch(t); item.p.catch(() => {});
      this.q.push(item); if (!this.playing) this.next();
    },
    async fetch(t) {
      const key = this.voice() + '|' + this.speed() + '|' + t;
      if (this.cache.has(key)) { const c = this.cache.get(key); this.cache.delete(key); this.cache.set(key, c); return c; }
      const r = await App.api('/api/tts', { method: 'POST', body: { text: t, voice: this.voice(), speed: this.speed(), voiceExplicit: !!(App.xaiVoiceExplicit && App.xaiVoiceExplicit(App.current)) }, ai: true, raw: true });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || (r.status === 422 ? 'Richiesta voce non accettata (422)' : 'Errore ' + r.status)); e.status = r.status; e.call = j.call; e.upstream = j.status; e.detail = j.detail; throw e; }
      const blob = await r.blob();
      if (!blob.size) throw new Error('Audio vuoto');
      const e = await envelope(blob).catch(() => null);
      const res = { url: URL.createObjectURL(blob), env: e && e.env, buf: e && e.buf, blob };
      this.cache.set(key, res);
      while (this.cache.size > 40) { const [k, v] = this.cache.entries().next().value; this.cache.delete(k); if (!this.playing || this.playing.res !== v) URL.revokeObjectURL(v.url); }
      return res;
    },
    async next() {
      const item = this.q.shift();
      if (!item) { this.playing = null; this.done(); return; }
      this.playing = item; let res;
      try { res = await item.p; } catch (e) { if (item.gen === this.gen) this.fail(e, item); return; }
      if (item.gen !== this.gen) return;
      this.fails = 0; item.res = res;
      // v8.4.5: con il microfono aperto MAI un elemento <audio> (su iPhone ogni play/fine cambia la sessione audio = "suono di
      // attacco e stacco"): la frase si decodifica e si suona sull'AudioContext condiviso; se non si decodifica, si riprova a scaricarla
      if (live() && !res.buf) { try { const e2 = await envelope(res.blob); if (e2) { res.buf = e2.buf; res.env = res.env || e2.env; } } catch (er) { console.warn('Voce: audio non decodificabile', er); } if (item.gen !== this.gen) return; }
      if (live() && !res.buf) { this.fail(new Error('audio non decodificabile'), item); return; }
      if (live() && res.buf) { if (!App.audio.ctx) { const AC = window.AudioContext || window.webkitAudioContext; App.audio.ctx = new AC(); }
        if (!this.lipsOn) { const avs = [App.avatarConv, App.avatarPresence].filter((x) => x && x.breathM); avs.forEach((x) => x.breathM.preInhale(performance.now())); if (avs.length) { await new Promise((r) => setTimeout(r, 60)); if (item.gen !== this.gen) return; } }
        const h = this.wa = playBuffer(res.buf, NX.volume == null ? 1 : NX.volume);
        if (App.audio._cur && App.audio._cur.h === h) App.audio._cur.env = res.env || null;
        App.audio.unlocked = true; this.lips(h.el, res.env, item.text); pauseRec();
        if (App.latency && App.latency.mark) { const ms = performance.now() + (h.t0 - App.audio.ctx.currentTime) * 1000 - App.latency.mark; App.latency.mark = 0; if (ms > 0 && ms < 30000) App.latency.add('classica', ms); }
        h.src.onended = () => { h.el.ended = true; if (this.wa === h) this.wa = null; if (item.gen === this.gen) this.next(); };
        return;
      }
      const a = this.audio();
      a.onended = () => { if (item.gen === this.gen) this.next(); };
      a.onerror = () => { if (item.gen === this.gen && a.src === res.url) this.next(); };
      a.onplaying = () => { App.audio.hint(false); App.audio.unlocked = true; this.lips(a, res.env, item.text); pauseRec(); if (App.latency && App.latency.mark) { const ms = performance.now() - App.latency.mark; App.latency.mark = 0; if (ms > 0 && ms < 30000) App.latency.add('classica', ms); } };
      a.src = res.url; try { a.volume = NX.volume == null ? 1 : NX.volume; } catch {} // v8.2: altoparlante in chiamata vocale
      if (!this.lipsOn) { // v8.1: prima della prima frase prende fiato (bocca appena socchiusa), come una persona vera
        const avs = [App.avatarConv, App.avatarPresence].filter((x) => x && x.breathM);
        avs.forEach((x) => x.breathM.preInhale(performance.now()));
        if (avs.length) { await new Promise((r) => setTimeout(r, App.call && App.call.active ? 90 : 300)); if (item.gen !== this.gen) return; } // in chiamata: respiro più breve
      }
      try { await a.play(); } catch (e) {
        if (item.gen !== this.gen) return;
        if (e && e.name === 'NotAllowedError') { this.q.unshift(item); this.playing = null; App.audio.pending = { resume: () => { if (!this.playing) this.next(); } }; App.audio.hint(true); }
        else this.next();
      }
    },
    lips(a, env, text) {
      this.lipsOn = true; { const st = document.getElementById('stage'); if (st) st.classList.add('speaking'); } // v8.4.5: movimento CSS anche se il canvas è fermo
      App.avatarConv && App.avatarConv.speakAudio(a, env, text);
      if (App.avatarPresence && !$('#presence').hidden) App.avatarPresence.speakAudio(a, env, text);
    },
    done() {
      if (this.lipsOn) { this.lipsOn = false; { const st = document.getElementById('stage'); if (st) st.classList.remove('speaking'); } App.avatarConv && App.avatarConv.stopAudio(); if (App.avatarPresence) App.avatarPresence.stopAudio(); }
      resumeRec();
    },
    fail(e, item) {
      if (live() && item && !item.retried) { // v8.4.5: in chiamata un secondo tentativo prima di cambiare voce
        item.retried = true; item.p = (async () => { this.cache.forEach((v, k) => { if (k.endsWith('|' + item.text)) this.cache.delete(k); }); return this.fetch(item.text); })(); item.p.catch(() => {});
        this.q.unshift(item); this.playing = null; this.next(); return;
      }
      this.fails++; console.warn('Voce xAI non disponibile:', e.message);
      if (!this._warned || performance.now() - this._warned > 60000) { this._warned = performance.now(); App.toast('🔈 Voce naturale non disponibile (' + e.message + '): uso la voce del telefono', 4500); }
      this.devBuf = [item.text, ...this.q.map((x) => x.text)].join(' '); this.q = []; this.playing = null; this.degraded = true; this.done();
      if (!this.streaming) { const t = this.devBuf; this.devBuf = ''; speakDevice(t); }
    },
  };
  App.tts = NX;
  // anti-eco: il riconoscimento vocale va in pausa mentre l'avatar parla
  function pauseRec() { if (on && rec && !pausedForTTS) { pausedForTTS = true; if (!inCall()) try { rec.stop(); } catch {} } } // in chiamata: niente stop (bip)
  function resumeRec() { if (pausedForTTS) { pausedForTTS = false; ignoreUntil = performance.now() + 400; if (on && !inCall()) try { rec.start(); } catch {} } }
  function speakDevice(clean) {
    if (!SS || !clean) return;
    speakNow(clean, { before: (u) => {
      u.addEventListener('start', pauseRec); u.addEventListener('end', resumeRec); u.addEventListener('error', resumeRec);
      App.avatarConv.speakUtterance(u, clean); // labiale + gesti
      if (App.avatarPresence && !$('#presence').hidden) App.avatarPresence.speakUtterance(u, clean);
    } });
  }
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
    { // v8.4.5: pillola sempre visibile sull'avatar (anche a schermo intero) con il percorso della voce in uso
      const st = document.getElementById('stage'); let p = document.getElementById('stage-voice');
      if (st && !p) { p = document.createElement('div'); p.id = 'stage-voice'; p.className = 'stage-voice'; p.hidden = true; st.appendChild(p); }
      if (p) { p.hidden = !on; p.dataset.kind = xMode ? 'xai' : 'sr'; p.textContent = xMode ? '🎙️ Voce · trascrizione xAI' : '🎙️ Voce · riconoscimento del telefono'; p.title = 'Per risposte più rapide usa la chiamata (⚡ Tempo reale)'; }
    }
    $('#mic-btn').classList.toggle('on', on); $('#mic-btn span').textContent = on ? 'Voce: on' : 'Voce: off';
    $('#tts-btn').classList.toggle('on', ttsOn); $('#tts-btn').firstChild.textContent = ttsOn ? '🔊 ' : '🔇 ';
    $('#tts-btn span').textContent = ttsOn ? 'Lettura: on' : 'Lettura: off';
  }
  function build() {
    rec = new (speechRec())(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      if (inCall() && (pausedForTTS || performance.now() < ignoreUntil)) return; // è la sua voce (eco), non la tua
      let interim = ''; lastResAt = performance.now(); clearTimeout(eosT);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          let t = r[0].transcript.trim(); if (!t) continue;
          if (early) { // v8.4: già inviato in anticipo dopo 600 ms di silenzio: manda solo l'eventuale parte nuova
            const a = norm(early), b = norm(t), nw = early.split(/\s+/).length; early = '';
            if (b === a || a.startsWith(b)) continue;
            if (b.startsWith(a)) { t = t.split(/\s+/).slice(nw).join(' ').trim(); if (!t) continue; }
          }
          if (App.latency) App.latency.mark = App.latency.mark || lastResAt;
          if (composerOnly) putComposer(t);
          else if ($('#auto-send').checked) { $('#chat-input').value = ''; App.chat.send(t); }
          else { const inp = $('#chat-input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; }
        } else interim += r[0].transcript;
      }
      status(interim ? '🎙️ ' + interim : '🎙️ In ascolto…');
      if (interim && App.call) App.call.onInterim(interim); // v8: annuisce mentre parli (videochiamata)
      // v8.4: fine del parlato più rapida in chiamata: ~600 ms senza nuove parole = turno finito (non si aspetta il "final" del browser)
      if (!composerOnly && interim.trim() && App.call && App.call.active && $('#auto-send').checked) {
        const snap = interim.trim(), at = lastResAt;
        eosT = setTimeout(() => { if (!on || lastResAt !== at || App.chat.busy) return; early = snap; if (App.latency) App.latency.mark = at; $('#chat-input').value = ''; App.chat.send(snap); }, 600);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; setBtn(); status('Permesso microfono negato.'); }
      else if (e.error === 'network') status('Riconoscimento vocale non raggiungibile (serve connessione).');
    };
    rec.onend = () => { if (on && (!pausedForTTS || inCall())) setTimeout(() => { try { rec.start(); } catch {} }, inCall() ? 0 : 250); }; // riavvio automatico
  }
  function putComposer(t) {
    const inp = $('#chat-input'); if (!inp || !t) return;
    inp.value = (inp.value ? inp.value + ' ' : '') + t;
    try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    if (App.gestures && App.gestures.hear) App.gestures.hear(t);
  }
  App.voice = {
    start(opts = {}) {
      composerOnly = !!(opts && opts.composer);
      const allow = composerOnly || App.ls.get('micOn', true);
      // v8.4.5: con la chiave xAI la modalità voce (fuori chiamata) usa il NOSTRO microfono + trascrizione xAI in italiano
      // (stesso rilevatore del parlato della chiamata): niente riconoscimento di Safari, che su iPhone capiva parole a caso
      // ("Foglia", "Gatto") e faceva il "bip" a ogni riavvio. Il riconoscimento del telefono resta solo come riserva.
      if (App.hasAi && App.hasAi() && App.callMic && App.callMic.supported() && !xFailed && !(App.call && App.call.active)) {
        if (!allow) return App.toast('Attiva il microfono in Impostazioni');
        App.audio.callSession(true); // prima dello sblocco: il contesto non deve nascere in «playback»
        try { App.audio.unlock(); } catch {}
        on = true; xMode = true; setBtn(); status(composerOnly ? '🎙️ Dettato…' : '🎙️ In ascolto… (trascrizione xAI)'); document.body.classList.add('voice-live');
        const onText = (t) => { if (!on) return; status(composerOnly ? '🎙️ Dettato…' : '🎙️ In ascolto… (trascrizione xAI)'); if (composerOnly) putComposer(t); else if ($('#auto-send').checked) { $('#chat-input').value = ''; App.chat.send(t); } else { const inp = $('#chat-input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; } };
        const onFail = (e) => { console.warn('Trascrizione xAI non disponibile, uso il riconoscimento del telefono:', e && e.message); xFailed = true; App.callMic.stop(); xMode = false; if (!(App.call && App.call.active)) App.audio.callSession(false); if (on) { const keep = composerOnly; on = false; App.voice.start(keep ? { composer: true } : undefined); } };
        App.callMic.start({ onText, onFail, noBarge: true, onState: (st) => { if (on && xMode) status(st === 'speech' ? '🎙️ Ti ascolto…' : '🎙️ In ascolto… (trascrizione xAI)'); } }).catch((e) => { if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { on = false; xMode = false; setBtn(); status('Permesso microfono negato.'); document.body.classList.remove('voice-live'); } else onFail(e); });
        return;
      }
      if (!speechRec()) { composerOnly = false; status('Il riconoscimento vocale non è supportato da questo browser (su iPhone il supporto è parziale). Puoi usare il microfono della tastiera.'); return; }
      if (!allow) return App.toast('Attiva il microfono in Impostazioni');
      if (!rec) build();
      on = true; setBtn(); status('🎙️ In ascolto…'); try { rec.start(); } catch {}
    },
    ttsOn: () => speakOn(), // v8.4.5: in chiamata sempre vero (lei parla a voce anche con «Lettura: off»)
    readOn: () => ttsOn,
    listening: () => on && !!rec,
    // Frase detta dall'avatar anche con la lettura spenta (es. domanda di conferma)
    sayNow(text) {
      if (NX.enabled()) { if (SS && (SS.speaking || SS.pending)) SS.cancel(); NX.say(text); return; }
      if (!SS) return;
      speakNow(text, { before: (u) => App.avatarConv.speakUtterance(u, text) });
    },
    stop() {
      on = false; composerOnly = false; setBtn(); status(''); document.body.classList.remove('voice-live'); if (rec) try { rec.stop(); } catch {}
      if (xMode) { xMode = false; App.callMic.stop(); if (!(App.call && App.call.active)) { App.audio.releaseMic(); App.audio.callSession(false); } } // in chiamata il microfono resta (stesso flusso)
    },
    mode: () => (on ? (xMode ? 'xai' : 'telefono') : 'off'),
    isListening: () => on,
    speak(text) {
      if (!speakOn()) return;
      if (NX.enabled()) { NX.say(text); return; }
      speakDevice(cleanTTS(text).replace(/\[laugh\]/g, ''));
    },
    // v8: lettura in streaming (frase per frase mentre arriva la risposta). Restituisce true se è attiva.
    streamStart() { if (!speakOn() || !NX.enabled()) return false; if (SS && (SS.speaking || SS.pending)) SS.cancel(); NX.begin(); return true; },
    streamFeed(delta) { NX.feed(delta); },
    streamEnd() { NX.end(); },
    cancel() { NX.stop(); if (App.simli) App.simli.interrupt(); if (SS && (SS.speaking || SS.pending)) try { SS.cancel(); } catch {} }, // v8.4.5: niente cancel() a vuoto (in chiamata nessun tocco alla sintesi del telefono)
    engine: () => (NX.enabled() ? 'xai' : 'device'),
  };
  $('#mic-btn').addEventListener('click', () => (on ? App.voice.stop() : App.voice.start()));
  $('#tts-btn').addEventListener('click', () => {
    ttsOn = !ttsOn; App.ls.set('tts', ttsOn); setBtn();
    if (!SS && !NX.enabled()) { ttsOn = false; setBtn(); App.toast('Lettura vocale non supportata'); return; }
    if (!ttsOn) { NX.stop(); if (SS) SS.cancel(); App.audio.hint(false); App.audio.pending = null; }
    else { App.audio.unlock(); if (inCall()) {} else if (NX.enabled()) NX.say('Lettura attiva.'); else speakNow('Lettura attiva.', { sync: true }); } // v8.4.4: in chiamata nessuna conferma a voce // conferma udibile, detta dentro il tocco (sblocca iOS)
  });
  // v7.3: lettura ACCESA di default (chi l'ha spenta a mano resta spenta). Sull'app installata (PWA) le preferenze sono separate da Safari.
  App.voice.init = () => {  ttsOn = App.ls.get('tts', true) && (!!SS || NX.enabled()); setBtn(); loadVoices(); };
  const au = document.getElementById('audio-unlock');
  if (au) au.addEventListener('click', (e) => { e.stopPropagation(); App.audio.unlock(); if (NX.playing || NX.q.length) return; if (performance.now() - (App.audio._spokeAt || 0) > 1500 && lastSpoken && SS && !SS.speaking) { App.audio._spokeAt = performance.now(); speakNow(lastSpoken.text, { ...lastSpoken.opts, sync: true }); } });
  // ---- v8: impostazioni voce (Impostazioni) ----
  (function voiceSettings() {
    const eng = document.getElementById('voice-engine'), vid = document.getElementById('voice-id'), sp = document.getElementById('voice-speed');
    if (!eng) return;
    const info = document.getElementById('voice-info'), spv = document.getElementById('voice-speed-val');
    const show = () => {
      eng.value = App.ls.get('voiceEngine', 'xai'); vid.value = NX.voice(); sp.value = NX.speed(); spv.textContent = '×' + Number(sp.value).toFixed(2);
      vid.disabled = eng.value !== 'xai';
      info.textContent = eng.value === 'xai' ? (App.hasAi() ? (NX.fails >= 3 ? 'Voce naturale in pausa dopo alcuni errori: riprova con "Prova la voce".' : 'Attiva: voce naturale xAI.') : 'Serve la chiave xAI (sopra): finché manca uso la voce del telefono.') : 'Attiva: voce del telefono.';
    };
    let loaded = false;
    const loadVoices = async () => {
      if (loaded || !App.hasAi()) return; loaded = true;
      try {
        const r = await App.api('/api/tts/voices', { ai: true });
        if (r.voices && r.voices.length) { const cur = NX.voice(); vid.innerHTML = ''; for (const v of r.voices) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name + (v.description ? ' — ' + v.description : ''); vid.appendChild(o); } if (![...vid.options].some((o) => o.value === cur)) { const o = document.createElement('option'); o.value = cur; o.textContent = cur; vid.appendChild(o); } }
      } catch { loaded = false; }
      show();
    };
    const ce = document.getElementById('call-engine'), li = document.getElementById('latency-info');
    const showLat = () => {
      if (ce) { ce.value = 'realtime'; ce.disabled = true; if (App.rt && !App.rt.supported()) ce.value = 'classic'; } // v2d-40: sempre tempo reale (non si sceglie più)
      if (li && App.latency) { const a = App.latency.median('tempo reale'), b = App.latency.median('classica'); li.textContent = a || b ? `Ritardo misurato su questo telefono (da quando smetti di parlare alla sua voce, mediana): ${a ? 'tempo reale ' + (a / 1000).toFixed(2) + ' s' : ''}${a && b ? ' · ' : ''}${b ? 'classica ' + (b / 1000).toFixed(2) + ' s' : ''}` : ''; }
    };
    if (ce) ce.addEventListener('change', () => { App.ls.set('callEngine', 'realtime'); showLat(); }); // v2d-40: mai «classica» salvata
    const tabA = document.querySelector('[data-tab="account"]'); if (tabA) tabA.addEventListener('click', showLat);
    setTimeout(showLat, 0);
    eng.addEventListener('change', () => { App.ls.set('voiceEngine', eng.value); NX.fails = 0; show(); loadVoices(); });
    vid.addEventListener('change', () => { App.ls.set('ttsVoiceExplicit', true); App.ls.set('ttsVoice', vid.value); if (App.current && App.current.id) App.ls.set('charVoicePick:' + App.current.id, vid.value); show(); });
    sp.addEventListener('input', () => { App.ls.set('ttsSpeed', Number(sp.value)); show(); });
    document.getElementById('voice-test').addEventListener('click', () => {
      App.audio.unlock(); NX.fails = 0; NX.stop(); if (SS) SS.cancel();
      const t = 'Ciao! Questa è la mia voce. Ti piace?';
      if (NX.enabled()) NX.say(t); else speakDevice(t);
      show();
    });
    const tab = document.querySelector('[data-tab="account"]');
    if (tab) tab.addEventListener('click', () => { show(); loadVoices(); });
    show();
  })();
})();
