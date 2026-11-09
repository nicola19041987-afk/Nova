/* Camera dell'utente: Nova riceve fotogrammi, non un video.
   Spenta all'avvio. Nessun fotogramma salvato, niente ripresa in background dopo lo stop. */
(function () {
  const CADENCE_MS = 8000;
  const MAX_EDGE = 480;
  let want = false, owns = false, current = null, timer = null, latest = null, latestAt = 0, gen = 0, busy = false, lastTx = 0;

  function camError(e) {
    const n = (e && e.name) || '';
    if (!window.isSecureContext) return 'Fotocamera non disponibile: serve una connessione sicura (https).';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Fotocamera non consentita. Consenti l\'accesso nelle impostazioni del sito e tocca di nuovo Camera.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nessuna fotocamera trovata su questo dispositivo.';
    if (n === 'NotReadableError' || n === 'AbortError') return 'Fotocamera occupata da un\'altra app. Chiudila e tocca di nuovo Camera.';
    return 'Fotocamera non disponibile' + (e && e.message ? ': ' + e.message : '.');
  }
  function ui() {
    const b = document.getElementById('dock-cam');
    if (b) {
      b.classList.toggle('on', want);
      b.setAttribute('aria-pressed', want ? 'true' : 'false');
      b.setAttribute('aria-label', want ? 'Camera accesa: Nova riceve fotogrammi' : 'Camera');
    }
    const el = document.getElementById('sight-status');
    const preview = document.getElementById('sight-preview');
    if (preview && !want) preview.hidden = true;
    if (!el) return;
    el.hidden = !want;
    if (!want) { el.textContent = ''; return; }
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = 'Nova ti vede a fotogrammi, circa ogni 8 secondi. Non è un video continuo e non registra.';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'sight-show'; btn.textContent = 'Faglielo vedere';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showNow(); });
    el.append(span, btn);
  }
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
  function grab() {
    const v = document.getElementById('sight-preview');
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
    timer = setInterval(sample, CADENCE_MS);
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { App.toast(camError({ name: 'NotFoundError' }), 7000); return; }
    want = true; ui();
    try {
      await openStream();
      if (!want) { release(); ui(); return; }
      arm();
      App.toast('Camera accesa. Nova riceve un fotogramma circa ogni 8 secondi, non un video. Tieni premuto Camera per la videochiamata.', 5500);
    } catch (e) {
      want = false; release(); if (timer) { clearInterval(timer); timer = null; } ui();
      App.toast(camError(e), 8000);
    }
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
    if (!opts.force && (busy || now - lastTx < CADENCE_MS)) return '';
    const frame = grab();
    if (!frame) { App.toast('Fotogramma non disponibile.'); return ''; }
    const id = App.current && App.current.id;
    if (!id) return '';
    const mine = ++gen;
    busy = true; lastTx = now;
    try {
      const r = await App.api(`/api/chats/${id}/sight`, { method: 'POST', body: { image: frame }, ai: true });
      if (mine !== gen || !want) return '';
      const note = String((r && r.note) || '').trim();
      if (!note) { App.toast('Il servizio non ha descritto il fotogramma.'); return ''; }
      return 'Fotogramma della fotocamera (un istante, non un video). Il modello che ha visto l\'immagine riferisce: ' + note;
    } catch (e) {
      if (mine === gen && want) App.toast((e && e.message) || 'Nova non ha ricevuto il fotogramma');
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
    if (!grab()) { App.toast('Nessun fotogramma: controlla la camera.'); return; }
    if (App.rt && App.rt.active && App.rt.sendText && App.rt.sendText('Guarda questo.')) return;
    if (App.chat && App.chat.send) App.chat.send('Guarda questo.');
  }
  document.addEventListener('visibilitychange', () => {
    if (!want) return;
    if (document.hidden) {
      if (timer) { clearInterval(timer); timer = null; }
      release();
      return;
    }
    openStream().then(() => { if (want) arm(); }).catch((e) => { stop(); App.toast(camError(e), 8000); });
  });
  window.addEventListener('pagehide', () => { if (want) stop(); });

  App.sight = {
    CADENCE_MS,
    active: () => want,
    toggle() { if (want) stop(); else start(); },
    start, stop, sample,
    takeFrame() { return want ? grab() : null; },
    onUtterance, noteForVoice,
    tracksLive() {
      return current && owns ? current.getVideoTracks().filter((t) => t.readyState === 'live').length : 0;
    },
  };
})();
