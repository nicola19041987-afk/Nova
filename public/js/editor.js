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
    const T = App.DEF_TEXTS || {}; // v8.4: testi di partenza (modificabili) coerenti con le regole di comportamento
    return { id: null, name: '', avatar: '💫', avatarSource: 'emoji', personality: T.personality || '', style: T.style || '', orders: T.orders || '', voice: '', preset: null, landmarks: clone(LM_DEFAULT.ritratto),
      appearance: { gender: 'donna', age: 30, build: 'snella', shape: 'clessidra', proportions: 'equilibrate', height: 168, framing: 'ritratto', colors: { hue: 0, saturation: 100, brightness: 100, background: '#2b1530', glow: '#d14b8f' } },
      look: { cut: 'scalato', length: 'lunghi', hairColor: 'castano', hairStyle: 'mosse morbide', makeup: 'naturale', outfit: 'casual', custom: '' },
      identity: { core: T.core || '', locked: false }, wardrobe: [], autoChanges: { enabled: false, everyDays: 1, bodyDrift: false, buildMin: 'esile', buildMax: 'robusta' }, lookHistory: [], state: null };
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
    form.name.value = E.name; form.personality.value = E.personality; form.style.value = E.style; form.orders.value = E.orders || '';
    form.voice.value = E.voice || ''; if (form.voice.value !== (E.voice || '')) { const o = document.createElement('option'); o.value = o.textContent = E.voice; form.voice.appendChild(o); form.voice.value = E.voice; }
    $('#fill-base').hidden = !E.id || !!(String(E.personality || '').trim() && String(E.style || '').trim() && String((E.identity && E.identity.core) || '').trim());
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
    { const d = E.frameDist == null ? 0.75 : E.frameDist, el = $('#frame-dist'); if (el) { el.value = d; $('#frame-dist-val').textContent = distLabel(d); } }
    $('#char-delete').hidden = !E.id || !(App.isAdmin() || (App.canEdit() && (App.charById(E.id) || {}).createdBy === (App.me && App.me.user))); $('#import-box').hidden = !!E.id || !App.isAdmin(); $('#char-dialog-title').textContent = E.id ? `Modifica ${E.name}` : 'Nuovo personaggio';
    $('#doc-canvas').hidden = true; $('#doc-actions').hidden = true;
  }
  function fromForm() {
    E.name = form.name.value.trim(); E.personality = form.personality.value; E.style = form.style.value; E.orders = form.orders.value; E.voice = form.voice.value;
    if (E.avatarSource === 'emoji') E.avatar = form.avatarEmoji.value.trim() || '💫';
    $$('[data-ap]', form).forEach((el) => { E.appearance[el.dataset.ap] = el.type === 'range' ? Number(el.value) : el.value; });
    $$('[data-look]', form).forEach((el) => { E.look[el.dataset.look] = el.value; });
    if (!E.identity.locked) E.identity.core = $('[data-id="core"]').value;
    E.identity.locked = $('[data-id="locked"]').checked;
    $$('[data-auto]', form).forEach((el) => { E.autoChanges[el.dataset.auto] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value; });
  }
  function body(extra = {}) {
    return { name: E.name, avatar: E.avatar, avatarSource: E.avatarSource, avatarConsent: $('#avatar-consent').checked, pendingId: E.pendingId,
      personality: E.personality, style: E.style, orders: E.orders || '', voice: E.voice || '', ...(E.preset ? { preset: E.preset } : {}), landmarks: E.landmarks, appearance: E.appearance, look: E.look, identity: E.identity,
      wardrobe: E.wardrobe, autoChanges: E.autoChanges, frameDist: E.frameDist == null ? 0.75 : E.frameDist, ...extra };
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
    const isNew = !E.id;
    const ch = E.id ? await App.api(`/api/characters/${E.id}`, { method: 'PUT', body: body(extra) }) : await App.api('/api/characters', { method: 'POST', body: body(extra) });
    if (isNew && importMem.length) { // v8.4.1: ricordi ricavati dal testo importato -> memoria di base del nuovo personaggio
      const list = importMem; importMem = [];
      for (const text of list) await App.api('/api/memory', { method: 'POST', body: { text, charId: ch.id } }).catch(() => {});
      App.toast(`🧠 ${list.length} ricordi aggiunti a ${ch.name}`);
    }
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
        if (framingChanged) { r.character.landmarks = clone(LM_DEFAULT[E.appearance.framing]); try { if (E.ready==='greta' || (App.me&&App.me.solo)) App.api('/api/solo/prep',{method:'POST',ai:true,body:{}}); } catch {}
      store(await App.api(`/api/characters/${E.id}`, { method: 'PUT', body: { ...r.character } })); }
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

  const distLabel = (d) => (d < 0.2 ? 'vicina (primo piano)' : d < 0.5 ? 'media' : d < 0.85 ? 'lontana (consigliata)' : 'molto lontana');
  // v8.4.1: distanza dalla camera, anteprima dal vivo (anche nella chat aperta)
  { const el = $('#frame-dist'); if (el) el.addEventListener('input', () => {
    if (!App.canEdit()) return; const d = Number(el.value); E.frameDist = d; $('#frame-dist-val').textContent = distLabel(d); dirty = true;
    App.avatarEditor && App.avatarEditor.setDistance && App.avatarEditor.setDistance(d);
    if (App.current && App.current.id === E.id) { App.avatarConv.setDistance(d); if (App.avatarPresence) App.avatarPresence.setDistance(d); }
  }); }
  let importMem = []; // v8.4.1: ricordi dall'importazione da testo (salvati insieme al nuovo personaggio)
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
      $('#preset-hint').hidden = true; importMem = []; $('#import-status').innerHTML = ''; $('#import-box').open = false;
      toForm(); refreshAvatar(); if (!dlg.open) dlg.showModal();
      App.editor.frameUi && App.editor.frameUi();
    },
    current: () => E,
    // v8.4: nuovo personaggio da un modello pronto (sempre un personaggio NUOVO: nessun testo esistente viene toccato)
    openPreset(key) {
      const p = App.PRESETS && App.PRESETS[key]; if (!p) return;
      App.editor.open(null);
      Object.assign(E, { name: p.name, avatar: p.emoji, avatarSource: 'emoji', personality: p.personality, style: p.style, orders: p.orders || '', voice: p.voice, preset: key });
      E.identity.core = p.core; E.appearance.age = p.age; E.appearance.gender = 'donna'; Object.assign(E.look, p.look || {});
      if (p.ap) Object.assign(E.appearance, p.ap); if (p.colors) E.appearance.colors = { ...E.appearance.colors, ...p.colors }; // v8.4.2: modello completo
      if (p.ward) E.wardrobe = [{ id: null, name: p.ward.name, look: { ...E.look, ...p.ward.look } }];
      toForm(); refreshAvatar();
      $('#regen-extra').value = p.photo;
      const h = $('#preset-hint'); h.hidden = false;
      h.textContent = `Modello «${App.PRESET_LABELS[key]}»: nome, testi e voce sono modificabili. La foto non è inclusa: tocca «✨ Rigenera avatar» qui sotto per crearla con l'IA (usa la tua chiave xAI).`;
    },
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
  // v8.4.1: «Elimina personaggio» (solo Nicola), doppia conferma. Prima dell'eliminazione il server fa una copia di sicurezza
  // completa e mette il personaggio nel cestino (ripristinabile per 7 giorni da Impostazioni → Recupero personaggi).
  $('#char-delete').addEventListener('click', async () => {
    if (!App.roles.guard()) return;
    const id = E.id, name = E.name;
    if (!confirm(`Eliminare ${name}?\n\nVerranno tolti: il personaggio, la sua conversazione, i suoi ricordi di base e le sue foto.\nLa memoria condivisa (Nico e Luisa) e gli altri personaggi restano.\nPrima viene fatta una copia di sicurezza: potrai ripristinarlo per 7 giorni.`)) return;
    const typed = prompt(`Seconda conferma: scrivi il nome «${name}» per eliminarlo.`);
    if (typed == null) return;
    if (typed.trim().toLowerCase() !== String(name).trim().toLowerCase()) { App.toast('Nome diverso: non ho eliminato nulla'); return; }
    try {
      const r = await App.api(`/api/characters/${id}`, { method: 'DELETE' });
      App.chars = App.chars.filter((c) => c.id !== id); delete App.previews[id];
      if (App.current && App.current.id === id) App.chat.close();
      dlg.close(); App.chat.renderList();
      App.toast(`🗑️ ${name} eliminato (${r.messages || 0} messaggi, ${r.memories || 0} ricordi, ${r.files || 0} foto). Ripristinabile per 7 giorni: Impostazioni → Recupero personaggi.`, 6500);
    } catch (e) { App.toast('⚠️ ' + e.message, 5000); }
  });
  // v8.4.1: personaggi eliminati negli ultimi 7 giorni
  async function trashList() {
    const ul = $('#trash-list'); if (!ul) return;
    try {
      const r = await App.api('/api/trash/characters');
      ul.innerHTML = r.items.length ? r.items.map((x) => `<li><span><b>${esc(x.name)}</b><br><span class="muted small">eliminato il ${esc(fmtDate(x.deletedAt))} · ${x.messages} messaggi · ripristinabile fino al ${esc(fmtDate(x.until))}</span></span><button type="button" data-trash="${esc(x.tid)}">Ripristina</button></li>`).join('') : '<li class="muted small">Nessun personaggio eliminato negli ultimi 7 giorni.</li>';
    } catch (e) { ul.innerHTML = `<li class="muted small">⚠️ ${esc(e.message)}</li>`; }
  }
  const tl = $('#trash-load'); if (tl) tl.addEventListener('click', trashList);
  const tlist = $('#trash-list'); if (tlist) tlist.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-trash]'); if (!b || !App.roles.guard()) return;
    try { const r = await App.api(`/api/trash/characters/${encodeURIComponent(b.dataset.trash)}/restore`, { method: 'POST' }); await App.loadChars(); App.chat.renderList(); App.toast(`↩︎ ${r.character.name} ripristinato con la sua chat`); trashList(); }
    catch (er) { App.toast('⚠️ ' + er.message); }
  });
  // v8.4.1: «Importa personaggio da testo» -> compila i campi di un NUOVO personaggio (da rivedere, niente viene salvato da solo)
  $('#import-go').addEventListener('click', async () => {
    if (!App.roles.guard()) return;
    const text = $('#import-text').value.trim(), st = $('#import-status'), b = $('#import-go');
    if (text.length < 20) { st.textContent = 'Incolla una descrizione un po\' più lunga.'; return; }
    b.disabled = true; st.textContent = '✨ Lettura del testo in corso…';
    try {
      const { draft: d } = await App.api('/api/characters-import', { method: 'POST', body: { text }, ai: true });
      fromForm();
      if (d.name) E.name = d.name;
      if (d.personality) E.personality = d.personality;
      if (d.style) E.style = d.style;
      if (d.voice) E.voice = d.voice;
      Object.assign(E.appearance, d.appearance || {}); Object.assign(E.look, d.look || {});
      if (d.identity && d.identity.core) E.identity.core = d.identity.core;
      importMem = d.memories || [];
      toForm(); refreshAvatar(); dirty = true;
      st.innerHTML = `✅ Campi compilati: controllali e premi <b>Salva</b>.${importMem.length ? `<br>Ricordi che verranno aggiunti al salvataggio:<ul>${importMem.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}${d.notes ? `<br>Note: ${esc(d.notes)}` : ''}<br>La foto non è inclusa: usa «✨ Rigenera avatar».`;
      $('#import-box').open = true;
    } catch (e) { if (e.message !== 'NO_KEY') st.textContent = '⚠️ ' + e.message; }
    b.disabled = false;
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
  // v8.4: «Adatta alla cornice» / «Foto originale» (versione 9:16 fatta dall'IA, solo per la visualizzazione)
  async function frameUi() {
    const box = $('#frame-box'), photo = E.id && typeof E.avatar === 'string' && E.avatar.startsWith('/api/');
    if (!photo) { box.hidden = true; return; }
    const ff = E.frameFill && E.frameFill.src === E.avatar ? E.frameFill : null;
    box.hidden = false; // v8.4.1: sempre visibile con una foto (c'è anche «Allontana con l'IA»)
    $('#frame-fit').hidden = !!(ff && !ff.off) ; $('#frame-fit').textContent = ff ? '🖼️ Usa la foto adattata' : '🖼️ Adatta alla cornice';
    $('#frame-undo').hidden = !(ff && !ff.off);
    const r = await App.frame.ratio(E.avatar), odd = r && Math.abs(r - 9 / 16) > 0.04;
    $('#frame-fit').hidden = !!(ff && !ff.off) || (!ff && !odd);
    $('#frame-info').textContent = ff && !ff.off ? (ff.far ? 'In chat e in chiamata si vede la versione ripresa più da lontano (fatta dall\'IA dalla stessa foto).' : 'In chat e in chiamata si vede la versione allargata a 9:16 (stessa foto, bordi completati dall\'IA).') : (odd ? 'La foto non è in formato 9:16: la cornice la riempie da sola (taglio leggero e bordi in tinta, niente sfocature). «Adatta alla cornice» la allarga con l\'IA. ' : '') + '«🔭 Allontana con l\'IA» crea la stessa foto ripresa da più lontano (usa la tua chiave).';
  }
  App.editor.frameUi = frameUi;
  $('#frame-fit').addEventListener('click', async () => {
    if (!App.roles.guard()) return; const ch = App.charById(E.id); if (!ch) return;
    const ff = E.frameFill && E.frameFill.src === E.avatar ? E.frameFill : null;
    try { const r = ff ? await App.frame.setOff(ch, false) : await App.frame.extend(ch, false); if (r) E.frameFill = r; } catch (e) { App.toast('⚠️ ' + e.message); }
    frameUi();
  });
  $('#frame-far').addEventListener('click', async () => {
    if (!App.roles.guard()) return; const ch = App.charById(E.id); if (!ch) return;
    try { const r = await App.frame.extend(ch, false, true); if (r) E.frameFill = r; } catch (e) { App.toast('⚠️ ' + e.message); }
    frameUi();
  });
  $('#frame-undo').addEventListener('click', async () => {
    if (!App.roles.guard()) return; const ch = App.charById(E.id); if (!ch) return;
    try { E.frameFill = await App.frame.setOff(ch, true); App.toast('↩︎ Torno alla foto originale'); } catch (e) { App.toast('⚠️ ' + e.message); }
    frameUi();
  });
  // v8.4: «Riempi con base»: completa SOLO i campi vuoti con i testi di partenza (mai sovrascrivere testi esistenti)
  $('#fill-base').addEventListener('click', () => {
    fromForm(); const T = App.DEF_TEXTS, done = [];
    if (!String(E.personality || '').trim()) { E.personality = T.personality; done.push('personalità'); }
    if (!String(E.style || '').trim()) { E.style = T.style; done.push('stile'); }
    if (!E.identity.locked && !String(E.identity.core || '').trim()) { E.identity.core = T.core; done.push('descrizione'); }
    dirty = true; toForm(); App.toast(done.length ? `✍️ Completati: ${done.join(', ')}. Controlla e salva.` : 'Nessun campo vuoto da completare');
  });
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
    try { if (dirty) await save(); const r = await App.api(`/api/characters/${E.id}/memory-base`, { method: 'POST', body: {} }); await App.account.loadMemory(); App.toast(`🧠 Memoria base: ${r.added.length} elementi (modificabili in Impostazioni)`); }
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
