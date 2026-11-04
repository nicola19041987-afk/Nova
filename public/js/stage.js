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
      const body = await autoBody(img).catch((e) => { console.warn('Corpo non rilevato', e); return null; });
      return {
        v: 2, ...(body ? { body } : {}),
        eyeL: eA, eyeR: eB, mouth: avg([13, 14]), browL: bA, browR: bB,
        mouthW: d(61, 291), mouthH: d(0, 17), eyeW: (wA + wB) / 2, eyeH: (hA + hB) / 2, tilt: Math.atan2(eB.y - eA.y, eB.x - eA.x),
        auto: true, src: srcKey(src), at: new Date().toISOString(),
      };
    }
    return null;
  }
  App.autoFace = autoFace;
  // v8.1: spalle/fianchi (MediaPipe Pose, sul telefono) e maschera della persona a bassa risoluzione (PNG ~96 px):
  // servono al respiro per muovere spalle e petto lasciando fermo lo sfondo.
  async function autoBody(img) {
    if (!Motion.imagePose) return null;
    const task = await Motion.imagePose();
    const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2;
    const r = task.detect(img);
    const L = r && r.landmarks && r.landmarks[0];
    const out = {};
    const Q = (p) => ({ x: (p.x * nw - ox) / s, y: (p.y * nh - oy) / s });
    let arms = null;
    if (L) {
      const vis = (i) => (L[i].visibility == null ? 1 : L[i].visibility) > 0.5 && L[i].y < 1.02 && L[i].y > -0.02;
      if (vis(11) && vis(12)) { let a = Q(L[11]), b = Q(L[12]); if (a.x > b.x) [a, b] = [b, a]; out.shL = a; out.shR = b; }
      // v8.3: avambracci appoggiati al tavolo (gomiti e polsi quasi alla stessa altezza, sotto le spalle)
      if (vis(13) && vis(14) && vis(15) && vis(16)) {
        const fy = [];
        for (const [e, w] of [[13, 15], [14, 16]]) {
          const E = Q(L[e]), Wr = Q(L[w]);
          if (Math.abs(Wr.y - E.y) < 0.7 * Math.abs(Wr.x - E.x) + 0.02) fy.push((E.y + Wr.y) / 2);
        }
        if (fy.length) arms = Math.min(...fy);
      }
      if (vis(23) && vis(24)) { let a = Q(L[23]), b = Q(L[24]); if (a.x > b.x) [a, b] = [b, a]; out.hipL = a; out.hipR = b; }
    }
    let F = null, MW = 0, MH = 0;
    const m = r && r.segmentationMasks && r.segmentationMasks[0];
    if (m) {
      try {
        const f = m.getAsFloat32Array(), mw = m.width, mh = m.height; F = f; MW = mw; MH = mh; const W0 = 96, W = W0, H = Math.max(8, Math.round(96 * nh / nw));
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const id = x.createImageData(W, H);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          let acc = 0, n = 0; // media su un piccolo blocco (niente scalini)
          for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) { const sx = Math.min(mw - 1, Math.floor((i + (di + 0.5) / 2) / W * mw)), sy = Math.min(mh - 1, Math.floor((j + (dj + 0.5) / 2) / H * mh)); acc += f[sy * mw + sx]; n++; }
          const v = Math.round(Math.max(0, Math.min(1, acc / n)) * 255), o = (j * W + i) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
        }
        x.putImageData(id, 0, 0); out.mask = c.toDataURL('image/png');
      } catch (e) { console.warn('Maschera non creata', e); }
      // v8.3: seduta al tavolo? la persona "finisce" sopra il bordo inferiore (il tavolo la copre): lì il respiro si ferma
      try {
        if (F && out.shL && out.shR) { // anche se Pose "indovina" i fianchi nascosti dal tavolo
          const sy = Math.max(0, Math.floor(((out.shL.y + out.shR.y) / 2 * s + oy) / nh * MH));
          const x0 = ((Math.min(out.shL.x, out.shR.x) * s + ox) / nw), x1 = ((Math.max(out.shL.x, out.shR.x) * s + ox) / nw), ends = [];
          for (let t = 0.3; t <= 0.71; t += 0.1) {
            const cx = Math.min(MW - 1, Math.max(0, Math.round((x0 + (x1 - x0) * t) * MW)));
            let y = sy; while (y < MH && F[y * MW + cx] > 0.5) y++;
            ends.push(y);
          }
          ends.sort((a, b) => a - b); const ey = ends[Math.floor(ends.length / 2)];
          if (ey < MH * 0.97 && ey > sy + MH * 0.08) out.table = { y: (ey / MH * nh - oy) / s };
          // la maschera spesso include il tavolo (primo piano): allora vale la linea degli avambracci
          if (arms != null) { const sh = (out.shL.y + out.shR.y) / 2; if (arms > sh + 0.12 && (!out.table || arms < out.table.y)) out.table = { y: arms }; }
        }
      } catch {}
      try { m.close && m.close(); } catch {}
    }
    return Object.keys(out).length ? out : null;
  }
  // Migrazione una tantum (non distruttiva): rileva il viso sugli avatar dei personaggi esistenti che non l'hanno ancora.
  // Gira in background, uno alla volta; i vecchi segni a mano restano salvati come riserva.
  // v8.4.3: punti del viso trovati dall'avatar animato su una foto che non li aveva (o li aveva di un'altra foto): salvali
  App.faceFound = async function (src, lm) {
    try {
      const c = (App.chars || []).find((x) => x.avatar === src), f = !c && (App.chars || []).find((x) => x.frameFill && x.frameFill.url === src);
      if (c) { const r = await App.api(`/api/characters/${c.id}/landmarks`, { method: 'PUT', body: { avatar: src, landmarks: lm } }); if (r.applied) adopt(r.character); }
      else if (f) { await App.api(`/api/characters/${f.id}/frame-fill/landmarks`, { method: 'PUT', body: { url: src, landmarks: lm } }); f.frameFill = { ...f.frameFill, landmarks: { ...lm, auto: true, src } }; }
    } catch (e) { console.warn('Punti del viso non salvati:', e.message); }
  };
  App.faceMigrate = async function () {
    if (App._faceMig || !window.Motion) return; App._faceMig = true;
    const todo = (App.chars || []).filter((c) => /^\/api\/avatars\//.test(c.avatar || '') && !(c.landmarks && c.landmarks.auto && c.landmarks.src === c.avatar && c.landmarks.v >= 2) && !App.ls.get('faceTried2:' + c.avatar, false)); // v8.1: v2 = anche corpo e maschera
    for (const c of todo) {
      await new Promise((ok) => (window.requestIdleCallback ? requestIdleCallback(ok, { timeout: 3000 }) : setTimeout(ok, 500)));
      try {
        const lm = await autoFace(c.avatar);
        // v8.4.3: un rilevamento fallito (es. modello non ancora pronto su iPhone) non blocca più per sempre: fino a 3 tentativi
        if (!lm) { const n = Number(App.ls.get('faceTry3:' + c.avatar, 0)) + 1; App.ls.set('faceTry3:' + c.avatar, n); if (n >= 3) App.ls.set('faceTried2:' + c.avatar, true); continue; }
        App.ls.set('faceTried2:' + c.avatar, true);
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
      const g = $('#scene-gestures'); if (g) g.hidden = !(sc && sc.url && !prev);
      $('#scene-btn').classList.toggle('on', on && !!url);
      const t = $('#scene-toggle'); if (t) { t.textContent = on ? '✓ Seduta al tavolo — tocca per spegnere' : '🪑 Mostrala seduta al tavolo'; t.classList.toggle('on', on); t.disabled = !url; }
      $('#scene-gen').textContent = url ? '✨ Rigenera la scena al tavolo' : '✨ Crea la scena al tavolo con l\'IA';
      $('#scene-info').textContent = prev ? 'Anteprima (non salvata).'
        : !url ? 'Foto realistica di lei seduta al tavolo del soggiorno, stesso viso e stessa luce, inquadratura da videochiamata: si crea una volta sola con la tua chiave xAI.'
        : sc && !sc.landmarks ? 'Scena pronta (viso non trovato: solo l\'immagine).' : on ? 'Seduta al tavolo: respiro e viso animati.' : 'Scena al tavolo pronta.';
      // v8.3: punti completi (viso + spalle + linea del tavolo) trovati sul telefono, una volta per foto; i vecchi restano finché non ci sono i nuovi
      if (sc && !(sc.landmarks && sc.landmarks.auto && sc.landmarks.v >= 2) && !this.tried.has(sc.url) && !App.ls.get('sceneTried2:' + sc.url, false)) { this.tried.add(sc.url); this.locate(ch.id, ROOM, sc.url); }
    },
    tried: new Set(), preview: null,
    set(on) { if (!App.current) return; App.ls.set(`scene:${App.current.id}`, on ? ROOM : ''); this.apply(); },
    toggle() { this.set(!this.room()); menu.hidden = true; },
    async locate(id, room, url) {
      const lm = (await autoFace(url).catch(() => null)) || await findFace(url); App.ls.set('sceneTried2:' + url, true); if (!lm) return;
      try { const r = await App.api(`/api/characters/${id}/scene`, { method: 'PUT', body: { room, landmarks: lm } }); adopt(r.character); this.apply(); } catch { /* riprova al prossimo avvio */ }
    },
    async gen() {
      const ch = App.current; if (!ch) return;
      if (!App.key()) return App.toast('Serve la chiave xAI (Impostazioni) per creare la scena al tavolo');
      const btn = $('#scene-gen'); btn.disabled = true; $('#scene-info').textContent = 'Creo la foto di lei seduta al tavolo… (può volerci un minuto)';
      try {
        const r = await App.api(`/api/characters/${ch.id}/scene-image`, { method: 'POST', body: { room: ROOM }, ai: true });
        if (r.character) { adopt(r.character); this.set(true); App.toast('🪑 Scena al tavolo salvata'); return; }
        const lm = (await autoFace(r.preview.dataUrl).catch(() => null)) || await findFace(r.preview.dataUrl);
        this.preview = { charId: ch.id, room: ROOM, dataUrl: r.preview.dataUrl, landmarks: lm }; App.ls.set(`scene:${ch.id}`, ROOM); this.apply();
        await new Promise((ok) => setTimeout(ok, 400));
        if (confirm('Salvare questa foto di lei seduta al tavolo?')) {
          const s2 = await App.api(`/api/characters/${ch.id}/scene`, { method: 'PUT', body: { room: ROOM, pendingId: r.preview.pending, landmarks: lm } });
          adopt(s2.character); App.toast('🪑 Scena al tavolo salvata');
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
  $('#scene-gestures').addEventListener('click', () => { menu.hidden = true; App.actions && App.actions.openPrepare('seated'); });

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
