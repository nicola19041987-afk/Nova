/* Camera dell'utente: Nova riceve fotogrammi, non un video.
   Spenta all'avvio. Nessun fotogramma salvato, niente ripresa in background dopo lo stop. */
(function () {
  const CADENCE_MS = 8000;
  function cadence() { return (App.call && App.call.active) ? 3000 : CADENCE_MS; }
  const MAX_EDGE = 480;
  let want = false, owns = false, current = null, timer = null, latest = null, latestAt = 0, gen = 0, busy = false, lastTx = 0;

  function paintCam(btn) {
    if (!btn) return;
    btn.classList.toggle('on', want);
    btn.setAttribute('aria-pressed', want ? 'true' : 'false');
  }
  function ui() {
    paintCam(document.getElementById('dock-cam'));
    paintCam(document.getElementById('vn-cam'));
    const preview = document.getElementById('sight-preview');
    if (preview && !want) preview.hidden = true;
    const live = document.getElementById('sight-live');
    if (live) live.hidden = true;
    const status = document.getElementById('sight-status');
    if (status) status.hidden = true;
  }
  const chatCam = document.getElementById('vn-cam');
  if (chatCam) chatCam.addEventListener('click', (e) => { e.preventDefault(); if (!want && start) start(); });
  const previewEl = document.getElementById('sight-preview');
  if (previewEl) previewEl.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (want) stop(); });
  function release() {
    if (current && owns) current.getVideoTracks().forEach((t) => { try { t.stop(); } catch {} });
    current = null; owns = false;
    const v = document.getElementById('sight-preview');
    if (v) { v.srcObject = null; v.hidden = true; }
  }
  function borrowCall() {
    const v = document.getElementById('call-self');
    const st = v && v.srcObject;
    if (!st || !st.getVideoTracks) return null;
    return st.getVideoTracks().some((t) => t.readyState === 'live') ? st : null;
  }
  function waitFrame(v) {
    return new Promise((res) => {
      const t0 = Date.now();
      const tick = () => {
        if (!want) return res();
        if (v.videoWidth > 0 || Date.now() - t0 > 2000) return res();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  function videoEl() {
    const call = document.getElementById('call-self');
    if (call && !call.hidden && call.srcObject && call.videoWidth) return call;
    return document.getElementById('sight-preview');
  }
  function grab() {
    const v = videoEl();
    if (!v || !v.srcObject || !v.videoWidth || !v.videoHeight) return latest && Date.now() - latestAt < 20000 ? latest : null;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(32, Math.round(v.videoWidth * scale));
    const h = Math.max(32, Math.round(v.videoHeight * scale));
    const c = grab.canvas || (grab.canvas = document.createElement('canvas'));
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(v, 0, 0, w, h);
    let url = '';
    try { url = c.toDataURL('image/jpeg', 0.62); } catch { return null; }
    if (!url || url.length < 64 || url.length > 700000) return null;
    latest = url; latestAt = Date.now();
    return url;
  }
  function sample() {
    if (!want || document.hidden) return null;
    return grab();
  }
  function arm() {
    if (timer) clearInterval(timer);
    timer = setInterval(sample, cadence());
  }
  async function openStream() {
    const borrowed = borrowCall();
    owns = !borrowed;
    const stream = borrowed || await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } } });
    if (!want) { if (!borrowed) stream.getVideoTracks().forEach((t) => t.stop()); return; }
    current = stream;
    const v = document.getElementById('sight-preview');
    if (!v) { if (owns) stream.getVideoTracks().forEach((t) => t.stop()); current = null; return; }
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.autoplay = true;
    v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.srcObject = stream; v.hidden = false;
    try { await v.play(); } catch {}
    await waitFrame(v);
    grab();
  }
  async function start() {
    if (want) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    want = true; ui();
    try {
      await openStream();
      if (!want) { release(); ui(); return; }
      arm();
    } catch (e) {
      want = false; release(); if (timer) { clearInterval(timer); timer = null; } ui();
    }
  }
  function watch(stream) {
    if (!stream) return;
    want = true; owns = false; current = stream; ui();
    const v = document.getElementById('sight-preview');
    if (v && v.srcObject !== stream) { v.srcObject = stream; v.muted = true; v.hidden = true; }
    if (timer) clearInterval(timer);
    timer = setInterval(() => { sample(); noteForVoice().catch(() => {}); }, cadence());
  }
  function stop() {
    want = false; gen += 1; busy = false; latest = null; latestAt = 0;
    if (timer) { clearInterval(timer); timer = null; }
    release(); ui();
  }
  async function noteForVoice(opts) {
    opts = opts || {};
    if (!want) return '';
    const now = Date.now();
    if (!opts.force && (busy || now - lastTx < cadence())) return '';
    const frame = grab();
    if (!frame) return '';
    const id = App.current && App.current.id;
    if (!id) return '';
    const mine = ++gen;
    busy = true; lastTx = now;
    try {
      const r = await App.api(`/api/chats/${id}/sight`, { method: 'POST', body: { image: frame }, ai: true });
      if (mine !== gen || !want) return '';
      const note = String((r && r.note) || '').trim();
      if (!note) return '';
      return 'Fotogramma della fotocamera (un istante, non un video). Il modello che ha visto l\'immagine riferisce: ' + note;
    } catch (e) {
      return '';
    } finally { if (mine === gen) busy = false; }
  }
  async function onUtterance() {
    const note = await noteForVoice();
    if (!note || !want) return;
    const s = App.rt && App.rt._s && App.rt._s();
    if (!s || s.closed || !s.ws || s.ws.readyState !== 1) return;
    s.ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: note }] } }));
    if (s.userSpeaking) return;
    if (s.responseActive && !(s.resp && s.resp.text)) {
      try { s.ws.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
      s.ws.send(JSON.stringify({ type: 'response.create' }));
    }
  }
  function showNow() {
    if (!want) return;
    if (!grab()) return;
    if (App.rt && App.rt.active && App.rt.sendText && App.rt.sendText('Guarda questo.')) return;
    if (App.chat && App.chat.send) App.chat.send('Guarda questo.');
  }
  document.addEventListener('visibilitychange', () => {
    if (!want) return;
    if (document.hidden) {
      if (timer) { clearInterval(timer); timer = null; }
      if (owns) release();
      return;
    }
    if (!owns && current) { arm(); return; }
    openStream().then(() => { if (want) arm(); }).catch(() => { stop(); });
  });
  window.addEventListener('pagehide', () => { if (want) stop(); });

  App.sight = {
    CADENCE_MS,
    active: () => want,
    toggle() { if (want) stop(); else start(); },
    start, stop, watch, sample,
    takeFrame() { return want ? grab() : null; },
    onUtterance, noteForVoice,
    tracksLive() {
      return current && owns ? current.getVideoTracks().filter((t) => t.readyState === 'live').length : 0;
    },
  };
})();
