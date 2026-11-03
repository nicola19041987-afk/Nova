/* actions.js — AZIONI dell'avatar (v7): brevi clip (o pose) preparate su richiesta con «Prepara azioni»,
 * riprodotte nel riquadro dell'avatar con dissolvenza; scelte da lei quando è inattiva (con limiti) o dalla chat ([azione:xxx]).
 * Le azioni per adulti esistono solo con la modalità adulti attiva per entrambi e per personaggi con volto generato dall'IA. */
(function () {
  const av = () => App.avatarConv;
  const TAG = /\s*\[azione:\s*([a-zà-ù]+)\s*\]/gi;
  const GESTURE_IDS = ['capelli', 'tosse', 'starnuto', 'ride'];
  const AUTO_MIN_GAP = 150e3, AUTO_IDLE = 45e3, AUTO_MAX_HOUR = 8;
  let info = { catalog: [], adult: false, video: true }, lastActivity = Date.now(), autoLog = [], lastAuto = 0, running = null;
  const poseLm = new Map(); // url -> punti del viso trovati sul telefono

  const ready = (ch) => Object.entries((ch && ch.actions) || {}).filter(([, a]) => !a.stale);
  // v8.3: gesti spontanei (capelli, tosse, starnuto, risata), anche nella scena seduta al tavolo
  const GEST_W = { capelli: 3, tosse: 1, starnuto: 0.6, ride: 0 }; // la risata parte solo quando ride davvero (contesto)
  const GEST_GAP = 150e3, GEST_MAX_HOUR = 6;
  let lastGest = 0, lastGestId = null, pendingCue = null, prepBase = 'avatar', gestLog = [];
  const seatedOn = () => { const A = av(); return !!(A.sceneOn && A.sceneOn() && A.sceneOn().landmarks && A.sceneOn().landmarks.auto); };
  const readySeated = (ch) => Object.entries((ch && ch.seated) || {}).filter(([, a]) => a && a.url && !a.stale);
  const pick = (ids) => { // a pesi, mai lo stesso gesto due volte di fila
    const pool = ids.filter((id) => ids.length < 2 || id !== lastGestId); const w = pool.map((id) => (id in GEST_W ? GEST_W[id] : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0 && w[i] > 0) return pool[i]; } return null; };
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
      const A = av(); if (A.actionBusy()) return false;
      // seduta al tavolo: solo le clip preparate da quella foto; scena vecchia (senza punti completi): niente azioni
      const seat = seatedOn();
      if (!seat && A.sceneOn && A.sceneOn()) return false;
      const a = seat ? ch.seated && ch.seated[aid] : ch.actions && ch.actions[aid]; if (!a || a.stale || !a.url) return false;
      if (GESTURE_IDS.includes(aid)) { lastGest = Date.now(); lastGestId = aid; gestLog.push(lastGest); A.breathM && A.breathM.gestureStart(aid, performance.now()); }
      try {
        if (a.kind === 'pose') {
          const p = A.playAction({ kind: 'pose', url: a.url, lm: poseLm.get(a.url) || null }); if (A.act) A.act.adult = !!meta(aid).adult;
          if (!poseLm.has(a.url) && App.findFace) App.findFace(a.url).then((lm) => { poseLm.set(a.url, lm); if (lm) A.setActionLandmarks(lm); });
          await p;
        } else { const p = A.playAction({ kind: 'video', url: a.url }); if (A.act) A.act.adult = !!meta(aid).adult; await p; }
        return true;
      } catch (e) { console.warn('Azione non riprodotta', aid, why, e && e.message); return false; }
      finally { if (GESTURE_IDS.includes(aid) && A.breathM) A.breathM.gestureEnd(aid, performance.now()); }
    },
    // v8.3: gesto legato al contesto (risata quando ride davvero, capelli con umore tenero/malizioso):
    // parte nella pausa dopo che ha finito di parlare, al massimo uno ogni 2,5 minuti, mai lo stesso due volte di fila
    cue(aid, prob = 1) {
      if (!GESTURE_IDS.includes(aid) || Math.random() > prob) return;
      if (Date.now() - lastGest < GEST_GAP || aid === lastGestId) return;
      pendingCue = { aid, at: Date.now() };
    },
    cueTick() {
      const c = pendingCue; if (!c) return;
      if (Date.now() - c.at > 25000 || Date.now() - lastGest < GEST_GAP) { pendingCue = null; return; }
      const A = av(), talking = A.speaking || (App.tts && App.tts.playing) || App.chat.busy;
      if (talking) { this._quietSince = 0; return; }
      if (!this._quietSince) { this._quietSince = Date.now(); return; }
      if (Date.now() - this._quietSince < 700) return; // un attimo di pausa dopo la frase
      pendingCue = null; this.play(c.aid, 'contesto');
    },
    render() {
      const ch = App.current, list = $('#act-list'); if (!list) return;
      const acts = Object.entries((ch && (seatedOn() ? ch.seated : ch.actions)) || {}).filter(([, a]) => a && a.url); // v8.3: seduta al tavolo -> i suoi gesti
      list.innerHTML = acts.length ? acts.map(([id, a]) => { const m = meta(id); return `<button type="button" data-act="${esc(id)}" class="${a.stale ? 'stale' : ''}" title="${a.stale ? 'Preparata con un avatar precedente: rifalla' : esc(m.label)}">${m.emoji} ${esc(m.label)}</button>`; }).join('') : '';
      const n = ready(ch).length;
      $('#act-info').textContent = !ch ? '' : !/^\/api\/avatars\//.test(ch.avatar || '') ? 'Serve un avatar immagine per le azioni.' : n ? `${n} azioni pronte${acts.length > n ? ` · ${acts.length - n} da rifare (avatar cambiato)` : ''}` : 'Nessuna azione pronta: usa «Prepara azioni».';
      $('#act-btn').classList.toggle('on', !!n);
      $('#act-auto').checked = App.ls.get('actAuto', true) !== false;
    },
    // ---- finestra «Prepara azioni» ----
    openPrepare(base) {
      const ch = App.current; if (!ch) return;
      prepBase = base === 'seated' ? 'seated' : 'avatar';
      const src = prepBase === 'seated' ? ch.seated || {} : ch.actions || {};
      const row = (c) => { const a = src[c.id]; const st = !a ? 'da preparare' : a.stale ? (prepBase === 'seated' ? 'da rifare (scena cambiata)' : 'da rifare (avatar cambiato)') : `pronta (${a.kind === 'pose' ? 'posa' : 'clip'})`;
        return `<label><input type="checkbox" data-prep="${c.id}" ${!a || a.stale ? 'checked' : ''}> ${c.emoji} ${esc(c.label)} <span class="st">${st}</span></label>`; };
      $('#act-dialog h3').textContent = prepBase === 'seated' ? '🎬 Gesti al tavolo' : '🎭 Prepara azioni';
      $('#act-choices').innerHTML = info.catalog.filter((c) => !c.adult && (prepBase !== 'seated' || c.gesture)).map(row).join('');
      const adult = info.catalog.filter((c) => c.adult);
      $('#act-adult').hidden = !info.adult || prepBase === 'seated'; // a modalità adulti spenta queste azioni non esistono nemmeno nell'elenco
      if (info.adult && prepBase !== 'seated') {
        const ok = !!ch.adultActionsOk;
        $('#act-adult-note').textContent = ok
          ? `Il volto di ${ch.name} è stato generato dall'IA: le azioni per adulti sono disponibili (personaggio inventato, adulto 25+). Non partono mai da sole se la modalità adulti è spenta, e «Cancella tutto» le elimina.`
          : `Non disponibili per ${ch.name}: le azioni per adulti si possono preparare solo per personaggi con il volto generato dall'IA, mai partendo da una foto caricata (per non creare immagini intime con il volto di una persona reale). Crea un personaggio con avatar generato dall'IA per usarle.`;
        $('#act-adult-choices').innerHTML = ok ? adult.map((c) => row(c).replace(' checked', '')).join('') : '';
      }
      $('#act-log').innerHTML = ''; $('#act-progress').hidden = true;
      $('#act-cost').textContent = `Ogni azione è una breve clip di circa ${info.seconds || 5} secondi generata dall'IA a partire dall'avatar attuale, con la tua chiave xAI (consuma crediti). Viene preparata una volta sola, solo quando premi «Prepara», ed è condivisa con l'altro profilo.${info.video ? '' : ' Video non disponibile: verranno create pose (immagini) animate.'}`;
      if (prepBase === 'seated') $('#act-cost').textContent = `Gesti spontanei di lei seduta al tavolo (capelli, tosse, starnuto, risata): ognuno è una clip di circa ${info.seconds || 5} secondi creata dall'IA partendo dalla foto al tavolo, con la tua chiave xAI (consuma crediti). Si preparano una volta sola, sono condivisi con l'altro profilo e partono raramente, mai due di fila.`;
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
          const base = prepBase;
          let r = await App.api(`/api/characters/${ch.id}/actions/${id}`, { method: 'POST', ai: true, body: base === 'seated' ? { base } : {} });
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
          if (r.action && App.current && App.current.id === ch.id) { const k = base === 'seated' ? 'seated' : 'actions'; App.current[k] = { ...(App.current[k] || {}), [id]: r.action }; this.render(); }
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
      const A = av(); if (A.speaking || A.actionBusy()) return;
      const seat = seatedOn(); if (!seat && A.sceneOn && A.sceneOn()) return;
      if (now - lastActivity < AUTO_IDLE || now - lastAuto < AUTO_MIN_GAP || now - lastGest < GEST_GAP) return;
      autoLog = autoLog.filter((t) => now - t < 3600e3); if (autoLog.length >= AUTO_MAX_HOUR) return;
      gestLog = gestLog.filter((t) => now - t < 3600e3);
      if (Math.random() > 0.2) return;
      if (seat) { // seduta al tavolo: solo i gesti spontanei preparati da quella foto
        if (gestLog.length >= GEST_MAX_HOUR) return;
        const id = pick(readySeated(ch).map(([k]) => k).filter((k) => GESTURE_IDS.includes(k))); if (!id) return;
        lastAuto = now; autoLog.push(now); this.play(id, 'spontanea'); return;
      }
      // le azioni per adulti possono partire da sole SOLO se la modalità adulti è attiva per entrambi (altrimenti non esistono)
      // v8: le azioni per adulti NON partono mai da sole: solo dal filo della conversazione (tag dell'IA) o a mano
      const pool = ready(ch).filter(([id]) => !meta(id).adult).map(([id]) => id);
      if (!pool.length) return;
      const id = pick(pool); if (!id) return; // v8.3: mai la stessa due volte di fila; la risata solo dal contesto
      lastAuto = now; autoLog.push(now);
      this.play(id, 'spontanea');
    },
    activity() { lastActivity = Date.now(); },
    _forceIdle() { lastActivity = 0; lastAuto = 0; lastGest = 0; }, // solo per i test
    _gest() { return { lastGest, lastGestId, pendingCue }; }, // solo per i test
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
  setInterval(() => App.actions.cueTick(), 400);
})();
