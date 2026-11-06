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
    return list.find((c) => c.ready === 'nova-unico') || list.find((c) => c.ready === 'greta') || list.find((c) => /^nova$/i.test(String(c.name || '').trim())) || null;
  }
  function fit() { if (App.fitFrame) App.fitFrame(); }
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
        if (App.rt && App.rt.stop) App.rt.stop();
        off();
        return;
      }
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
      const exp = $('#av-expand');
      if (exp) exp.addEventListener('click', (e) => { e.stopPropagation(); this.toggleFull(); });
      const stage = $('#stage');
      if (stage) stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.stage-tools,#call-ui')) this.toggleFull(); });
      // tap empty stage area to expand (single tap on canvas)
      const canvas = $('#avatar-canvas');
      if (canvas) {
        canvas.addEventListener('click', (e) => {
          if (App.call && App.call.active) return;
          // tap sull'avatar: ingrandisce (o riduce se già pieno)
          this.toggleFull();
        });
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
        if (App.current?.id !== ch.id) App.chat.open(ch.id);
        if (this.full || (App.call && App.call.active)) {
          try { App.call.start('video'); } catch (e) { App.toast(e.message || 'Camera non avviata'); }
        } else {
          this.toggleFull(true); // modalità avatar a tutto schermo; secondo tap Camera → videochiamata
        }
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
      dlg.innerHTML = `<button type="button" class="avatar-x" aria-label="Chiudi">×</button><h3 id="avatar-sheet-title">Avatar</h3><ul id="avatar-sheet-list"></ul>`;
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-labelledby', 'avatar-sheet-title');
      (document.getElementById('app-shell') || document.body).appendChild(dlg);
      dlg.addEventListener('click', (e) => {
        if (e.target === dlg || e.target.closest('.avatar-x')) dlg.hidden = true;
      });
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
