/* call-video.js — video su richiesta durante la videochiamata in tempo reale.
 * Ira chiama lo strumento mostra_video; il pannello compare in basso (non copre il viso),
 * la sessione vocale resta aperta. Il video finisce anche in chat. */
(function () {
  if (window.__novaCallVideoBound) return;
  window.__novaCallVideoBound = true;

  const panel = () => document.getElementById('call-video-panel');
  const title = () => document.getElementById('call-video-title');
  const progress = () => document.getElementById('call-video-progress');
  const player = () => document.getElementById('call-video-player');
  const soundBtn = () => document.getElementById('call-video-sound');
  const closeBtn = () => document.getElementById('call-video-close');

  let pollT = 0;
  let jobId = '';
  let dragging = false;
  let dragX = 0, dragY = 0, startL = 0, startT = 0;

  function stopPoll() { if (pollT) { clearTimeout(pollT); pollT = 0; } }

  function hide() {
    stopPoll();
    jobId = '';
    const p = panel(), v = player(), pr = progress(), s = soundBtn();
    if (!p) return;
    p.hidden = true;
    p.style.left = '';
    p.style.top = '';
    p.style.right = '';
    p.style.bottom = '';
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.hidden = true; }
    if (pr) { pr.hidden = false; pr.textContent = 'Sto preparando il video…'; }
    if (s) s.hidden = true;
  }

  function showProgress(text) {
    const p = panel(), pr = progress(), ti = title();
    if (!p) return;
    p.hidden = false;
    if (ti) ti.textContent = 'Video';
    if (pr) { pr.hidden = false; pr.textContent = text || 'Sto preparando il video…'; }
  }

  function playReady(url, muted) {
    const p = panel(), v = player(), pr = progress(), s = soundBtn();
    if (!p || !v) return;
    p.hidden = false;
    if (pr) pr.hidden = true;
    v.hidden = false;
    v.muted = muted !== false;
    v.src = url;
    const start = v.play();
    const seen = () => { if (App.rt && App.rt.notifyVisible) App.rt.notifyVisible('[sistema: il video richiesto è ora visibile nel pannello in chiamata. Solo ora puoi accennarlo.]'); };
    if (start && start.then) start.then(() => { if (v && !v.paused) seen(); }).catch(() => {});
    else if (!v.paused) seen();
    if (s) { s.hidden = false; s.textContent = v.muted ? '🔇' : '🔊'; s.setAttribute('aria-label', v.muted ? 'Attiva il suono' : 'Togli il suono'); }
  }

  async function poll(id) {
    if (!id || id !== jobId) return;
    try {
      const s = await App.api('/api/call-videos/' + encodeURIComponent(id), { ai: true });
      if (id !== jobId) return;
      if (s.status === 'pending') {
        showProgress('Sto preparando il video…');
        pollT = setTimeout(() => poll(id), 3000);
        return;
      }
      if (s.status === 'done' && (s.chatUrl || s.url)) {
        playReady(s.chatUrl || s.url, true);
        if (App.chat && App.chat.poll && App.current) App.chat.poll();
        return;
      }
      showProgress(s.error || 'Non sono riuscita a preparare il video.');
        if (App.rt && App.rt.notifyVisible) App.rt.notifyVisible('[sistema: il video non è visibile. Non dire di averlo mostrato.]');
    } catch (e) {
      if (id !== jobId) return;
      showProgress((e && e.message) || 'Non sono riuscita a preparare il video.');
    }
  }

  async function request(ch, descrizione) {
    const desc = String(descrizione || '').trim();
    if (!ch || !ch.id) return;
    stopPoll();
    jobId = 'pending';
    showProgress(desc ? 'Sto preparando il video…' : 'Dimmi cosa vuoi vedere.');
    if (!desc) return;
    try {
      const r = await App.api('/api/call-videos', { method: 'POST', ai: true, body: { characterId: ch.id, descrizione: desc } });
      if (!r || !r.id) { showProgress((r && r.error) || 'Non sono riuscita ad avviare il video.'); return; }
      jobId = r.id;
      if (r.status === 'done' && (r.chatUrl || r.url)) {
        playReady(r.chatUrl || r.url, true);
        if (App.chat && App.chat.poll && App.current) App.chat.poll();
        return;
      }
      showProgress('Sto preparando il video…');
      pollT = setTimeout(() => poll(r.id), 1500);
    } catch (e) {
      showProgress((e && e.message) || 'Non sono riuscita ad avviare il video.');
    }
  }

  function bindDrag() {
    const p = panel(); if (!p || p._dragBound) return;
    p._dragBound = true;
    const start = (e) => {
      if (e.target.closest('button,video')) return;
      const ev = e.touches ? e.touches[0] : e;
      const r = p.getBoundingClientRect();
      dragging = true;
      dragX = ev.clientX; dragY = ev.clientY;
      startL = r.left; startT = r.top;
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      p.style.left = startL + 'px';
      p.style.top = startT + 'px';
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const ev = e.touches ? e.touches[0] : e;
      const r = p.getBoundingClientRect();
      let l = startL + (ev.clientX - dragX);
      let t = startT + (ev.clientY - dragY);
      l = Math.max(8, Math.min(window.innerWidth - r.width - 8, l));
      t = Math.max(8, Math.min(window.innerHeight - r.height - 8, t));
      p.style.left = l + 'px';
      p.style.top = t + 'px';
    };
    const end = () => { dragging = false; };
    p.addEventListener('pointerdown', start);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    p.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
  }

  function bind() {
    const c = closeBtn(), s = soundBtn();
    if (c && !c._bound) { c._bound = true; c.addEventListener('click', (e) => { e.stopPropagation(); hide(); }); }
    if (s && !s._bound) {
      s._bound = true;
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = player(); if (!v) return;
        v.muted = !v.muted;
        s.textContent = v.muted ? '🔇' : '🔊';
        s.setAttribute('aria-label', v.muted ? 'Attiva il suono' : 'Togli il suono');
        if (!v.muted) v.play().catch(() => {});
      });
    }
    bindDrag();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  App.callVideo = {
    request,
    onCallEnd() { hide(); },
    hide,
    get jobId() { return jobId; },
  };
})();
