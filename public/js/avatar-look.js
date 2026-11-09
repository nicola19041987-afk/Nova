/* Campo aspetto accanto all'avatar. Lo storico resta sul server, per persona e personaggio. */
(function () {
  function $(s) { return document.querySelector(s); }
  function characterId() {
    const c = (App.solo && App.solo.char && App.solo.char()) || App.current;
    return (c && c.id) || '';
  }
  function msg(t) { const el = $('#look-msg'); if (el) el.textContent = t || ''; }
  function render(entries) {
    const ul = $('#look-history'); if (!ul) return;
    ul.innerHTML = '';
    (entries || []).slice().reverse().forEach((e) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Ripristina';
      b.addEventListener('click', () => restore(e.id));
      li.append((e.summary || e.text || 'Aspetto') + ' ');
      li.appendChild(b);
      ul.appendChild(li);
    });
  }
  async function restore(id) {
    try {
      const res = await App.api('/api/avatar-looks/restore', { method: 'POST', body: { characterId: characterId(), id } });
      render(res.entries);
      msg(res.entry && res.entry.summary);
    } catch (e) { msg(e.message); }
  }
  async function boot() {
    const id = characterId();
    let data = null;
    try { data = await App.api('/api/avatar-looks?character=' + encodeURIComponent(id)); } catch { data = null; }
    render(data && data.entries);
    if (data && data.current) msg(data.current.summary);
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
      const prev = App.avatar3d && App.avatar3d.look && App.avatar3d.look();
      const pre = window.LookParse && LookParse.parse(text, prev);
      if (pre && !pre.ok) { msg(pre.error); return; }
      try {
        const res = await App.api('/api/avatar-looks', { method: 'POST', body: { text, characterId: characterId() } });
        render(res.entries);
        msg(res.entry.summary);
        if (input) input.value = '';
      } catch (err) {
        msg(err.message);
        if (prev) msg(prev.summary || '');
      }
    });
  }
  bind();
  App.looks = { boot, render };
})();
