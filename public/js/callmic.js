/* callmic.js — v8.4.1: microfono della chiamata CLASSICA senza il riconoscimento vocale del telefono.
 * Perché: su iPhone ogni stop/start di webkitSpeechRecognition suona il "bip" di attacco/stacco e cambia la sessione audio.
 * Qui il microfono resta aperto per tutta la chiamata (un solo getUserMedia con cancellazione dell'eco, riduzione del rumore e
 * guadagno automatico, sull'AudioContext unico); un nostro rilevatore del parlato (energia + soglia adattiva al rumore di fondo)
 * capisce quando inizi e finisci di parlare; la frase (WAV 24 kHz) va alla trascrizione xAI (/api/stt) e poi alla chat.
 * Se parli mentre lei parla (più forte del suo eco) la interrompi. Se la trascrizione non funziona: riconoscimento continuo
 * del telefono, senza riavvii per frase. */
(function () {
  const RATE = 24000, CH_MS = 100;
  const AC = window.AudioContext || window.webkitAudioContext;
  const P = { pre: 4, startN: 3, endMs: 720, minMs: 650, maxMs: 25000, bargeN: 7 }; // un rumore sotto ~0,7 s non è un turno e non la interrompe
  let M = null;
  const SHORT_OK = /^(s[iì]|no|ok|okay|ciao|grazie|certo|dai|boh|forse|esatto|perfetto|brava|bravo|bene|male|cosa|come|chi|perch[eé]|dove|quando|aspetta|basta|stop|ehi|ehm|allora|vero|davvero|sicuro|infatti|appunto|giusto|ecco|tranquilla|scusa|buonanotte|buongiorno|buonasera|benissimo|ottimo|figurati|magari|mai|sempre|prego|pronto|oddio|wow|mh+|ah+|oh+|eh+)$/i;
  const ctx = () => { if (!App.audio.ctx) App.audio.ctx = new AC(); if (App.audio.ctx.state !== 'running') App.audio.ctx.resume().catch(() => {}); return App.audio.ctx; };
  const herVoice = () => !!(App.tts && (App.tts.playing || App.tts.q.length)) || !!(App.avatarConv && App.avatarConv.speaking);
  function wav(chunks) {
    const n = chunks.reduce((a, c) => a + c.byteLength / 2, 0), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44; for (const c of chunks) { new Uint8Array(b, o, c.byteLength).set(new Uint8Array(c)); o += c.byteLength; }
    return new Blob([b], { type: 'audio/wav' });
  }
  function onChunk(m, pcm, rms) {
    if (m.closed) return;
    m.level = rms;
    // v8.4.7: microfono che consegna solo silenzio (iPhone: sessione audio sbagliata / traccia muta) -> riaperto UNA volta da solo
    if (rms > m.peak2) m.peak2 = rms;
    if (!m.reacq && !App.audio._reacq && m.t0) {
      const tr = m.stream && m.stream.getAudioTracks()[0], mutedT = !!(tr && (tr.muted || tr.readyState !== 'live'));
      if (mutedT || (performance.now() - m.t0 > 4000 && m.peak2 < 0.0012)) { m.reacq = true; App.audio.reacquire(mutedT ? 'traccia muta' : 'livello quasi zero').catch(() => {}); return; }
    }
    if (m.muted) { m.pre = []; m.speech = null; return; }
    const her = herVoice(), now = performance.now();
    if (her && m.noBarge && !m.speech) { m.pre = []; m.hot = 0; return; } // v8.4.5: fuori chiamata non la interrompe il suo stesso eco
    if (!m.speech) {
      if (!her && rms < m.floor * 2.5) m.floor = Math.max(0.003, m.floor * 0.95 + rms * 0.05); // rumore di fondo (solo quando nessuno parla)
      const th = her ? Math.max(0.07, m.floor * 9) : Math.max(0.02, m.floor * 3.4); // mentre lei parla serve voce sostenuta (l'eco e i colpi secchi non la interrompono)
      m.pre.push(pcm); if (m.pre.length > P.pre + P.bargeN) m.pre.shift();
      m.hot = rms > th ? m.hot + 1 : 0;
      if (m.hot >= (her ? P.bargeN : P.startN)) {
        m.speech = { chunks: m.pre.splice(0), startAt: now, lastVoiceAt: now }; m.hot = 0;
        if (her) { m.barges++; App.voice.cancel(); App.avatarConv && App.avatarConv.stopAudio(); if (App.avatarPresence) App.avatarPresence.stopAudio(); }
        warm(); if (App.call && App.call.onInterim) App.call.onInterim('…');
        m.onState && m.onState('speech');
      }
      return;
    }
    const sp = m.speech; sp.chunks.push(pcm);
    if (rms > Math.max(0.011, m.floor * 2.2)) { sp.lastVoiceAt = now; sp.voiced = (sp.voiced || 0) + 1; }
    sp.peak = Math.max(sp.peak || 0, rms);
    if (App.call && App.call.onInterim && sp.chunks.length % 8 === 0) App.call.onInterim('…'); // annuisce ogni tanto mentre parli
    const dur = sp.chunks.length * CH_MS;
    if (now - sp.lastVoiceAt >= P.endMs || dur >= P.maxMs) { m.speech = null; m.onState && m.onState('idle'); finish(m, sp); }
  }
  let lastWarm = 0;
  function warm() { // pre-apre le connessioni verso xAI mentre stai ancora parlando (trascrizione e risposta le riusano)
    const now = Date.now(); if (now - lastWarm < 4000) return; lastWarm = now;
    App.api('/api/ai-warm', { method: 'POST', ai: true }).catch(() => {});
  }
  async function finish(m, sp) {
    const voiced = sp.lastVoiceAt - sp.startAt; if (voiced < P.minMs) { m.dropped = (m.dropped || 0) + 1; return; } // colpo di tosse, rumore breve
    // v8.4.5: segmenti deboli o con pochissima voce vera (rumore, eco, respiro) = parole a caso dalla trascrizione ("Foglia", "Gatto"): scartati
    if ((sp.voiced || 0) * CH_MS < 400 || (sp.peak || 0) < Math.max(0.03, m.floor * 5)) { m.dropped = (m.dropped || 0) + 1; return; }
    const endAt = sp.lastVoiceAt, t0 = performance.now();
    try {
      const r = await App.api('/api/stt', { method: 'POST', body: wav(sp.chunks), headers: { 'Content-Type': 'audio/wav' }, ai: true, rawBody: true });
      m.sttMs.push(Math.round(performance.now() - t0)); m.fails = 0;
      if (App.latency) App.latency.cur = { end: endAt, stt: Math.round(performance.now() - endAt) }; // v8.4.5: tempi per Diagnostica
      const text = String((r && r.text) || '').trim();
      if (!text || m.closed) return;
      // v8.4.5: una sola parola "strana" da un segmento corto è quasi sempre un errore di trascrizione: scartata (le risposte brevi vere restano)
      const words = text.replace(/[.,!?…;:"«»]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (words.length === 1 && voiced < 900 && !SHORT_OK.test(words[0])) { m.dropped = (m.dropped || 0) + 1; console.info('Trascrizione scartata (parola isolata):', text); return; }
      const tw = performance.now(); while (App.chat.busy && !m.closed && performance.now() - tw < 10000) await new Promise((r) => setTimeout(r, 100)); // risposta precedente ancora in arrivo
      if (m.closed) return;
      if (App.latency) App.latency.mark = endAt; // ritardo misurato da quando hai smesso di parlare
      if (m.onText) m.onText(text); else App.chat.send(text);
    } catch (e) {
      m.fails++; console.warn('Trascrizione:', e.message);
      if ((m.fails >= 2 || (e.status && e.status < 500)) && !m.closed && m.onFail) m.onFail(e);
    }
  }
  App.callMic = {
    supported: () => !!(AC && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    async start(opts = {}) {
      App.callMic.stop();
      const m = M = { onText: opts.onText, noBarge: !!opts.noBarge, dropped: 0, closed: false, muted: false, floor: 0.008, hot: 0, pre: [], speech: null, sttMs: [], fails: 0, barges: 0, level: 0, onFail: opts.onFail, onState: opts.onState };
      m.stream = await App.audio.mic(); // v8.4.4: lo stesso microfono per tutta la chiamata (anche dopo il tempo reale)
      if (m.closed) return;
      const c = ctx(); m.c = c; m.t0 = performance.now(); m.peak2 = 0; // v8.4.7: contesto audio DOPO il microfono (iPhone)
      m.src = c.createMediaStreamSource(m.stream);
      m.offLost = App.audio.onMicLost(() => { if (m.closed) return; App.callMic.start(opts).catch((e) => { if (m.onFail) m.onFail(e); }); }); // v8.4.7: microfono riaperto -> catena audio ricostruita sul contesto nuovo
      await c.audioWorklet.addModule('/js/rt-worklet.js');
      m.node = new AudioWorkletNode(c, 'rt-capture'); m.node.port.onmessage = (e) => onChunk(m, e.data.pcm, e.data.rms);
      m.sink = c.createGain(); m.sink.gain.value = 0; m.src.connect(m.node); m.node.connect(m.sink); m.sink.connect(c.destination);
      return true;
    },
    stop() {
      const m = M; if (!m) return; M = null; m.closed = true;
      try { m.node && m.node.disconnect(); m.src && m.src.disconnect(); m.sink && m.sink.disconnect(); } catch {}
      if (m.offLost) m.offLost(); // v8.4.4: niente stop delle tracce: il microfono condiviso si chiude solo riattaccando
    },
    setMuted(v) { if (M) { M.muted = !!v; M.speech = null; M.pre = []; } },
    get active() { return !!(M && !M.closed); },
    speaking: () => !!(M && M.speech),
    stats: () => (M ? { floor: +M.floor.toFixed(4), level: +M.level.toFixed(4), sttMs: M.sttMs.slice(), barges: M.barges, dropped: M.dropped || 0 } : null),
    _wav: wav,
  };
})();
