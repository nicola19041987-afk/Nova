/* realtime.js — v8.4 "Conversazione in tempo reale" (xAI Voice Agent API, speech-to-speech su WebSocket).
 * Il telefono parla DIRETTAMENTE con xAI: microfono sempre aperto (full duplex), fine del turno rilevata da xAI (server VAD),
 * voce di lei in streaming man mano che arriva, interruzione immediata quando parli sopra (barge-in), labiale dall'audio vero.
 * La chiave xAI resta sul telefono: il server crea solo un token effimero (5 min, una sessione) e non salva nulla.
 * v8.4.1: configurazione conforme allo schema ufficiale, errori di configurazione NON fatali (in v8.4 un campo non previsto
 * faceva cadere il tempo reale sul telefono vero -> chiamata classica con i "bip"), motivo esatto in caso di problemi,
 * dissolvenze sulla voce (niente click) e sessione audio iOS fissa su play-and-record per tutta la chiamata.
 * Le trascrizioni (tue e sue) finiscono nella chat condivisa. Se il tempo reale non si collega si usa la chiamata classica. */
(function () {
  const RATE = 24000;
  const AC = window.AudioContext || window.webkitAudioContext;
  const supported = () => !!(window.WebSocket && AC && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  App.latency = App.latency || {
    log: App.ls.get('latencyLog', []) || [],
    add(path, ms) { const e = { path, ms: Math.round(ms), at: Date.now() }; if (path === 'classica' && this.cur) { e.stt = this.cur.stt; e.tok = this.cur.tok; } this.cur = null; this.log.push(e); this.log = this.log.slice(-40); App.ls.set('latencyLog', this.log); console.info(`[latenza] ${path}: ${e.ms} ms`); },
    median(path) { const v = this.log.filter((x) => x.path === path).map((x) => x.ms).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; },
  };
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  let S = null; // sessione attiva
  let PRE = null; // v8.5.0: token effimero preparato in anticipo (una sola sessione, scade in 300 s)
  const LOG = []; // ultimi eventi (per «Diagnostica voce»)
  const note = (t, d) => { LOG.push({ at: Math.round(performance.now()), t, d: d == null ? undefined : String(d).slice(0, 200) }); if (LOG.length > 60) LOG.shift(); };
  const errText = (ev) => { const e = (ev && ev.error) || ev || {}; return [e.message || e.code || 'errore', e.param && `(${e.param})`].filter(Boolean).join(' '); };
  // xAI risponde così se response.cancel arriva senza una risposta aperta. Non è un guasto: non va in diagnostica né in console.
  const benignCancel = (t) => /cancellation failed/i.test(t) && /no active response/i.test(t);

  function ctx() { if (!App.audio.ctx) App.audio.ctx = new AC(); if (App.audio.ctx.state !== 'running') App.audio.ctx.resume().catch(() => {}); return App.audio.ctx; }

  // ---------- microfono -> 24 kHz PCM16, blocchi da 100 ms ----------
  async function startMic(s) {
    s.stream = await App.audio.mic(); // v8.4.4: microfono condiviso della chiamata (mai fermato qui)
    if (s.closed) return;
    const c = ctx(); // v8.4.7: contesto audio DOPO il microfono (iPhone: con la sessione 'play-and-record')
    if (s.out && s.out.c !== c) { s.out = null; s.playT = 0; } // contesto rinnovato: la catena della sua voce si rifà
    s.micT0 = performance.now(); s.micPeak = 0;
    try { s.src && s.src.disconnect(); s.node && s.node.disconnect(); } catch {}
    s.src = c.createMediaStreamSource(s.stream);
    if (!s.offLost) s.offLost = App.audio.onMicLost(() => { if (!s.closed) startMic(s).catch((e) => console.warn('Microfono non riaperto', e)); });
    const onChunk = (pcm, rms) => {
      if (rms > 0.012 && !playing(s)) s.lastVoiceAt = performance.now(); // fine del parlato (per misurare la latenza)
      if (rms > s.micPeak) s.micPeak = rms; // v8.4.7: microfono «muto» -> riaperto una volta
      if (!s.reacq && !App.audio._reacq) { const tr = s.stream && s.stream.getAudioTracks()[0], mt = !!(tr && (tr.muted || tr.readyState !== 'live')); if (mt || (performance.now() - s.micT0 > 4000 && s.micPeak < 0.0012)) { s.reacq = true; note('microfono muto: riapro', mt ? 'traccia muta' : 'livello ' + s.micPeak.toFixed(4)); App.audio.reacquire(mt ? 'traccia muta' : 'livello quasi zero').catch(() => {}); return; } }
      if (s.muted) return;
      if (s.ready && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(pcm) }));
      else { s.early.push(pcm); if (s.early.length > 15) s.early.shift(); } // tiene ~1,5 s finché la sessione non è pronta
    };
    try {
      if (!c.audioWorklet) throw new Error('no worklet');
      await c.audioWorklet.addModule('/js/rt-worklet.js');
      s.node = new AudioWorkletNode(c, 'rt-capture');
      s.node.port.onmessage = (e) => onChunk(e.data.pcm, e.data.rms);
      const mute = c.createGain(); mute.gain.value = 0; s.src.connect(s.node); s.node.connect(mute); mute.connect(c.destination);
    } catch { // vecchi browser: ScriptProcessor (stesso formato)
      const sp = c.createScriptProcessor(2048, 1, 1), ratio = c.sampleRate / RATE; let pos = 0, prev = 0, out = new Int16Array(2400), n = 0, e2 = 0;
      sp.onaudioprocess = (ev) => {
        const ch = ev.inputBuffer.getChannelData(0), X = (k) => (k === 0 ? prev : ch[k - 1]); let p = pos;
        while (p < ch.length) { const i = Math.floor(p), f = p - i, v = Math.max(-1, Math.min(1, X(i) + (X(i + 1) - X(i)) * f)); out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff; e2 += v * v; if (n === out.length) { const b = out.slice(0); onChunk(b.buffer, Math.sqrt(e2 / n)); n = 0; e2 = 0; } p += ratio; }
        pos = p - ch.length; prev = ch[ch.length - 1];
      };
      const mute = c.createGain(); mute.gain.value = 0; s.src.connect(sp); sp.connect(mute); mute.connect(c.destination); s.node = sp;
    }
  }

  // ---------- voce di lei: blocchi PCM in coda senza buchi, labiale dall'analizzatore ----------
  function outChain(s) {
    if (s.out) return s.out;
    const c = ctx(), g = c.createGain(), an = c.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.2;
    g.gain.value = s.volume; g.connect(an); an.connect(c.destination);
    s.out = { c, g, an, td: new Float32Array(an.fftSize), fd: new Uint8Array(an.frequencyBinCount) }; return s.out;
  }
  const playing = (s) => s && s.playT > ctx().currentTime + 0.005;
  function play(s, buf) {
    const c = ctx(), o = outChain(s), i16 = new Int16Array(buf), n = i16.length; if (!n) return;
    let e2 = 0, zc = 0, prev = 0;
    const ab = c.createBuffer(1, n, RATE), d = ab.getChannelData(0);
    for (let i = 0; i < n; i++) { const v = i16[i] / 32768; d[i] = v; e2 += v * v; if ((v >= 0) !== (prev >= 0)) zc++; prev = v; }
    const rms = Math.sqrt(e2 / n), shape = Math.max(0, Math.min(1, (zc / n) * 6));
    const src = c.createBufferSource(); src.buffer = ab; src.connect(o.g);
    const fresh = !(s.playT > c.currentTime + 0.002), t = Math.max(c.currentTime + 0.025, s.playT || 0);
    if (fresh) { const g = o.g.gain; g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(s.volume, t + 0.015); } // dissolvenza in entrata: niente click
    src.start(t); s.playT = t + n / RATE;
    if (App.simli && App.simli.feedPcm24) App.simli.feedPcm24(buf);
    if (!s.env) s.env = [];
    s.env.push({ t0: t, t1: s.playT, rms, shape });
    const cut = c.currentTime - 0.25;
    while (s.env.length > 6 && s.env[0].t1 < cut) s.env.shift();
    s.sources.push(src); src.onended = () => { s.sources = s.sources.filter((x) => x !== src); };
    if (s.resp && !s.resp.firstAt) { // primo audio della risposta: latenza fine-parlato -> primo suono
      s.resp.firstAt = performance.now() + (t - c.currentTime) * 1000;
      if (s.eosAt) { const ms = s.resp.firstAt - s.eosAt; if (ms > 0 && ms < 20000) { App.latency.add('tempo reale', ms); s.lat.push(Math.round(ms)); } s.eosAt = 0; }
    }
    lips(s, true);
  }
  // livello della voce (0..1) e "apertura larga" (vocali chiare/sibilanti) per il labiale, letti a ogni fotogramma
  function envNow(s) {
    const list = s.env; if (!list || !list.length) return null;
    const t = ctx().currentTime;
    for (let i = list.length - 1; i >= 0; i--) if (t >= list[i].t0 && t <= list[i].t1) return list[i];
    return null;
  }
  function level(s) {
    if (!playing(s)) return 0;
    let rms = 0;
    const seg = envNow(s); if (seg) rms = seg.rms;
    const o = s.out;
    if (o) {
      try {
        o.an.getFloatTimeDomainData(o.td); let e = 0; for (let i = 0; i < o.td.length; i++) e += o.td[i] * o.td[i];
        rms = Math.max(rms, Math.sqrt(e / o.td.length));
      } catch { /* Safari: l'analizzatore spesso resta a zero; resta l'inviluppo del PCM */ }
    }
    if (rms <= 0) return 0.02; // in riproduzione ma misuratore muto (Safari): non è «audio finito»
    s.peak = Math.max(rms, (s.peak || 0.05) * 0.995);
    const v = rms / (s.peak * 0.75); return v < 0.04 ? 0 : Math.min(1, Math.pow(v, 0.8));
  }
  function vowelShape(text) {
    const ch = String(text || '').toLowerCase().replace(/[^aeiouàèéìòóù]/g, '').slice(-1);
    if (!ch) return null;
    if ('ouòóù'.includes(ch)) return 0.18;
    if ('ieìéè'.includes(ch)) return 0.86;
    if ('aà'.includes(ch)) return 0.55;
    return null;
  }
  function wide(s) {
    const seg = envNow(s);
    const spec = seg ? seg.shape : null;
    const vis = s.viseme;
    if (spec != null && vis != null) return spec * 0.4 + vis * 0.6;
    if (spec != null) return spec;
    if (vis != null) return vis;
    const o = s.out; if (!o || !playing(s)) return 0.5;
    try {
      o.an.getByteFrequencyData(o.fd); let lo = 0, hi = 0; const N = o.fd.length, k = Math.floor(N * 0.04), h = Math.floor(N * 0.12);
      for (let i = 1; i < k; i++) lo += o.fd[i]; for (let i = k; i < h; i++) hi += o.fd[i];
      return Math.max(0, Math.min(1, (hi / Math.max(1, h - k)) / Math.max(1, lo / Math.max(1, k - 1)) - 0.4));
    } catch { return 0.5; }
  }
  function lips(s, on) {
    const avs = [App.avatarConv, App.avatarPresence].filter(Boolean);
    if (on !== !!s.lipsOn) { const st = document.getElementById('stage'); if (st) st.classList.toggle('speaking', !!on); } // v8.4.5
    if (on && !s.lipsOn) { s.lipsOn = true; avs.forEach((a) => a.speakLive && a.speakLive(() => level(s), () => wide(s))); }
    if (!on && s.lipsOn) { s.lipsOn = false; avs.forEach((a) => a.stopAudio && a.stopAudio()); }
  }
  function stopPlayback(s) { // dissolvenza in uscita di 30 ms, poi stop (niente "tac")
    const c = App.audio.ctx, o = s.out;
    if (c && o && s.sources.length) {
      const t = c.currentTime, g = o.g.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.03);
      for (const x of s.sources) { try { x.onended = null; x.stop(t + 0.035); } catch {} }
    } else for (const x of s.sources) { try { x.onended = null; x.stop(); } catch {} }
    s.sources = []; s.playT = 0; s.env = []; lips(s, false);
  }
  function fadeOutEnd(s) { // fine risposta: chiude dolcemente l'ultimo pezzo
    const c = App.audio.ctx, o = s.out; if (!c || !o || !(s.playT > c.currentTime + 0.05)) return;
    const g = o.g.gain, e = s.playT; g.setValueAtTime(s.volume, e - 0.02); g.linearRampToValueAtTime(0, e);
  }

  // ---------- trascrizioni nella chat condivisa (in ordine) ----------
  function save(s, role, text, extra = {}) {
    text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text) return;
    s.saveQ = s.saveQ.then(async () => {
      if (role === 'assistant') { const t0 = performance.now(); while (s.waitUser && performance.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 120)); }
      try {
        const r = await App.api(`/api/chats/${s.ch.id}/voice-turn`, { method: 'POST', body: { role, text, callMode: s.mode, ...extra } });
        s.turns++;
        if ((r && r.adult !== s.adult) || s.turns % 8 === 0) refresh(s);
        if (App.chat && App.chat.poll && App.current && App.current.id === s.ch.id) App.chat.poll();
      } catch (e) { console.warn('Trascrizione non salvata:', e.message); }
    });
  }
  async function refresh(s) { // istruzioni aggiornate (modalità adulti, ricordi, ultimi messaggi) senza interrompere la chiamata
    try {
      const r = await App.api('/api/realtime/instructions', { method: 'POST', body: { characterId: s.ch.id, mode: s.mode } });
      s.adult = r.adult; if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'session.update', session: { instructions: r.instructions } }));
    } catch {}
  }

  // ---------- eventi da xAI ----------
  function onEvent(s, ev) {
    switch (ev.type) {
      case 'session.created':
        s.created = true; note('session.created'); configure(s); break;
      case 'session.updated':
        s.upd = (s.upd || 0) + 1; note('session.updated'); if (s.step) { const f = s.step; s.step = null; f(true); } break;
      case 'input_audio_buffer.speech_started':
        s.userSpeaking = true; s.phase = 'listening';
        if (playing(s) || s.resp) bargeIn(s, false);
        if (App.call && App.call.onInterim) App.call.onInterim('…'); break;
      case 'input_audio_buffer.speech_stopped':
        s.userSpeaking = false; s.waitUser = true; s.phase = 'replying'; // ottimista: "sta parlando…" appena hai finito
        s.eosAt = s.lastVoiceAt && performance.now() - s.lastVoiceAt < 3000 ? s.lastVoiceAt : performance.now() - 500;
        [App.avatarConv, App.avatarPresence].forEach((a) => a && a.breathM && a.breathM.preInhale(performance.now()));
        if (App.sight && App.sight.onUtterance) App.sight.onUtterance();
        break;
      case 'conversation.item.input_audio_transcription.updated':
        s.live = ev.transcript || ''; if (App.call && App.call.onInterim) App.call.onInterim(s.live); break;
      case 'conversation.item.input_audio_transcription.completed':
        s.waitUser = false; s.live = ''; save(s, 'user', ev.transcript); break;
      case 'response.created':
        s.responseActive = true;
        s.resp = { id: ev.response && ev.response.id, text: '', firstAt: 0 }; s.phase = 'replying'; break;
      case 'response.output_audio.delta': case 'response.audio.delta':
        if (s.cancelled === (ev.response_id || 'x')) break;
        if (!s.resp) s.resp = { id: ev.response_id, text: '', firstAt: 0 };
        if (ev.delta) play(s, unb64(ev.delta)); break;
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta':
        if (s.resp) { s.resp.text += ev.delta || ''; s.viseme = vowelShape(s.resp.text); if (App.call && App.call.caption) App.call.caption(s.resp.text); } break;
      case 'response.output_audio_transcript.done': case 'response.audio_transcript.done':
        if (s.resp && ev.transcript) s.resp.text = ev.transcript; break;
      case 'response.done': {
        s.responseActive = false;
        fadeOutEnd(s); const r = s.resp; s.resp = null; if (s.phase === 'replying') s.phase = 'idle';
        const st = ev.response && ev.response.status;
        if (r && isGreet(s, r.text)) break; // il saluto iniziale non va in chat
        if (r && r.text && !r.saved) { r.saved = true; save(s, 'assistant', r.text + (st === 'cancelled' || r.cut ? '…' : ''), st === 'cancelled' || r.cut ? { interrupted: true } : {}); }
        break;
      }
      case 'error': { // NON fatale: il servizio resta collegato e tiene la configurazione precedente
        const et = errText(ev);
        if (benignCancel(et)) break;
        note('error', et); if (!s.inExtra) { s.lastError = et; App.rt.lastError = et; } // l'opzione accessoria rifiutata non è un problema
        console.warn('Tempo reale:', s.lastError);
        if (s.step) { const f = s.step; s.step = null; f(false); }
        break;
      }
      default: break;
    }
  }
  // configurazione a passi: prima tutto insieme; se il servizio rifiuta, pezzo per pezzo (così le istruzioni del personaggio
  // arrivano sempre, anche se un'opzione accessoria non fosse accettata). Il modello di trascrizione è un extra separato.
  function upd(s, session) {
    return new Promise((res) => {
      if (!s.ws || s.ws.readyState !== 1) return res(false);
      s.step = res; s.ws.send(JSON.stringify({ type: 'session.update', session }));
      setTimeout(() => { if (s.step === res) { s.step = null; res(true); } }, 1500); // nessuna risposta: proseguiamo
    });
  }
  async function configure(s) {
    const c = s.cfg.session || {}, t0 = performance.now();
    let ok = await upd(s, c);
    if (!ok && !s.closed) {
      const parts = [{ instructions: c.instructions, voice: c.voice }, { instructions: c.instructions }, { turn_detection: c.turn_detection }, { audio: c.audio && { input: { format: c.audio.input.format }, output: c.audio.output } }, { audio: c.audio && { input: { transcription: c.audio.input.transcription } } }, { reasoning: c.reasoning }];
      const done = new Set();
      for (const p of parts) { if (s.closed) return; if (p.instructions && done.has('instructions')) continue; if (Object.values(p).some((v) => v === undefined)) continue; if (await upd(s, p)) Object.keys(p).forEach((k) => done.add(k)); }
      s.partial = true; note('config', 'parziale: ' + [...done].join(', '));
    }
    s.cfgMs = Math.round(performance.now() - t0);
    ready(s);
    if (s.cfg.extra && !s.closed) { s.inExtra = true; const okx = await upd(s, s.cfg.extra); s.inExtra = false; note('extra', okx ? 'ok' : 'rifiutato (non necessario)'); }
  }
  function isGreet(s, t) { if (!s.greet || !t) return false; const g = s.greet.trim().slice(0, 10), ok = String(t).trim().slice(0, 10) === g; if (ok) s.greet = null; return ok; }
  function ready(s) {
    if (s.isReady || s.closed) return; s.isReady = true; s.ready = true; s.ok();
    for (const pcm of s.early.splice(0)) if (!s.muted) s.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(pcm) }));
  }
  // interruzione: la sua voce si ferma subito; la risposta in corso viene annullata (e salvata fin dove è arrivata)
  function bargeIn(s, manual) {
    const r = s.resp;
    const active = !!s.responseActive;
    if (playing(s) || active) { App.rt.barges = (App.rt.barges || 0) + 1; App.rt.lastBargeAt = performance.now(); } // per diagnostica/test
    stopPlayback(s);
    if (active) {
      s.responseActive = false;
      s.cancelled = (r && r.id) || 'x';
      try { if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
    }
    if (r) { r.cut = true; if (r.text && !r.saved && !isGreet(s, r.text)) { r.saved = true; save(s, 'assistant', r.text + '…', { interrupted: true }); } s.resp = null; }
    if (manual) s.phase = 'idle';
  }

  // ---------- connessione (token effimero, 5 s per partire, fino a 3 tentativi) ----------
  function connect(s) {
    return new Promise((ok, ko) => {
      let done = false; const fin = (e) => { if (done) return; done = true; clearTimeout(to); if (e) { try { s.ws.close(); } catch {} ko(e); } else ok(); };
      s.ok = () => fin(); s.fail = (e) => fin(e);
      const ws = new WebSocket(s.cfg.url, [`xai-client-secret.${s.cfg.token}`]); ws.binaryType = 'arraybuffer'; s.ws = ws;
      const to = setTimeout(() => fin(new Error('Il servizio voce non ha risposto in tempo')), 6000);
      ws.onmessage = (m) => { if (typeof m.data !== 'string') { if (s.resp || s.isReady) play(s, m.data); return; } let ev; try { ev = JSON.parse(m.data); } catch { return; } onEvent(s, ev); };
      s.t0 = performance.now(); note('ws.connect', s.cfg.url);
      ws.onopen = () => { s.openMs = Math.round(performance.now() - s.t0); note('ws.open', s.openMs + ' ms · ' + (ws.protocol ? 'sottoprotocollo accettato' : 'nessun sottoprotocollo')); };
      ws.onerror = () => { note('ws.error'); setTimeout(() => fin(new Error('Connessione al servizio voce non riuscita' + (s.lastError ? ': ' + s.lastError : ''))), 400); }; // aspetta il codice di chiusura
      ws.onclose = (e) => {
        note('ws.close', `${e.code} ${e.reason || ''}`);
        const why = `Connessione chiusa dal servizio voce (codice ${e.code}${e.reason ? ': ' + e.reason : ''}${s.lastError ? ' · ' + s.lastError : ''})`;
        if (!done) fin(new Error(why)); else if (!s.closed) { s.closeWhy = why; dropped(s); }
      };
    });
  }
  async function dropped(s) { // connessione persa a chiamata in corso: un nuovo tentativo, poi la chiamata classica
    if (s.closed || s.retrying) return; s.retrying = true; s.ready = false; stopPlayback(s);
    try { await open(s, 1); s.retrying = false; App.toast('🔄 Ricollegata', 1800); }
    catch (e) {
      s.retrying = false;
      const why = 'Connessione persa: ' + ((e && e.message) || s.closeWhy || '');
      if (App.call && App.call.active && App.call.fallback) App.call.fallback(why);
      else {
        App.rt.stop();
        document.body.classList.remove('solo-rt');
        const btn = document.getElementById('solo-rt'); if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
        const status = document.getElementById('voice-status'); if (status) { status.hidden = true; status.textContent = ''; }
        App.toast('⚡ ' + why);
      }
    }
  }
  async function open(s, tries = 3) {
    let last;
    for (let i = 0; i < tries && !s.closed; i++) {
      try {
        s.isReady = false; s.upd = 0; s.created = false;
        const t = performance.now();
        // v8.5.0: token già pronto (preparato all'apertura della chat) -> la chiamata si collega subito
        const w = PRE && PRE.ch === s.ch.id && PRE.vid === s.voice && Date.now() - PRE.at < 200e3 ? PRE.modes[s.mode] : null; PRE = null;
        s.cfg = (w && await w.p.catch(() => null)) || await App.api('/api/realtime/session', { method: 'POST', body: { characterId: s.ch.id, mode: s.mode, voice: s.voice, voiceExplicit: s.voiceExplicit === true }, ai: true });
        if (w) note('token pronto in anticipo');
        s.tokenMs = Math.round(performance.now() - t); note('token', s.tokenMs + ' ms');
        s.adult = s.cfg.adult; await connect(s); return;
      } catch (e) { last = e; note('tentativo ' + (i + 1), e.message); if (e.status && e.status < 500 && e.status !== 408) break; }
    }
    throw last || new Error('Tempo reale non disponibile');
  }

  App.rt = {
    supported,
    // v8.5.0: all'apertura della chat prepara i token (vocale e video) e scalda la connessione: la chiamata parte subito
    prewarm(ch) {
      if (!ch || !App.rt.enabled() || S) return; const voice = App.xaiVoice ? App.xaiVoice(ch) : 'eve';
      if (PRE && PRE.ch === ch.id && Date.now() - PRE.at < 150e3) return;
      const mk = (mode) => { const p = App.api('/api/realtime/session', { method: 'POST', body: { characterId: ch.id, mode, voice }, ai: true }); p.catch(() => {}); return { p }; };
      PRE = { ch: ch.id, vid: voice, at: Date.now(), modes: { voice: mk('voice'), video: mk('video') } };
    },
    enabled: () => App.ls.get('callEngine', 'realtime') === 'realtime' && supported() && !!(App.hasAi && App.hasAi()),
    get active() { return !!(S && !S.closed && S.isReady); },
    // da chiamare DENTRO il tocco che avvia la chiamata (sblocco audio + microfono in parallelo alla connessione)
    async start(ch, mode, greet) {
      if (S) App.rt.stop();
      const s = S = { ch, mode: mode === 'voice' ? 'voice' : 'video', voice: App.xaiVoice ? App.xaiVoice(ch) : 'eve', voiceExplicit: !!(App.xaiVoiceExplicit && App.xaiVoiceExplicit(ch)), early: [], sources: [], playT: 0, saveQ: Promise.resolve(), turns: 0, lat: [], volume: 1, muted: false, phase: 'connecting', closed: false };
      App.audio.callSession && App.audio.callSession(true); // iOS: registra+riproduce per tutta la chiamata (niente cambi di sessione)
      ctx(); LOG.length = 0; App.rt.lastError = '';
      const mic = startMic(s); mic.catch(() => {});
      try { await Promise.all([mic, open(s)]); }
      catch (e) { App.rt.stop(); throw e; }
      if (greet && !s.closed) s.greet = greet;
      if (greet && !s.closed) s.ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'force_message', role: 'assistant', interruptible: true, content: [{ type: 'output_text', text: greet }] } }));
      s.phase = 'idle'; return true;
    },
    stop() {
      const s = S; if (!s) return null; S = null; s.closed = true; s.ready = false;
      try { s.ws && s.ws.close(); } catch {}
      stopPlayback(s);
      try { s.node && s.node.disconnect(); s.src && s.src.disconnect(); } catch {}
      if (s.offLost) s.offLost(); // in chiamata il microfono resta aperto (lo chiude solo la fine della chiamata)
      if (!(App.call && App.call.active) && App.audio) {
        if (App.audio.releaseMic) App.audio.releaseMic();
        if (App.audio.callSession) App.audio.callSession(false);
      }
      if (s.resp && s.resp.text && !s.resp.saved) { s.resp.saved = true; save(s, 'assistant', s.resp.text + '…', { interrupted: true }); }
      return { lat: s.lat };
    },
    interrupt() { if (S) bargeIn(S, true); },
    sendText(t) { // messaggio scritto durante la chiamata (tastiera): lei risponde a voce
      const s = S; t = String(t || '').trim(); if (!s || !t || !s.ws || s.ws.readyState !== 1) return false;
      bargeIn(s, false); s.eosAt = performance.now(); s.phase = 'replying'; save(s, 'user', t);
      const deliver = (extra) => {
        if (!S || S !== s || !s.ws || s.ws.readyState !== 1) return;
        const text = extra ? `${t}\n\n${extra}` : t;
        s.ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
        s.ws.send(JSON.stringify({ type: 'response.create' }));
      };
      if (App.sight && App.sight.active && App.sight.active() && App.sight.noteForVoice) {
        App.sight.noteForVoice({ force: true }).then((note) => deliver(note || '')).catch(() => deliver(''));
      } else deliver('');
      return true;
    },
    setMuted(v) { if (!S) return; S.muted = !!v; if (v && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' })); },
    setVolume(v) { if (!S) return; S.volume = v; if (S.out) { const g = S.out.g.gain, t = ctx().currentTime; g.cancelScheduledValues(t); g.setTargetAtTime(v, t, 0.02); } },
    setMode(m) { if (!S) return; S.mode = m === 'voice' ? 'voice' : 'video'; refresh(S); },
    status() {
      if (!S) return null;
      if (S.phase === 'connecting') return 'Collegamento…';
      if (playing(S)) return 'Sta parlando…';
      if (S.phase === 'replying') return 'Sta parlando…'; // ottimista: appena hai finito di parlare
      if (S.muted) return 'Microfono spento';
      return S.userSpeaking ? 'Ti ascolto…' : 'Ti ascolto…';
    },
    speaking: () => !!(S && playing(S)),
    lat: () => (S ? S.lat.slice() : []),
    _s: () => S,
    log: () => LOG.slice(),
    lastError: '',
    info: () => (S ? { tokenMs: S.tokenMs, openMs: S.openMs, cfgMs: S.cfgMs, partial: !!S.partial, lastError: S.lastError || '' } : null),
  };
})();
