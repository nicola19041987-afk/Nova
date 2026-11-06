/* gallery.js — v8.4 Galleria in stile iPhone: foto e video scelti dal rullino (copiati nel tuo spazio privato),
 * immagini dell'app (avatar, soggiorno, immagini e video creati), visore a tutto schermo con scorrimento,
 * condividi/salva, usa come foto avatar, invia in chat, elimina (solo con conferma, solo ciò che hai aggiunto tu). */
(function () {
  let items = [], trash = [], appItems = [], cur = null, list = [], idx = 0;
  const fmtDur = (d) => (d ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : '');
  // ---------- caricamento ----------
  async function load() {
    try { const r = await App.api('/api/gallery'); items = r.items || []; trash = r.trash || []; } catch { items = []; trash = []; }
    appItems = [];
    for (const c of App.chars || []) {
      if (/^\/api\/avatars\//.test(c.avatar)) appItems.push({ app: true, kind: 'image', url: c.avatar, thumb: c.avatar, name: `Avatar di ${c.name}`, charId: c.id });
      if (c.frameFill && c.frameFill.url && !c.frameFill.off) appItems.push({ app: true, kind: 'image', url: c.frameFill.url, thumb: c.frameFill.url, name: `${c.name} · adattata 9:16` });
      const sc = c.scenes && c.scenes.soggiorno; if (sc && sc.url) appItems.push({ app: true, kind: 'image', url: sc.url, thumb: sc.url, name: `${c.name} nel soggiorno` });
    }
    try {
      const [imgs, vids] = await Promise.all([App.api('/api/images'), App.api('/api/videos')]);
      for (const i of imgs || []) appItems.push({ app: true, kind: 'image', url: '/api/images/' + i.file, thumb: '/api/images/' + i.file, name: i.prompt || 'Immagine creata', file: i.file });
      for (const v of vids || []) appItems.push({ app: true, kind: 'video', url: '/api/videos/file/' + v.file, name: v.prompt || 'Video creato', file: v.file });
    } catch {}
    render();
  }
  const tile = (it, i, sect) => `<button type="button" class="ptile${it.kind === 'video' ? ' vid' : ''}" data-s="${sect}" data-i="${i}" aria-label="${esc(it.name || '')}">`
    + (it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : it.kind === 'video' ? `<video src="${esc(it.url)}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${esc(it.url)}" alt="" loading="lazy">`)
    + (it.kind === 'video' ? `<span class="pdur">▶︎ ${esc(fmtDur(it.duration))}</span>` : '') + '</button>';
  function render() {
    $('#gal-phone').innerHTML = items.map((it, i) => tile(it, i, 'p')).join('') || '<p class="muted small pempty">Ancora niente: tocca «＋ Aggiungi» per scegliere foto o video dal telefono.</p>';
    $('#gal-app').innerHTML = appItems.map((it, i) => tile(it, i, 'a')).join('') || '<p class="muted small pempty">Le foto dei personaggi e le immagini create con l\'IA compaiono qui.</p>';
    $('#gal-trash-box').hidden = !trash.length; $('#gal-trash-n').textContent = trash.length ? `(${trash.length})` : '';
    $('#gal-trash').innerHTML = trash.map((it, i) => tile(it, i, 't')).join('');
    $('#gal-count').textContent = items.length ? `${items.length} ${items.length === 1 ? 'elemento' : 'elementi'}` : '';
  }
  // ---------- aggiungi dal telefono ----------
  function meta(file) { // dimensioni, durata e miniatura (sul telefono)
    return new Promise((res) => {
      const url = URL.createObjectURL(file), out = { w: null, h: null, d: null, thumb: null };
      const fin = (el, w, h) => {
        try { if (w && h) { const k = Math.min(1, 360 / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(el, 0, 0, c.width, c.height); out.thumb = c.toDataURL('image/jpeg', 0.78); } } catch {}
        URL.revokeObjectURL(url); res(out);
      };
      if (/^video\//.test(file.type) || /\.(mov|mp4|webm)$/i.test(file.name)) {
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
        const to = setTimeout(() => fin(v, 0, 0), 6000);
        v.onloadedmetadata = () => { out.w = v.videoWidth; out.h = v.videoHeight; out.d = v.duration; try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch {} };
        v.onseeked = () => { clearTimeout(to); fin(v, v.videoWidth, v.videoHeight); }; v.onerror = () => { clearTimeout(to); fin(v, 0, 0); };
      } else {
        const im = new Image(); im.onload = () => { out.w = im.naturalWidth; out.h = im.naturalHeight; fin(im, im.naturalWidth, im.naturalHeight); }; im.onerror = () => fin(im, 0, 0); im.src = url;
      }
    });
  }
  function upload(file, m, onp) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(), q = new URLSearchParams(); if (m.w) q.set('w', m.w); if (m.h) q.set('h', m.h); if (m.d) q.set('d', m.d);
      x.open('POST', '/api/gallery?' + q); x.setRequestHeader('X-Requested-With', 'app-privata');
      x.setRequestHeader('Content-Type', file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : /\.(mp4|webm)$/i.test(file.name) ? 'video/mp4' : 'image/jpeg'));
      x.setRequestHeader('X-File-Name', encodeURIComponent(file.name || ''));
      x.upload.onprogress = (e) => e.lengthComputable && onp(e.loaded / e.total);
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status === 200 ? res(j.item) : rej(new Error(j.error || 'Errore ' + x.status)); };
      x.onerror = () => rej(new Error('Rete non disponibile')); x.send(file);
    });
  }
  $('#gal-add').addEventListener('click', () => $('#gal-file').click());
  $('#gal-file').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    const bar = $('#gal-progress'), fill = bar.querySelector('span'); bar.hidden = false; let ok = 0;
    for (let n = 0; n < files.length; n++) {
      const f = files[n], m = await meta(f);
      try {
        const it = await upload(f, m, (p) => { fill.style.width = (((n + p) / files.length) * 100).toFixed(1) + '%'; });
        if (m.thumb) await App.api(`/api/gallery/${it.id}/thumb`, { method: 'PUT', body: { dataUrl: m.thumb } }).catch(() => {});
        ok++;
      } catch (err) { App.toast(`⚠️ ${f.name}: ${err.message}`, 4000); }
    }
    bar.hidden = true; fill.style.width = '0'; if (ok) App.toast(`✅ ${ok === 1 ? 'Aggiunto' : ok + ' elementi aggiunti'} alla Galleria`); load();
  });
  // ---------- visore ----------
  function slide(it) {
    return it.kind === 'video' ? `<video src="${esc(it.url)}" controls playsinline preload="metadata" ${it.thumb ? `poster="${esc(it.thumb)}"` : ''}></video>` : `<img src="${esc(it.url)}" alt="" draggable="false">`;
  }
  function show() {
    const tr = $('#vw-track'); cur = list[idx]; if (!cur) return close();
    tr.innerHTML = [-1, 0, 1].map((k) => `<div class="vw-slide" style="transform:translateX(${k * 100}%)">${list[idx + k] ? slide(list[idx + k]) : ''}</div>`).join('');
    $('#vw-title').textContent = cur.name || ''; $('#vw-pos').textContent = list.length > 1 ? `${idx + 1} di ${list.length}` : '';
    const own = !cur.app && !cur.chat && !cur.trash;
    $('#vw-del').hidden = !own; $('#vw-avatar').hidden = cur.kind !== 'image' || !App.canEdit() || !!cur.trash;
    $('#vw-send').hidden = !own;
    cur._blob = null;
    if (own) fetch(cur.url, { credentials: 'same-origin' }).then((r) => r.blob()).then((b) => { if (list[idx] === cur) cur._blob = b; }).catch(() => {}); // pronto per «Condividi» (iPhone vuole il file subito)
  }
  function open(arr, i) { list = arr; idx = i; $('#viewer').hidden = false; document.body.classList.add('viewer-on'); show(); }
  function close() { $('#viewer').hidden = true; document.body.classList.remove('viewer-on'); $('#vw-track').innerHTML = ''; cur = null; }
  function go(d) { if (!list[idx + d]) return snap(0); idx += d; show(); }
  let sx = 0, sy = 0, dx = 0, drag = false;
  const tr = $('#vw-track');
  const setX = (px, anim) => tr.querySelectorAll('.vw-slide').forEach((s, k) => { s.style.transition = anim ? 'transform .25s ease' : 'none'; s.style.transform = `translateX(calc(${(k - 1) * 100}% + ${px}px))`; });
  const snap = (dir) => { setX(-dir * tr.clientWidth, true); setTimeout(() => (dir ? go(dir) : setX(0, false)), dir ? 250 : 260); };
  tr.addEventListener('pointerdown', (e) => { if (e.target.closest('video')) return; drag = true; sx = e.clientX; sy = e.clientY; dx = 0; tr.setPointerCapture(e.pointerId); });
  tr.addEventListener('pointermove', (e) => { if (!drag) return; dx = e.clientX - sx; if (Math.abs(e.clientY - sy) > Math.abs(dx) * 1.5) return; setX(dx, false); });
  tr.addEventListener('pointerup', (e) => { if (!drag) return; drag = false; const dy = e.clientY - sy; if (Math.abs(dx) > 50) { const d = dx < 0 ? 1 : -1; if (list[idx + d]) { setX(-d * tr.clientWidth, true); setTimeout(() => go(d), 250); } else setX(0, true); } else if (dy > 120) close(); else setX(0, true); });
  document.addEventListener('keydown', (e) => { if ($('#viewer').hidden) return; if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') close(); });
  $('#vw-close').addEventListener('click', close);
  // condividi / salva: menu di condivisione di iPhone («Salva immagine» lo rimette nel rullino); altrimenti scarica
  $('#vw-share').addEventListener('click', async () => {
    const it = cur; if (!it) return;
    if (it.app || it.chat) return App.share(it.url, (it.name || 'immagine').replace(/[^\w.\- ]+/g, '_').slice(0, 40) + (it.kind === 'video' ? '.mp4' : '.jpg'));
    const name = it.name || (it.kind === 'video' ? 'video.mp4' : 'foto.jpg');
    try {
      const b = it._blob || (await (await fetch(it.url, { credentials: 'same-origin' })).blob()), file = new File([b], name, { type: b.type || it.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { if (e.name !== 'AbortError') App.toast('Condivisione non riuscita'); }
  });
  const pickChar = (title) => App.sheet(title, (App.chars || []).map((c) => ({ label: c.name, value: c.id })));
  $('#vw-send').addEventListener('click', async () => {
    const it = cur; if (!it) return;
    const id = await pickChar('Invia in chat a…'); if (!id) return;
    const cap = prompt('Vuoi aggiungere un messaggio? (facoltativo)', '') ; if (cap === null) return;
    close(); await App.chat.open(id);
    App.chat.send(cap || '', !App.hasAi(), it);
    App.toast('📤 Inviata nella chat di coppia (la vedrà anche l\'altra persona)', 3500);
  });
  $('#vw-avatar').addEventListener('click', async () => {
    const it = cur; if (!it || !App.roles.guard()) return;
    const id = await pickChar('Usa come foto avatar di…'); if (!id) return; const c = App.charById(id);
    if (!confirm('Confermo che questa foto ritrae me o il mio partner con il suo consenso, oppure un volto generato dall\'IA, e non una terza persona reale.\n\nNota: con una foto caricata dal telefono le azioni per adulti restano disattivate per questo personaggio (solo volti creati dall\'IA).')) return;
    try {
      const b = it._blob || (await (await fetch(it.url, { credentials: 'same-origin' })).blob());
      const bmp = await createImageBitmap(b); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const r = await App.api(`/api/characters/${id}`, { method: 'PUT', body: { ...c, avatar: cv.toDataURL('image/jpeg', 0.88), avatarSource: 'upload', avatarConsent: true, landmarks: null } });
      Object.assign(c, r); App.chat.renderList(); if (App.current && App.current.id === id) App.avatarConv.setCharacter(c);
      App.toast(`✅ Nuova foto per ${c.name}`); close(); load();
    } catch (e) { App.toast('⚠️ ' + e.message, 4000); }
  });
  $('#vw-del').addEventListener('click', async () => {
    const it = cur; if (!it || it.app) return;
    const v = await App.sheet('La foto verrà spostata in «Eliminati di recente» (30 giorni) e tolta da questa Galleria. L\'originale nel rullino del telefono non viene toccato.', [{ label: it.kind === 'video' ? 'Elimina video' : 'Elimina foto', value: 'del', danger: true }]);
    if (v !== 'del') return;
    try { await App.api(`/api/gallery/${it.id}`, { method: 'DELETE', body: { confirm: true } }); close(); load(); } catch (e) { App.toast('⚠️ ' + e.message); }
  });
  // tocchi sulle griglie
  $('#gal-photos').addEventListener('click', async (e) => {
    const t = e.target.closest('.ptile'); if (!t) return; const i = +t.dataset.i;
    if (t.dataset.s === 'p') return open(items, i);
    if (t.dataset.s === 'a') return open(appItems, i);
    const it = trash[i]; // eliminati di recente
    const v = await App.sheet(it.name || '', [{ label: 'Ripristina', value: 'rest' }, { label: 'Elimina definitivamente', value: 'del', danger: true }]);
    if (v === 'rest') await App.api(`/api/gallery/${it.id}/restore`, { method: 'POST', body: {} }).catch((er) => App.toast(er.message));
    if (v === 'del' && confirm('Eliminare definitivamente? Non si potrà recuperare.')) await App.api(`/api/gallery/${it.id}`, { method: 'DELETE', body: { confirm: true } }).catch((er) => App.toast(er.message));
    load();
  });
  function seg(g) { $$('#gal-seg button').forEach((b) => b.classList.toggle('on', b.dataset.g === g)); $('#gal-photos').hidden = g !== 'photos'; $('#gal-create').hidden = g !== 'create'; }
  $('#gal-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) seg(b.dataset.g); });
  App.gallery = { load, seg, open, close, viewChat(f) { open([{ chat: true, kind: f.kind, url: '/api/chat-media/' + f.file, thumb: f.thumb ? '/api/chat-media/' + f.thumb : null, name: f.kind === 'video' ? 'Video' : 'Foto' }], 0); } };
})();
