/* Strato di movimento sull'immagine intera (foto o video idle).
   Traslazione, rotazione e scala uniforme: niente deformazione di viso o mani.
   Più vivo mentre parla, più fermo mentre ascolta. Rispetta prefers-reduced-motion. */
(function () {
  const reduced = () => {
    try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch { return false; }
  };
  function energy() {
    const App = window.App;
    const av = App && App.avatarConv;
    const speaking = !!(
      (av && av.speaking) ||
      (App && App.tts && (App.tts.playing || (App.tts.q && App.tts.q.length))) ||
      (App && App.chat && App.chat.busy) ||
      (App && App.rt && App.rt.speaking && App.rt.speaking()) ||
      (window.speechSynthesis && window.speechSynthesis.speaking)
    );
    const mouth = av && typeof av.mouth === 'number' ? av.mouth : 0;
    const userTalk = !!(App && App.rt && App.rt.listening && App.rt.listening());
    const callListen = document.body.classList.contains('in-call') && !speaking;
    const soloListen = document.body.classList.contains('solo-rt') && !speaking;
    if (speaking) return Math.max(0.62, Math.min(1, 0.62 + mouth * 0.38));
    if (userTalk || callListen || soloListen) return 0.14;
    return 0.3;
  }
  function shown(el) {
    if (!el || el.hidden) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }
  const state = { drive: null, at: 0, raf: 0, on: false };
  function targets() {
    const v = document.getElementById('motion-video');
    const stage = document.getElementById('stage');
    const videoOn = !!(v && stage && stage.classList.contains('has-motion') && shown(v));
    const portrait = document.getElementById('call-portrait');
    const faceOn = !!(portrait && !portrait.hidden && document.body.classList.contains('in-call'));
    return { v: videoOn ? v : null, portrait: faceOn ? portrait : null };
  }
  function clear(el) {
    if (!el) return;
    el.style.transform = '';
    el.classList.remove('nv-live');
  }
  function tick(now) {
    const Lib = window.MotionLib;
    const t = targets();
    if (!Lib || reduced() || (!t.v && !t.portrait)) {
      clear(t.v); clear(document.getElementById('motion-video'));
      clear(t.portrait);
      state.on = false;
      return null;
    }
    if (!state.drive) state.drive = Lib.createDrive();
    const dt = state.at ? Math.min(80, Math.max(8, now - state.at)) : 16;
    state.at = now;
    const pose = Lib.drive(state.drive, now, dt, energy());
    const css = Lib.cssTransform(pose);
    if (t.v) { t.v.classList.add('nv-live'); t.v.style.transform = css; }
    if (t.portrait) { t.portrait.classList.add('nv-live'); t.portrait.style.transform = css; }
    state.on = true;
    return pose;
  }
  function loop(now) {
    const t = targets();
    const active = !!(t.v || t.portrait) && !reduced();
    if (active || state.on) tick(now);
    if (active) state.raf = requestAnimationFrame(loop);
    else {
      state.raf = 0;
      state.timer = setTimeout(() => { state.timer = 0; state.raf = requestAnimationFrame(loop); }, 500);
    }
  }
  function start() {
    if (state.raf || state.timer || typeof requestAnimationFrame !== 'function') return;
    state.raf = requestAnimationFrame(loop);
  }
  window.LiveMotion = { tick, energy, reduced, start };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
