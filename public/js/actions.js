/* actions.js — AZIONI dell'avatar (v7): brevi clip (o pose) preparate su richiesta con «Prepara azioni»,
 * riprodotte nel riquadro dell'avatar con dissolvenza; scelte da lei quando è inattiva (con limiti) o dalla chat ([azione:xxx]).
 * Le azioni per adulti esistono solo con la modalità adulti attiva per entrambi e per personaggi con volto generato dall'IA. */
(function () {
  const av = () => App.avatarConv;
  const TAG = /\s*\[azione:\s*([a-zà-ù]+)\s*\]/gi;
  const AUTO_MIN_GAP = 150e3, AUTO_IDLE = 45e3, AUTO_MAX_HOUR = 8;
  let info = { catalog: [], adult: false, video: true }, lastActivity = Date.now(), autoLog = [], lastAuto = 0, running = null;
  const poseLm = new Map(); // url -> punti del viso trovati sul telefono

  const ready = (ch) => Object.entries((ch && ch.actions) || {}).filter(([, a]) => !a.stale);
  const meta = (id) => info.catalog.find((c) => c.id === id) || { id, label: id, emoji: '🎭' };

  App.actions = {
    strip(t) { return String(t || '').replace(TAG, '').replace(/\s*\[(?:gesto|umore):\s*[a-zà-ù]*\s*\]\s*/gi, ' ').replace(/\s*\[(?:azione|gesto|umore):[^\]]*$/i, '').replace(/\s*\[[a-zà-ù]{0,6}$/i, '').trim(); }, // v8: anche i tag di gesto/umore // anche un tag a metà durante lo streaming
    tag(t) { const m = /\[azione:\s*([a-zà-ù]+)\s*\]/i.exec(String(t || '')); return m ? m[1].toLowerCase() : null; },
    fromReply(t) { const a = this.tag(t); if (a) this.play(a, 'chat'); },
    async load() {
      try { info = await App.api('/api/actions'); } catch { /* offline */ }
      const A = av(); if (!info.adult && A.act && A.act.adult) A.stopAction(true); // modalità adulti spenta: via subito
      this.render();
    },
    refresh() { this.load(); },
    // riproduce un'azione pronta del personaggio aperto (mai durante la scena cinematografica o se ne sta già facendo una)
    async play(aid, why = 'manuale') {
      const ch = App.current; if (!ch) return false;
      const a = ch.actions && ch.actions[aid]; if (!a || a.stale) return false;
      const A = av(); if (A.actionBusy() || (A.sceneOn && A.sceneOn())) return false;
      try {
        if (a.kind === 'pose') {
          const p = A.playAction({ kind: 'pose', url: a.url, lm: poseLm.get(a.url) || null }); if (A.act) A.act.adult = !!meta(aid).adult;
          if (!poseLm.has(a.url) && App.findFace) App.findFace(a.url).then((lm) => { poseLm.set(a.url, lm); if (lm) A.setActionLandmarks(lm); });
          await p;
        } else { const p = A.playAction({ kind: 'video', url: a.url }); if (A.act) A.act.adult = !!meta(aid).adult; await p; }
        return true;
      } catch (e) { console.warn('Azione non riprodotta', aid, why, e && e.message); return false; }
    },
    render() {
      const ch = App.current, list = $('#act-list'); if (!list) return;
      const acts = Object.entries((ch && ch.actions) || {});
      list.innerHTML = acts.length ? acts.map(([id, a]) => { const m = meta(id); return `<button type="button" data-act="${esc(id)}" class="${a.stale ? 'stale' : ''}" title="${a.stale ? 'Preparata con un avatar precedente: rifalla' : esc(m.label)}">${m.emoji} ${esc(m.label)}</button>`; }).join('') : '';
      const n = ready(ch).length;
      $('#act-info').textContent = !ch ? '' : !/^\/api\/avatars\//.test(ch.avatar || '') ? 'Serve un avatar immagine per le azioni.' : n ? `${n} azioni pronte${acts.length > n ? ` · ${acts.length - n} da rifare (avatar cambiato)` : ''}` : 'Nessuna azione pronta: usa «Prepara azioni».';
      $('#act-btn').classList.toggle('on', !!n);
      $('#act-auto').checked = App.ls.get('actAuto', true) !== false;
    },
    // ---- finestra «Prepara azioni» ----
    openPrepare() {
      const ch = App.current; if (!ch) return;
      const row = (c) => { const a = ch.actions && ch.actions[c.id]; const st = !a ? 'da preparare' : a.stale ? 'da rifare (avatar cambiato)' : `pronta (${a.kind === 'pose' ? 'posa' : 'clip'})`;
        return `<label><input type="checkbox" data-prep="${c.id}" ${!a || a.stale ? 'checked' : ''}> ${c.emoji} ${esc(c.label)} <span class="st">${st}</span></label>`; };
      $('#act-choices').innerHTML = info.catalog.filter((c) => !c.adult).map(row).join('');
      const adult = info.catalog.filter((c) => c.adult);
      $('#act-adult').hidden = !info.adult; // a modalità adulti spenta queste azioni non esistono nemmeno nell'elenco
      if (info.adult) {
        const ok = !!ch.adultActionsOk;
        $('#act-adult-note').textContent = ok
          ? `Il volto di ${ch.name} è stato generato dall'IA: le azioni per adulti sono disponibili (personaggio inventato, adulto 25+). Non partono mai da sole se la modalità adulti è spenta, e «Cancella tutto» le elimina.`
          : `Non disponibili per ${ch.name}: le azioni per adulti si possono preparare solo per personaggi con il volto generato dall'IA, mai partendo da una foto caricata (per non creare immagini intime con il volto di una persona reale). Crea un personaggio con avatar generato dall'IA per usarle.`;
        $('#act-adult-choices').innerHTML = ok ? adult.map((c) => row(c).replace(' checked', '')).join('') : '';
      }
      $('#act-log').innerHTML = ''; $('#act-progress').hidden = true;
      $('#act-cost').textContent = `Ogni azione è una breve clip di circa ${info.seconds || 5} secondi generata dall'IA a partire dall'avatar attuale, con la tua chiave xAI (consuma crediti). Viene preparata una volta sola, solo quando premi «Prepara», ed è condivisa con l'altro profilo.${info.video ? '' : ' Video non disponibile: verranno create pose (immagini) animate.'}`;
      $('#act-dialog').showModal();
    },
    log(text, cls = '') { const li = document.createElement('li'); li.className = cls; li.textContent = text; $('#act-log').appendChild(li); li.scrollIntoView({ block: 'nearest' }); return li; },
    async prepare() {
      const ch = App.current; if (!ch || running) return;
      if (!App.key()) return App.toast('🔑 Inserisci la chiave xAI in Account');
      const ids = $$('#act-dialog [data-prep]').filter((x) => x.checked).map((x) => x.dataset.prep);
      if (!ids.length) return App.toast('Scegli almeno un\'azione');
      running = { stop: false }; const run = running;
      $('#act-go').disabled = true; $('#act-stop').hidden = false; const bar = $('#act-progress'); bar.hidden = false; bar.max = ids.length; bar.value = 0;
      let ok = 0;
      for (const id of ids) {
        if (run.stop) { this.log('Interrotto.'); break; }
        const m = meta(id), li = this.log(`${m.emoji} ${m.label}: avvio…`);
        try {
          let r = await App.api(`/api/characters/${ch.id}/actions/${id}`, { method: 'POST', ai: true, body: {} });
          if (r.status === 'pending') {
            const t0 = Date.now(), rid = r.rid;
            while (r.status !== 'done') {
              if (run.stop) throw new Error('interrotto');
              if (Date.now() - t0 > 6 * 60e3) throw new Error('tempo scaduto');
              li.textContent = `${m.emoji} ${m.label}: generazione clip… ${Math.round((Date.now() - t0) / 1000)} s`;
              await new Promise((z) => setTimeout(z, 5000));
              r = await App.api(`/api/characters/${ch.id}/actions/${id}/status/${encodeURIComponent(rid)}`, { ai: true });
              if (r.status === 'failed') throw Object.assign(new Error(r.error || 'non riuscita'), { refused: r.refused });
            }
          }
          ok++; li.textContent = `${m.emoji} ${m.label}: pronta ✓${r.kind === 'pose' ? ' (posa)' : ''}`; li.className = 'ok';
          if (r.action && App.current && App.current.id === ch.id) { App.current.actions = { ...(App.current.actions || {}), [id]: r.action }; this.render(); }
        } catch (e) {
          li.className = 'err';
          li.textContent = `${m.emoji} ${m.label}: ${e.refused || /rifiutato/i.test(e.message) ? 'Contenuto rifiutato dal servizio AI — resta l\'avatar normale' : e.message}`;
        }
        bar.value++;
      }
      this.log(`Fatto: ${ok}/${ids.length} azioni pronte.`);
      running = null; $('#act-go').disabled = false; $('#act-stop').hidden = true;
      await App.loadChars(); if (App.current) { App.current = App.charById(App.current.id) || App.current; } this.render();
    },
    // ---- azioni spontanee: solo a chat aperta, lei inattiva da un po', al massimo AUTO_MAX_HOUR l'ora ----
    tick() {
      const ch = App.current, now = Date.now();
      if (!ch || !App.chat.visible() || App.chat.busy || App.ls.get('actAuto', true) === false) return;
      if (App.call && App.call.active) return; // v8: in videochiamata solo gesti legati a ciò che si dice, niente azioni a caso
      const A = av(); if (A.speaking || A.actionBusy() || (A.sceneOn && A.sceneOn())) return;
      if (now - lastActivity < AUTO_IDLE || now - lastAuto < AUTO_MIN_GAP) return;
      autoLog = autoLog.filter((t) => now - t < 3600e3); if (autoLog.length >= AUTO_MAX_HOUR) return;
      if (Math.random() > 0.2) return;
      // le azioni per adulti possono partire da sole SOLO se la modalità adulti è attiva per entrambi (altrimenti non esistono)
      // v8: le azioni per adulti NON partono mai da sole: solo dal filo della conversazione (tag dell'IA) o a mano
      const pool = ready(ch).filter(([id]) => !meta(id).adult).map(([id]) => id);
      if (!pool.length) return;
      const weighted = pool;
      lastAuto = now; autoLog.push(now);
      this.play(weighted[Math.floor(Math.random() * weighted.length)], 'spontanea');
    },
    activity() { lastActivity = Date.now(); },
    _forceIdle() { lastActivity = 0; lastAuto = 0; }, // solo per i test
  };

  $('#act-btn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#act-menu'); m.hidden = !m.hidden; $('#scene-menu').hidden = true; if (!m.hidden) App.actions.render(); });
  $('#act-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-act]'); if (b) { $('#act-menu').hidden = true; App.actions.play(b.dataset.act); }
  });
  $('#act-auto').addEventListener('change', (e) => App.ls.set('actAuto', e.target.checked));
  $('#act-prepare').addEventListener('click', () => { $('#act-menu').hidden = true; App.actions.openPrepare(); });
  $('#act-go').addEventListener('click', () => App.actions.prepare());
  $('#act-stop').addEventListener('click', () => { if (running) running.stop = true; });
  $('#act-close').addEventListener('click', () => { if (running) running.stop = true; $('#act-dialog').close(); });
  $('#scene-btn').addEventListener('click', () => { $('#act-menu').hidden = true; });
  document.addEventListener('click', (e) => { if (!e.target.closest('#act-menu, #act-btn')) $('#act-menu').hidden = true; });
  ['keydown', 'pointerdown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => App.actions.activity(), { passive: true }));
  setInterval(() => App.actions.tick(), 5000);
})();
