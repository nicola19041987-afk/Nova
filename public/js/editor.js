/* editor.js — editor del personaggio: dati base, avatar animato, aspetto (corpo + colori istantanei),
 * identità base, parrucchiere, guardaroba, cambi automatici, personalità in evoluzione, storico look. */
(function () {
  const LM_DEFAULT = {
    ritratto: { eyeL: { x: 0.38, y: 0.42 }, eyeR: { x: 0.62, y: 0.42 }, mouth: { x: 0.5, y: 0.7 } },
    'mezzo busto': { eyeL: { x: 0.44, y: 0.24 }, eyeR: { x: 0.56, y: 0.24 }, mouth: { x: 0.5, y: 0.33 } },
    'figura intera': { eyeL: { x: 0.475, y: 0.11 }, eyeR: { x: 0.525, y: 0.11 }, mouth: { x: 0.5, y: 0.15 } },
  };
  // Proposte rapide del parrucchiere (modificabili liberamente)
  const HAIR_PRESETS = [
    { name: 'Bob parigino', look: { cut: 'caschetto', length: 'al mento', hairStyle: 'sciolti lisci' } },
    { name: 'Onde da diva', look: { cut: 'scalato', length: 'lunghi', hairStyle: 'onde voluminose' } },
    { name: 'Coda sportiva', look: { cut: 'scalato', length: 'lunghi', hairStyle: 'coda alta' } },
    { name: 'Pixie audace', look: { cut: 'pixie', length: 'cortissimi', hairStyle: 'sciolti lisci' } },
    { name: 'Shag anni 70', look: { cut: 'shag', length: 'alle spalle', hairStyle: 'mosse morbide' } },
    { name: 'Chignon elegante', look: { cut: 'pari', length: 'lunghi', hairStyle: 'chignon morbido' } },
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dlg = $('#char-dialog'), form = $('#char-form');
  let E = null; // copia di lavoro del personaggio
  let lmEditor = null;
  let dirty = false; // modifiche nel modulo non ancora salvate (per non sovrascriverle con gli aggiornamenti dell'altro utente)
  const whoName = (u) => (u === 'luisa' ? 'Luisa' : u === 'nicola' ? 'Nico' : 'l\'altro profilo');

  function defaults() {
    return { id: null, name: '', avatar: '💫', avatarSource: 'emoji', personality: '', style: '', landmarks: clone(LM_DEFAULT.ritratto),
      appearance: { gender: 'donna', age: 30, build: 'snella', shape: 'clessidra', proportions: 'equilibrate', height: 168, framing: 'ritratto', colors: { hue: 0, saturation: 100, brightness: 100, background: '#2b1530', glow: '#d14b8f' } },
      look: { cut: 'scalato', length: 'lunghi', hairColor: 'castano', hairStyle: 'mosse morbide', makeup: 'naturale', outfit: 'casual', custom: '' },
      identity: { core: '', locked: false }, wardrobe: [], autoChanges: { enabled: false, everyDays: 1, bodyDrift: false, buildMin: 'esile', buildMax: 'robusta' }, lookHistory: [], state: null };
  }
  function fillSelects() {
    const o = App.opts;
    const fill = (sel, list) => { sel.innerHTML = list.map((v) => `<option>${esc(v)}</option>`).join(''); };
    $$('[data-ap]', form).forEach((el) => { if (el.tagName === 'SELECT') fill(el, o[el.dataset.ap] || []); });
    $$('[data-look]', form).forEach((el) => { if (el.tagName === 'SELECT') fill(el, o[el.dataset.look] || []); });
    fill($('[data-auto="buildMin"]'), o.build || []); fill($('[data-auto="buildMax"]'), o.build || []);
    $('#outfit-chips').innerHTML = (o.outfit || []).map((v) => `<button type="button" data-outfit="${esc(v)}">${esc(v)}</button>`).join('');
    $('#hair-presets').innerHTML = HAIR_PRESETS.map((p, i) => `<button type="button" data-hair="${i}">${esc(p.name)}</button>`).join('');
  }
  const shownAvatar = () => E.avatar;
  function refreshAvatar() {
    App.avatarEditor.setCharacter({ ...E, avatar: shownAvatar() });
    const img = typeof E.avatar === 'string' && (E.avatar.startsWith('/api/') || E.avatar.startsWith('data:'));
    $('#landmark-wrap').hidden = !img;
    if (img) lmEditor.set(E.avatar, E.landmarks);
    if (App.current && App.current.id === E.id) App.avatarConv.setCharacter({ ...E, avatar: shownAvatar() }); // cambio dal vivo
    if (img) detectFace(false);
  }
  // v8: occhi e bocca trovati in automatico sulla foto (MediaPipe sul telefono). I segni a mano restano come riserva in "manual".
  async function detectFace(force) {
    const src = E.avatar, key = App.faceKey ? App.faceKey(src) : src, st = $('#face-status');
    if (!force && E.landmarks && E.landmarks.auto && E.landmarks.src === key) { st.textContent = 'Viso rilevato ✓ (occhi e bocca in automatico)'; st.className = 'small face-status ok'; return; }
    if (!App.autoFace) return;
    st.textContent = '🔎 Cerco occhi e bocca…'; st.className = 'muted small face-status';
    let lm = null; try { lm = await App.autoFace(src); } catch (e) { console.warn(e); }
    if (E.avatar !== src) return; // nel frattempo è cambiata la foto
    if (lm) {
      const prev = E.landmarks || {};
      lm.manual = prev.manual || (!prev.auto && prev.eyeL ? { eyeL: prev.eyeL, eyeR: prev.eyeR, mouth: prev.mouth } : undefined);
      E.landmarks = lm; dirty = true; lmEditor.set(E.avatar, E.landmarks); App.avatarEditor.setLandmarks(lm);
      if (App.current && App.current.id === E.id) App.avatarConv.setLandmarks(lm);
      st.textContent = 'Viso rilevato ✓ (occhi e bocca in automatico)'; st.className = 'small face-status ok';
      $('#lm-manual').open = false;
    } else {
      st.textContent = '⚠️ Non trovo il viso in questa foto (troppo piccolo, girato o coperto). Il viso resta fermo: puoi posizionare occhi e bocca a mano qui sotto.'; st.className = 'small face-status warn';
      $('#lm-manual').open = true;
    }
  }
  function toForm() {
    form.name.value = E.name; form.personality.value = E.personality; form.style.value = E.style;
    form.avatarEmoji.value = E.avatarSource === 'emoji' ? E.avatar : '';
    $$('[data-ap]', form).forEach((el) => { el.value = E.appearance[el.dataset.ap]; });
    $$('[data-out]', form).forEach((el) => { el.textContent = E.appearance[el.dataset.out] + (el.dataset.out === 'height' ? ' cm' : ' anni'); });
    $$('[data-col]', form).forEach((el) => { el.value = E.appearance.colors[el.dataset.col]; });
    $$('[data-look]', form).forEach((el) => { el.value = E.look[el.dataset.look] || ''; });
    $('[data-id="core"]').value = E.identity.core || ''; $('[data-id="core"]').disabled = !!E.identity.locked; $('[data-id="locked"]').checked = !!E.identity.locked;
    $('#identity-info').textContent = E.identity.seed ? `Ancora identità #${E.identity.seed}${E.identity.refAvatar ? ' · immagine di riferimento fissata' : ' · il primo avatar salvato diventerà il riferimento'}` : 'L\'identità verrà fissata al primo salvataggio.';
    $$('[data-auto]', form).forEach((el) => { const v = E.autoChanges[el.dataset.auto]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
    $('#auto-info').textContent = E.autoChanges.lastAt ? `Ultimo cambio automatico: ${fmtDate(E.autoChanges.lastAt)}` : '';
    $$('#outfit-chips button').forEach((b) => b.classList.toggle('sel', b.dataset.outfit === E.look.outfit));
    $('#wardrobe-list').innerHTML = (E.wardrobe || []).map((w) => `<button type="button" data-ward="${w.id}">${esc(w.name)}</button><button type="button" class="chip-del" data-ward-del="${w.id}">✕</button>`).join('') || '<span class="muted small">Nessun look salvato.</span>';
    const st = E.state;
    $('#state-info').innerHTML = st ? `<p><b>Umore:</b> ${esc(st.mood)}</p><p><b>Relazione:</b> ${esc(st.relationship)}</p>
      ${st.traits.length ? `<p><b>Tratti:</b> ${esc(st.traits.join(', '))}</p>` : ''}${st.grudges.length ? `<p><b>Rancori:</b> ${esc(st.grudges.join('; '))}</p>` : ''}
      ${st.notes ? `<p><b>Note:</b> ${esc(st.notes)}</p>` : ''}<p class="muted small">${st.updatedAt ? 'Aggiornato il ' + esc(fmtDate(st.updatedAt)) : 'Si aggiornerà dopo le prime conversazioni.'}</p>` : '<p class="muted small">Si creerà dopo il primo salvataggio.</p>';
    $('#look-history').innerHTML = (E.lookHistory || []).map((h) => `<figure><img src="${esc(h.avatar)}" alt=""><figcaption>${esc(fmtDate(h.at))}<br>${esc(h.reason)}</figcaption><button type="button" data-revert="${h.id}">Ripristina</button></figure>`).join('') || '<p class="muted small">Nessun look precedente.</p>';
    $('#avatar-consent-wrap').hidden = !(E.avatarSource === 'upload' && String(E.avatar).startsWith('data:'));
    $('#char-delete').hidden = !E.id; $('#char-dialog-title').textContent = E.id ? `Modifica ${E.name}` : 'Nuovo personaggio';
    $('#doc-canvas').hidden = true; $('#doc-actions').hidden = true;
  }
  function fromForm() {
    E.name = form.name.value.trim(); E.personality = form.personality.value; E.style = form.style.value;
    if (E.avatarSource === 'emoji') E.avatar = form.avatarEmoji.value.trim() || '💫';
    $$('[data-ap]', form).forEach((el) => { E.appearance[el.dataset.ap] = el.type === 'range' ? Number(el.value) : el.value; });
    $$('[data-look]', form).forEach((el) => { E.look[el.dataset.look] = el.value; });
    if (!E.identity.locked) E.identity.core = $('[data-id="core"]').value;
    E.identity.locked = $('[data-id="locked"]').checked;
    $$('[data-auto]', form).forEach((el) => { E.autoChanges[el.dataset.auto] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; });
  }
  function body(extra = {}) {
    return { name: E.name, avatar: E.avatar, avatarSource: E.avatarSource, avatarConsent: $('#avatar-consent').checked, pendingId: E.pendingId,
      personality: E.personality, style: E.style, landmarks: E.landmarks, appearance: E.appearance, look: E.look, identity: E.identity,
      wardrobe: E.wardrobe, autoChanges: E.autoChanges, ...extra };
  }
  function store(ch) {
    const i = App.chars.findIndex((c) => c.id === ch.id);
    if (i < 0) App.chars.push(ch); else App.chars[i] = ch;
    if (App.current && App.current.id === ch.id) App.current = ch;
    E = { ...clone(ch), pendingId: null }; delete App.previews[ch.id]; dirty = false;
    App.chat.renderList(); toForm(); refreshAvatar();
  }
  async function save(extra) {
    fromForm();
    if (!E.name) { App.toast('Il nome è obbligatorio'); throw new Error('nome'); }
    if (E.avatarSource === 'upload' && String(E.avatar).startsWith('data:') && !$('#avatar-consent').checked) { App.toast('Spunta la dichiarazione di consenso per la foto'); throw new Error('consenso'); }
    const ch = E.id ? await App.api(`/api/characters/${E.id}`, { method: 'PUT', body: body(extra) }) : await App.api('/api/characters', { method: 'POST', body: body(extra) });
    store(ch); return ch;
  }
  // Rigenerazione via xAI ancorata all'identità base; cambio dal vivo, senza ricaricare
  async function regenerate(reason, patchLook) {
    try {
      fromForm(); if (patchLook) Object.assign(E.look, patchLook);
      const prevFraming = (App.charById(E.id) || {}).appearance?.framing;
      if (!E.id || (E.pendingId && false)) await save();
      $('#avatar-status').textContent = '✨ Generazione in corso… (può richiedere qualche secondo)';
      const r = await App.api(`/api/characters/${E.id}/regenerate`, { method: 'POST', ai: true, body: { appearance: E.appearance, look: E.look, identity: E.identity, prompt: $('#regen-extra').value, reason } });
      const framingChanged = prevFraming && prevFraming !== E.appearance.framing;
      if (r.character) {
        if (framingChanged) { r.character.landmarks = clone(LM_DEFAULT[E.appearance.framing]); store(await App.api(`/api/characters/${E.id}`, { method: 'PUT', body: { ...r.character } })); }
        else store(r.character);
        $('#avatar-status').textContent = '✅ Nuovo look salvato.';
      } else if (r.preview) {
        App.previews[E.id] = r.preview;
        Object.assign(E, { avatar: r.preview.dataUrl, avatarSource: 'ai', pendingId: r.preview.pending, appearance: r.preview.appearance, look: r.preview.look });
        if (framingChanged) E.landmarks = clone(LM_DEFAULT[E.appearance.framing]);
        toForm(); refreshAvatar(); App.chat.renderList();
        $('#avatar-status').textContent = '👀 Anteprima (solo in memoria). Premi Salva per tenerla.';
      }
      // v8: occhi e bocca vengono rilevati in automatico sulla nuova immagine (refreshAvatar)
    } catch (e) { if (e.message !== 'NO_KEY') $('#avatar-status').textContent = '⚠️ ' + e.message; }
  }

  App.editor = {
    init() {
      fillSelects();
      lmEditor = window.LandmarkEditor($('#landmark-canvas'), (lm) => { lm.auto = false; delete lm.src; E.landmarks = lm; $('#face-status').textContent = '✋ Occhi e bocca posizionati a mano'; $('#face-status').className = 'muted small face-status'; App.avatarEditor.setLandmarks(lm); if (App.current && App.current.id === E.id) App.avatarConv.setLandmarks(lm); });
    },
    open(id) {
      const ch = id ? App.charById(id) : null;
      E = ch ? { ...clone(ch), pendingId: null } : defaults();
      { const D = defaults(); for (const k of ['appearance', 'look', 'identity', 'autoChanges']) E[k] = { ...D[k], ...(E[k] || {}) }; if (!E.wardrobe) E.wardrobe = []; if (!E.landmarks) E.landmarks = D.landmarks; } // v8: personaggi vecchi con campi mancanti
      E.appearance.colors = E.appearance.colors || defaults().appearance.colors;
      const pv = ch && App.previews[ch.id];
      if (pv) Object.assign(E, { avatar: pv.dataUrl, avatarSource: 'ai', pendingId: pv.pending, appearance: pv.appearance || E.appearance, look: pv.look || E.look });
      $('#avatar-consent').checked = false; $('#avatar-status').textContent = pv ? '👀 C\'è un nuovo look non salvato: premi Salva per tenerlo.' : '';
      $('#regen-extra').value = ''; dirty = false;
      toForm(); refreshAvatar(); dlg.showModal();
    },
    current: () => E,
    // Il personaggio è stato modificato sull'altro dispositivo (archivio condiviso): aggiorna l'editor se aperto.
    remoteUpdate(ch) {
      if (!dlg.open || !E || E.id !== ch.id || ch.updatedAt === E.updatedAt) return;
      if (ch.updatedBy === App.me.user && !dirty) { E = { ...clone(ch), pendingId: E.pendingId }; toForm(); refreshAvatar(); return; }
      if (!dirty && !E.pendingId) {
        E = { ...clone(ch), pendingId: null }; toForm(); refreshAvatar();
        $('#avatar-status').textContent = `🔄 Aggiornato ora da ${whoName(ch.updatedBy)}.`;
      } else {
        $('#avatar-status').textContent = `⚠️ ${whoName(ch.updatedBy)} ha appena modificato ${ch.name}. Se salvi, le tue modifiche sostituiranno le sue; chiudi e riapri per vedere le sue.`;
      }
    },
    removed(id) { if (dlg.open && E && E.id === id) { dlg.close(); App.toast('Il personaggio è stato eliminato dall\'altro profilo'); } },
  };

  // ---- eventi ----
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { await save(); App.toast('💾 Salvato'); } catch {} });
  $('#char-cancel').addEventListener('click', () => dlg.close());
  $('#char-delete').addEventListener('click', async () => {
    if (!confirm(`Eliminare ${E.name} e la sua conversazione?`)) return;
    await App.api(`/api/characters/${E.id}`, { method: 'DELETE' });
    App.chars = App.chars.filter((c) => c.id !== E.id); delete App.previews[E.id];
    if (App.current && App.current.id === E.id) App.chat.close();
    dlg.close(); App.chat.renderList();
  });
  form.avatarEmoji.addEventListener('input', () => { const v = form.avatarEmoji.value.trim(); if (v) { E.avatar = v; E.avatarSource = 'emoji'; E.pendingId = null; refreshAvatar(); } });
  $('#avatar-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    E.avatar = await App.fileToDataUrl(f, 768); E.avatarSource = 'upload'; E.pendingId = null;
    $('#avatar-consent').checked = false; $('#avatar-consent-wrap').hidden = false;
    E.landmarks = clone(LM_DEFAULT.ritratto); refreshAvatar(); e.target.value = '';
    App.toast('Spunta la dichiarazione per usare la foto');
  });
  $('#lm-redetect').addEventListener('click', () => detectFace(true));
  $('#avatar-remove').addEventListener('click', () => { E.avatar = '💫'; E.avatarSource = 'emoji'; E.pendingId = null; toForm(); refreshAvatar(); });
  // colori: istantanei
  $$('[data-col]', form).forEach((el) => el.addEventListener('input', () => {
    E.appearance.colors[el.dataset.col] = el.type === 'range' ? Number(el.value) : el.value;
    App.avatarEditor.setColors(E.appearance.colors);
    if (App.current && App.current.id === E.id) App.avatarConv.setColors(E.appearance.colors);
  }));
  $$('[data-ap]', form).forEach((el) => el.addEventListener('input', () => {
    const o = $(`[data-out="${el.dataset.ap}"]`, form); if (o) o.textContent = el.value + (el.dataset.ap === 'height' ? ' cm' : ' anni');
  }));
  $('[data-id="locked"]').addEventListener('change', (e) => { $('[data-id="core"]').disabled = e.target.checked; });
  $('#regen-btn').addEventListener('click', () => regenerate('rigenerazione'));
  $('#hair-apply').addEventListener('click', () => regenerate('parrucchiere'));
  $('#hair-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hair]'); if (!b) return;
    const p = HAIR_PRESETS[b.dataset.hair]; Object.assign(E.look, p.look);
    $$('[data-look]', form).forEach((el) => { el.value = E.look[el.dataset.look] || ''; });
    regenerate(`parrucchiere: ${p.name}`);
  });
  $('#outfit-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-outfit]'); if (b) regenerate(`outfit: ${b.dataset.outfit}`, { outfit: b.dataset.outfit }); });
  $('#look-apply').addEventListener('click', () => regenerate('guardaroba'));
  $('#look-save').addEventListener('click', async () => {
    fromForm(); const name = prompt('Nome del look', `Look ${(E.wardrobe || []).length + 1}`); if (!name) return;
    E.wardrobe = [...(E.wardrobe || []), { id: null, name, look: clone(E.look) }];
    try { await save(); App.toast('👗 Look salvato nel guardaroba'); } catch {}
  });
  $('#wardrobe-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-ward-del]');
    if (del) { E.wardrobe = E.wardrobe.filter((w) => w.id !== del.dataset.wardDel); try { await save(); } catch {} return; }
    const b = e.target.closest('[data-ward]'); if (!b) return;
    const w = E.wardrobe.find((x) => x.id === b.dataset.ward);
    E.look = clone(w.look); toForm(); regenerate(`guardaroba: ${w.name}`);
  });
  $('#look-history').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revert]'); if (!b || !E.id) return;
    try { store(await App.api(`/api/characters/${E.id}/revert/${b.dataset.revert}`, { method: 'POST' })); App.toast('↩️ Look ripristinato'); }
    catch (err) { App.toast(err.message); }
  });
  $('#mem-base-btn').addEventListener('click', async () => {
    if (!E.id) return App.toast('Salva prima il personaggio');
    if (!confirm(`Rigenerare la memoria base di ${E.name} dai campi attuali? I ricordi "base" precedenti di questo personaggio vengono sostituiti (gli altri restano).`)) return;
    try { if (dirty) await save(); const r = await App.api(`/api/characters/${E.id}/memory-base`, { method: 'POST', body: {} }); await App.account.loadMemory(); App.toast(`🧠 Memoria base: ${r.added.length} elementi (modificabili in Account)`); }
    catch (err) { App.toast(err.message); }
  });
  $('#state-reset').addEventListener('click', async () => {
    if (!E.id || !confirm('Azzerare umore, relazione e rancori?')) return;
    try { await save({ resetState: true }); } catch {}
  });
  $('#post-avatar').addEventListener('click', async () => {
    if (!E.id) return App.toast('Salva prima il personaggio');
    const spec = E.pendingId ? { source: 'pending', ref: E.pendingId } : /^\/api\/avatars\//.test(E.avatar) ? { source: 'avatar', ref: E.avatar } : null;
    if (!spec) return App.toast('Serve un avatar con immagine');
    try { await App.feed.post({ ...spec, characterId: E.id, context: `nuovo look: ${E.look.outfit}, capelli ${E.look.hairStyle}` }); } catch (err) { App.toast(err.message); }
  });
  $$('[data-doc]').forEach((b) => b.addEventListener('click', () => { fromForm(); App.docs.render(b.dataset.doc, { ...E, avatar: E.avatar }); }));
})();
