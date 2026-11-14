'use strict';
/* presence.js — v2d-36: Nova ha una vita sua. Quando la saluti («ok ciao ciao», «ciao», «a dopo») ti saluta e se ne va:
   se il look ha il clip «ciao» (si gira e se ne va) lo suona, altrimenti la scena sfuma. Poi l'app la mostra «non in linea»
   finché non le riscrivi. «dai aspetta ancora un attimo» -> resta volentieri.
   Il saluto vale solo a conversazione avviata (almeno 2 tuoi messaggi in questa visita) o se lei ha detto che stava per andare;
   un «ciao» all'inizio è un saluto d'arrivo. Lo stato resta solo su questo telefono (App.ls), non si salva niente sul server. */
(function (root) {
  const BYE = /^\s*(?:ok(?:ay|ei)?|va bene|vabb?[eè]|dai|allora|perfetto|grazie)?[\s,.!]*(?:ciao(?:\s*ciao)*|a\s+dopo|a\s+più\s+tardi|a\s+piu\s+tardi|ci\s+sentiamo(?:\s+dopo|\s+domani)?|a\s+domani|buonanotte|notte|vai\s+pure|bye|devo\s+andare|scappo|ti\s+lascio\s+andare)(?:\s+(?:nova|tesoro|cara|bella))?[\s,.!❤️😘👋🙂😊]*$/i;
  const STAY = /\b(aspetta|resta|rimani|non\s+andare|non\s+te\s+ne\s+andare|ancora\s+un\s+(attimo|po|po'|momento)|un\s+attimo\s+ancora|dove\s+vai)\b/i;
  const LEAVING = /\b(me\s+ne\s+vado|vado\s+in\s+palestra|devo\s+andare|scappo|ti\s+lascio|se\s+(tu\s+)?hai\s+finito)\b/i;
  const S = { sent: 0, offered: false, pendingBye: false, timer: 0 };
  const key = (ch) => 'away:' + ((ch && ch.id) || 'nova');
  const ls = () => (root.App && App.ls) || null;
  function isNova(ch) { return !!ch && (document.body.classList.contains('solo-mode') || /^nova/i.test(String(ch.name || '')) || ch.id === 'nova' || (root.App && App.solo && App.solo.char && App.solo.char() === ch)); }
  function awayInfo(ch) { try { const v = ls() && ls().get(key(ch || (App && App.current)), null); return v && v.at ? v : null; } catch { return null; } }
  function classify(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 60) return {};
    if (STAY.test(t)) return { stay: true };
    if (BYE.test(t)) return { byeWord: true };
    return {};
  }
  // messaggio dell'utente (scritto o a voce): torna in linea se era via; dice se è un saluto o un «resta»
  function hear(ch, text) {
    if (!isNova(ch)) return {};
    if (awayInfo(ch)) back(ch);
    const c = classify(text);
    S.sent++;
    if (c.stay) { S.pendingBye = false; clearTimeout(S.timer); S.offered = false; return { stay: true }; }
    if (c.byeWord && (S.sent >= 3 || S.offered)) { S.pendingBye = true; return { bye: true }; }
    return {};
  }
  function talking() {
    const av = root.App && App.avatarConv;
    return !!((av && av.speaking) || (App.tts && (App.tts.playing || (App.tts.q && App.tts.q.length))) || (App.rt && typeof App.rt.speaking === 'function' && App.rt.speaking()) || (root.speechSynthesis && root.speechSynthesis.speaking));
  }
  // risposta di Nova: se l'utente l'ha salutata, finito di parlare se ne va
  function afterReply(ch, reply, flags) {
    if (!isNova(ch)) return;
    if (LEAVING.test(String(reply || ''))) S.offered = true;
    if (!(flags && flags.bye) && !S.pendingBye) return;
    S.pendingBye = false;
    const t0 = performance.now();
    clearTimeout(S.timer);
    const wait = () => { if (talking() && performance.now() - t0 < 15000) { S.timer = setTimeout(wait, 250); return; } S.timer = setTimeout(() => leave(ch), 700); };
    wait();
  }
  function walkClip(ch) {
    const G = root.MotionGraph; if (!G || !ch) return null;
    const k = App.outfits && App.outfits.key ? App.outfits.key(ch) : '';
    const all = G.libraryOf(ch, k).filter((c) => c.kind === 'event' && c.event === 'ciao');
    if (!all.length) return null;
    const mode = App.net ? App.net.mode() : 'std';
    if (mode === 'still') return null; // rete lentissima: sfuma e basta, niente attesa di un video
    const lite = all.filter((c) => c.quality === 'lite'), std = all.filter((c) => c.quality !== 'lite');
    return (mode === 'lite' ? (lite[0] || std[0]) : (std[0] || lite[0])) || null;
  }
  function stageShown() { const b = document.body.classList; return (b.contains('solo-portrait') || (b.contains('in-call') && !b.contains('call-min'))); }
  async function leave(ch) {
    const stage = document.getElementById('stage');
    const at = new Date().toISOString();
    S.offered = false; S.sent = 0;
    if (stage && stageShown()) {
      const clip = walkClip(ch);
      let played = false;
      if (clip) played = await playWalk(stage, clip);
      if (!played) { stage.classList.add('nv-leaving'); await new Promise((r) => setTimeout(r, 1300)); }
    }
    try { if (ls()) ls().set(key(ch), { at }); } catch { /* */ }
    paint(ch);
    try { if (App.call && App.call.active) App.call.end(); } catch { /* */ }
  }
  function playWalk(stage, clip) {
    return new Promise((done) => {
      const v = document.createElement('video');
      v.id = 'nv-walk'; v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('aria-hidden', 'true');
      const poster = App.faceSrc ? App.faceSrc(App.current || {}) : '';
      if (poster) v.poster = poster;
      let ok = false, fin = false;
      const end = (res) => { if (fin) return; fin = true; clearTimeout(tt); stage.classList.add('nv-leaving'); setTimeout(() => { v.remove(); done(res); }, res ? 500 : 1300); };
      const tt = setTimeout(() => end(ok), 14000);
      v.addEventListener('playing', () => { ok = true; v.classList.add('on'); });
      v.addEventListener('ended', () => end(true));
      v.addEventListener('error', () => end(false));
      setTimeout(() => { if (!ok) end(false); }, 3500); // non parte in 3,5 s: sfuma (mai un fermo immagine)
      v.src = clip.url;
      stage.appendChild(v);
      try { const p = v.play(); if (p && p.catch) p.catch(() => end(false)); } catch { end(false); }
    });
  }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
  function label(ch) { const a = awayInfo(ch); return a ? 'non in linea · uscita alle ' + hhmm(a.at) : ''; }
  function paint(ch) {
    const a = awayInfo(ch || App.current);
    document.body.classList.toggle('nova-away', !!a);
    const stage = document.getElementById('stage');
    if (stage) { stage.classList.toggle('nv-away', !!a); if (!a) stage.classList.remove('nv-leaving'); }
    let card = document.getElementById('nv-away-card');
    if (a && stage) {
      if (!card) { card = document.createElement('div'); card.id = 'nv-away-card'; stage.appendChild(card); }
      card.textContent = ((ch && ch.name) || 'Nova') + ' è uscita · scrivile quando vuoi';
    } else if (card) card.remove();
    try { if (App.chat && App.chat.header) App.chat.header(); } catch { /* */ }
    try { if (App.solo && App.solo.paintHome) App.solo.paintHome(); } catch { /* */ }
    try { if (App.solo && App.solo.syncMotion) App.solo.syncMotion(); } catch { /* */ }
  }
  function back(ch) {
    try { if (ls()) ls().set(key(ch), null); } catch { /* */ }
    paint(ch);
  }
  const api = { BYE, STAY, LEAVING, classify, hear, afterReply, leave, back, label, paint, away: (ch) => !!awayInfo(ch || (root.App && App.current)), state: S };
  if (root.App) { root.App.presence = api; if (!root.App.net && root.NovaNet) root.App.net = root.NovaNet; }
  root.NovaPresence = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
