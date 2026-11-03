/* voice.js — comandi vocali continui (Web Speech API) e lettura delle risposte (speechSynthesis).
 * L'ascolto si riavvia da solo a ogni evento "end" finché il microfono è acceso: nessun limite di durata.
 * Mentre l'avatar parla l'ascolto è in pausa, per evitare l'eco. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, on = false, pausedForTTS = false, ttsOn = false;
  let lastResAt = 0, eosT = 0, early = ''; // v8.4: fine del parlato anticipata (chiamate)
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
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch {} // iOS 17+: suona anche col tasto silenzioso
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
    clipSound: () => ttsOn && App.audio.unlocked, // clip delle azioni con il loro audio solo a lettura attiva e audio sbloccato
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
    return env;
  }
  const NX = {
    el: null, q: [], playing: null, buf: '', streaming: false, sent: 0, gen: 0, fails: 0, cache: new Map(), devBuf: '', degraded: false, blessed: false,
    enabled() { return App.ls.get('voiceEngine', 'xai') === 'xai' && !!App.key() && this.fails < 3; },
    voice() { return App.ls.get('ttsVoice', 'ara') || 'ara'; },
    speed() { return Number(App.ls.get('ttsSpeed', 1)) || 1; },
    audio() { if (!this.el) { const a = new Audio(); a.preload = 'auto'; a.setAttribute('playsinline', ''); this.el = a; } return this.el; },
    stop() {
      this.gen++; this.q = []; this.buf = ''; this.streaming = false; this.sent = 0; this.devBuf = ''; this.degraded = false;
      if (this.playing) { try { this.el.pause(); } catch {} }
      this.playing = null; this.done();
    },
    begin() { this.stop(); this.streaming = true; },
    feed(delta) { this.buf += delta; this.split(false); },
    end() { this.split(true); this.streaming = false; if (this.degraded && this.devBuf) { const t = this.devBuf; this.devBuf = ''; speakDevice(t); } },
    say(text) { this.begin(); this.feed(text); this.end(); },
    split(force) { // frasi intere; la prima corta (si sente subito), le altre più lunghe (meno richieste, intonazione migliore)
      const re = /[.!?…]+["»”')]*\s+|\n+/g; let m, last = 0, acc = '';
      while ((m = re.exec(this.buf))) { acc += this.buf.slice(last, m.index + m[0].length); last = m.index + m[0].length; if (acc.trim().length >= (this.sent === 0 ? 16 : 80)) { this.enqueue(acc); acc = ''; } }
      this.buf = acc + this.buf.slice(last);
      // v8.4: la prima frase parte anche a una virgola (dopo ~5 parole), così la voce inizia prima
      if (!force && this.sent === 0) { const c = this.buf.search(/[,;:]\s/); if (c >= 28 && c < 160) { this.enqueue(this.buf.slice(0, c + 1)); this.buf = this.buf.slice(c + 2); } }
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
      const r = await App.api('/api/tts', { method: 'POST', body: { text: t, voice: this.voice(), speed: this.speed() }, ai: true, raw: true });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.error || 'Errore ' + r.status); e.status = r.status; throw e; }
      const blob = await r.blob();
      if (!blob.size) throw new Error('Audio vuoto');
      const res = { url: URL.createObjectURL(blob), env: await envelope(blob).catch(() => null) };
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
      this.lipsOn = true;
      App.avatarConv && App.avatarConv.speakAudio(a, env, text);
      if (App.avatarPresence && !$('#presence').hidden) App.avatarPresence.speakAudio(a, env, text);
    },
    done() {
      if (this.lipsOn) { this.lipsOn = false; App.avatarConv && App.avatarConv.stopAudio(); if (App.avatarPresence) App.avatarPresence.stopAudio(); }
      resumeRec();
    },
    fail(e, item) {
      this.fails++; console.warn('Voce xAI non disponibile:', e.message);
      if (!this._warned || performance.now() - this._warned > 60000) { this._warned = performance.now(); App.toast('🔈 Voce naturale non disponibile (' + e.message + '): uso la voce del telefono', 4500); }
      this.devBuf = [item.text, ...this.q.map((x) => x.text)].join(' '); this.q = []; this.playing = null; this.degraded = true; this.done();
      if (!this.streaming) { const t = this.devBuf; this.devBuf = ''; speakDevice(t); }
    },
  };
  App.tts = NX;
  // anti-eco: il riconoscimento vocale va in pausa mentre l'avatar parla
  function pauseRec() { if (on && rec && !pausedForTTS) { pausedForTTS = true; try { rec.stop(); } catch {} } }
  function resumeRec() { if (pausedForTTS) { pausedForTTS = false; if (on) try { rec.start(); } catch {} } }
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
    $('#mic-btn').classList.toggle('on', on); $('#mic-btn span').textContent = on ? 'Voce: on' : 'Voce: off';
    $('#tts-btn').classList.toggle('on', ttsOn); $('#tts-btn').firstChild.textContent = ttsOn ? '🔊 ' : '🔇 ';
    $('#tts-btn span').textContent = ttsOn ? 'Lettura: on' : 'Lettura: off';
  }
  function build() {
    rec = new SR(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
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
          if ($('#auto-send').checked) { $('#chat-input').value = ''; App.chat.send(t); }
          else { const inp = $('#chat-input'); inp.value = (inp.value ? inp.value + ' ' : '') + t; }
        } else interim += r[0].transcript;
      }
      status(interim ? '🎙️ ' + interim : '🎙️ In ascolto…');
      if (interim && App.call) App.call.onInterim(interim); // v8: annuisce mentre parli (videochiamata)
      // v8.4: fine del parlato più rapida in chiamata: ~600 ms senza nuove parole = turno finito (non si aspetta il "final" del browser)
      if (interim.trim() && App.call && App.call.active && $('#auto-send').checked) {
        const snap = interim.trim(), at = lastResAt;
        eosT = setTimeout(() => { if (!on || lastResAt !== at || App.chat.busy) return; early = snap; if (App.latency) App.latency.mark = at; $('#chat-input').value = ''; App.chat.send(snap); }, 600);
      }
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
      if (!App.ls.get('micOn', false)) return App.toast('Attiva il microfono in Impostazioni');
      if (!rec) build();
      on = true; setBtn(); status('🎙️ In ascolto…'); try { rec.start(); } catch {}
    },
    ttsOn: () => ttsOn,
    listening: () => on && !!rec,
    // Frase detta dall'avatar anche con la lettura spenta (es. domanda di conferma)
    sayNow(text) {
      if (NX.enabled()) { if (SS) SS.cancel(); NX.say(text); return; }
      if (!SS) return;
      speakNow(text, { before: (u) => App.avatarConv.speakUtterance(u, text) });
    },
    stop() { on = false; setBtn(); status(''); if (rec) try { rec.stop(); } catch {} },
    speak(text) {
      if (!ttsOn) return;
      if (NX.enabled()) { NX.say(text); return; }
      speakDevice(cleanTTS(text).replace(/\[laugh\]/g, ''));
    },
    // v8: lettura in streaming (frase per frase mentre arriva la risposta). Restituisce true se è attiva.
    streamStart() { if (!ttsOn || !NX.enabled()) return false; if (SS) SS.cancel(); NX.begin(); return true; },
    streamFeed(delta) { NX.feed(delta); },
    streamEnd() { NX.end(); },
    cancel() { NX.stop(); if (SS) try { SS.cancel(); } catch {} },
    engine: () => (NX.enabled() ? 'xai' : 'device'),
  };
  $('#mic-btn').addEventListener('click', () => (on ? App.voice.stop() : App.voice.start()));
  $('#tts-btn').addEventListener('click', () => {
    ttsOn = !ttsOn; App.ls.set('tts', ttsOn); setBtn();
    if (!SS && !NX.enabled()) { ttsOn = false; setBtn(); App.toast('Lettura vocale non supportata'); return; }
    if (!ttsOn) { NX.stop(); if (SS) SS.cancel(); App.audio.hint(false); App.audio.pending = null; }
    else { App.audio.unlock(); if (NX.enabled()) NX.say('Lettura attiva.'); else speakNow('Lettura attiva.', { sync: true }); } // conferma udibile, detta dentro il tocco (sblocca iOS)
  });
  // v7.3: lettura ACCESA di default (chi l'ha spenta a mano resta spenta). Sull'app installata (PWA) le preferenze sono separate da Safari.
  App.voice.init = () => { ttsOn = App.ls.get('tts', true) && (!!SS || NX.enabled()); setBtn(); loadVoices(); };
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
      info.textContent = eng.value === 'xai' ? (App.key() ? (NX.fails >= 3 ? 'Voce naturale in pausa dopo alcuni errori: riprova con "Prova la voce".' : 'Attiva: voce naturale xAI.') : 'Serve la chiave xAI (sopra): finché manca uso la voce del telefono.') : 'Attiva: voce del telefono.';
    };
    let loaded = false;
    const loadVoices = async () => {
      if (loaded || !App.key()) return; loaded = true;
      try {
        const r = await App.api('/api/tts/voices', { ai: true });
        if (r.voices && r.voices.length) { const cur = NX.voice(); vid.innerHTML = ''; for (const v of r.voices) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name + (v.description ? ' — ' + v.description : ''); vid.appendChild(o); } if (![...vid.options].some((o) => o.value === cur)) { const o = document.createElement('option'); o.value = cur; o.textContent = cur; vid.appendChild(o); } }
      } catch { loaded = false; }
      show();
    };
    const ce = document.getElementById('call-engine'), li = document.getElementById('latency-info');
    const showLat = () => {
      if (ce) { ce.value = App.ls.get('callEngine', 'realtime'); if (App.rt && !App.rt.supported()) { ce.value = 'classic'; ce.disabled = true; } }
      if (li && App.latency) { const a = App.latency.median('tempo reale'), b = App.latency.median('classica'); li.textContent = a || b ? `Ritardo misurato su questo telefono (da quando smetti di parlare alla sua voce, mediana): ${a ? 'tempo reale ' + (a / 1000).toFixed(2) + ' s' : ''}${a && b ? ' · ' : ''}${b ? 'classica ' + (b / 1000).toFixed(2) + ' s' : ''}` : ''; }
    };
    if (ce) ce.addEventListener('change', () => { App.ls.set('callEngine', ce.value); showLat(); });
    const tabA = document.querySelector('[data-tab="account"]'); if (tabA) tabA.addEventListener('click', showLat);
    setTimeout(showLat, 0);
    eng.addEventListener('change', () => { App.ls.set('voiceEngine', eng.value); NX.fails = 0; show(); loadVoices(); });
    vid.addEventListener('change', () => { App.ls.set('ttsVoice', vid.value); show(); });
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
