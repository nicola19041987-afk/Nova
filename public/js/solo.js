/* solo.js — v8.6.1: una avatar (Greta), metà schermo + dock Home/Mic/Camera/Impostazioni */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  function soloChar() {
    const list = App.chars || [];
    // L'unica avatar della home è Nova (id interno greta). Mai il primo personaggio della lista.
    return list.find((c) => c.ready === 'greta') || list.find((c) => /^(nova|greta)$/i.test(String(c.name || '').trim())) || null;
  }
  function fit() { if (App.fitFrame) App.fitFrame(); }

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
      if (App.isAdmin && App.isAdmin() && App.key()) {
        App.api('/api/solo/prep', { method: 'POST', ai: true, body: { store: true } }).catch(() => {});
      }
      this.setDock('home');
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
        const ch = soloChar();
        if (ch) App.chat.open(ch.id);
        App.openTab('chat');
        // force conv visible in solo
        $('#tab-conv').hidden = false; $('#tab-account').hidden = true; $('#tab-chat').hidden = true;
        $('#tab-calls') && ($('#tab-calls').hidden = true); $('#tab-images') && ($('#tab-images').hidden = true);
        document.body.dataset.tab = 'conv';
        requestAnimationFrame(fit);
        return;
      }
      if (name === 'mic') {
        // realtime voice call
        const ch = soloChar(); if (!ch) return;
        if (App.current?.id !== ch.id) App.chat.open(ch.id);
        if (App.call && App.call.active) {
          if (App.call.minimized && App.call.restore) App.call.restore();
          else if (App.call.mode === 'voice') { /* già in chiamata vocale */ }
          else if ($('#call-tovoice') || true) { try { App.call.start('voice'); } catch {} }
        } else {
          try { App.call.start('voice'); } catch (e) { App.toast(e.message || 'Microfono non avviato'); }
        }
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
      const b = $('#av-expand'); if (b) { b.textContent = on ? '✕' : '⛶'; b.title = on ? 'Riduci' : 'Ingrandisci avatar'; }
      if (on && App.stageFs && !App.stageFs.isFs()) { /* css overlay, not browser FS */ }
      requestAnimationFrame(() => { fit(); setTimeout(fit, 80); });
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
