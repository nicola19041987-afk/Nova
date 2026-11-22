/* Volto Simli in videochiamata. Il token arriva dal nostro server; la chiave non esce mai dal server.
 * Se Simli non c'è, la foto disegnata resta com'è. La sessione si chiude a fine chiamata e quando l'app va in background.
 * v2d-49: Simli chiude da sé la sessione (durata massima o troppo silenzio). Finché la videochiamata è aperta:
 *  - poco prima della durata massima si prepara una seconda sessione e si passa a quella appena manda video (senza stacchi);
 *  - se una sessione si chiude lo stesso (silenzio, rete), si chiede un token nuovo e si riconnette, con attese crescenti
 *    e un numero massimo di tentativi; nel frattempo resta la foto con la bocca sull'audio. */
(function () {
  const CHUNK = 6000, ICE_QUIET = 250, ICE_CAP = 3000;
  const RETRY_MAX = 5, RETRY_BASE_MS = 800, RETRY_CAP_MS = 15000, HANDOVER_LEAD_S = 25, DEF_MAX_S = 300;
  let session = null, starting = null, queue = [], lines = [];
  let next = null; // v2d-49: sessione nuova in preparazione (cambio prima della durata massima)
  const retry = { n: 0, timer: 0, total: 0 };
  const stats = { handovers: 0, reconnects: 0 };
  let connGen = 0; // v2d-67b: close() invalida le connessioni ancora in volo (niente volto dopo lo stop)
  function blockedByLocation() {
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

  // v2d-49: 24 kHz (o 44,1/48 kHz) -> 16 kHz con un filtro passa-basso prima del ricampionamento (niente frequenze ripiegate
  // sopra gli 8 kHz che diventano fruscio e «sibili» nella bocca di Simli). FIR finestrato, coda conservata tra un pezzo e l'altro.
  const lp = { ratio: 0, taps: null, tail: null };
  function lpTaps(ratio) {
    if (lp.ratio === ratio && lp.taps) return lp.taps;
    const N = 31, fc = 0.45 / ratio, mid = (N - 1) / 2, t = new Float32Array(N); let sum = 0;
    for (let k = 0; k < N; k++) {
      const x = k - mid, sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (N - 1));
      t[k] = sinc * w; sum += t[k];
    }
    for (let k = 0; k < N; k++) t[k] /= sum;
    lp.ratio = ratio; lp.taps = t; lp.tail = null;
    return t;
  }
  function lowpass(samples, ratio, stream) {
    if (!(ratio > 1.01) || !samples.length) return samples;
    const t = lpTaps(ratio), N = t.length, h = N - 1;
    const prev = stream && lp.tail && lp.tail.length === h ? lp.tail : new Float32Array(h);
    const x = new Float32Array(h + samples.length); x.set(prev, 0); x.set(samples, h);
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) { let acc = 0; for (let k = 0; k < N; k++) acc += x[i + k] * t[k]; out[i] = acc; }
    if (stream) lp.tail = x.slice(x.length - h);
    return out;
  }
  function pcm16(samples, sampleRate, stream) {
    const ratio = (sampleRate || 16000) / 16000;
    samples = lowpass(samples, ratio, stream);
    const n = Math.max(0, Math.floor(samples.length / ratio));
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * ratio, i0 = Math.floor(p), f = p - i0;
      const a = samples[i0] || 0, b = samples[Math.min(samples.length - 1, i0 + 1)] || 0;
      const v = Math.max(-1, Math.min(1, a + (b - a) * f));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return new Uint8Array(out.buffer);
  }
  function sanitize(raw) {
    let t = String(raw || '');
    t = t.replace(/^STOP REASON:\s*/i, '').replace(/^CLOSING REASON:\s*/i, '').replace(/^ERROR:\s*/i, '').replace(/^RATE LIMIT REACHED!?\s*/i, '');
    t = t.replace(/session_token[=:]\s*\S+/gi, '').replace(/["']?sdp["']?\s*[:=][\s\S]*/i, '');
    t = t.replace(/\s+/g, ' ').trim().slice(0, 120);
    return t || 'Video non disponibile';
  }
  function paintLog() {
    const ul = document.getElementById('simli-log');
    if (!ul) return;
    ul.innerHTML = lines.map((x) => `<li>${esc(x.t)} ${esc(x.line)}</li>`).join('');
    ul.scrollTop = ul.scrollHeight;
  }
  function note(raw, kind) {
    const el = document.getElementById('simli-status');
    if (kind === 'clear') {
      if (el) { el.hidden = true; el.classList.remove('err'); el.textContent = ''; }
      return;
    }
    const line = kind === 'wait' ? 'Connessione video…' : sanitize(raw);
    if (kind !== 'wait') {
      lines.push({ t: new Date().toISOString().slice(11, 19), line });
      if (lines.length > 30) lines.shift();
      paintLog();
    }
    if (!el) return;
    if (kind === 'wait') { el.hidden = false; el.classList.remove('err'); el.textContent = line; }
    else if (kind === 'err') { el.hidden = false; el.classList.add('err'); el.textContent = line; }
  }
  // v2d-46: il volto Simli si mostra SOLO se è quello di Ira creato dalla sua foto (App.me.simliFace, deciso dal server).
  function show(on) {
    document.body.classList.toggle('simli-on', !!on);
    const v = document.getElementById('simli-video');
    if (v && !on) { v.hidden = true; try { v.pause(); } catch { /* già fermo */ } v.srcObject = null; }
    if (v && on) v.hidden = false;
    voiceFrom(false); // v2d-67b: mai l'audio di Simli — la voce resta solo Eve in tempo reale
  }
  // v2d-67b: il video Simli resta muto; non si collega mai la traccia audio di Simli alle casse (evita la doppia voce).
  // Prima (v2d-46) si abbassava Eve quando arrivava audio da Simli: in chiamata si sentivano due voci.
  let sa = null;
  function voiceFrom(on) {
    // v2d-67b: nessuna uscita audio da Simli. Si stacca eventuale grafo precedente e si lascia Eve.
    if (sa) { clearInterval(sa.t); try { sa.src.disconnect(); sa.g.disconnect(); } catch { /* */ } sa = null; }
    if (App.rt && App.rt.localMute) App.rt.localMute(false);
  }
  function sendBytes(bytes) {
    const ws = session && session.ws;
    if (!bytes || !bytes.length) return;
    if (!ws || ws.readyState !== 1 || !session.ready) { queue.push(bytes); return; }
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
      const even = slice.length - (slice.length % 2);
      if (even > 0) ws.send(slice.subarray(0, even));
    }
  }
  function flush() { const q = queue; queue = []; q.forEach(sendBytes); }
  function teardown(s) {
    if (!s) return;
    s.closed = true; clearTimeout(s.handT);
    try { s.ws && s.ws.close(); } catch { /* già chiuso */ }
    try { s.pc && s.pc.close(); } catch { /* già chiuso */ }
  }
  // fine della videochiamata (o app in background): tutto chiuso, nessun nuovo tentativo
  function close(why) {
    connGen += 1;
    const s = session; session = null; queue = [];
    clearTimeout(retry.timer); retry.timer = 0; retry.n = 0;
    const nx = next; next = null; teardown(nx);
    if (why) note(why, 'err');
    else note('', 'clear');
    if (!s) { show(false); return; }
    teardown(s);
    const v = document.getElementById('simli-video');
    if (v) { try { v.pause(); } catch { /* */ } v.srcObject = null; v.hidden = true; }
    show(false);
  }
  function fail(why) { close(why || 'Video non disponibile'); }
  // v2d-49: una sessione è finita da sola (STOP di Simli, socket chiuso, rete) o non è partita. Se la videochiamata è ancora
  // aperta si riconnette con un token nuovo; dopo RETRY_MAX tentativi di fila falliti resta la foto (come prima).
  function ended(s, why) {
    if (s && s === next) { next = null; teardown(s); if (session && !session.closed) return; s = null; } // il ricambio non è partito: resta quella attuale (se c'è)
    else if (s && session !== s) return;
    else if (!s && session && !session.closed) return;
    const wasShown = !!(s && s.shown);
    if (s) { session = null; teardown(s); }
    if (!wanted() || !(App.me && App.me.simliFace) || blockedByLocation()) { fail(why); return; }
    if (wasShown) retry.n = 0; // funzionava: si riparte da capo con i tentativi
    if (retry.n >= RETRY_MAX) { fail(why || 'Video non disponibile'); return; }
    if (!next) show(false); // intanto la foto con la bocca sull'audio (la voce resta quella locale)
    if (why) note(why, 'log');
    const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * Math.pow(2, retry.n));
    retry.n++; retry.total++; stats.reconnects++;
    clearTimeout(retry.timer);
    retry.timer = setTimeout(() => { retry.timer = 0; if (wanted() && !session && !next) connect(false); }, delay); // con un ricambio in arrivo si aspetta quello
  }
  // v2d-49: passa alla sessione nuova appena ha il video e Simli è pronto: stesso elemento video, la vecchia si chiude dopo.
  function promote(s) {
    if (next !== s || s.closed || !s.ready || !s.stream) return;
    const old = session; next = null; session = s;
    const video = document.getElementById('simli-video');
    if (sa) voiceFrom(false);
    if (video) { video.srcObject = s.stream; prime(video); watch(video, s); }
    teardown(old);
    stats.handovers++;
    flush();
  }
  function handover(s) {
    if (session !== s || s.closed || next || !wanted()) return;
    connect(true);
  }
  function wanted() { return !!(App.call && App.call.active && App.call.mode === 'video' && document.visibilityState !== 'hidden'); }
  function prime(video) {
    video.muted = true; video.defaultMuted = true; video.volume = 0; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
    try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch { /* fuori dal gesto */ }
  }
  function reveal(s) {
    const video = document.getElementById('simli-video');
    if (!s || s.closed || session !== s || !wanted() || blockedByLocation() || !video || !video.srcObject) return;
    s.shown = true; retry.n = 0;
    show(true);
    note('', 'clear');
    // v2d-49: poco prima della durata massima si prepara la sessione successiva
    clearTimeout(s.handT);
    const lead = Math.max(5, Math.min(HANDOVER_LEAD_S, (s.maxLen || DEF_MAX_S) / 4));
    s.handT = setTimeout(() => handover(s), Math.max(1000, ((s.maxLen || DEF_MAX_S) - lead) * 1000 - (performance.now() - (s.startedAt || performance.now()))));
  }
  function watch(video, s) {
    if (s.watched) return;
    s.watched = true;
    const mark = () => reveal(s);
    video.addEventListener('playing', mark);
    video.addEventListener('loadeddata', mark);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => mark());
  }
  function iceGathered(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let done = false, timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(cap); clearTimeout(timer);
        pc.removeEventListener('icecandidate', onIce);
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      const cap = setTimeout(finish, ICE_CAP);
      timer = setTimeout(finish, ICE_QUIET);
      function onIce(evt) {
        clearTimeout(timer);
        if (!evt.candidate) finish();
        else timer = setTimeout(finish, ICE_QUIET);
      }
      function onState() { if (pc.iceGatheringState === 'complete') finish(); }
      pc.addEventListener('icecandidate', onIce);
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }
  function onMessage(s, pc, data) {
    const text = typeof data === 'string' ? data : '';
    if (!text || s.closed) return;
    if (text.startsWith('{')) {
      let msg; try { msg = JSON.parse(text); } catch { return; }
      if (msg.destination) note('Sessione video', 'log');
      else if (msg.type === 'answer' && msg.sdp) pc.setRemoteDescription(msg).catch(() => ended(s, 'Risposta video non valida'));
      else if (msg.video_metadata) note('Video ' + (msg.video_metadata.width || '') + '×' + (msg.video_metadata.height || ''), 'log');
      return;
    }
    if (text === 'START') { s.ready = true; s.startedAt = performance.now(); if (!wanted()) { close(); return; } if (s === next) promote(s); else flush(); return; }
    if (text === 'ACK' || text === 'SPEAK' || text === 'SILENT' || text.startsWith('ENDFRAME:')) return;
    if (text.startsWith('CLOSING REASON')) { s.reason = sanitize(text); note(s.reason, 'log'); return; }
    if (text === 'STOP') { ended(s, s.reason || 'Video interrotto'); return; } // v2d-49: durata massima o silenzio -> si riconnette
    if (/^(ERROR|RATE LIMIT|STOP REASON|CLIENT NOT CONNECTED)/.test(text)) { ended(s, text); return; }
    note(text, 'log');
  }
  // permanente: niente volto, niente chiave, non attivato -> nessun nuovo tentativo
  const PERMANENT = new Set([401, 403, 404, 409, 503]);
  async function start() {
    if (!(App.me && App.me.simliFace)) { close(); return false; } // v2d-46: nessun volto di Ira pronto -> foto con la bocca sull'audio
    // v2d-66: mai Simli insieme ai clip di luogo (un solo strato visivo).
    if (blockedByLocation()) { close(); return false; }
    if (!wanted()) return false;
    if (session && !session.closed) return true;
    if (starting) return starting;
    clearTimeout(retry.timer); retry.timer = 0;
    return connect(false);
  }
  // asHandover: sessione di ricambio (resta in «next» finché non manda video, poi prende il posto di quella attuale)
  async function connect(asHandover) {
    if (!asHandover && starting) return starting;
    const video = document.getElementById('simli-video');
    if (video && !asHandover) prime(video);
    if (!asHandover && !(session && session.shown)) note('Connessione video…', 'wait');
    let s = null;
    const bad = (why, permanent) => { if (permanent || !s) { if (asHandover) return false; if (permanent) { fail(why); return false; } } ended(s, why); return false; };
    const gen = connGen;
    const stale = () => gen !== connGen;
    const run = (async () => {
      let data;
      try { data = await App.api('/api/simli/session', { method: 'POST', body: {} }); }
      catch (e) {
        if (stale() || asHandover) return false;
        const why = (e && e.message) || 'Video non disponibile';
        if (e && PERMANENT.has(e.status)) { fail(why); return false; }
        ended(null, why); return false;
      }
      if (stale()) return false;
      if (!wanted() || blockedByLocation()) { if (!asHandover) fail('Video non disponibile'); return false; }
      if (!data || !data.session_token) { if (!asHandover) fail(data && data.error ? data.error : 'Video non disponibile'); return false; }
      if (!video || !window.RTCPeerConnection || !window.WebSocket) { if (!asHandover) fail('Questo browser non mostra il video'); return false; }
      const pc = new RTCPeerConnection({ iceServers: data.iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }] });
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); } catch { /* offerta senza transceiver */ }
      const url = new URL('wss://api.simli.ai/compose/webrtc/p2p');
      url.searchParams.set('session_token', data.session_token);
      url.searchParams.set('enableSFU', 'true');
      const ws = new WebSocket(url);
      s = { ws, pc, closed: false, ready: false, shown: false, watched: false, reason: '', maxLen: +data.maxSessionLength || DEF_MAX_S, handover: !!asHandover, handT: 0, stream: null, startedAt: 0 };
      if (asHandover) next = s; else session = s;
      pc.addEventListener('track', (evt) => {
        if (!evt.track || evt.track.kind !== 'video' || !evt.streams || !evt.streams[0] || s.closed) return;
        s.stream = evt.streams[0];
        if (stale() || blockedByLocation() || !wanted()) { teardown(s); return; }
        if (session === s) { video.srcObject = evt.streams[0]; prime(video); watch(video, s); }
        else if (next === s) promote(s);
      });
      ws.addEventListener('message', (ev) => { onMessage(s, pc, ev.data); });
      ws.addEventListener('close', () => { if (session === s || next === s) ended(s, s.reason || 'Video interrotto'); });
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' && (session === s || next === s)) ended(s, 'Connessione video persa'); });
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('Collegamento video non riuscito')), { once: true });
      });
      if (s.closed || stale()) return false;
      if (!wanted() || blockedByLocation()) { close(); return false; }
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      if (s.closed || stale() || ws.readyState !== 1) return false;
      if (!wanted() || blockedByLocation()) { close(); return false; }
      ws.send(JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }));
      return true;
    })();
    if (!asHandover) starting = run;
    try { return await run; } catch (e) { return bad((e && e.message) || 'Video non disponibile', false); } finally { if (starting === run) starting = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') close();
    else if (wanted()) start();
  });
  window.addEventListener('pagehide', () => close());

  App.simli = {
    start, stop: close,
    blockedByLocation,
    active: () => !!(session && !session.closed),
    ready: () => !!(session && session.ready),
    log: () => lines.slice(),
    stats: () => ({ ...stats, retries: retry.n, pending: !!next, waiting: !!retry.timer }), // v2d-49: per le prove
    _pcm16: pcm16, // v2d-49: per le prove (filtro + ricampionamento)
    feedBuffer(buf) { try { if (buf && buf.getChannelData) sendBytes(pcm16(buf.getChannelData(0), buf.sampleRate, false)); } catch { /* audio non leggibile */ } },
    feedPcm24(buf) {
      try {
        const i16 = buf instanceof Int16Array ? buf : new Int16Array(buf);
        const f = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
        sendBytes(pcm16(f, 24000, true));
      } catch { /* formato inatteso */ }
    },
    interrupt() { try { if (session && session.ws && session.ws.readyState === 1) session.ws.send('SKIP'); } catch { /* socket chiuso */ } },
  };
})();
