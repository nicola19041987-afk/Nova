/* Gesti della foto ferma: clip locali, una alla volta, mai sopra la bocca mentre parla e mai sopra Simli.
 * Il catalogo arriva da /api/gestures. Per aggiungerne uno: file in assets/gestures/ e una riga nel manifest
 * (full:true = tutto schermo, per i gesti a figura intera). */
(function () {
  const QUIET_MS = 700, IDLE_GAP = 180000, IDLE_AFTER = 90000;
  const FALLBACK = [
    { id: 'saluto', label: 'Saluta con la mano', emoji: '👋', full: false, keys: ['ciao con la mano', 'salut'], url: '/api/gestures/saluto' },
    { id: 'capelli', label: 'Si sistema i capelli', emoji: '💇‍♀️', full: false, keys: ['pettin', 'capell'], url: '/api/gestures/capelli' },
  ];
  let clips = FALLBACK.slice(), pending = null, playing = null, lastPlay = 0, lastTalk = Date.now(), quietSince = 0, lastIdleId = '';
  const video = () => document.getElementById('stage-video');
  const simli = () => document.body.classList.contains('simli-on') || !!(App.simli && App.simli.active && App.simli.active());
  const talking = () => !!(
    (App.avatarConv && App.avatarConv.speaking) ||
    (App.chat && App.chat.busy) ||
    (App.tts && (App.tts.playing || (App.tts.q && App.tts.q.length))) ||
    (App.rt && App.rt.speaking && App.rt.speaking()) ||
    (window.speechSynthesis && window.speechSynthesis.speaking)
  );
  function byId(id) { return clips.find((c) => c.id === id) || null; }
  function match(text) {
    const t = String(text || '').toLowerCase();
    const ranked = clips.slice().sort((a, b) => {
      const al = Math.max(0, ...(a.keys || []).map((k) => String(k).length));
      const bl = Math.max(0, ...(b.keys || []).map((k) => String(k).length));
      return bl - al;
    });
    for (const g of ranked) for (const k of g.keys || []) if (k && t.includes(String(k).toLowerCase())) return g.id;
    return null;
  }
  function hide(v) {
    if (!v) return;
    v.classList.remove('gesture-on');
    v.hidden = true;
    try { v.pause(); } catch { /* */ }
    playing = null;
  }
  function endClip(v, clip) {
    if (clip && clip.full && clip._restoreFull && App.solo && App.solo.toggleFull) App.solo.toggleFull(false);
    hide(v);
    if (pending && !talking() && !simli()) { const id = pending; pending = null; play(id); }
  }
  function play(id) {
    const clip = byId(id); if (!clip) return false;
    if (simli()) { pending = null; return false; }
    if (talking()) { pending = id; return false; }
    const v = video(); if (!v) return false;
    if (playing && playing.id === id) return true;
    playing = clip; pending = null; lastPlay = Date.now(); quietSince = 0;
    v.loop = false; v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); v.removeAttribute('loop');
    if (clip.full && App.solo && App.solo.toggleFull && !App.solo.full) { clip._restoreFull = true; App.solo.toggleFull(true); }
    else clip._restoreFull = false;
    const go = () => { if (playing !== clip) return; v.hidden = false; requestAnimationFrame(() => { if (playing === clip) v.classList.add('gesture-on'); }); const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    v.onended = () => { if (playing === clip) endClip(v, clip); };
    v.onerror = () => { if (playing === clip) endClip(v, clip); };
    if (v.getAttribute('src') !== clip.url) { v.oncanplay = () => { v.oncanplay = null; go(); }; v.src = clip.url; v.load(); }
    else go();
    return true;
  }
  function pump() {
    if (simli()) { pending = null; if (playing) endClip(video(), playing); return; }
    if (talking()) { lastTalk = Date.now(); quietSince = 0; if (playing) endClip(video(), playing); return; }
    if (pending) {
      if (!quietSince) { quietSince = Date.now(); return; }
      if (Date.now() - quietSince < QUIET_MS) return;
      const id = pending; pending = null; play(id); return;
    }
    if (!clips.length || playing) return;
    if (Date.now() - lastPlay < IDLE_GAP || Date.now() - lastTalk < IDLE_AFTER) return;
    if (Math.random() > 0.2) return;
    const pool = clips.filter((c) => clips.length < 2 || c.id !== lastIdleId);
    const clip = pool[Math.floor(Math.random() * pool.length)]; if (!clip) return;
    lastIdleId = clip.id; lastPlay = Date.now(); play(clip.id);
  }
  App.gestures = {
    match, list: () => clips.slice(), has: (id) => !!byId(id),
    async load() {
      try { const r = await App.api('/api/gestures'); if (Array.isArray(r) && r.length) clips = r; } catch { /* resta l'elenco precedente */ }
    },
    hear(text, opts) {
      const id = match(text); if (!id || simli()) return null;
      if (this._heard && this._heard.id === id && Date.now() - this._heard.at < 2500) return 'queued';
      this._heard = { id, at: Date.now() };
      if ((opts && opts.defer) || talking() || playing) { pending = id; quietSince = 0; return 'queued'; }
      play(id); return 'play';
    },
    request(id) {
      if (!byId(id) || simli()) return false;
      if (talking() || playing) { pending = id; quietSince = 0; return 'queued'; }
      play(id); return 'play';
    },
    pump, playing: () => !!playing,
    state: () => ({ pending, playing: playing && playing.id, lastPlay }),
    _quiet(ms) { quietSince = Date.now() - (ms || QUIET_MS); lastTalk = 0; },
  };
  setInterval(pump, 5000);
})();
