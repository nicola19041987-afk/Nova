/* chat.js — elenco personaggi, conversazione in streaming, memoria automatica, evoluzione personalità. */
App.chat = {
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
    const msgs = await App.api(`/api/chats/${ch.id}`);
    $('#messages').innerHTML = ''; msgs.forEach((m) => this.addMsg(m.role, m.content));
    this.scroll();
  },
  close() {
    App.current = null; App.voice && App.voice.stop(); speechSynthesis && speechSynthesis.cancel();
    $('#tab-conv').hidden = true; $('#tab-chat').hidden = false; $('#back-btn').hidden = true; $('#title').textContent = 'Chat';
    this.renderList();
  },
  addMsg(role, text) {
    const d = document.createElement('div'); d.className = `msg ${role}`; d.textContent = text;
    const pin = document.createElement('button'); pin.className = 'pin'; pin.type = 'button'; pin.textContent = '📌'; pin.title = 'Ricorda questo';
    pin.onclick = () => { const t = prompt('Cosa devo ricordare?', d.firstChild ? d.firstChild.textContent.slice(0, 280) : ''); if (t) App.account.remember(t); };
    d.appendChild(pin); $('#messages').appendChild(d); return d;
  },
  scroll() { const m = $('#messages'); m.scrollTop = m.scrollHeight; },
  async send(text) {
    text = (text || '').trim(); if (!text || !App.current || this.busy) return;
    if (!App.key()) return App.toast('🔑 Inserisci la chiave xAI in Account');
    this.busy = true; const ch = App.current;
    this.addMsg('user', text); const bubble = this.addMsg('assistant', '…'); bubble.classList.add('typing'); this.scroll();
    let reply = '';
    try {
      const r = await App.api(`/api/chats/${ch.id}`, { method: 'POST', body: { message: text }, ai: true, raw: true });
      if (!r.ok) { const j = await r.json().catch(() => ({})); if (r.status === 403) App.showActivation(); throw new Error(j.error || `Errore ${r.status}`); }
      const reader = r.body.getReader(); const dec = new TextDecoder();
      bubble.classList.remove('typing');
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        reply += dec.decode(value, { stream: true });
        bubble.firstChild.textContent = reply; this.scroll();
      }
    } catch (e) { bubble.firstChild.textContent = '⚠️ ' + e.message; bubble.classList.remove('typing'); }
    this.busy = false;
    if (reply && App.voice) App.voice.speak(reply);
    if (reply) this.afterReply(ch);
  },
  // Ogni 3 messaggi: estrai ricordi (se attivo) e aggiorna lo stato emotivo del personaggio
  async afterReply(ch) {
    const n = (App.ls.get(`count:${ch.id}`, 0) || 0) + 1; App.ls.set(`count:${ch.id}`, n);
    if (n % 3) return;
    try {
      if (App.ls.get('memAuto', true)) {
        const r = await App.api('/api/memory/extract', { method: 'POST', body: { characterId: ch.id }, ai: true });
        if (r.added && r.added.length) { App.account.setMemory([...App.memory, ...r.added]); App.toast(`🧠 Ho imparato: ${r.added[0].text}`); }
      }
      const s = await App.api(`/api/characters/${ch.id}/evolve`, { method: 'POST', body: {}, ai: true });
      ch.state = s.state;
    } catch { /* in background: ignora errori */ }
  },
};

$('#char-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  if (e.target.closest('[data-edit]')) App.editor.open(li.dataset.id); else App.chat.open(li.dataset.id);
});
$('#new-char').addEventListener('click', () => App.editor.open(null));
$('#back-btn').addEventListener('click', () => App.chat.close());
$('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#chat-input'); const t = i.value; i.value = ''; App.chat.send(t); });
$('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !/Mobi/.test(navigator.userAgent)) { e.preventDefault(); $('#chat-form').requestSubmit(); } });
$('#clear-chat').addEventListener('click', async () => {
  if (!App.current || !confirm('Cancellare questa conversazione?')) return;
  await App.api(`/api/chats/${App.current.id}`, { method: 'DELETE' }); $('#messages').innerHTML = '';
});
