/* media.js — immagini (galleria privata + anteprime solo in memoria), video, scambio volto/reinquadratura,
 * ritaglio locale e fotocamera (opzionale, spenta di default). */
(function () {
  const session = { images: [], videos: [] }; // NON salvati: spariscono chiudendo l'app
  let saved = [], savedVideos = [], camStream = null;

  async function loadAll() {
    [saved, savedVideos] = await Promise.all([App.api('/api/images'), App.api('/api/videos')]);
    renderAll();
  }
  function renderAll() {
    const g = $('#gallery');
    g.innerHTML = session.images.map((it) => `<figure><img src="${it.dataUrl}" alt=""><figcaption><span>${esc(it.prompt)}</span><b class="badge">non salvata</b></figcaption>
        <figcaption><button data-save-img="${it.pending}">💾 Salva</button><button data-post-pending="${it.pending}">📔</button>${App.exportButtons('/api/pending/' + it.pending, 'immagine.' + (it.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'))}</figcaption></figure>`).join('')
      + saved.map((it) => `<figure><img src="/api/images/${esc(it.file)}" loading="lazy" alt=""><figcaption><span title="${esc(it.prompt)}">${esc(it.prompt)}</span></figcaption>
        <figcaption><button data-post-img="${esc(it.file)}">📔</button>${App.exportButtons('/api/images/' + it.file, it.file)}<button data-del-img="${esc(it.file)}">🗑️</button></figcaption></figure>`).join('')
      || '<p class="muted">Nessuna immagine ancora.</p>';
    $('#videos').innerHTML = session.videos.map((v) => `<figure><video src="${v.url}" controls playsinline></video><figcaption>${esc(v.prompt)} <b class="badge">non salvato</b>
        <button data-save-vid="${v.pending}">💾 Salva</button>${App.exportButtons(v.url, 'video.mp4')}</figcaption></figure>`).join('')
      + savedVideos.map((v) => `<figure><video src="/api/videos/file/${esc(v.file)}" controls playsinline preload="metadata"></video><figcaption>${esc(v.prompt)}
        ${App.exportButtons('/api/videos/file/' + v.file, v.file)}<button data-del-vid="${esc(v.file)}">🗑️</button></figcaption></figure>`).join('');
    fillFaceswap();
  }
  function fillFaceswap() {
    const avatars = App.chars.map((c) => ({ c, src: App.previews[c.id] ? { source: 'pending', ref: App.previews[c.id].pending } : /^\/api\/avatars\//.test(c.avatar) ? { source: 'avatar', ref: c.avatar } : null })).filter((x) => x.src);
    const opt = (spec, label) => `<option value='${esc(JSON.stringify(spec))}'>${esc(label)}</option>`;
    $('#fs-target').innerHTML = opt({ source: 'upload' }, '📱 Carica dal telefono…')
      + session.images.map((i, n) => opt({ source: 'pending', ref: i.pending }, `Anteprima ${n + 1}: ${i.prompt.slice(0, 30)}`)).join('')
      + saved.map((i) => opt({ source: 'image', ref: i.file }, `Galleria: ${i.prompt.slice(0, 30)}`)).join('')
      + avatars.map((a) => opt(a.src, `Avatar di ${a.c.name}`)).join('');
    $('#fs-face').innerHTML = opt(null, '— nessuno (solo reinquadratura) —') + opt({ source: 'upload' }, '📱 Volto dal telefono (tu o il partner)…')
      + avatars.map((a) => opt(a.src, `Volto di ${a.c.name} (IA)`)).join('');
  }
  async function postToFeed(spec, extra = {}) { await App.feed.post({ ...spec, characterId: App.current ? App.current.id : (App.chars[0] || {}).id, ...extra }); }

  // ---- genera immagine ----
  $('#img-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const p = $('#img-prompt').value.trim(); if (!p) return;
    const st = $('#img-status'); st.textContent = '✨ Generazione in corso…';
    try {
      const r = await App.api('/api/images', { method: 'POST', body: { prompt: p }, ai: true });
      if (r.saved) saved.unshift(r); else session.images.unshift(r);
      st.textContent = r.saved ? 'Salvata nella galleria.' : 'Anteprima solo in memoria: premi 💾 per salvarla.'; renderAll();
    } catch (err) { if (err.message !== 'NO_KEY') st.textContent = '⚠️ ' + err.message; }
  });
  $('#tab-images').addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.saveImg) { const r = await App.api('/api/images/save', { method: 'POST', body: { pending: t.dataset.saveImg } }); session.images = session.images.filter((i) => i.pending !== t.dataset.saveImg); saved.unshift(r); renderAll(); }
      if (t.dataset.delImg && confirm('Eliminare l\'immagine?')) { await App.api(`/api/images/${t.dataset.delImg}`, { method: 'DELETE' }); saved = saved.filter((i) => i.file !== t.dataset.delImg); renderAll(); }
      if (t.dataset.postImg) await postToFeed({ source: 'image', ref: t.dataset.postImg }, { context: (saved.find((i) => i.file === t.dataset.postImg) || {}).prompt });
      if (t.dataset.postPending) await postToFeed({ source: 'pending', ref: t.dataset.postPending }, { context: (session.images.find((i) => i.pending === t.dataset.postPending) || {}).prompt });
      if (t.dataset.saveVid) { const r = await App.api('/api/videos/save', { method: 'POST', body: { pending: t.dataset.saveVid } }); session.videos = session.videos.filter((v) => v.pending !== t.dataset.saveVid); savedVideos.unshift(r); renderAll(); }
      if (t.dataset.delVid && confirm('Eliminare il video?')) { await App.api(`/api/videos/file/${t.dataset.delVid}`, { method: 'DELETE' }); savedVideos = savedVideos.filter((v) => v.file !== t.dataset.delVid); renderAll(); }
    } catch (err) { App.toast(err.message); }
  });

  // ---- video ----
  $('#vid-go').addEventListener('click', async () => {
    const st = $('#vid-status'); const prompt = $('#vid-prompt').value.trim(); if (!prompt) return;
    if (!App.me.videoEnabled) { st.textContent = 'Video non configurato sul server.'; return; }
    let image;
    if ($('#vid-from-avatar').checked) {
      const c = App.current || App.chars.find((x) => /^\/api\/avatars\//.test(x.avatar) || App.previews[x.id]);
      if (c) image = App.previews[c.id] ? { source: 'pending', ref: App.previews[c.id].pending } : { source: 'avatar', ref: c.avatar };
    }
    try {
      st.textContent = '🎬 Richiesta inviata…';
      const { requestId } = await App.api('/api/videos', { method: 'POST', ai: true, body: { prompt, duration: Number($('#vid-duration').value), aspect: $('#vid-aspect').value, image } });
      const t0 = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        const s = await App.api(`/api/videos/status/${encodeURIComponent(requestId)}`, { ai: true });
        if (s.status === 'done') { if (s.saved) savedVideos.unshift(s); else session.videos.unshift(s); st.textContent = s.saved ? 'Video salvato.' : 'Video pronto (solo in memoria): premi 💾 per salvarlo.'; renderAll(); break; }
        if (s.status === 'failed' || s.status === 'expired') { st.textContent = '⚠️ Generazione video non riuscita.'; break; }
        st.textContent = `🎬 In lavorazione… ${Math.round((Date.now() - t0) / 1000)} s`;
      }
    } catch (err) { if (err.message !== 'NO_KEY') st.textContent = '⚠️ ' + err.message; }
  });

  // ---- fotocamera (solo se attivata in Account; permesso chiesto solo all'uso) ----
  async function capture() {
    if (!App.ls.get('camOn', false)) { App.toast('Attiva la fotocamera in Impostazioni'); return null; }
    const v = $('#cam-video');
    try {
      if (!camStream) camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      v.srcObject = camStream; v.hidden = false; await v.play();
      App.toast('Tocca il video per scattare', 4000);
      await new Promise((r) => v.addEventListener('click', r, { once: true }));
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
      stopCamera(); return c.toDataURL('image/jpeg', 0.9);
    } catch { App.toast('Fotocamera non disponibile (serve HTTPS e il permesso)'); stopCamera(); return null; }
  }
  function stopCamera() { if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; const v = $('#cam-video'); v.hidden = true; v.srcObject = null; }

  // ---- scambio volto / reinquadratura ----
  let fsTargetData = null, fsFaceData = null;
  const val = (sel) => JSON.parse($(sel).value || 'null');
  $('#fs-target').addEventListener('change', () => { if ((val('#fs-target') || {}).source === 'upload') $('#fs-target-file').click(); });
  $('#fs-face').addEventListener('change', () => { if ((val('#fs-face') || {}).source === 'upload') $('#fs-face-file').click(); });
  $('#fs-target-file').addEventListener('change', async (e) => { if (e.target.files[0]) { fsTargetData = await App.fileToDataUrl(e.target.files[0], 1024); App.toast('Immagine di partenza caricata'); } });
  $('#fs-face-file').addEventListener('change', async (e) => { if (e.target.files[0]) { fsFaceData = await App.fileToDataUrl(e.target.files[0], 768); App.toast('Volto caricato'); } });
  $('#fs-cam').addEventListener('click', async () => { const d = await capture(); if (d) { fsFaceData = d; $('#fs-face').value = JSON.stringify({ source: 'upload' }); App.toast('Volto acquisito'); } });
  $('#fs-go').addEventListener('click', async () => {
    const st = $('#fs-status'); let target = val('#fs-target'), face = val('#fs-face');
    if (target && target.source === 'upload') { if (!fsTargetData) return App.toast('Carica l\'immagine di partenza'); target = { source: 'upload', dataUrl: fsTargetData }; }
    if (face && face.source === 'upload') { if (!fsFaceData) return App.toast('Carica o scatta il volto'); face = { source: 'upload', dataUrl: fsFaceData }; }
    const usesUpload = (target && target.source === 'upload') || (face && face.source === 'upload');
    if (usesUpload && !$('#fs-consent').checked) return App.toast('Spunta la dichiarazione di consenso');
    try {
      st.textContent = '🔄 Elaborazione con l\'IA…';
      const r = await App.api('/api/faceswap', { method: 'POST', ai: true, body: { target, face, consent: $('#fs-consent').checked, instruction: $('#fs-instr').value } });
      if (r.saved) saved.unshift(r); else session.images.unshift(r);
      st.textContent = r.saved ? 'Risultato salvato in galleria.' : 'Risultato in anteprima (solo in memoria).'; renderAll();
    } catch (err) { if (err.message !== 'NO_KEY') st.textContent = '⚠️ ' + err.message; }
  });

  // ---- ritaglio/inquadratura locale (nessun invio all'IA) ----
  const crop = { img: null, zoom: 1, ox: 0, oy: 0, drag: null };
  function drawCrop() {
    const c = $('#crop-canvas'), aspect = Number($('#crop-aspect').value); c.width = 600; c.height = Math.round(600 / aspect);
    const ctx = c.getContext('2d'), im = crop.img; if (!im) return;
    const base = Math.max(c.width / im.width, c.height / im.height) * crop.zoom;
    const w = im.width * base, h = im.height * base;
    crop.ox = Math.min(0, Math.max(c.width - w, crop.ox)); crop.oy = Math.min(0, Math.max(c.height - h, crop.oy));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, crop.ox, crop.oy, w, h);
  }
  function loadCrop(src) { const im = new Image(); im.onload = () => { crop.img = im; crop.zoom = 1; crop.ox = -9e9; crop.oy = -9e9; $('#crop-zoom').value = 100; $('#crop-canvas').hidden = false; $('#crop-tools').hidden = false; drawCrop(); crop.ox = ($('#crop-canvas').width - im.width * Math.max($('#crop-canvas').width / im.width, $('#crop-canvas').height / im.height)) / 2; drawCrop(); }; im.src = src; }
  $('#crop-file').addEventListener('change', async (e) => { if (e.target.files[0]) loadCrop(await App.fileToDataUrl(e.target.files[0], 1600)); });
  $('#crop-cam').addEventListener('click', async () => { const d = await capture(); if (d) loadCrop(d); });
  $('#crop-zoom').addEventListener('input', (e) => { crop.zoom = Number(e.target.value) / 100; drawCrop(); });
  $('#crop-aspect').addEventListener('change', drawCrop);
  const cc = $('#crop-canvas');
  cc.addEventListener('pointerdown', (e) => { crop.drag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy }; cc.setPointerCapture(e.pointerId); });
  cc.addEventListener('pointermove', (e) => { if (!crop.drag) return; const k = cc.width / cc.getBoundingClientRect().width; crop.ox = crop.drag.ox + (e.clientX - crop.drag.x) * k; crop.oy = crop.drag.oy + (e.clientY - crop.drag.y) * k; drawCrop(); });
  cc.addEventListener('pointerup', () => { crop.drag = null; });
  $('#crop-save').addEventListener('click', async () => {
    if (!$('#crop-consent').checked) return App.toast('Spunta la dichiarazione di consenso');
    try { const r = await App.api('/api/images/upload', { method: 'POST', body: { dataUrl: cc.toDataURL('image/jpeg', 0.9), consent: true, prompt: 'Immagine ritagliata' } }); saved.unshift(r); renderAll(); App.toast('💾 Salvata in galleria'); }
    catch (err) { App.toast(err.message); }
  });

  App.media = { load: loadAll, renderAll, stopCamera };
})();
