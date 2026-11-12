/* call.js — chiamata vocale in tempo reale con Idea (xAI Voice Agent API), ripresa da Nova (realtime.js / call.js).
 * Il server dà solo un token effimero (5 min): il telefono parla direttamente con xAI via WebSocket.
 * Microfono 24 kHz PCM16 (AudioWorklet, con ScriptProcessor di riserva), voce di Idea in coda senza buchi,
 * interruzione quando parli sopra, timer, muto, riaggancio. A fine chiamata: trascrizione -> riassunto in chat + idee nel 💡. */
(function () {
  'use strict';
  const RATE = 24000;
  const AC = window.AudioContext || window.webkitAudioContext;
  const $ = (q) => document.querySelector(q);
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const supported = () => !!(window.WebSocket && AC && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  let S = null;
  const stats = window.NNCall = { frames: 0, bytes: 0, events: [], lastError: '', turns: () => (S ? S.turns.slice() : []) };
  const note = (t) => { stats.events.push(t); if (stats.events.length > 80) stats.events.shift(); };

  // iPhone: la sessione "play-and-record" forzata manda la voce nella capsula (auricolare), bassissima.
  // Lasciamo "auto": Safari col microfono attivo usa l'altoparlante, come una chiamata in vivavoce.
  function audioSession() { try { if (navigator.audioSession && navigator.audioSession.type !== 'auto') navigator.audioSession.type = 'auto'; } catch {} }
  function unlock(c) { // iPhone: suono muto nel tocco, così la voce di Idea può partire
    try { const b = c.createBuffer(1, 1, c.sampleRate), src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0); } catch {}
    if (c.state !== 'running') c.resume().catch(() => {});
  }

  // ---------- microfono -> PCM16 24 kHz ----------
  async function startMic(s) {
    const c = s.c;
    s.src = c.createMediaStreamSource(s.stream);
    const onChunk = (pcm, rms) => {
      if (s.closed || s.muted) return;
      if (s.ready && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(pcm) }));
      else { s.early.push(pcm); if (s.early.length > 15) s.early.shift(); }
    };
    const sink = c.createGain(); sink.gain.value = 0; sink.connect(c.destination);
    try {
      if (!c.audioWorklet) throw new Error('no worklet');
      await c.audioWorklet.addModule('/rt-worklet.js');
      s.node = new AudioWorkletNode(c, 'rt-capture');
      s.node.port.onmessage = (e) => onChunk(e.data.pcm, e.data.rms);
      s.src.connect(s.node); s.node.connect(sink);
    } catch { // vecchi browser: ScriptProcessor (stesso formato)
      const sp = c.createScriptProcessor(2048, 1, 1), ratio = c.sampleRate / RATE; let pos = 0, prev = 0, out = new Int16Array(2400), n = 0, e2 = 0;
      sp.onaudioprocess = (ev) => {
        const ch = ev.inputBuffer.getChannelData(0), X = (k) => (k === 0 ? prev : ch[k - 1]); let p = pos;
        while (p < ch.length) { const i = Math.floor(p), f = p - i, v = Math.max(-1, Math.min(1, X(i) + (X(i + 1) - X(i)) * f)); out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff; e2 += v * v; if (n === out.length) { onChunk(out.slice(0).buffer, Math.sqrt(e2 / n)); n = 0; e2 = 0; } p += ratio; }
        pos = p - ch.length; prev = ch[ch.length - 1];
      };
      s.src.connect(sp); sp.connect(sink); s.node = sp;
    }
  }

  // ---------- voce di Idea ----------
  const playing = (s) => s && s.playT > s.c.currentTime + 0.005;
  function play(s, buf) {
    const c = s.c, i16 = new Int16Array(buf), n = i16.length; if (!n) return;
    stats.frames++; stats.bytes += buf.byteLength;
    if (!s.out) { // voce più forte senza distorsioni: guadagno + compressore prima dell'uscita
      s.out = c.createGain(); s.boost = c.createGain(); s.boost.gain.value = 1.8;
      try { const k = c.createDynamicsCompressor(); k.threshold.value = -12; k.knee.value = 6; k.ratio.value = 8; k.attack.value = 0.003; k.release.value = 0.15; s.out.connect(s.boost); s.boost.connect(k); k.connect(c.destination); }
      catch { s.out.connect(c.destination); }
    }
    const ab = c.createBuffer(1, n, RATE), d = ab.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = i16[i] / 32768;
    const src = c.createBufferSource(); src.buffer = ab; src.connect(s.out);
    const fresh = !(s.playT > c.currentTime + 0.002), t = Math.max(c.currentTime + 0.025, s.playT || 0);
    if (fresh) { const g = s.out.gain; g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.015); }
    src.start(t); s.playT = t + n / RATE;
    s.sources.push(src); src.onended = () => { s.sources = s.sources.filter((x) => x !== src); };
  }
  function stopPlayback(s) {
    for (const x of s.sources) { try { x.onended = null; x.stop(); } catch {} }
    s.sources = []; s.playT = 0;
  }
  function report(s, kind, text) {
    if (!s || !s.callId || !window.NN) return;
    const body = { callId: s.callId, kind, text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1500), at: Date.now() };
    if (!body.text) return;
    try { window.NN.api('/api/call/log', { method: 'POST', body }).catch(() => {}); } catch {}
  }
  function addTurn(s, role, text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    s.turns.push({ role, text });
    report(s, role === 'assistant' ? 'idea' : 'user', text);
  }

  // dopo una riconnessione Idea riparte sapendo di cosa stavate parlando
  function sessionFor(s) {
    const sess = { ...s.cfg.session };
    if (s.reconnects && s.turns.length) {
      const recap = s.turns.slice(-12).map((t) => (t.role === 'assistant' ? 'Ventuno' : 'Lui') + ': ' + t.text.slice(0, 300)).join('\n');
      sess.instructions = (sess.instructions || '') + '\n\nLA LINEA È CADUTA UN ATTIMO ED È TORNATA: continua la stessa chiamata senza risalutare e senza ricominciare da capo. Ultime battute:\n' + recap;
    }
    return sess;
  }
  function onEvent(s, ev) {
    s.lastEv = Date.now();
    switch (ev.type) {
      case 'session.created': note('session.created'); s.ws.send(JSON.stringify({ type: 'session.update', session: sessionFor(s) })); break;
      case 'session.updated':
        note('session.updated');
        if (!s.ready) { s.ready = true; s.ok && s.ok(); for (const pcm of s.early.splice(0)) if (!s.muted) s.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64(pcm) })); }
        break;
      case 'input_audio_buffer.speech_started':
        s.userSpeaking = true; ui();
        if (playing(s) || s.responseActive) { // parli sopra: la sua voce si ferma
          stopPlayback(s);
          if (s.responseActive) { s.responseActive = false; s.cancelled = s.resp && s.resp.id; try { s.ws.send(JSON.stringify({ type: 'response.cancel' })); } catch {} }
          if (s.resp && s.resp.text && !s.resp.saved) { s.resp.saved = true; addTurn(s, 'assistant', s.resp.text + '…'); }
          s.resp = null;
        }
        break;
      case 'input_audio_buffer.speech_stopped': s.userSpeaking = false; s.waitSince = Date.now(); ui(); break;
      case 'conversation.item.input_audio_transcription.completed': addTurn(s, 'user', ev.transcript); break;
      case 'response.created': s.waitSince = 0; s.respAt = Date.now(); s.responseActive = true; s.resp = { id: ev.response && ev.response.id, text: '' }; break;
      case 'response.output_audio.delta': case 'response.audio.delta':
        if (s.cancelled && s.cancelled === ev.response_id) break;
        s.respAt = Date.now(); if (ev.delta) play(s, unb64(ev.delta)); ui(); break;
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta':
        if (s.resp) { s.resp.text += ev.delta || ''; caption(s.resp.text); } break;
      case 'response.output_audio_transcript.done': case 'response.audio_transcript.done':
        if (s.resp && ev.transcript) s.resp.text = ev.transcript; break;
      case 'response.done': {
        s.responseActive = false; const r = s.resp; s.resp = null;
        if (r && r.text && !r.saved) { r.saved = true; addTurn(s, 'assistant', r.text); }
        if (s.ending) s.goodbyeHeard = true;
        break;
      }
      case 'error': {
        const e = ev.error || {}; const t = [e.message || e.code || 'errore', e.param && `(${e.param})`].filter(Boolean).join(' ');
        if (/cancellation failed/i.test(t)) break;
        note('error ' + t); stats.lastError = t;
        // voce rifiutata: riprova con la voce di riserva
        if (/voice/i.test(t) && !s.voiceRetry && s.cfg.fallbackVoice) { s.voiceRetry = true; s.ws.send(JSON.stringify({ type: 'session.update', session: { ...s.cfg.session, voice: s.cfg.fallbackVoice } })); }
        else if (!s.ready && !s.partialTried) { s.partialTried = true; s.ws.send(JSON.stringify({ type: 'session.update', session: { instructions: s.cfg.session.instructions, voice: s.cfg.session.voice } })); }
        break;
      }
      default: break;
    }
  }
  function connect(s) {
    return new Promise((ok, ko) => {
      let done = false; const fin = (e) => { if (done) return; done = true; clearTimeout(to); if (e) ko(e); else ok(); };
      s.ok = () => fin();
      const ws = new WebSocket(s.cfg.url, [`xai-client-secret.${s.cfg.token}`]); ws.binaryType = 'arraybuffer'; s.ws = ws;
      const to = setTimeout(() => fin(new Error('Il servizio voce non ha risposto in tempo')), 8000);
      ws.onmessage = (m) => { if (typeof m.data !== 'string') { play(s, m.data); return; } let ev; try { ev = JSON.parse(m.data); } catch { return; } onEvent(s, ev); };
      ws.onopen = () => note('ws.open');
      ws.onerror = () => { note('ws.error'); setTimeout(() => fin(new Error('Connessione al servizio voce non riuscita')), 300); };
      ws.onclose = (e) => { note('ws.close ' + e.code); if (s.ws !== ws) return; if (!done) fin(new Error('Connessione chiusa dal servizio voce (' + e.code + ')')); else if (!s.closed) reconnect(s); };
    });
  }

  // linea caduta (rete, token scaduto, iPhone in pausa): nuova sessione e si continua, senza chiudere la chiamata
  async function reconnect(s) {
    if (s.closed || s.reconnecting) return; s.reconnecting = true; s.ready = false;
    stopPlayback(s); s.responseActive = false; s.resp = null; s.waitSince = 0;
    try { if (s.ws) { s.ws.onclose = null; s.ws.close(); } } catch {}
    caption('Linea disturbata, riconnetto…'); ui();
    for (let i = 0; i < 4 && !s.closed; i++) {
      try {
        s.reconnects = (s.reconnects || 0) + 1; note('reconnect ' + s.reconnects); report(s, 'event', 'riconnessione');
        s.cfg = await window.NN.api('/api/call/session', { method: 'POST', body: {} });
        if (s.closed) break;
        await connect(s);
        s.reconnecting = false; caption(''); ui(); return;
      } catch (e) { stats.lastError = e.message; await new Promise((r) => setTimeout(r, 1000 * (i + 1))); }
    }
    s.reconnecting = false;
    if (!s.closed) { report(s, 'event', 'riconnessione non riuscita'); hangup('La chiamata si è interrotta: la linea non è tornata.'); }
  }
  // controllo ogni secondo: audio dell'iPhone sospeso, microfono spento dal sistema, Idea che non risponde
  async function watchdog(s) {
    if (s.closed || s.reconnecting) return;
    const c = s.c;
    if (c.state !== 'running') { note('audio ' + c.state); c.resume().catch(() => {}); }
    const tr = s.stream && s.stream.getAudioTracks()[0];
    if (tr && tr.readyState === 'ended' && !s.micFixing) { // iPhone: chiamata/Siri/blocco schermo spengono il microfono
      s.micFixing = true; note('mic ended');
      try { try { s.node && s.node.disconnect(); s.src && s.src.disconnect(); } catch {}
        s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); await startMic(s); report(s, 'event', 'microfono riattivato'); }
      catch (e) { stats.lastError = 'mic: ' + e.message; }
      s.micFixing = false;
    }
    if (!s.ready || !s.ws || s.ws.readyState !== 1) return;
    const now = Date.now();
    // hai finito di parlare ma non arriva risposta: la chiediamo noi
    if (s.waitSince && !s.responseActive && !playing(s) && !s.userSpeaking && now - s.waitSince > 5000) {
      s.waitSince = 0; note('nudge'); report(s, 'event', 'risposta sollecitata'); try { s.ws.send(JSON.stringify({ type: 'response.create' })); } catch {}
    }
    // risposta bloccata a metà (nessun audio da 15 s): la sblocchiamo
    if (s.responseActive && !playing(s) && now - (s.respAt || now) > 15000) { note('stuck response'); s.responseActive = false; s.resp = null; }
    // il microfono si accumula senza partire (oltre ~20 s di audio in coda): linea morta, riconnetto
    if (s.ws.bufferedAmount > 1000000) { note('dead line'); reconnect(s); }
  }

  // ---------- schermata ----------
  const fmt = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  function ui() {
    const s = S; if (!s) return;
    $('#call-status').textContent = s.reconnecting ? 'Riconnessione…' : !s.ready ? 'Chiamata in corso…' : s.muted ? 'Microfono spento' : playing(s) ? 'Ventuno sta parlando…' : s.userSpeaking ? 'Ti ascolto…' : 'In linea';
    $('#call-time').textContent = s.t0 ? fmt((Date.now() - s.t0) / 1000) : '';
    $('#call-mute').classList.toggle('on', !!s.muted); $('#call-mute').setAttribute('aria-pressed', s.muted ? 'true' : 'false');
  }
  function caption(t) { const el = $('#call-caption'); el.textContent = String(t || '').slice(-160); }

  async function start(opts) {
    opts = opts || {};
    const NN = window.NN; if (!NN || S) return;
    if (!supported()) return NN.status('Chiamata non supportata da questo browser.');
    // tutto nel tocco: contesto audio + sblocco + microfono (permesso chiesto qui)
    const c = new AC(); unlock(c); audioSession(true);
    const s = S = { c, early: [], sources: [], turns: [], playT: 0, ready: false, muted: false, closed: false, t0: 0, callId: (crypto.randomUUID ? crypto.randomUUID() : ('c' + Date.now() + Math.random().toString(16).slice(2))) };
    $('#call').hidden = false; caption(''); ui();
    s.timer = setInterval(ui, 500);
    try {
      const micP = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const cfgP = NN.api('/api/call/session', { method: 'POST', body: opts.incomingId ? { incomingId: opts.incomingId } : {} });
      s.stream = await micP.catch(() => { throw new Error('Microfono non consentito: attivalo nelle impostazioni del browser.'); });
      s.cfg = await cfgP;
      window.NNCall.lastGreet = (s.cfg && s.cfg.greet) || '';
      if (s.closed) return;
      await startMic(s);
      await connect(s);
      if (s.closed) return;
      s.t0 = Date.now(); s.lastEv = Date.now(); ui(); report(s, 'event', 'chiamata iniziata');
      s.dog = setInterval(() => watchdog(s), 1000);
      c.onstatechange = () => { if (!s.closed && c.state !== 'running') c.resume().catch(() => {}); };
      if (s.cfg.greet) s.ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'force_message', role: 'assistant', interruptible: true, content: [{ type: 'output_text', text: s.cfg.greet }] } }));
    } catch (e) { stats.lastError = e.message; hangup(e.message || 'Chiamata non riuscita.'); }
  }
  async function sayGoodbye(s) {
    if (!s.ws || s.ws.readyState !== 1 || !s.ready) return;
    s.ending = true; s.goodbyeHeard = false;
    caption('');
    $('#call-status').textContent = 'Saluto…';
    try {
      s.ws.send(JSON.stringify({
        type: 'response.create',
        response: { instructions: "L'utente sta riagganciando. Saluta in italiano in modo breve e naturale, una sola frase di commiato, senza fare domande e senza proporre altro. Poi taci." }
      }));
    } catch { return; }
    const t0 = Date.now();
    while (!s.closed && Date.now() - t0 < 8000) {
      if (s.goodbyeHeard && !playing(s) && !s.responseActive) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    const drain = Date.now();
    while (playing(s) && Date.now() - drain < 4000) await new Promise((r) => setTimeout(r, 80));
    await new Promise((r) => setTimeout(r, 180));
  }
  async function hangup(msg, opt) {
    const s = S; if (!s || s.closed) return;
    if (opt && opt.goodbye && !s.ending && s.ws && s.ws.readyState === 1 && s.ready && s.t0) {
      try { await sayGoodbye(s); } catch {}
    }
    if (s.closed) return;
    s.closed = true; S = null;
    clearInterval(s.timer); clearInterval(s.dog);
    if (s.resp && s.resp.text && !s.resp.saved) addTurn(s, 'assistant', s.resp.text + '…');
    try { s.ws && s.ws.close(); } catch {}
    stopPlayback(s);
    try { s.node && s.node.disconnect(); s.src && s.src.disconnect(); } catch {}
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    try { s.c.close(); } catch {}
    audioSession(false);
    $('#call').hidden = true;
    const sec = s.t0 ? Math.round((Date.now() - s.t0) / 1000) : 0;
    stats.lastTurns = s.turns.slice();
    if (msg) window.NN.status(msg);
    if (s.t0) {
      report(s, 'event', 'chiamata terminata, durata ' + (Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')));
      window.NN.status('Salvo la chiamata…');
      try { await window.NN.api('/api/call/end', { method: 'POST', body: { turns: s.turns, sec, callId: s.callId } }); window.NN.status(''); window.NN.poll(); stats.saved = true; }
      catch (e) { window.NN.status('Chiamata non salvata: ' + e.message); }
    }
  }
  function mute() { const s = S; if (!s) return; s.muted = !s.muted; if (s.muted && s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' })); ui(); }

  $('#call-btn').addEventListener('click', start);
  $('#call-end').addEventListener('click', () => hangup(null, { goodbye: true }));
  $('#call-mute').addEventListener('click', mute);
  window.NNCall.start = start; window.NNCall.hangup = hangup;
  window.addEventListener('pagehide', () => { if (S) hangup(); });
  document.addEventListener('visibilitychange', () => { const s = S; if (s && !document.hidden) { s.c.resume().catch(() => {}); if (s.ws && s.ws.readyState > 1) reconnect(s); } });
})();
