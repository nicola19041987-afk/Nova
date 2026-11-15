/* attach.js — v2d-44: UN solo punto in chat per foto e video.
 * «＋» accetta foto e video (anche più di uno). Accanto resta il campo di testo: chi scrive dice cosa cambiare e preme invio.
 * - foto + testo: la foto va in Galleria e in chat, poi viene modificata con l'IA (POST /api/gallery/:id/edit) e il risultato
 *   arriva in chat ed è salvato in Galleria (l'originale resta);
 * - video + testo: il video va in Galleria e in chat; i video non si modificano qui, il testo resta come nota sul video;
 * - senza testo: foto e video vengono solo caricati e inviati in chat.
 * Limiti come la Galleria: foto fino a 40 MB, video MP4/MOV/WebM fino a 200 MB. */
(function () {
  const MAX_IMG = 40 * 1024 * 1024, MAX_VID = 200 * 1024 * 1024, MAX_FILES = 6;
  const form = document.getElementById('chat-form'), input = document.getElementById('chat-input'), plus = document.getElementById('vn-plus');
  if (!form || !input || !plus) return;
  let files = [], busy = false;
  plus.setAttribute('aria-label', 'Allega foto o video');
  plus.title = 'Foto o video';
  const tray = document.createElement('div'); tray.id = 'att-tray'; tray.className = 'att-tray'; tray.hidden = true;
  const status = document.createElement('p'); status.id = 'att-status'; status.className = 'att-status'; status.hidden = true;
  form.insertBefore(status, form.firstChild); form.insertBefore(tray, form.firstChild);
  const isVid = (f) => /^video\//.test(f.type || '') || /\.(mov|mp4|webm|m4v)$/i.test(f.name || '');
  const isImg = (f) => /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name || '');
  const say = (t) => { status.textContent = t || ''; status.hidden = !t; };
  function hint() {
    if (files.some((x) => x.kind === 'image')) return 'Scrivi cosa cambiare nella foto e premi invio. Senza testo la foto viene solo inviata.';
    return 'Premi invio per inviare. I video non si modificano qui: il testo resta come nota sul video.';
  }
  function paint() {
    tray.hidden = !files.length;
    tray.innerHTML = files.map((x, i) => `<div class="att-item${x.kind === 'video' ? ' vid' : ''}">`
      + (x.kind === 'video' ? `<video src="${esc(x.url)}#t=0.1" muted playsinline preload="metadata"></video><span class="att-badge">▶︎</span>` : `<img src="${esc(x.url)}" alt="">`)
      + `<button type="button" class="att-x" data-i="${i}" aria-label="Togli">×</button></div>`).join('')
      + (files.length ? `<p class="att-hint">${esc(hint())}</p>` : '');
    if (files.length) {
      input.removeAttribute('required'); input.setAttribute('enterkeyhint', 'send');
      input.placeholder = files.some((x) => x.kind === 'image') ? 'Cosa cambio? (facoltativo)' : 'Nota sul video (facoltativa)';
    } else { input.setAttribute('required', ''); input.removeAttribute('enterkeyhint'); input.placeholder = 'Messaggio'; }
    form.classList.toggle('has-att', !!files.length);
    document.body.classList.toggle('att-on', !!files.length);
    if (App.voiceNote && App.voiceNote.paintMic) App.voiceNote.paintMic();
    if (App.fitFrame) requestAnimationFrame(() => App.fitFrame());
  }
  function add(list) {
    for (const f of list) {
      if (files.length >= MAX_FILES) { App.toast(`Al massimo ${MAX_FILES} file alla volta`); break; }
      const kind = isVid(f) ? 'video' : isImg(f) ? 'image' : null;
      if (!kind) { App.toast(`⚠️ ${f.name}: solo foto o video`, 3500); continue; }
      if (f.size > (kind === 'video' ? MAX_VID : MAX_IMG)) { App.toast(`⚠️ ${f.name}: troppo grande (max ${kind === 'video' ? 200 : 40} MB)`, 4000); continue; }
      files.push({ file: f, kind, url: URL.createObjectURL(f) });
    }
    paint();
  }
  function clear() { for (const x of files) try { URL.revokeObjectURL(x.url); } catch {} files = []; paint(); }
  plus.addEventListener('click', () => {
    if (busy) return;
    const pick = document.createElement('input');
    pick.type = 'file'; pick.accept = 'image/*,video/*'; pick.multiple = true; pick.id = 'att-file'; pick.hidden = true;
    pick.onchange = () => { add([...(pick.files || [])]); pick.remove(); input.focus({ preventScroll: true }); };
    document.body.appendChild(pick); // nel documento: così anche i test (e Safari) trovano il selettore
    pick.click();
  });
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('.att-x'); if (!b || busy) return;
    const x = files.splice(+b.dataset.i, 1)[0]; if (x) try { URL.revokeObjectURL(x.url); } catch {}
    paint();
  });
  // copia ridotta (JPEG, lato lungo 1600 px) fatta sul telefono: va bene anche per le foto HEIC dell'iPhone
  async function small(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Foto non leggibile')); i.src = url; });
      const w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 1600 / Math.max(w, h));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.88);
    } finally { URL.revokeObjectURL(url); }
  }
  async function idle() { const t = performance.now(); while (App.chat && App.chat.busy && performance.now() - t < 60000) await new Promise((r) => setTimeout(r, 150)); }
  async function post(text, noAI, item) { await idle(); await App.chat.send(text, noAI, { id: item.id, url: item.url, thumb: item.thumb, kind: item.kind, w: item.w, h: item.h }); }
  async function submit(text) {
    if (busy || !files.length) return;
    if (!App.current) { App.toast('Apri prima la chat'); return; }
    const list = files.slice(), note = String(text || '').trim();
    busy = true; files = []; paint(); form.classList.add('att-busy');
    let done = 0;
    try {
      for (let n = 0; n < list.length; n++) {
        const x = list[n], tag = list.length > 1 ? ` ${n + 1}/${list.length}` : '';
        say(`Carico ${x.kind === 'video' ? 'il video' : 'la foto'}${tag}…`);
        let item;
        try {
          const m = await App.gallery.meta(x.file);
          item = await App.gallery.upload(x.file, m, (p) => say(`Carico ${x.kind === 'video' ? 'il video' : 'la foto'}${tag}… ${Math.round(p * 100)}%`));
          if (m.thumb) { const t = await App.api(`/api/gallery/${item.id}/thumb`, { method: 'PUT', body: { dataUrl: m.thumb } }).catch(() => null); if (t && t.item) item = t.item; }
        } catch (e) { App.toast(`⚠️ ${x.file.name || 'File'}: ${e.message}`, 4500); continue; }
        if (!note) { await post('', !App.hasAi() || list.length > 1, item); done++; continue; }
        await post(`✏️ ${note}`, true, item);
        if (x.kind === 'video') {
          try { const r = await App.api(`/api/gallery/${item.id}/edit`, { method: 'POST', body: { instruction: note }, ai: true }); App.toast(r.message || 'Video salvato con la nota', 4500); }
          catch (e) { App.toast('⚠️ ' + e.message, 4500); }
          done++; continue;
        }
        say(`✨ Modifico la foto${tag}…`);
        try {
          let src = null; try { src = await small(x.file); } catch { src = null; }
          const r = await App.api(`/api/gallery/${item.id}/edit`, { method: 'POST', body: { instruction: note, ...(src ? { src } : {}) }, ai: true });
          if (r && r.item) await post(`✨ Fatto: ${note}`, true, r.item);
          done++;
        } catch (e) { App.toast('⚠️ Modifica non riuscita: ' + e.message, 5000); }
      }
    } finally {
      for (const x of list) try { URL.revokeObjectURL(x.url); } catch {}
      busy = false; say(''); form.classList.remove('att-busy');
      if (done && App.gallery && App.gallery.load && document.body.dataset.tab === 'images') App.gallery.load();
    }
  }
  App.attach = { count: () => files.length, busy: () => busy, add, clear, submit };
})();
