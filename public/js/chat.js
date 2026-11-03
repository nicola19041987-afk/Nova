/* chat.js — elenco personaggi e CHAT CONDIVISA tra Nico e Luisa (stesso thread per entrambi),
 * con polling automatico (~3 s) mentre la chat è visibile, risposta dell'IA in streaming,
 * "solo messaggio" senza IA, memoria automatica ed evoluzione della personalità. */
App.chat = {
  epoch: null, last: 0, ids: new Set(), busy: false, polling: false,
  renderList() {
    $('#char-list').innerHTML = App.chars.map((c) => `<li data-id="${c.id}">${App.avatarHtml(c)}
      <div class="grow"><b>${esc(c.name)}</b><span>${esc(c.state ? 'Umore: ' + c.state.mood : '')}${App.previews[c.id] ? ' · nuovo look da salvare' : ''}</span></div>
      <button data-edit title="Modifica">✏️</button></li>`).join('');
  },
  async open(id) {
    const ch = App.charById(id); if (!ch) return;
    App.current = ch;
    $('#tab-chat').hidden = true; $('#tab-conv').hidden = false; $('#back-btn').hidden = false; $('#title').textContent = ch.name;
    const shown = App.previews[ch.id] ? { ...ch, avatar: App.previews[ch.id].dataUrl } : ch;
    App.avatarConv.setCharacter(shown);
    App.scene && App.scene.apply();
    App.avatarConv.stopAction(true); App.actions && App.actions.render();
    $('#messages').innerHTML = ''; this.epoch = null; this.last = 0; this.ids = new Set();
    this.header(null);
    await this.poll(true);
    this.scroll();
  },
  close() {
    App.stageFs && App.stageFs.exit(); $('#scene-menu').hidden = true; $('#act-menu').hidden = true; App.avatarConv.stopAction(true);
    App.current = null; App.voice && App.voice.stop(); App.voice && App.voice.cancel ? App.voice.cancel() : window.speechSynthesis && window.speechSynthesis.cancel();
    $('#tab-conv').hidden = true; $('#tab-chat').hidden = false; $('#back-btn').hidden = true; $('#title').textContent = 'Chat';
    this.setTyping(null); this.renderList(); document.body.classList.remove('wa-conv');
  },
  // Nome visibile dell'autore: Nico / Luisa / nome del personaggio
  label(m) { return m.authorName || (m.author === 'nicola' ? 'Nico' : m.author === 'luisa' ? 'Luisa' : (App.current && App.current.name) || ''); },
  addMsg(m) {
    if (m.id && this.ids.has(m.id)) return null;
    if (m.id) this.ids.add(m.id);
    const mine = m.role === 'user' && (!m.author || m.author === App.me.user);
    const d = document.createElement('div');
    d.className = `msg ${m.role === 'user' ? (mine ? 'user' : 'user other') : 'assistant'}`;
    if (m.id) d.dataset.id = m.id;
    if (m.local) d.classList.add('local');
    const who = document.createElement('span'); who.className = 'who';
    who.textContent = `${this.label(m)}${m.noAI ? ' · solo messaggio' : ''}${m.local ? ' · solo su questo telefono' : ''}`;
    if (!mine) who.dataset.c = m.role === 'assistant' ? 'a' : 'o';
    const body = document.createElement('span'); body.className = 'body'; body.textContent = App.actions ? App.actions.strip(m.content) : m.content;
    // v8.2: ora e spunte in basso a destra, come su WhatsApp (✓ inviato · ✓✓ salvato in chat · ✓✓ blu letto/risposto)
    const meta = document.createElement('span'); meta.className = 'meta';
    meta.innerHTML = `${m.call ? (m.callMode === 'voice' ? '📞 ' : '📹 ') : ''}<time>${m.at ? new Date(m.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ''}</time>${mine && !m.local ? '<i class="ticks">✓</i>' : ''}`;
    d.append(who, body, meta);
    const pin = document.createElement('button'); pin.className = 'pin'; pin.type = 'button'; pin.textContent = '📌'; pin.title = 'Ricorda questo';
    pin.onclick = () => { const t = prompt('Cosa devo ricordare?', body.textContent.slice(0, 280)); if (t) App.account.remember(t); };
    d.appendChild(pin); $('#messages').appendChild(d); return d;
  },
  // spunte: due spunte quando il server ha il messaggio, blu quando dopo c'è una risposta (del personaggio o dell'altra persona)
  ticks() {
    const all = [...$('#messages').querySelectorAll('.msg')]; let seen = false;
    for (let i = all.length - 1; i >= 0; i--) {
      const el = all[i], t = el.querySelector('.ticks');
      if (!el.classList.contains('user') || el.classList.contains('other')) { if (el.dataset.id && !el.classList.contains('typing')) seen = true; continue; }
      if (!t) continue;
      const st = !el.dataset.id ? 'sent' : seen ? 'read' : 'saved';
      t.textContent = st === 'sent' ? '✓' : '✓✓'; t.className = 'ticks ' + st; t.title = st === 'read' ? 'Letto' : st === 'saved' ? 'Consegnato' : 'Inviato';
    }
  },
  // intestazione stile WhatsApp: foto rotonda, nome, "online" / "sta scrivendo…" / "in chiamata"
  header(state) {
    const ch = App.current, st = $('#wa-status'); if (!st) return;
    const on = !!ch && !$('#tab-conv').hidden; document.body.classList.toggle('wa-conv', on);
    if (!on) return;
    const ph = $('#wa-photo'); if (ph.dataset.for !== ch.id + (ch.avatar || '')) { ph.dataset.for = ch.id + (ch.avatar || ''); ph.innerHTML = App.avatarHtml(App.previews[ch.id] ? { ...ch, avatar: App.previews[ch.id].dataUrl } : ch, 'wa-av'); }
    if (state !== undefined) this._hs = state;
    st.textContent = App.call && App.call.active ? (App.call.mode === 'voice' ? 'in chiamata' : 'in videochiamata') : this.busy || this._hs ? (this._hs || 'sta scrivendo…') : 'online';
    st.classList.toggle('typing', !!(this.busy || this._hs));
  },
  scroll() { const m = $('#messages'); m.scrollTop = m.scrollHeight; },
  nearBottom() { const m = $('#messages'); return m.scrollHeight - m.scrollTop - m.clientHeight < 80; },
  setTyping(t) {
    const el = $('#typing'); if (!el) return;
    el.hidden = !t; el.textContent = t ? `${t.name || 'Il personaggio'} sta scrivendo${t.for ? ' a ' + t.for : ''}…` : '';
    this.header(t ? `sta scrivendo${t.for ? ' a ' + t.for : ''}…` : null);
  },
  // Chiede al server solo i messaggi nuovi (n > last). Se la chat è stata svuotata (epoch diversa) ricarica tutto.
  async poll(full = false) {
    const ch = App.current; if (!ch || this.polling) return;
    this.polling = true;
    try {
      const q = !full && this.epoch ? `?since=${this.last}&epoch=${encodeURIComponent(this.epoch)}` : '';
      const r = await App.api(`/api/chats/${ch.id}${q}`);
      if (App.current !== ch) return;
      const stick = this.nearBottom();
      if (r.reset) { $('#messages').innerHTML = ''; this.ids = new Set(); }
      this.epoch = r.epoch; this.last = r.last;
      let added = 0;
      for (const m of r.messages) {
        if (!this.addMsg(m)) continue;
        added++;
        // risposta del personaggio arrivata col polling (es. chiesta dall'altro profilo): l'avatar "la dice" e reagisce
        if (!full && !r.reset && m.role === 'assistant') { App.avatarConv.talkText(m.content.slice(0, 400)); if (m.gesture) App.avatarConv.react({ annuisce: 'nod', sorride: 'smile', ride: 'smile', inclina: 'tilt', nega: 'shake', pensa: 'tilt', ammicca: 'smile', saluta: 'wave' }[m.gesture] || 'nod'); else App.avatarConv.emote(m.content); if (m.action && App.actions) App.actions.play(m.action, 'chat'); }
      }
      this.setTyping(this.busy ? null : r.typing && r.typing.by !== App.me.user ? r.typing : null);
      if (added && (stick || r.reset)) this.scroll();
      this.ticks();
    } catch { /* rete assente: si riprova al prossimo giro */ } finally { this.polling = false; }
  },
  visible() { return !!App.current && !document.hidden && !$('#tab-conv').hidden; },
  // noAI = true: "solo messaggio" all'altra persona, l'IA non risponde (non serve la chiave).
  async send(text, noAI = false) {
    text = (text || '').trim(); if (!text || !App.current || this.busy) return;
    if (this.pendingAdult) return this.answerAdult(text); // risposta sì/no alla domanda di conferma (resta sul telefono)
    if (App.kwSet && text.length <= 80) { // parola chiave: confronto sul server (hash), mai in chat né all'IA
      try { const k = await App.api('/api/adult-keyword/check', { method: 'POST', body: { text } }); if (k.match) return this.askAdult(k.token); } catch { /* prosegui */ }
    }
    if (!noAI && !App.key()) return App.toast('🔑 Inserisci la chiave xAI in Account (oppure usa 💬 per scrivere solo all\'altra persona)');
    this.busy = true; const ch = App.current;
    const meName = App.me.name;
    const local = this.addMsg({ role: 'user', author: App.me.user, authorName: meName, content: text, noAI, at: new Date().toISOString() });
    this.scroll();
    if (noAI) {
      try { const r = await App.api(`/api/chats/${ch.id}`, { method: 'POST', body: { message: text, noAI: true } }); if (r.keyword) { local.remove(); this.busy = false; return this.askAdult(r.token); } this.claim(local, r.message.id); }
      catch (e) { local.querySelector('.body').textContent += `\n⚠️ ${e.message}`; }
      this.busy = false; this.poll(); return;
    }
    this.header();
    const bubble = this.addMsg({ role: 'assistant', authorName: ch.name, content: '…' }); bubble.classList.add('typing'); this.scroll();
    const body = bubble.querySelector('.body');
    let reply = '', streamTTS = false;
    const cue = App.chat.cues();
    try {
      const r = await App.api(`/api/chats/${ch.id}`, { method: 'POST', body: { message: text, ...(App.call && App.call.active ? { call: true, callMode: App.call.mode || 'video' } : {}) }, ai: true, raw: true });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.message) this.claim(local, j.message.id); // il tuo messaggio è comunque salvato nella chat condivisa
        if (r.status === 403) App.showActivation();
        throw new Error(j.error || `Errore ${r.status}`);
      }
      if ((r.headers.get('Content-Type') || '').includes('application/json')) { // parola chiave riconosciuta dal server
        const j = await r.json(); local.remove(); bubble.remove(); this.busy = false; this.header();
        if (j.keyword) return this.askAdult(j.token);
      }
      this.claim(local, r.headers.get('X-Msg-Id')); this.claim(bubble, r.headers.get('X-Reply-Id'));
      const reader = r.body.getReader(); const dec = new TextDecoder();
      bubble.classList.remove('typing');
      streamTTS = !!(App.voice && App.voice.streamStart && App.voice.streamStart()); // v8: voce naturale frase per frase
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const chunk = dec.decode(value, { stream: true });
        reply += chunk;
        body.textContent = App.actions ? App.actions.strip(reply) : reply; this.scroll();
        if (!cue.done) cue.check(reply); // v8: gesto/umore scelti dall'IA in base a ciò che dice (tag a inizio risposta)
        if (App.call && App.call.active) App.call.caption(App.actions ? App.actions.strip(reply) : reply);
        if (streamTTS) App.voice.streamFeed(chunk);
        else if (!App.voice || !App.voice.ttsOn()) App.avatarConv.talkText(chunk); // labiale anche senza lettura vocale
      }
    } catch (e) { body.textContent = '⚠️ ' + e.message; bubble.classList.remove('typing'); }
    this.busy = false; this.header();
    this.poll();
    if (reply) { cue.check(reply, true); if (!cue.any) App.avatarConv.emote(reply); }
    if (reply && App.actions) App.actions.fromReply(reply);
    if (streamTTS) App.voice.streamEnd();
    else if (reply && App.voice) App.voice.speak(App.actions ? App.actions.strip(reply) : reply);
    if (reply) this.afterReply(ch);
  },
  // v8: linguaggio del corpo contestuale. L'IA può iniziare la risposta con [gesto:…] e/o [umore:…]:
  // il gesto parte quando arriva (insieme alla voce), niente animazioni casuali.
  cues() {
    const G = { annuisce: 'nod', sorride: 'smile', ride: 'smile', inclina: 'tilt', nega: 'shake', pensa: 'tilt', ammicca: 'smile', saluta: 'wave' };
    const M = { allegra: 'smile', tenera: 'smile', maliziosa: 'smile', sorpresa: 'tilt', pensierosa: 'tilt', triste: 'tilt', seria: null, offesa: null };
    const c = { done: false, any: false, g: null, m: null,
      check(t, final) {
        if (!this.g) { const g = /\[gesto:\s*([a-zà-ù]+)\s*\]/i.exec(t); if (g) { this.g = g[1].toLowerCase(); this.any = true; if (G[this.g]) App.avatarConv.react(G[this.g], this.g === 'ride' ? '😄' : null); if (this.g === 'ride' && App.actions && App.actions.cue) App.actions.cue('ride', 0.6); } }
        if (!this.m) { const m = /\[umore:\s*([a-zà-ù]+)\s*\]/i.exec(t); if (m) { this.m = m[1].toLowerCase(); this.any = true; if (!this.g && M[this.m]) App.avatarConv.react(M[this.m]); if (this.m === 'triste' && App.avatarConv.breathM) App.avatarConv.breathM.sigh(performance.now()); if ((this.m === 'tenera' || this.m === 'maliziosa') && App.actions && App.actions.cue) App.actions.cue('capelli', 0.3); } }
        if ((this.g && this.m) || final || t.length > 160) this.done = true;
      } };
    return c;
  },
  // ---- modalità adulti con parola chiave: domanda a voce e conferma sì/no (solo su questo telefono) ----
  askAdult(token) {
    const q = App.me.activated ? 'Vuoi attivare la modalità adulti? Rispondi sì o no' : 'Prima serve il consenso vocale: la modalità adulti non si può attivare.';
    this.addMsg({ role: 'assistant', authorName: (App.current && App.current.name) || 'Avatar', content: q, local: true }); this.scroll();
    if (App.voice && App.voice.sayNow) App.voice.sayNow(q);
    if (!App.me.activated) return;
    this.pendingAdult = { token, until: Date.now() + 115e3 };
  },
  async answerAdult(text) {
    const p = this.pendingAdult; this.pendingAdult = null;
    this.addMsg({ role: 'user', author: App.me.user, authorName: App.me.name, content: text, local: true });
    if (!p || Date.now() > p.until) { this.addMsg({ role: 'assistant', authorName: App.current.name, content: 'Tempo scaduto: ripeti la parola chiave.', local: true }); return; }
    try {
      const r = await App.api('/api/adult-keyword/confirm', { method: 'POST', body: { token: p.token, answer: text } });
      const msg = r.changed ? `Modalità adulti attivata per ${App.me.name}.${r.adultChat ? ' Ora è attiva per entrambi.' : r.status ? ' ' + App.adultText(r.status, false) : ' Nella chat condivisa vale quando la attiva anche l\'altra persona.'}` : 'Va bene, la modalità adulti resta com\'era.';
      this.addMsg({ role: 'assistant', authorName: App.current.name, content: msg, local: true });
      if (App.voice && App.voice.sayNow) App.voice.sayNow(msg);
      if (r.changed) { App.settings.adultMode = true; App.applyAdult(); App.account.load(); }
    } catch (e) { this.addMsg({ role: 'assistant', authorName: App.current.name, content: '⚠️ ' + e.message, local: true }); }
    this.scroll();
  },
  claim(el, id) { if (el && id) { el.dataset.id = id; this.ids.add(id); this.ticks(); } },
  // Ogni 3 messaggi: estrai ricordi (se attivo) e aggiorna lo stato emotivo del personaggio
  async afterReply(ch) {
    const n = (App.ls.get(`count:${ch.id}`, 0) || 0) + 1; App.ls.set(`count:${ch.id}`, n);
    if (n % 3) return;
    try {
      if (App.ls.get('memAuto', true)) {
        const r = await App.api('/api/memory/extract', { method: 'POST', body: { characterId: ch.id }, ai: true });
        if (r.added && r.added.length) { App.account.loadMemory(); App.toast(`🧠 Ho imparato: ${r.added[0].text}`); }
      }
      const s = await App.api(`/api/characters/${ch.id}/evolve`, { method: 'POST', body: {}, ai: true });
      ch.state = s.state;
      if (n % 6 === 0) await App.api(`/api/chats/${ch.id}/summarize`, { method: 'POST', body: {}, ai: true }); // v8: riassunto delle parti vecchie (il server decide se serve)
    } catch { /* in background: ignora errori */ }
  },
};

// ---- sincronizzazione dell'archivio condiviso ----
// Chat: ogni 3 s mentre è visibile (in pausa se l'app è in background).
setInterval(() => { if (App.chat.visible() && !App.chat.busy) App.chat.poll(); }, 3000);
document.addEventListener('visibilitychange', () => { if (App.chat.visible()) App.chat.poll(); if (!document.hidden) App.sync(); });
// Personaggi e memoria: ogni 7 s controlla le versioni e ricarica solo ciò che l'altro profilo ha cambiato.
App._ver = { chars: null, memory: null };
App.sync = async function () {
  if (!App.me || document.hidden || App._syncing) return;
  App._syncing = true;
  try {
    const v = await App.api('/api/sync');
    if (App._ver.chars && (v.chars !== App._ver.chars || v.adultChat !== App._ver.adultChat)) { // anche quando cambia la modalità adulti (azioni visibili o no)
      const list = await App.api('/api/characters');
      const old = new Map(App.chars.map((c) => [c.id, c]));
      App.chars = list;
      if (App.current) { const cur = list.find((c) => c.id === App.current.id); if (cur) App.current = cur; } // sempre l'oggetto aggiornato (anche stato interno, es. umore)
      for (const c of list) {
        const prev = old.get(c.id);
        if (prev && prev.updatedAt === c.updatedAt) continue;
        if (App.current && App.current.id === c.id) {
          App.current = c; $('#title').textContent = c.name;
          if (!App.previews[c.id]) App.avatarConv.setCharacter(c);
        }
        App.editor.remoteUpdate && App.editor.remoteUpdate(c);
        if (prev && c.updatedBy && c.updatedBy !== App.me.user) App.toast(`🔄 ${c.updatedBy === 'luisa' ? 'Luisa' : 'Nico'} ha aggiornato ${c.name}`);
      }
      for (const id of old.keys()) if (!list.find((c) => c.id === id)) { App.editor.removed && App.editor.removed(id); if (App.current && App.current.id === id) App.chat.close(); }
      if (!App.current) App.chat.renderList(); else App.chat.renderList();
      if (App.current && App.scene) App.scene.apply();
      if (App.actions) App.actions.refresh();
    }
    if (App._ver.memory && v.memory !== App._ver.memory) await App.account.loadMemory();
    App._ver = v;
  } catch { /* riprova */ } finally { App._syncing = false; }
};
setInterval(() => App.sync(), 7000);

$('#char-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  if (e.target.closest('[data-edit]')) App.editor.open(li.dataset.id); else App.chat.open(li.dataset.id);
});
$('#new-char').addEventListener('click', () => App.editor.open(null));
$('#back-btn').addEventListener('click', () => App.chat.close());
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); const t = i.value; i.value = ''; App.chat.send(t); });
$('#chat-only').addEventListener('click', () => { const i = $('#chat-input'); const t = i.value; if (!t.trim()) return App.toast('Scrivi prima il messaggio'); i.value = ''; App.chat.send(t, true); });
$('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !/Mobi/.test(navigator.userAgent)) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
$('#clear-chat').addEventListener('click', async () => {
  if (!App.current || !confirm('Cancellare questa conversazione? Sparisce per entrambi (Nico e Luisa).')) return;
  await App.api(`/api/chats/${App.current.id}`, { method: 'DELETE' }); $('#messages').innerHTML = ''; App.chat.ids = new Set(); App.chat.poll(true);
});

// Tocca l'avatar per passare da grande a piccolo (più spazio ai messaggi) e viceversa
$('#avatar-canvas').addEventListener('click', () => { if (App.stageFs && App.stageFs.isFs()) return; $('#scene-menu').hidden = true; const c = $('#tab-conv'); c.classList.toggle('compact'); App.ls.set('avatarCompact', c.classList.contains('compact')); });
