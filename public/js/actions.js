/* actions.js — AZIONI dell'avatar (v7): brevi clip (o pose) preparate su richiesta con «Prepara azioni»,
 * riprodotte nel riquadro dell'avatar con dissolvenza; scelte da lei quando è inattiva (con limiti) o dalla chat ([azione:xxx]).
 * Le azioni per adulti esistono solo con la modalità adulti attiva per entrambi e per personaggi con volto generato dall'IA. */
(function () {
  const av = () => App.avatarConv;
  const TAG = /\s*\[azione:\s*([a-zà-ù]+)\s*\]/gi;
  const GESTURE_IDS = ['capelli', 'tosse', 'starnuto', 'ride', 'sorriso', 'annuisce', 'inclina', 'guarda', 'sbatte', 'gesticola', 'tocco_viso', 'tocco_capelli'];
  const AUTO_MIN_GAP = 150e3, AUTO_IDLE = 45e3, AUTO_MAX_HOUR = 8;
  let info = { catalog: [], adult: false, video: true }, lastActivity = Date.now(), autoLog = [], lastAuto = 0, running = null, autoQ = [], autoBusy = new Set(), autoDone = 0, autoTotal = 0, autoFail = 0, prepLog = [], lastWhy = '', failToast = 0;
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
  // v8.4.5: azioni rifiutate da xAI (per questo avatar): segnate chiaramente e mai ritentate in automatico
  const refKey = (ch, base, id) => `${ch.id}|${base}|${id}|${base === 'seated' ? (ch.seated && ch.seated.src) || '' : ch.avatar || ''}`;
  const refused = () => App.ls.get('actRefused', {}) || {};
  const setRefused = (k, v) => { const r = refused(); if (v) r[k] = Date.now(); else delete r[k]; App.ls.set('actRefused', r); };
  // v8.4.7: motivo dell'errore in italiano (mai un generico «errore nelle azioni»)
  const actWhy = (e) => {
    const m = String((e && e.message) || e || '');
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'connessione persa durante la preparazione (riprovo più tardi)';
    if (/tempo scaduto/i.test(m)) return 'xAI non ha finito la clip entro 6 minuti';
    if (/Chiave xAI non valida|401/.test(m)) return 'chiave xAI non valida o scaduta (Impostazioni → Chiave API xAI)';
    if (/credit|crediti|402|quota|billing/i.test(m)) return 'crediti xAI esauriti';
    if (/Troppe richieste|429/.test(m)) return 'troppe richieste a xAI in poco tempo (riprovo più tardi)';
    if (/non disponibile|50\d/.test(m)) return 'servizio video xAI momentaneamente non disponibile';
    return m.slice(0, 160) || 'motivo sconosciuto';
  };
  // v8.5.0: clip dei movimenti scaricate sul telefono (Cache Storage, sopravvive agli aggiornamenti dell'app): partono subito, anche offline
  App.actionCache = (() => {
    const NAME = 'nova-actions', urls = new Map();
    const open = () => (window.caches ? caches.open(NAME) : Promise.reject(new Error('no cache')));
    return {
      async has(url) { try { return !!(await (await open()).match(url)); } catch { return false; } },
      async save(url) { try { const c = await open(); if (await c.match(url)) return true; const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) return false; await c.put(url, r); return true; } catch { return false; } },
      async local(url) {
        if (urls.has(url)) return urls.get(url);
        try { const r = await (await open()).match(url); if (r) { const u = URL.createObjectURL(await r.blob()); urls.set(url, u); return u; } } catch { /* */ }
        this.save(url); return url; // la prima volta dalla rete, intanto si scarica
      },
      async syncAll() { // scarica tutte le clip pronte dei personaggi (in background, una alla volta)
        for (const ch of App.chars || []) for (const a of [...Object.values(ch.actions || {}), ...Object.values(ch.seated || {})]) if (a && a.url && !a.stale) await this.save(a.url);
      },
    };
  })();
  const meta = (id) => info.catalog.find((c) => c.id === id) || (App.gestures && App.gestures.list && App.gestures.list().find((g) => g.id === id)) || { id, label: id, emoji: '🎭' };

  App.actions = {
    strip(t) { return String(t || '').replace(TAG, '').replace(/\s*\[(?:gesto|umore):\s*[a-zà-ù]*\s*\]\s*/gi, ' ').replace(/\s*\[(?:azione|gesto|umore):[^\]]*$/i, '').replace(/\s*\[[a-zà-ù]{0,6}$/i, '').trim(); }, // v8: anche i tag di gesto/umore // anche un tag a metà durante lo streaming
    tag(t) { const m = /\[azione:\s*([a-zà-ù]+)\s*\]/i.exec(String(t || '')); return m ? m[1].toLowerCase() : null; },
    fromReply(t) { const a = this.tag(t); if (a) this.play(a, 'chat'); },
    async load() {
      try { if (App.gestures) await App.gestures.load(); } catch { /* offline */ }
      try { info = await App.api('/api/actions'); } catch { /* offline */ }
      const A = av(); if (!info.adult && A.act && A.act.adult) A.stopAction(true); // modalità adulti spenta: via subito
      this.render(); this.autoAll(); setTimeout(() => App.actionCache.syncAll(), 4000);
    },
    // ---- v8.5.0: preparazione AUTOMATICA in background di tutti i movimenti normali ----
    // Dopo la creazione di un personaggio, il cambio foto e alla prima apertura: coda (2 alla volta), progressi nella
    // pillola in basso, rifiuti di xAI segnati e mai ritentati, nulla blocca l'interfaccia. Le azioni per adulti NON
    // partono da sole: restano esattamente come prima (solo a mano, solo se sbloccate per entrambi).
    autoMissing(ch) {
      if (!ch || !/^\/api\/avatars\//.test(ch.avatar || '') || !info.catalog.length) return [];
      return info.catalog.filter((c) => !c.adult).map((c) => c.id).filter((id) => { const a = ch.actions && ch.actions[id]; return (!a || a.stale || !a.url) && !refused()[refKey(ch, 'avatar', id)]; });
    },
    autoAll() {
      if (App.me && App.me.serverKey) return;
      if (App.ls.get('autoPrep', true) === false || !App.hasAi() || (App.canEdit && !App.canEdit())) return;
      (App.chars || []).forEach((ch) => this.autoMissing(ch).forEach((id) => { const k = ch.id + '|' + id + '|' + ch.avatar; if (!autoQ.some((q) => q.k === k) && !autoBusy.has(k)) autoQ.push({ k, cid: ch.id, id }); }));
      // il personaggio aperto ha la precedenza
      if (App.current) autoQ.sort((a, b) => (b.cid === App.current.id) - (a.cid === App.current.id));
      autoTotal = Math.max(autoTotal, autoDone + autoQ.length + autoBusy.size); this.autoPump();
    },
    autoPump() {
      if (running || (this._paused && Date.now() < this._paused)) { this.autoPill(); return; } // v8.4.7: «Prepara» a mano ha la precedenza: la coda automatica aspetta
      while (autoBusy.size < 2 && autoQ.length) { const q = autoQ.shift(); autoBusy.add(q.k); this.autoOne(q).finally(() => { autoBusy.delete(q.k); autoDone++; this.autoPill(); this.autoPump(); }); }
      this.autoPill();
    },
    async autoOne(q) {
      const ch = App.charById(q.cid); if (!ch) return;
      const m = meta(q.id);
      try {
        let r = await App.api(`/api/characters/${ch.id}/actions/${q.id}`, { method: 'POST', ai: true, body: {} });
        const t0 = Date.now();
        while (r.status === 'pending') {
          if (Date.now() - t0 > 6 * 60e3) throw new Error('tempo scaduto');
          await new Promise((z) => setTimeout(z, 5000));
          r = await App.api(`/api/characters/${ch.id}/actions/${q.id}/status/${encodeURIComponent(r.rid)}`, { ai: true });
          if (r.status === 'failed') throw Object.assign(new Error(r.error || 'non riuscita'), { refused: r.refused });
        }
        setRefused(refKey(ch, 'avatar', q.id), false); this._back = 0;
        if (r.action && r.action.url) App.actionCache.save(r.action.url);
        if (r.action) { ch.actions = { ...(ch.actions || {}), [q.id]: r.action }; if (App.current && App.current.id === ch.id) { App.current.actions = { ...(App.current.actions || {}), [q.id]: r.action }; this.render(); } }
        prepLog.push({ at: Date.now(), id: q.id, ok: true });
      } catch (e) {
        if (/Troppe richieste|429/i.test(e.message || '')) { // v8.5.0: xAI chiede di rallentare -> attesa crescente, poi si riprova (non è un rifiuto)
          autoQ.unshift(q); this._back = Math.min(15 * 60e3, (this._back || 30e3) * 2); lastWhy = `xAI chiede di rallentare: riprovo tra ${Math.round(this._back / 60e3) || 1} min`; this._paused = Date.now() + this._back; setTimeout(() => { this._paused = 0; this.autoPump(); }, this._back); return;
        }
        if (/Limite di|già in preparazione/i.test(e.message || '')) { // limite orario o già in corso: si riprova più tardi, non è un rifiuto
          autoQ.length = 0; if (!this._retryT) { const mins = (e.data && e.data.retryMin) || +((/tra (\d+) min/.exec(e.message || '') || [])[1]) || 10; lastWhy = `limite orario di xAI raggiunto: riprovo da sola tra ${mins} min`; this._retryT = setTimeout(() => { this._retryT = 0; this.autoAll(); }, mins * 60e3 + 5000); } return;
        }
        const isRef = !!(e.refused || /rifiutat/i.test(e.message || ''));
        if (isRef) setRefused(refKey(ch, 'avatar', q.id), true); // rifiutata: segnata, mai ritentata in automatico
        else { autoFail++; lastWhy = actWhy(e); console.warn('Azione', q.id, 'non preparata:', lastWhy); }
        prepLog.push({ at: Date.now(), id: q.id, ok: false, refused: isRef, err: String(e.message || e).slice(0, 120) });
        if (/chiave|401|403|crediti|402/i.test(e.message || '')) { autoQ.length = 0; } // chiave o crediti: si ferma la coda
      }
    },
    queueText() {
      const left = autoQ.length + autoBusy.size;
      if (left) return `🎭 Preparo i movimenti in background: ${autoDone}/${autoTotal}…`;
      const ready = (App.current && App.current.ready) || '';
      if (ready === 'nova-scelta' || ready === 'nova-unico' || ready === 'nova-bionda') return '🎭 Su questa foto i movimenti sono respiro, sguardo e bocca. Le clip non si generano: coprirebbero il viso.';
      return '🎭 Nessuna azione pronta: si preparano da sole appena c\'è la chiave xAI';
    },
    autoState() { return { queued: autoQ.length, busy: autoBusy.size, done: autoDone, total: autoTotal, fail: autoFail, log: prepLog.slice(-20) }; },
    autoPill() {
      let el = document.getElementById('auto-prep');
      const left = autoQ.length + autoBusy.size;
      if (!el) { el = document.createElement('div'); el.id = 'auto-prep'; el.className = 'auto-prep'; (document.getElementById('app-shell') || document.body).appendChild(el); }
      el.hidden = !left; if (!left) { if (autoFail && autoFail !== failToast) { failToast = autoFail; App.toast(`⚠️ Movimenti: ${autoFail} non preparati · motivo: ${lastWhy}`, 6000); } autoTotal = 0; autoDone = 0; return; }
      el.innerHTML = `<i style="width:${Math.round((autoDone / Math.max(1, autoTotal)) * 100)}%"></i><span>🎭 Movimenti ${autoDone}/${autoTotal}</span>`;
    },
    refresh() { this.load(); },
    // riproduce un'azione pronta del personaggio aperto (mai durante la scena cinematografica o se ne sta già facendo una)
    async play(aid, why = 'manuale') {
      if (App.gestures && App.gestures.has(aid)) return App.gestures.request(aid);
      const ch = App.current; if (!ch) return false;
      const A = av(); if (A.actionBusy()) return false;
      // seduta al tavolo: solo le clip preparate da quella foto; scena vecchia (senza punti completi): niente azioni
      const seat = seatedOn();
      if (!seat && A.sceneOn && A.sceneOn()) return false;
      const a = seat ? ch.seated && ch.seated[aid] : ch.actions && ch.actions[aid]; if (!a || a.stale || !a.url) return false;
      const src = await App.actionCache.local(a.url); // v8.5.0: dal telefono (scaricata), parte subito anche offline
      if (GESTURE_IDS.includes(aid)) { lastGest = Date.now(); lastGestId = aid; gestLog.push(lastGest); A.breathM && A.breathM.gestureStart(aid, performance.now()); }
      try {
        if (a.kind === 'pose') {
          const p = A.playAction({ kind: 'pose', url: src, lm: poseLm.get(a.url) || null }); if (A.act) A.act.adult = !!meta(aid).adult;
          if (!poseLm.has(a.url) && App.findFace) App.findFace(a.url).then((lm) => { poseLm.set(a.url, lm); if (lm) A.setActionLandmarks(lm); });
          await p;
        } else { const p = A.playAction({ kind: 'video', url: src }); if (A.act) A.act.adult = !!meta(aid).adult; await p; }
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
      const bundled = (!seatedOn() && App.gestures && App.gestures.list ? App.gestures.list() : []).filter((g) => !acts.some(([id]) => id === g.id));
      const buttons = bundled.map((g) => `<button type="button" data-act="${esc(g.id)}" title="${esc(g.label)}">${g.emoji} ${esc(g.label)}</button>`).concat(acts.map(([id, a]) => { const m = meta(id); return `<button type="button" data-act="${esc(id)}" class="${a.stale ? 'stale' : ''}" title="${a.stale ? 'Preparata con un avatar precedente: rifalla' : esc(m.label)}">${m.emoji} ${esc(m.label)}</button>`; }));
      list.innerHTML = buttons.join('');
      const n = ready(ch).length;
      $('#act-info').textContent = !ch ? '' : !/^\/api\/avatars\//.test(ch.avatar || '') ? 'Serve un avatar immagine per le azioni.' : n ? `${n} azioni pronte${acts.length > n ? ` · ${acts.length - n} da rifare (avatar cambiato)` : ''}` : 'Nessuna azione pronta: usa «Prepara azioni».';
      // v8.3.1: modalità adulti attiva solo per uno dei due -> spiega cosa manca (le azioni per adulti restano nascoste)
      if (App.me && App.settings && App.settings.adultMode && !info.adult && App.adultStatus && !App.adultStatus.chat) $('#act-info').textContent += ' · 🔞 ' + App.adultText(App.adultStatus, false);
      if (autoQ.length + autoBusy.size) $('#act-info').textContent += ' · ' + this.queueText(); // v8.5.0
      if (lastWhy) $('#act-info').textContent += ` · ⚠️ ultimo errore: ${lastWhy}`; // v8.4.7
      $('#act-btn').classList.toggle('on', !!n);
      $('#act-auto').checked = App.ls.get('actAuto', true) !== false;
    },
    // ---- finestra «Prepara azioni» ----
    openPrepare(base) {
      const ch = App.current; if (!ch) return;
      prepBase = base === 'seated' ? 'seated' : 'avatar';
      const src = prepBase === 'seated' ? ch.seated || {} : ch.actions || {};
      const row = (c) => { const a = src[c.id], rf = !a && refused()[refKey(ch, prepBase, c.id)]; const st = rf ? 'rifiutata da xAI' : !a ? 'da preparare' : a.stale ? (prepBase === 'seated' ? 'da rifare (scena cambiata)' : 'da rifare (avatar cambiato)') : `pronta (${a.kind === 'pose' ? 'posa' : 'clip'})`;
        return `<label><input type="checkbox" data-prep="${c.id}" ${(!a && !rf) || (a && a.stale) ? 'checked' : ''}> ${c.emoji} ${esc(c.label)} <span class="st${rf ? ' refused' : ''}">${st}</span></label>`; };
      $('#act-dialog h3').textContent = prepBase === 'seated' ? '🎬 Gesti al tavolo' : '🎭 Prepara azioni';
      // v8.4.5: tutte le azioni normali da preparare sono già selezionate (+ «Tutte» per selezionarle/deselezionarle in un colpo)
      const normal = info.catalog.filter((c) => !c.adult && (prepBase !== 'seated' || c.gesture));
      $('#act-choices').innerHTML = (normal.length > 1 ? `<label class="act-all"><input type="checkbox" id="act-all"> <b>Tutte le azioni normali</b></label>` : '') + normal.map(row).join('');
      const all = $('#act-all'), boxes = () => $$('#act-choices [data-prep]');
      if (all) { const sync = () => { all.checked = boxes().every((x) => x.checked); }; sync(); all.addEventListener('change', () => boxes().forEach((x) => { x.checked = all.checked; })); boxes().forEach((x) => x.addEventListener('change', sync)); }
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
      if (!App.hasAi()) return App.toast('🔑 Inserisci la chiave xAI in Impostazioni');
      // v8.4.5: prima tutte le azioni normali, poi (se scelte) quelle per adulti; un rifiuto non ferma le altre
      const ids = $$('#act-dialog [data-prep]').filter((x) => x.checked).map((x) => x.dataset.prep).sort((a, b) => (meta(a).adult ? 1 : 0) - (meta(b).adult ? 1 : 0));
      if (!ids.length) return App.toast('Scegli almeno un\'azione');
      running = { stop: false }; const run = running;
      for (let i = autoQ.length - 1; i >= 0; i--) if (autoQ[i].cid === ch.id && ids.includes(autoQ[i].id)) autoQ.splice(i, 1); // v8.4.7: mai la stessa azione due volte
      $('#act-go').disabled = true; $('#act-stop').hidden = false; const bar = $('#act-progress'); bar.hidden = false; bar.max = ids.length; bar.value = 0;
      let ok = 0, nRef = 0, nErr = 0, k = 0;
      for (const id of ids) {
        if (run.stop) { this.log('Interrotto.'); break; }
        k++; const m = meta(id), li = this.log(`(${k}/${ids.length}) ${m.emoji} ${m.label}: avvio…`);
        if ([...autoBusy].some((x) => x.startsWith(ch.id + '|' + id + '|'))) { li.textContent = `(${k}/${ids.length}) ${m.emoji} ${m.label}: già in preparazione automatica, la salto`; bar.value++; continue; }
        try {
          const base = prepBase;
          let r = await App.api(`/api/characters/${ch.id}/actions/${id}`, { method: 'POST', ai: true, body: base === 'seated' ? { base } : {} });
          if (r.status === 'pending') {
            const t0 = Date.now(), rid = r.rid;
            while (r.status !== 'done') {
              if (run.stop) throw new Error('interrotto');
              if (Date.now() - t0 > 6 * 60e3) throw new Error('tempo scaduto');
              li.textContent = `(${k}/${ids.length}) ${m.emoji} ${m.label}: generazione clip… ${Math.round((Date.now() - t0) / 1000)} s`;
              await new Promise((z) => setTimeout(z, 5000));
              r = await App.api(`/api/characters/${ch.id}/actions/${id}/status/${encodeURIComponent(rid)}`, { ai: true });
              if (r.status === 'failed') throw Object.assign(new Error(r.error || 'non riuscita'), { refused: r.refused });
            }
          }
          ok++; li.textContent = `(${k}/${ids.length}) ${m.emoji} ${m.label}: pronta ✓${r.kind === 'pose' ? ' (posa)' : ''}`; li.className = 'ok'; setRefused(refKey(ch, base, id), false);
          if (r.action && App.current && App.current.id === ch.id) { const k = base === 'seated' ? 'seated' : 'actions'; App.current[k] = { ...(App.current[k] || {}), [id]: r.action }; this.render(); }
        } catch (e) {
          li.className = 'err';
          const isRef = !!(e.refused || /rifiutato/i.test(e.message || ''));
          if (isRef) { nRef++; setRefused(refKey(ch, prepBase, id), true); } else if (!/interrotto/.test(e.message || '')) nErr++;
          li.textContent = `(${k}/${ids.length}) ${m.emoji} ${m.label}: ${isRef ? 'rifiutata da xAI — resta l\'avatar normale (nessun nuovo tentativo automatico)' : actWhy(e)}`;
        }
        bar.value++;
        if (/Limite di \d+ preparazioni/.test(li.textContent)) { this.log('⏳ Limite orario raggiunto: le altre azioni restano in coda, riprova all\'ora indicata.'); break; } // v8.4.7
      }
      this.log(`Fatto: ${ok}/${ids.length} azioni pronte${nRef ? ` · ${nRef} rifiutate da xAI` : ''}${nErr ? ` · ${nErr} non riuscite (riprova più tardi)` : ''}.`);
      running = null; $('#act-go').disabled = false; $('#act-stop').hidden = true;
      setTimeout(() => this.autoAll(), 1500); // v8.4.7: la coda automatica riprende
      await App.loadChars(); if (App.current) { App.current = App.charById(App.current.id) || App.current; } this.render();
    },
    // ---- azioni spontanee: solo a chat aperta, lei inattiva da un po', al massimo AUTO_MAX_HOUR l'ora ----
    tick() {
      const ch = App.current, now = Date.now();
      if (!ch || !App.chat.visible() || App.chat.busy || App.ls.get('actAuto', true) === false) return;
      // v8.4.5: in videochiamata anche gesti spontanei, ma solo nei silenzi (nessuno dei due parla da 12 s), senza audio, mai per adulti
      const inCall = !!(App.call && App.call.active);
      if (inCall) {
        if (App.call.mode === 'voice') return; // chiamata vocale: lei non si vede
        const quiet = !(App.tts && (App.tts.playing || App.tts.q.length)) && !(App.rt && App.rt.speaking && App.rt.speaking()) && !(App.callMic && App.callMic.speaking && App.callMic.speaking());
        if (!quiet) { lastActivity = Math.max(lastActivity, now - AUTO_IDLE + 12e3); return; }
      }
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
      const everyday = ['gesticola','tocco_viso','tocco_capelli','capelli','acqua','vino','patatine','mangia','sorriso','annuisce'];
      let pool = ready(ch).filter(([id]) => !meta(id).adult).map(([id]) => id);
      // v8.6.0: preferisci gesti quotidiani se pronti
      const pref = pool.filter((id) => everyday.includes(id)); if (pref.length) pool = pref;
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
  // v8.5.0: tasto 🔥 Hot di nuovo visibile (anche a schermo intero e in videochiamata): apre le azioni pronte.
  // Non cambia nulla della modalità adulti: elenca solo le azioni che esistono già (quelle per adulti esistono solo se sbloccate per entrambi).
  async function hot(e) {
    if (e) e.stopPropagation(); App.actions.activity();
    const ch = App.current; if (!ch) return;
    const bundled = (!seatedOn() && App.gestures && App.gestures.list ? App.gestures.list() : []).map((g) => [g.id, { url: g.url }]);
    const list = bundled.concat(seatedOn() ? readySeated(ch) : ready(ch).filter(([, a]) => a && a.url)).sort(([a], [b]) => (meta(b).adult ? 1 : 0) - (meta(a).adult ? 1 : 0));
    if (!list.length) { App.toast(App.actions.queueText ? App.actions.queueText() : '🎭 Le azioni si stanno preparando da sole…', 3000); return; }
    const v = await App.sheet('Gesti', list.map(([id]) => { const m = meta(id); return { label: `${m.emoji} ${m.label}`, value: id }; }));
    if (v) App.actions.play(v);
  }
  $('#hot-btn').addEventListener('click', hot);
  $('#call-hot').addEventListener('click', hot);
  $('#act-auto').addEventListener('change', (e) => App.ls.set('actAuto', e.target.checked));
  $('#act-prepare') && $('#act-prepare').addEventListener('click', () => { if (document.body.classList.contains('solo-mode')) return; $('#act-menu').hidden = true; App.actions.openPrepare(); });
  $('#act-go').addEventListener('click', () => App.actions.prepare());
  $('#act-stop').addEventListener('click', () => { if (running) running.stop = true; });
  $('#act-close').addEventListener('click', () => { if (running) running.stop = true; $('#act-dialog').close(); });
  $('#scene-btn').addEventListener('click', () => { $('#act-menu').hidden = true; });
  document.addEventListener('click', (e) => { if (!e.target.closest('#act-menu, #act-btn')) $('#act-menu').hidden = true; });
  ['keydown', 'pointerdown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => App.actions.activity(), { passive: true }));
  setInterval(() => App.actions.tick(), 5000);
  setInterval(() => App.actions.cueTick(), 400);
})();

// v8.5.0: dopo ogni ricarica dei personaggi (creazione, nuova foto, ripristino) la coda riparte da sola
(function () { const orig = App.loadChars; App.loadChars = async (...a) => { const r = await orig(...a); try { App.actions && App.actions.autoAll(); } catch { /* */ } return r; }; })();
