/* Campo aspetto accanto all'avatar. Lo storico resta sul server, per persona e personaggio. */
(function () {
  function $(s) { return document.querySelector(s); }
  function characterId() {
    const c = (App.solo && App.solo.char && App.solo.char()) || App.current;
    return (c && c.id) || '';
  }
  function msg(t) { const el = $('#look-msg'); if (el) el.textContent = t || ''; }
  function list(ul, entries, onRestore) {
    if (!ul) return;
    ul.innerHTML = '';
    (entries || []).slice().reverse().forEach((e) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Annulla';
      b.addEventListener('click', () => onRestore(e.id));
      li.append((e.summary || e.text || 'vuoto') + ' ');
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  function render(entries) { list($('#look-history'), entries, restore); }
  async function restore(id) {
    try {
      const res = await App.api('/api/avatar-looks/restore', { method: 'POST', body: { characterId: characterId(), id } });
      render(res.entries);
      msg(res.entry && res.entry.summary);
    } catch (e) { msg(e.message); }
  }
  function fillNotes(data) {
    const c = $('#nova-carattere');
    const r = $('#nova-richieste');
    const curC = data && data.carattere && data.carattere.current;
    const curR = data && data.richieste && data.richieste.current;
    if (c && document.activeElement !== c) c.value = (curC && curC.text) || '';
    if (r && document.activeElement !== r) r.value = (curR && curR.text) || '';
    list($('#char-history'), data && data.carattere && data.carattere.entries, (id) => restoreNote('carattere', id));
    list($('#req-history'), data && data.richieste && data.richieste.entries, (id) => restoreNote('richieste', id));
  }
  async function restoreNote(kind, id) {
    try {
      const res = await App.api('/api/nova-notes/restore', { method: 'POST', body: { characterId: characterId(), kind, id } });
      fillNotes(res);
      msg('Ripristinato');
    } catch (e) { msg(e.message); }
  }
  async function boot() {
    const id = characterId();
    let data = null;
    try { data = await App.api('/api/avatar-looks?character=' + encodeURIComponent(id)); } catch { data = null; }
    render(data && data.entries);
    const look = $('#look-text');
    if (look && data && data.current && document.activeElement !== look) look.value = data.current.text || '';
    if (data && data.current) msg('Salvato. La foto 2D non cambia da questo testo.');
    try { fillNotes(await App.api('/api/nova-notes?character=' + encodeURIComponent(id))); } catch { /* assente */ }
  }
  function bind() {
    const toggle = $('#look-toggle');
    if (toggle && !toggle._bound) {
      toggle._bound = true;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = $('#look-bar');
        if (f) f.hidden = !f.hidden;
      });
    }
    const form = $('#look-bar'); if (!form || form._bound) return; form._bound = true;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#look-text');
      const text = (input && input.value || '').trim();
      const id = characterId();
      const prev = App.avatar3d && App.avatar3d.look && App.avatar3d.look();
      if (text) {
        const pre = window.LookParse && LookParse.parse(text, prev);
        if (pre && !pre.ok) { msg(pre.error); return; }
      }
      try {
        if (text) {
          const res = await App.api('/api/avatar-looks', { method: 'POST', body: { text, characterId: id } });
          render(res.entries);
        }
        const notes = await App.api('/api/nova-notes', { method: 'POST', body: {
          characterId: id,
          carattere: ($('#nova-carattere') && $('#nova-carattere').value) || '',
          richieste: ($('#nova-richieste') && $('#nova-richieste').value) || '',
        } });
        fillNotes(notes);
        msg('Salvato. La foto 2D non cambia da questo testo.');
      } catch (err) {
        msg(err.message);
      }
    });
  }
  bind();
  App.looks = { boot, render };
})();
