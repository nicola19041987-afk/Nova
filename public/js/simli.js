/* Volto Simli in videochiamata. Il token arriva dal nostro server; la chiave non esce mai dal server.
 * Se Simli non c'è, la foto disegnata resta com'è. La sessione si chiude a fine chiamata e quando l'app va in background. */
(function () {
  const CHUNK = 6000, ICE_QUIET = 250, ICE_CAP = 3000;
  let session = null, starting = null, queue = [], lines = [];

  function pcm16(samples, sampleRate) {
    const ratio = (sampleRate || 16000) / 16000;
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
  function show(on) {
    document.body.classList.toggle('simli-on', !!on);
    const v = document.getElementById('simli-video');
    if (v) v.hidden = !on;
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
  function close(why) {
    const s = session; session = null; queue = [];
    if (why) note(why, 'err');
    else note('', 'clear');
    if (!s) { show(false); return; }
    s.closed = true;
    try { s.ws && s.ws.close(); } catch { /* già chiuso */ }
    try { s.pc && s.pc.close(); } catch { /* già chiuso */ }
    const v = document.getElementById('simli-video');
    if (v) { try { v.pause(); } catch { /* */ } v.srcObject = null; v.hidden = true; }
    show(false);
  }
  function fail(why) { close(why || 'Video non disponibile'); }
  function wanted() { return !!(App.call && App.call.active && App.call.mode === 'video' && document.visibilityState !== 'hidden'); }
  function prime(video) {
    video.muted = true; video.defaultMuted = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
    try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch { /* fuori dal gesto */ }
  }
  function reveal(s) {
    const video = document.getElementById('simli-video');
    if (!s || s.closed || session !== s || !wanted() || !video || !video.srcObject) return;
    s.shown = true;
    show(true);
    note('', 'clear');
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
      else if (msg.type === 'answer' && msg.sdp) pc.setRemoteDescription(msg).catch(() => fail('Risposta video non valida'));
      else if (msg.video_metadata) note('Video ' + (msg.video_metadata.width || '') + '×' + (msg.video_metadata.height || ''), 'log');
      return;
    }
    if (text === 'START') { s.ready = true; if (wanted()) flush(); else close(); return; }
    if (text === 'ACK' || text === 'SPEAK' || text === 'SILENT' || text.startsWith('ENDFRAME:')) return;
    if (text.startsWith('CLOSING REASON')) { s.reason = sanitize(text); note(s.reason, 'log'); return; }
    if (text === 'STOP') { if (!s.shown) fail(s.reason || 'Video interrotto'); else close(); return; }
    if (/^(ERROR|RATE LIMIT|STOP REASON|CLIENT NOT CONNECTED)/.test(text)) { fail(text); return; }
    note(text, 'log');
  }
  async function start() {
    if (App.avatar3d && App.avatar3d.mode && App.avatar3d.mode() === '3d') return false;
    if (!wanted()) return false;
    if (session && !session.closed) return true;
    if (starting) return starting;
    const video = document.getElementById('simli-video');
    if (video) prime(video);
    note('Connessione video…', 'wait');
    const run = (async () => {
      let data;
      try { data = await App.api('/api/simli/session', { method: 'POST', body: {} }); }
      catch (e) { fail((e && e.message) || 'Video non disponibile'); return false; }
      if (!wanted() || !data || !data.session_token) { fail(data && data.error ? data.error : 'Video non disponibile'); return false; }
      if (!video || !window.RTCPeerConnection || !window.WebSocket) { fail('Questo browser non mostra il video'); return false; }
      const pc = new RTCPeerConnection({ iceServers: data.iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }] });
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); } catch { /* offerta senza transceiver */ }
      pc.addEventListener('track', (evt) => {
        if (!evt.track || evt.track.kind !== 'video' || !evt.streams || !evt.streams[0] || session !== s) return;
        video.srcObject = evt.streams[0];
        prime(video);
        watch(video, s);
      });
      const url = new URL('wss://api.simli.ai/compose/webrtc/p2p');
      url.searchParams.set('session_token', data.session_token);
      url.searchParams.set('enableSFU', 'true');
      const ws = new WebSocket(url);
      const s = { ws, pc, closed: false, ready: false, shown: false, watched: false, reason: '' };
      session = s;
      watch(video, s);
      ws.addEventListener('message', (ev) => { onMessage(s, pc, ev.data); });
      ws.addEventListener('close', () => { if (session === s && !s.shown) fail(s.reason || 'Video interrotto'); else if (session === s) close(); });
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' && session === s) fail('Connessione video persa'); });
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('Collegamento video non riuscito')), { once: true });
      });
      if (s.closed || !wanted()) { close(); return false; }
      await pc.setLocalDescription(await pc.createOffer());
      await iceGathered(pc);
      if (s.closed || ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }));
      return true;
    })();
    starting = run;
    try { return await run; } catch (e) { fail((e && e.message) || 'Video non disponibile'); return false; } finally { if (starting === run) starting = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') close();
    else if (wanted()) start();
  });
  window.addEventListener('pagehide', () => close());

  App.simli = {
    start, stop: close,
    active: () => !!(session && !session.closed),
    ready: () => !!(session && session.ready),
    log: () => lines.slice(),
    feedBuffer(buf) { try { if (buf && buf.getChannelData) sendBytes(pcm16(buf.getChannelData(0), buf.sampleRate)); } catch { /* audio non leggibile */ } },
    feedPcm24(buf) {
      try {
        const i16 = buf instanceof Int16Array ? buf : new Int16Array(buf);
        const f = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
        sendBytes(pcm16(f, 24000));
      } catch { /* formato inatteso */ }
    },
    interrupt() { try { if (session && session.ws && session.ws.readyState === 1) session.ws.send('SKIP'); } catch { /* socket chiuso */ } },
  };
})();
