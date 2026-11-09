/* solo.js — una sola avatar visibile (Nova). Le schede con archived restano su disco ma non si scelgono. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  function live(c) { return !!(c && !c.archived); }
  function soloChar() {
    const list = (App.chars || []).filter(live);
    const saved = App.settings && App.settings.activeChar;
    if (saved) {
      const hit = list.find((c) => c.id === saved);
      if (hit) return hit;
    }
    return list.find((c) => c.ready === 'nova-scelta') || list.find((c) => c.ready === 'nova-bionda') || list.find((c) => c.ready === 'nova-unico') || list.find((c) => c.ready === 'greta') || list.find((c) => /^nova$/i.test(String(c.name || '').trim())) || null;
  }
  function fit() { if (App.fitFrame) App.fitFrame(); }
  function drop3d() {
    document.body.classList.remove('vrm-on');
    const c = document.getElementById('vrm-view');
    if (c) c.hidden = true;
    const sel = document.getElementById('avatar-view');
    if (sel) {
      [...sel.options].forEach((o) => { if (o.value === 'video') o.remove(); });
      if (![...sel.options].some((o) => o.value === '3d')) {
        const opt = document.createElement('option');
        opt.value = '3d';
        opt.textContent = '3D (stand-in)';
        sel.appendChild(opt);
      }
      sel.value = 'photo';
    }
    try {
      if (App.me && App.ls) {
        if (App.ls.get('avatarViewPick', '') === '3d') App.ls.set('avatarViewPick', 'photo');
        if (App.ls.get('avatarView', '') === '3d') App.ls.set('avatarView', 'photo');
      }
    } catch { /* storage assente */ }
  }
  function loadAvatar3d() {
    if (window.App && App.avatar3d) return Promise.resolve();
    if (loadAvatar3d.p) return loadAvatar3d.p;
    loadAvatar3d.p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/js/avatar3d.js';
      s.onload = () => (App.avatar3d ? res() : rej(new Error('3D non pronto')));
      s.onerror = () => rej(new Error('Script 3D non caricato'));
      document.body.appendChild(s);
    }).catch((e) => { loadAvatar3d.p = null; throw e; });
    return loadAvatar3d.p;
  }
  async function chooseView(next) {
    const sel = document.getElementById('avatar-view');
    const status = document.getElementById('avatar-view-status');
    if (next !== '3d') {
      if (App.avatar3d && App.avatar3d.apply) await App.avatar3d.apply('photo');
      document.body.classList.remove('vrm-on');
      const c = document.getElementById('vrm-view');
      if (c) c.hidden = true;
      if (status) status.textContent = 'Nova usa la foto.';
      try { if (App.me && App.ls) App.ls.set('avatarViewPick', 'photo'); } catch { /* storage assente */ }
      return;
    }
    if (status) status.textContent = 'Carico il 3D…';
    try {
      await loadAvatar3d();
      await App.avatar3d.apply('3d');
      if (App.avatar3d.failed && App.avatar3d.failed()) {
        if (sel) sel.value = 'photo';
        try { if (App.me && App.ls) App.ls.set('avatarViewPick', 'photo'); } catch { /* storage assente */ }
        return;
      }
      try { if (App.me && App.ls) App.ls.set('avatarViewPick', '3d'); } catch { /* storage assente */ }
    } catch (e) {
      if (sel) sel.value = 'photo';
      if (status) status.textContent = (e && e.message) || '3D non disponibile. Resta la foto.';
      try { if (App.me && App.ls) App.ls.set('avatarViewPick', 'photo'); } catch { /* storage assente */ }
    }
  }
  function sheetOk(c) {
    return live(c);
  }
  function stageClip(ch) {
    const bag = Object.assign({}, (ch && ch.actions) || {}, (ch && ch.seated) || {});
    const vids = Object.values(bag).filter((a) => a && a.kind === 'video' && a.url && !a.stale);
    vids.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return vids[0] || null;
  }
  function showStage(ch) {
    const v = document.getElementById('stage-video'); if (!v || !ch) return;
    if (App.gestures && App.gestures.playing && App.gestures.playing()) return;
    const clip = stageClip(ch);
    if (!clip) { try { v.pause(); } catch {} v.hidden = true; if (v.getAttribute('src')) v.removeAttribute('src'); return; }
    if (v.getAttribute('src') !== clip.url) v.src = clip.url;
    v.hidden = false;
    v.play().catch(() => {});
  }
  function sheetList() {
    return (App.chars || []).filter(sheetOk).sort((a, b) => (Number(b.messages) || 0) - (Number(a.messages) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'it'));
  }

  App.solo = {
    char: soloChar,
    full: false,
    async boot() {
      document.body.classList.add('solo-mode');
      drop3d();
      this.bindOnce();
      const dock = $('#solo-dock'); if (dock) dock.hidden = false;
      const legacy = $('#legacy-tabbar'); if (legacy) legacy.hidden = true;
      const listTab = $('#tab-chat'); if (listTab) listTab.hidden = true;
      const ch = soloChar();
      if (!ch) {
        const conv = $('#tab-conv'); if (conv) conv.hidden = false;
        const title = $('#title'); if (title) title.textContent = 'Nova';
        document.body.dataset.tab = 'conv';
        this.bindOnce();
        return;
      }
      // Una sola apertura. Le ricariche dei personaggi non azzerano la chat e non tolgono Impostazioni.
      if (this._booted) { this.syncChar(); return; }
      this._booted = true;
      if (!App.current || App.current.id !== ch.id) {
        try { await App.chat.open(ch.id); } catch (e) { console.warn('Solo open:', e.message); }
      }
      this.syncSettings(ch);
      this.bindOnce();
      requestAnimationFrame(() => { fit(); setTimeout(fit, 120); });
      if (App.isAdmin && App.isAdmin() && App.key() && !(App.me && App.me.serverKey)) {
        App.api('/api/solo/prep', { method: 'POST', ai: true, body: { store: true } }).catch(() => {});
      }
      this.setDock('home');
      showStage(ch);
      const rt = $('#solo-rt'); if (rt) rt.hidden = false;
      if (App.looks && App.looks.boot) App.looks.boot();
    },
    async toggleRt() {
      const btn = $('#solo-rt');
      const status = $('#voice-status');
      const off = () => {
        document.body.classList.remove('solo-rt');
        if (btn) { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); }
        if (status) { status.hidden = true; status.textContent = ''; }
      };
      if (document.body.classList.contains('solo-rt')) {
        if (App.ls && App.me) App.ls.set('soloRtOff', true);
        if (App.rt && App.rt.stop) App.rt.stop();
        off();
        return;
      }
      if (App.ls && App.me) App.ls.set('soloRtOff', false);
      const ch = soloChar();
      if (!ch || !App.current || App.current.id !== ch.id) return;
      if (App.call && App.call.active) return;
      if (App.voice && App.voice.isListening && App.voice.isListening()) App.voice.stop();
      if (!App.hasAi || !App.hasAi()) return App.toast('🔑 Per la voce in tempo reale serve la chiave xAI in Impostazioni');
      if (!App.rt || !App.rt.supported || !App.rt.supported()) return App.toast('Questo browser non supporta la voce in tempo reale');
      document.body.classList.add('solo-rt');
      if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
      if (status) { status.hidden = false; status.textContent = '⚡ Collegamento…'; }
      try {
        await App.rt.start(ch, 'voice', '');
        if (!document.body.classList.contains('solo-rt')) { if (App.rt.stop) App.rt.stop(); return; }
        if (status) status.textContent = '⚡ In ascolto';
      } catch (e) {
        off();
        App.toast('⚡ Voce in tempo reale non disponibile' + (e && e.message ? ': ' + e.message : ''));
      }
    },
    syncChar() {
      const ch = soloChar();
      if (!ch || !App.current || App.current.id !== ch.id) return;
      const fresh = (App.charById && App.charById(ch.id)) || ch;
      const prevAvatar = App.current.avatar;
      App.current = fresh;
      const title = $('#title');
      if (title && document.body.dataset.tab === 'conv' && !document.body.classList.contains('in-call')) title.textContent = fresh.name;
      if (fresh.avatar !== prevAvatar && App.avatarConv && !(App.previews && App.previews[fresh.id])) App.avatarConv.setCharacter(fresh);
      showStage(fresh);
    },
    syncSettings(ch) {
      const ta = $('#set-requests');
      if (ta && document.activeElement !== ta) ta.value = (ch && (ch.requests || ch.orders)) || '';
      const adult = $('#set-adult');
      // adult already managed in account.js
    },
    bindOnce() {
      if (this._bound) return; this._bound = true;
      const dock = $('#solo-dock');
      if (dock) dock.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dock]'); if (!b) return;
        this.onDock(b.dataset.dock);
      });
      const cam = $('#dock-cam');
      if (cam) {
        let timer = null, held = false;
        const clearHold = () => { if (timer) { clearTimeout(timer); timer = null; } };
        cam.addEventListener('pointerdown', (e) => {
          if (e.button != null && e.button !== 0) return;
          held = false; clearHold();
          timer = setTimeout(() => {
            timer = null; held = true;
            if (App.sight && App.sight.active && App.sight.active()) App.sight.stop();
            const ch = soloChar();
            if (ch && App.current?.id !== ch.id && App.chat) App.chat.open(ch.id);
            try { App.call.start('video'); } catch (err) { App.toast((err && err.message) || 'Videochiamata non avviata'); }
          }, 650);
        });
        cam.addEventListener('pointerup', clearHold);
        cam.addEventListener('pointercancel', clearHold);
        cam.addEventListener('click', (e) => {
          if (!held) return;
          held = false; e.preventDefault(); e.stopPropagation();
        }, true);
      }
      const viewSel = $('#avatar-view');
      if (viewSel && !viewSel._soloView) {
        viewSel._soloView = true;
        viewSel.addEventListener('change', () => { chooseView(viewSel.value); });
      }
      const exp = $('#av-expand');
      if (exp) exp.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFull(); });
      const stage = $('#stage');
      if (stage) stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.stage-tools,#call-ui')) this.toggleFull(); });
      // tap empty stage area to expand (single tap on canvas)
      const stageEl = $('#stage');
      if (stageEl && !stageEl._mini) {
        stageEl._mini = true;
        stageEl.addEventListener('click', (e) => {
          if (App.call && App.call.active) return;
          if (e.target.closest('button, a, input, textarea, form, .stage-tools, #call-ui')) return;
          if (this.full) { this.toggleFull(false); return; }
          const conv = $('#tab-conv'); if (!conv) return;
          conv.classList.toggle('stage-mini');
          if (App.ls && App.me) App.ls.set('stageMini', conv.classList.contains('stage-mini'));
          fit();
          requestAnimationFrame(() => fit());
        });
      }
      if (App.ls && App.ls.get('stageMini') === true) {
        const conv = $('#tab-conv'); if (conv) conv.classList.add('stage-mini');
      }
      const rt = $('#solo-rt'); if (rt) rt.addEventListener('click', () => this.toggleRt());
      const photo = $('#wa-photo');
      if (photo) {
        const open = (e) => { e.preventDefault(); e.stopPropagation(); this.openPicker(); };
        photo.addEventListener('click', open);
        photo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
      }
      const look = $('#set-look-btn'); if (look) look.onclick = () => this.openLook();
      const save = $('#set-requests-save'); if (save) save.onclick = () => this.saveRequests();
      const hot = $('#set-hot-btn'); if (hot) hot.onclick = () => { const h = $('#hot-btn'); if (h) h.click(); else if (App.actions && App.actions.openHot) App.actions.openHot(); };
      window.addEventListener('resize', () => { if (document.body.classList.contains('solo-mode')) fit(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.full) this.toggleFull(false); });
    },
    setDock(name) {
      document.querySelectorAll('#solo-dock [data-dock]').forEach((b) => b.classList.toggle('active', b.dataset.dock === name));
    },
    onDock(name) {
      this.setDock(name);
      if (name === 'home') {
        if (this.full) this.toggleFull(false);
        // Il thread è già aperto: openTab mostra la conversazione senza richiamare chat.open, che svuoterebbe #messages.
        App.openTab('chat');
        const conv = $('#tab-conv'); if (conv) conv.hidden = false;
        const acc = $('#tab-account'); if (acc) acc.hidden = true;
        const list = $('#tab-chat'); if (list) list.hidden = true;
        const calls = $('#tab-calls'); if (calls) calls.hidden = true;
        const images = $('#tab-images'); if (images) images.hidden = true;
        document.body.dataset.tab = 'conv';
        requestAnimationFrame(fit);
        return;
      }
      if (name === 'mic') {
        // Il microfono del dock non apre una chiamata: accende o spegne il dettato nel composer.
        const listening = App.voice && App.voice.isListening && App.voice.isListening();
        if (listening) {
          App.voice.stop();
          this.setDock(document.body.dataset.tab === 'account' ? 'settings' : 'home');
          return;
        }
        const ch = soloChar();
        if (ch && (!App.current || App.current.id !== ch.id) && App.chat) App.chat.open(ch.id);
        else if ($('#tab-conv') && $('#tab-conv').hidden && App.openTab) App.openTab('chat');
        if (App.voice && App.voice.start) App.voice.start({ composer: true });
        const on = App.voice && App.voice.isListening && App.voice.isListening();
        this.setDock(on ? 'mic' : (document.body.dataset.tab === 'account' ? 'settings' : 'home'));
        return;
      }
      if (name === 'cam') {
        const ch = soloChar(); if (!ch) return;
        if (App.current?.id !== ch.id && App.chat) App.chat.open(ch.id);
        if (App.sight && App.sight.toggle) {
          const was = App.sight.active && App.sight.active();
          App.sight.toggle();
          if (was) App.toast('Camera spenta. Nova non riceve più fotogrammi.', 2500);
        }
        else App.toast('Visione da fotocamera non disponibile');
        return;
      }
      if (name === 'settings') {
        if (this.full) this.toggleFull(false);
        this.syncSettings(soloChar());
        App.openTab('account');
        $('#tab-conv').hidden = true;
        document.body.dataset.tab = 'account';
      }
    },
    toggleFull(force) {
      const on = force == null ? !this.full : !!force;
      this.full = on;
      const st = $('#stage'); if (st) st.classList.toggle('av-full', on);
      document.body.classList.toggle('av-full-on', on);
      document.dispatchEvent(new CustomEvent('nova-layer'));
      const b = $('#av-expand'); if (b) { b.textContent = '⛶'; b.title = on ? 'Riduci' : 'Ingrandisci avatar'; b.setAttribute('aria-hidden', on ? 'true' : 'false'); }
      if (on && App.stageFs && !App.stageFs.isFs()) { /* css overlay, not browser FS */ }
      if (App.fitFrame) requestAnimationFrame(() => App.fitFrame());
    },
    async saveRequests() {
      const v = ($('#set-requests') && $('#set-requests').value) || '';
      try {
        const r = await App.api('/api/solo/requests', { method: 'PUT', body: { requests: v } });
        if (r.character) {
          const i = App.chars.findIndex((c) => c.id === r.character.id);
          if (i >= 0) App.chars[i] = { ...App.chars[i], ...r.character };
          if (App.current && App.current.id === r.character.id) Object.assign(App.current, r.character);
        }
        App.toast('Richieste salvate');
      } catch (e) { App.toast(e.message); }
    },
    picker() {
      let dlg = $('#avatar-sheet');
      if (dlg) return dlg;
      dlg = document.createElement('div');
      dlg.id = 'avatar-sheet';
      dlg.className = 'avatar-sheet';
      dlg.hidden = true;
      dlg.innerHTML = `<button type="button" class="avatar-x" aria-label="Chiudi">×</button><h3 id="avatar-sheet-title">Avatar</h3>
        <div class="avatar-edit">
          <label for="avatar-edit-note">Modifica la foto</label>
          <input id="avatar-edit-note" type="text" maxlength="400" placeholder="es. maglietta rossa, capelli corti" autocomplete="off">
          <button type="button" id="avatar-edit-go">Aggiorna immagine</button>
          <p id="avatar-edit-status" class="muted small" hidden></p>
        </div>
        <ul id="avatar-sheet-list"></ul>`;
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-labelledby', 'avatar-sheet-title');
      (document.getElementById('app-shell') || document.body).appendChild(dlg);
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('.avatar-x')) dlg.hidden = true;
      });
      const go = $('#avatar-edit-go');
      if (go) go.addEventListener('click', (e) => { e.stopPropagation(); this.editPhoto(); });
      const ul = $('#avatar-sheet-list');
      if (ul) ul.addEventListener('click', (e) => {
        const li = e.target.closest('li[data-id]'); if (!li) return;
        if (e.target.closest('[data-act]')) this.activate(li.dataset.id);
        if (e.target.closest('[data-del]')) this.removeChar(li.dataset.id);
      });
      return dlg;
    },
    openPicker() {
      const dlg = this.picker();
      this.renderPicker();
      dlg.hidden = false;
    },
    renderPicker() {
      const ul = $('#avatar-sheet-list'); if (!ul) return;
      const active = soloChar();
      const aid = active && active.id;
      const mine = sheetList();
      ul.innerHTML = mine.map((c) => {
        const on = c.id === aid;
        const n = Number(c.messages) || 0;
        return `<li data-id="${esc(c.id)}" class="${on ? 'on' : ''}">${App.avatarHtml(c, 'av-pick-face')}<b>${esc(c.name || 'Avatar')}</b><span class="av-msgs">${n}</span><button type="button" data-act${on ? ' disabled' : ''}>Attiva</button><button type="button" data-del${on ? ' disabled' : ''}>Cancella</button></li>`;
      }).join('') || '<li class="muted">Nessun avatar</li>';
    },
    async activate(id) {
      const ch = App.charById(id); if (!ch || !sheetOk(ch)) return;
      try {
        App.settings = await App.api('/api/settings', { method: 'PUT', body: { ...(App.settings || {}), activeChar: id } });
        App.ls.set('settings', App.settings);
      } catch (e) { App.toast(e.message || 'Scelta non salvata'); return; }
      if (!App.current || App.current.id !== id) {
        try { await App.chat.open(id); } catch (e) { App.toast(e.message); }
      }
      const title = $('#title'); if (title) title.textContent = ch.name;
      if (App.avatarConv) App.avatarConv.setCharacter(ch);
      if (App.chat && App.chat.header) App.chat.header();
      showStage(ch);
      this.renderPicker();
    },
    async removeChar(id) {
      const active = soloChar();
      if (!id || (active && active.id === id)) return;
      const ch = App.charById(id); if (!ch || !sheetOk(ch)) return;
      if (!confirm(`Cancellare definitivamente ${ch.name}?`)) return;
      try { await App.api(`/api/characters/${id}`, { method: 'DELETE' }); }
      catch (e) { App.toast(e.message || 'Non cancellato'); return; }
      App.chars = (App.chars || []).filter((c) => c.id !== id);
      if (App.chat && App.chat.renderList) App.chat.renderList();
      this.renderPicker();
    },
    async editPhoto() {
      const input = $('#avatar-edit-note');
      const note = (input && input.value || '').trim();
      const status = $('#avatar-edit-status');
      const btn = $('#avatar-edit-go');
      if (!note) return;
      const ch = soloChar();
      if (!ch || !/^\/api\/avatars\//.test(ch.avatar || '')) {
        if (status) { status.hidden = false; status.textContent = 'Serve una foto attiva da modificare.'; }
        return;
      }
      if (btn) btn.disabled = true;
      if (status) { status.hidden = false; status.textContent = 'Aggiorno la foto…'; }
      try {
        const r = await App.api(`/api/characters/${ch.id}/photo-edit`, { method: 'POST', ai: true, body: { prompt: note } });
        const next = r && r.character;
        if (!next || !next.avatar) throw new Error('Nessuna foto ricevuta');
        const i = (App.chars || []).findIndex((c) => c.id === next.id);
        if (i >= 0) App.chars[i] = next;
        if (App.current && App.current.id === next.id) App.current = next;
        if (App.avatarConv) App.avatarConv.setCharacter(next);
        if (App.chat && App.chat.header) App.chat.header();
        showStage(next);
        if (input) input.value = '';
        if (status) status.textContent = 'Foto aggiornata. La precedente resta nello storico.';
        this.renderPicker();
      } catch (e) {
        const msg = (e && e.message) || 'Modifica non riuscita';
        if (status) { status.hidden = false; status.textContent = msg; }
      } finally {
        if (btn) btn.disabled = false;
      }
    },
    openLook() {
      const ch = soloChar(); if (!ch) return;
      let dlg = $('#solo-look-dialog');
      if (!dlg) {
        dlg = document.createElement('dialog'); dlg.id = 'solo-look-dialog'; dlg.className = 'sheet';
        dlg.innerHTML = `<form method="dialog" class="solo-look-form">
          <h3>Aspetto di Nova</h3>
          <p class="muted small">Solo testo → nuova foto inventata (stesso volto AI).</p>
          <label>Capelli <input name="hair" placeholder="es. biondo miele a spalle con frangia"></label>
          <label>Occhi <input name="eyes" placeholder="es. verdi"></label>
          <label>Corpo <input name="body" placeholder="es. 165 cm"></label>
          <label>Vestiti <input name="clothes" placeholder="es. maglia rossa"></label>
          <label>Altro <input name="extra" placeholder="opzionale"></label>
          <div class="row"><button type="submit" value="ok" class="primary">✨ Aggiorna</button>
          <button type="submit" value="cancel">Annulla</button></div>
        </form>`;
        (document.getElementById('app-shell') || document.body).appendChild(dlg);
        dlg.addEventListener('close', async () => {
          if (dlg.returnValue !== 'ok') return;
          const f = dlg.querySelector('form');
          const body = { hair: f.hair.value, eyes: f.eyes.value, body: f.body.value, clothes: f.clothes.value, extra: f.extra.value };
          App.toast('Aggiorno l’aspetto…');
          try {
            const look = { ...(ch.look || {}) };
            if (body.hair) look.hair = body.hair;
            if (body.eyes) look.eyes = body.eyes;
            if (body.clothes) look.outfit = body.clothes;
            const appearance = { ...(ch.appearance || {}) };
            if (body.body) appearance.build = body.body;
            const prompt = [body.hair && `hair: ${body.hair}`, body.eyes && `eyes: ${body.eyes}`, body.clothes && `outfit: ${body.clothes}`, body.body && `body: ${body.body}`, body.extra].filter(Boolean).join('; ');
            const r = await App.api(`/api/characters/${ch.id}/regenerate`, { method: 'POST', ai: true, body: { appearance, look, identity: ch.identity, prompt: prompt || undefined } });
            if (r.character) {
              Object.assign(ch, r.character); App.current = ch;
              App.avatarConv && App.avatarConv.setCharacter(ch);
              App.toast('Aspetto aggiornato');
            } else if (r.preview) {
              App.previews[ch.id] = r.preview;
              App.avatarConv && App.avatarConv.setImage(r.preview.dataUrl);
              App.toast('Anteprima pronta');
            }
            App.api('/api/solo/prep', { method: 'POST', ai: true, body: {} }).catch(() => {});
            fit();
          } catch (e) { App.toast(e.message || 'Aggiornamento non riuscito'); }
        });
      }
      const f = dlg.querySelector('form');
      f.hair.value = (ch.look && ch.look.hair) || '';
      f.eyes.value = (ch.look && ch.look.eyes) || '';
      f.body.value = (ch.appearance && (ch.appearance.build || '')) || '';
      f.clothes.value = (ch.look && ch.look.outfit) || '';
      f.extra.value = '';
      if (App.closeSheets) App.closeSheets(dlg);
      dlg.showModal();
    },
  };

  const wrap = () => {
    if (!App.loadChars || App.loadChars._soloWrapped) return;
    const orig = App.loadChars;
    App.loadChars = async (...a) => {
      const r = await orig(...a);
      try {
        if (App.me && App.solo) {
          if (!App.solo._booted) await App.solo.boot();
          else App.solo.syncChar();
        }
      } catch (e) { console.warn(e); }
      return r;
    };
    App.loadChars._soloWrapped = true;
  };
  if (App.loadChars) wrap(); else document.addEventListener('DOMContentLoaded', wrap);
})();
