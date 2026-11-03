/* stage.js — riquadro dell'avatar: schermo intero e scena cinematografica (lei a figura intera in una stanza). */
(function () {
  const stage = $('#stage'), menu = $('#scene-menu'), av = () => App.avatarConv;
  const loadImg = (src) => new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = src; });

  // Punti del viso sull'immagine scena, trovati SUL TELEFONO (MediaPipe locale), nello spazio del quadrato centrale
  async function findFace(src) {
    if (!window.Motion) return null;
    try {
      const task = await Motion.imageFace(); const img = await loadImg(src);
      const r = task.detect(img); const f = r && r.faceLandmarks && r.faceLandmarks[0]; if (!f) return null;
      const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2;
      const avg = (ids) => { const p = { x: 0, y: 0 }; ids.forEach((i) => { p.x += f[i].x; p.y += f[i].y; }); return { x: (p.x / ids.length * nw - ox) / s, y: (p.y / ids.length * nh - oy) / s }; };
      let a = avg([33, 133]), b = avg([362, 263]); if (a.x > b.x) [a, b] = [b, a];
      return { eyeL: a, eyeR: b, mouth: avg([13, 14]) };
    } catch (e) { console.warn('Viso nella scena non trovato', e); return null; }
  }
  App.findFace = findFace; // usato anche dalle pose delle azioni

  // ---- v8: occhi e bocca rilevati IN AUTOMATICO sulla foto dell'avatar (MediaPipe locale, sul telefono) ----
  // Prova prima la foto intera; nelle foto a figura intera il viso è piccolo, quindi riprova sulla parte alta ingrandita.
  // Risultato nello spazio del quadrato centrale (come i vecchi segni a mano), con larghezza bocca/occhi e sopracciglia.
  const srcKey = (src) => (String(src).startsWith('data:') ? 'data:' + src.length + ':' + src.slice(-24) : String(src));
  App.faceKey = srcKey;
  async function autoFace(src) {
    if (!window.Motion || !src) return null;
    const task = await Motion.imageFace(); const img = await loadImg(src);
    const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2;
    const crops = [[0, 0, nw, nh], [0, 0, nw, Math.min(nh, nw)], [nw * 0.2, 0, nw * 0.6, Math.min(nh, nw * 0.7)], [nw * 0.25, 0, nw * 0.5, nh * 0.32], [nw * 0.3, 0, nw * 0.4, nh * 0.22]];
    // ultima possibilità (viso piccolissimo, figura intera): riquadri sovrapposti sulla parte alta dell'immagine
    const T = Math.round(Math.min(nw, nh) * 0.35), step = Math.max(1, Math.round(T / 2));
    for (let y = 0; y + T <= nh * 0.65; y += step) for (let x = 0; x + T <= nw; x += step) crops.push([x, y, T, T]);
    for (const [cx, cy, cw, chh] of crops) {
      let input = img;
      if (cw !== nw || chh !== nh) {
        const c = document.createElement('canvas'), k = Math.min(4, 1024 / Math.max(cw, chh));
        c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(chh * k)); c.getContext('2d').drawImage(img, cx, cy, cw, chh, 0, 0, c.width, c.height); input = c;
      }
      let r = null; try { r = task.detect(input); } catch (e) { console.warn('Rilevamento viso non riuscito', e); continue; }
      const f = r && r.faceLandmarks && r.faceLandmarks[0]; if (!f) continue;
      const P = (i) => ({ x: (cx + f[i].x * cw - ox) / s, y: (cy + f[i].y * chh - oy) / s });
      const avg = (ids) => { const o = { x: 0, y: 0 }; ids.forEach((i) => { const p = P(i); o.x += p.x; o.y += p.y; }); return { x: o.x / ids.length, y: o.y / ids.length }; };
      const d = (a, b) => { const p = P(a), q = P(b); return Math.hypot(p.x - q.x, p.y - q.y); };
      let eA = avg([33, 133, 159, 145]), eB = avg([362, 263, 386, 374]), bA = P(105), bB = P(334);
      let wA = d(33, 133), wB = d(362, 263), hA = d(159, 145), hB = d(386, 374);
      if (eA.x > eB.x) { [eA, eB] = [eB, eA]; [bA, bB] = [bB, bA]; [wA, wB] = [wB, wA]; [hA, hB] = [hB, hA]; }
      if (Math.hypot(eB.x - eA.x, eB.y - eA.y) < 0.008) continue; // troppo piccolo per animarlo bene
      return {
        eyeL: eA, eyeR: eB, mouth: avg([13, 14]), browL: bA, browR: bB,
        mouthW: d(61, 291), mouthH: d(0, 17), eyeW: (wA + wB) / 2, eyeH: (hA + hB) / 2, tilt: Math.atan2(eB.y - eA.y, eB.x - eA.x),
        auto: true, src: srcKey(src), at: new Date().toISOString(),
      };
    }
    return null;
  }
  App.autoFace = autoFace;
  // Migrazione una tantum (non distruttiva): rileva il viso sugli avatar dei personaggi esistenti che non l'hanno ancora.
  // Gira in background, uno alla volta; i vecchi segni a mano restano salvati come riserva.
  App.faceMigrate = async function () {
    if (App._faceMig || !window.Motion) return; App._faceMig = true;
    const todo = (App.chars || []).filter((c) => /^\/api\/avatars\//.test(c.avatar || '') && !(c.landmarks && c.landmarks.auto && c.landmarks.src === c.avatar) && !App.ls.get('faceTried:' + c.avatar, false));
    for (const c of todo) {
      await new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 3000 }) : setTimeout(ok, 500)));
      try {
        const lm = await autoFace(c.avatar);
        App.ls.set('faceTried:' + c.avatar, true);
        if (!lm) continue;
        const r = await App.api(`/api/characters/${c.id}/landmarks`, { method: 'PUT', body: { avatar: c.avatar, landmarks: lm } });
        if (r.applied) { adopt(r.character); if (App.current && App.current.id === c.id) App.avatarConv.setLandmarks(r.character.landmarks); }
      } catch (e) { console.warn('Migrazione viso:', e.message); }
    }
  };
  function adopt(ch) { // personaggio aggiornato dal server
    if (!ch) return; const i = App.chars.findIndex((c) => c.id === ch.id); if (i >= 0) App.chars[i] = ch;
    if (App.current && App.current.id === ch.id) App.current = ch;
  }

  // v8: UNA sola scena — il soggiorno / sala da pranzo fotografico (9:16), generato con l'IA con lei dentro, stessa luce.
  // Acceso/spento per personaggio; senza foto generata resta l'avatar normale.
  const ROOM = 'soggiorno';
  App.scene = {
    room() { if (!App.current) return ''; const v = App.ls.get(`scene:${App.current.id}`, ''); return v ? ROOM : ''; }, // vecchi valori (salotto, …) = acceso
    apply() {
      const ch = App.current, on = !!this.room();
      const sc = ch && ch.scenes && ch.scenes[ROOM];
      const prev = this.preview && this.preview.charId === (ch && ch.id) ? this.preview : null;
      const url = prev ? prev.dataUrl : sc ? sc.url : null;
      av().setSceneMode(on && url ? { on: true, room: ROOM, url, landmarks: prev ? prev.landmarks : sc.landmarks } : { on: false });
      $('#scene-btn').classList.toggle('on', on && !!url);
      const t = $('#scene-toggle'); if (t) { t.textContent = on ? '✓ Soggiorno attivo — tocca per spegnere' : '🏠 Mostrala nel soggiorno'; t.classList.toggle('on', on); t.disabled = !url; }
      $('#scene-gen').textContent = url ? '✨ Rigenera il soggiorno' : '✨ Crea il soggiorno con l\'IA';
      $('#scene-info').textContent = prev ? 'Anteprima (non salvata).'
        : !url ? 'Foto realistica di lei nel soggiorno di casa, con la stessa luce: si crea una volta sola (serve la chiave xAI).'
        : sc && !sc.landmarks ? 'Soggiorno pronto (viso non trovato: solo l\'immagine).' : on ? 'Soggiorno attivo: viso animato.' : 'Soggiorno pronto.';
      if (sc && !sc.landmarks && !this.tried.has(sc.url)) { this.tried.add(sc.url); this.locate(ch.id, ROOM, sc.url); }
    },
    tried: new Set(), preview: null,
    set(on) { if (!App.current) return; App.ls.set(`scene:${App.current.id}`, on ? ROOM : ''); this.apply(); },
    toggle() { this.set(!this.room()); menu.hidden = true; },
    async locate(id, room, url) {
      const lm = await findFace(url); if (!lm) return;
      try { const r = await App.api(`/api/characters/${id}/scene`, { method: 'PUT', body: { room, landmarks: lm } }); adopt(r.character); this.apply(); } catch { /* riprova al prossimo avvio */ }
    },
    async gen() {
      const ch = App.current; if (!ch) return;
      if (!App.key()) return App.toast('Serve la chiave xAI (Account) per creare il soggiorno');
      const btn = $('#scene-gen'); btn.disabled = true; $('#scene-info').textContent = 'Creo la foto nel soggiorno… (può volerci un minuto)';
      try {
        const r = await App.api(`/api/characters/${ch.id}/scene-image`, { method: 'POST', body: { room: ROOM }, ai: true });
        if (r.character) { adopt(r.character); this.set(true); App.toast('🏠 Soggiorno salvato'); return; }
        const lm = await findFace(r.preview.dataUrl);
        this.preview = { charId: ch.id, room: ROOM, dataUrl: r.preview.dataUrl, landmarks: lm }; App.ls.set(`scene:${ch.id}`, ROOM); this.apply();
        await new Promise((ok) => setTimeout(ok, 400));
        if (confirm('Salvare questa foto nel soggiorno per il personaggio?')) {
          const s2 = await App.api(`/api/characters/${ch.id}/scene`, { method: 'PUT', body: { room: ROOM, pendingId: r.preview.pending, landmarks: lm } });
          adopt(s2.character); App.toast('🏠 Soggiorno salvato');
        }
        this.preview = null; this.apply();
      } catch (e) { $('#scene-info').textContent = '⚠️ ' + e.message; }
      finally { btn.disabled = false; }
    },
  };
  $('#scene-btn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) App.scene.apply(); });
  menu.addEventListener('click', (e) => e.stopPropagation());
  $('#scene-toggle').addEventListener('click', () => App.scene.toggle());
  $('#scene-gen').addEventListener('click', () => App.scene.gen());

  // ---- schermo intero: Fullscreen API se disponibile, altrimenti sovrapposizione CSS (iPhone Safari / app installata) ----
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFs = () => stage.classList.contains('fs') || fsEl() === stage;
  function update() { const on = isFs(); const b = $('#fs-btn'); b.textContent = on ? '✕' : '⛶'; b.title = on ? 'Esci dallo schermo intero' : 'Schermo intero'; b.setAttribute('aria-label', b.title); document.body.classList.toggle('avatar-fs-on', on); }
  async function enter() {
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    let ok = false;
    if (req && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) { try { await req.call(stage, { navigationUI: 'hide' }); ok = fsEl() === stage; } catch { ok = false; } }
    if (!ok) stage.classList.add('fs');
    update();
  }
  function exit() {
    if (fsEl()) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* già uscito */ } }
    stage.classList.remove('fs'); update();
  }
  App.stageFs = { enter, exit, isFs };
  $('#fs-btn').addEventListener('click', (e) => { e.stopPropagation(); isFs() ? exit() : enter(); });
  document.addEventListener('fullscreenchange', update); document.addEventListener('webkitfullscreenchange', update);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stage.classList.contains('fs')) exit(); });
})();
