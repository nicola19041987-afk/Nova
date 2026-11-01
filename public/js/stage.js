/* stage.js — riquadro dell'avatar: schermo intero e scena cinematografica (lei a figura intera in una stanza). */
(function () {
  const stage = $('#stage'), menu = $('#scene-menu'), av = () => App.avatarConv;
  const ROOM_NAMES = { salotto: 'divano / salotto', camera: 'camera da letto', terrazza: 'terrazza' };
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
  function adopt(ch) { // personaggio aggiornato dal server
    if (!ch) return; const i = App.chars.findIndex((c) => c.id === ch.id); if (i >= 0) App.chars[i] = ch;
    if (App.current && App.current.id === ch.id) App.current = ch;
  }

  App.scene = {
    room() { return App.current ? App.ls.get(`scene:${App.current.id}`, '') : ''; },
    apply() {
      const ch = App.current, room = this.room();
      const sc = room && ch && ch.scenes && ch.scenes[room];
      const prev = this.preview && this.preview.room === room && this.preview.charId === (ch && ch.id) ? this.preview : null;
      av().setSceneMode(room ? { on: true, room, url: prev ? prev.dataUrl : sc ? sc.url : null, landmarks: prev ? prev.landmarks : sc ? sc.landmarks : null } : { on: false });
      $('#scene-btn').classList.toggle('on', !!room);
      menu.querySelectorAll('[data-room]').forEach((b) => b.classList.toggle('on', b.dataset.room === room));
      $('#scene-gen').hidden = !room;
      $('#scene-info').textContent = !room ? 'Inquadratura cinematografica: lei a figura intera in una stanza.'
        : prev ? 'Anteprima (non salvata).'
        : sc ? (sc.landmarks ? `Figura intera in ${ROOM_NAMES[room]}: viso animato.` : `Figura intera in ${ROOM_NAMES[room]} (viso non trovato: solo l'immagine).`)
        : `Stanza illustrata (${ROOM_NAMES[room]}) con l'avatar attuale. Genera la figura intera con l'IA per vederla seduta nella stanza.`;
      if (sc && !sc.landmarks && !this.tried.has(sc.url)) { this.tried.add(sc.url); this.locate(ch.id, room, sc.url); }
    },
    tried: new Set(), preview: null,
    set(room) { if (!App.current) return; App.ls.set(`scene:${App.current.id}`, room || ''); menu.hidden = true; this.apply(); if (room) App.toast(`🎬 Scena: ${ROOM_NAMES[room]}`); },
    async locate(id, room, url) {
      const lm = await findFace(url); if (!lm) return;
      try { const r = await App.api(`/api/characters/${id}/scene`, { method: 'PUT', body: { room, landmarks: lm } }); adopt(r.character); this.apply(); } catch { /* riprova al prossimo avvio */ }
    },
    async gen() {
      const ch = App.current, room = this.room(); if (!ch || !room) return;
      if (!App.key()) return App.toast('Serve la chiave xAI (Account) per generare la scena');
      const btn = $('#scene-gen'); btn.disabled = true; $('#scene-info').textContent = `Genero la figura intera in ${ROOM_NAMES[room]}… (può volerci un minuto)`;
      try {
        const r = await App.api(`/api/characters/${ch.id}/scene-image`, { method: 'POST', body: { room }, ai: true });
        if (r.character) { adopt(r.character); this.apply(); App.toast('🎬 Scena salvata'); return; }
        // senza salvataggio automatico: anteprima solo in memoria, poi conferma
        const lm = await findFace(r.preview.dataUrl);
        this.preview = { charId: ch.id, room, dataUrl: r.preview.dataUrl, landmarks: lm }; this.apply();
        await new Promise((ok) => setTimeout(ok, 400));
        if (confirm('Salvare questa scena a figura intera per il personaggio?')) {
          const s = await App.api(`/api/characters/${ch.id}/scene`, { method: 'PUT', body: { room, pendingId: r.preview.pending, landmarks: lm } });
          adopt(s.character); App.toast('🎬 Scena salvata');
        }
        this.preview = null; this.apply();
      } catch (e) { $('#scene-info').textContent = '⚠️ ' + e.message; }
      finally { btn.disabled = false; }
    },
  };
  $('#scene-btn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) App.scene.apply(); });
  menu.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-room]'); if (b) App.scene.set(b.dataset.room); });
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
