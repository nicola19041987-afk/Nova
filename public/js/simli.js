/* Volto Simli in videochiamata. Il token arriva dal nostro server; la chiave non esce mai dal server.
 * Se Simli non c'è, la foto disegnata resta com'è. La sessione si chiude a fine chiamata e quando l'app va in background. */
(function () {
  const CHUNK = 6000;
  let session = null, starting = null, queue = [];

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
  function close() {
    const s = session; session = null; queue = [];
    if (!s) { show(false); return; }
    s.closed = true;
    try { s.ws && s.ws.close(); } catch { /* già chiuso */ }
    try { s.pc && s.pc.close(); } catch { /* già chiuso */ }
    const v = document.getElementById('simli-video');
    if (v) { v.srcObject = null; v.hidden = true; }
    show(false);
  }
  function wanted() { return !!(App.call && App.call.active && App.call.mode === 'video' && document.visibilityState !== 'hidden'); }
  async function start() {
    if (!wanted()) return false;
    if (session && !session.closed) return true;
    if (starting) return starting;
    const run = (async () => {
      let data;
      try { data = await App.api('/api/simli/session', { method: 'POST', body: {} }); }
      catch { show(false); return false; }
      if (!wanted() || !data || !data.session_token) { show(false); return false; }
      const video = document.getElementById('simli-video');
      if (!video || !window.RTCPeerConnection || !window.WebSocket) return false;
      const pc = new RTCPeerConnection({ iceServers: data.iceServers || [{ urls: ['stun:stun.l.google.com:19302'] }] });
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' }); } catch { /* offerta senza transceiver */ }
      pc.addEventListener('track', (evt) => {
        if (evt.track && evt.track.kind === 'video' && evt.streams && evt.streams[0]) {
          video.srcObject = evt.streams[0];
          const p = video.play && video.play(); if (p && p.catch) p.catch(() => {});
        }
      });
      const url = new URL('wss://api.simli.ai/compose/webrtc/p2p');
      url.searchParams.set('session_token', data.session_token);
      url.searchParams.set('enableSFU', 'true');
      const ws = new WebSocket(url);
      const s = { ws, pc, closed: false, ready: false };
      session = s;
      ws.addEventListener('message', async (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : '';
        if (!text || s.closed) return;
        if (text.startsWith('{')) {
          let msg; try { msg = JSON.parse(text); } catch { return; }
          if (msg.type === 'answer' && msg.sdp) { try { await pc.setRemoteDescription(msg); } catch { close(); } }
        } else if (text === 'START') { s.ready = true; if (wanted()) { show(true); flush(); } else close(); }
        else if (text === 'STOP' || /^(ERROR|RATE LIMIT|STOP REASON|CLIENT NOT CONNECTED)/.test(text)) close();
      });
      ws.addEventListener('close', () => { if (session === s) close(); });
      pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') close(); });
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true });
        ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
      });
      if (s.closed || !wanted()) { close(); return false; }
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((res) => {
        if (pc.iceGatheringState === 'complete') return res();
        const t = setTimeout(res, 400);
        pc.addEventListener('icecandidate', (e) => { if (!e.candidate) { clearTimeout(t); res(); } });
      });
      if (s.closed || ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }));
      return true;
    })();
    starting = run;
    try { return await run; } catch { close(); return false; } finally { if (starting === run) starting = null; }
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
