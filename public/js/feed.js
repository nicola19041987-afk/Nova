/* feed.js — Diario: bacheca privata condivisa solo tra Nicola e Luisa (post, didascalie del personaggio, mi piace, commenti). */
(function () {
  let posts = [];
  App.feed = {
    async load() { posts = await App.api('/api/feed'); this.render(); },
    render() {
      $('#feed').innerHTML = posts.map((p) => `<article class="post" data-id="${p.id}">
        <header><div class="avatar">${esc((p.character && p.character.emoji) || '💜')}</div>
          <div class="grow"><b>${esc(p.character ? p.character.name : p.authorName)}</b><small>pubblicato da ${esc(p.authorName)} · ${esc(fmtDate(p.createdAt))}</small></div>
          ${p.mine ? '<button data-del-post>🗑️</button>' : ''}</header>
        <img src="/api/feed/img/${esc(p.file)}" loading="lazy" alt="">
        <div class="actions"><button data-like class="${p.likedByMe ? 'liked' : ''}">❤️ ${p.likes.length || ''}</button>
          <span class="muted small">${p.likeNames.length ? 'Piace a ' + esc(p.likeNames.join(' e ')) : ''}</span>
          <span class="grow"></span>${App.exportButtons('/api/feed/img/' + p.file, p.file)}</div>
        ${p.caption ? `<div class="caption">${esc(p.caption)}</div>` : ''}
        <div class="comments">${p.comments.map((c) => `<p><b>${esc(c.name)}</b> ${esc(c.text)} ${c.mine ? `<button data-del-comment="${c.id}">✕</button>` : ''}</p>`).join('')}</div>
        <form data-comment><input placeholder="Scrivi un commento…" maxlength="1000"><button class="primary">↵</button></form>
      </article>`).join('') || '<p class="muted">Il diario è vuoto. Pubblica un\'immagine o un look con 📔.</p>';
    },
    // spec: { source: 'image'|'avatar'|'pending', ref, characterId, context }
    async post(spec) {
      const caption = prompt('Didascalia (lascia vuoto per farla scrivere al personaggio):', '');
      if (caption === null) return;
      App.toast('📔 Pubblicazione nel Diario…');
      const p = await App.api('/api/feed', { method: 'POST', ai: !caption && !!App.key(), body: { ...spec, caption, autoCaption: !caption } });
      posts.unshift(p); this.render(); App.toast('📔 Pubblicato nel Diario');
    },
  };
  $('#feed').addEventListener('click', async (e) => {
    const art = e.target.closest('.post'); if (!art) return; const id = art.dataset.id;
    const upd = (p) => { posts = posts.map((x) => (x.id === p.id ? p : x)); App.feed.render(); };
    try {
      if (e.target.closest('[data-like]')) upd(await App.api(`/api/feed/${id}/like`, { method: 'POST' }));
      const dc = e.target.closest('[data-del-comment]'); if (dc) upd(await App.api(`/api/feed/${id}/comments/${dc.dataset.delComment}`, { method: 'DELETE' }));
      if (e.target.closest('[data-del-post]') && confirm('Eliminare il post?')) { await App.api(`/api/feed/${id}`, { method: 'DELETE' }); posts = posts.filter((x) => x.id !== id); App.feed.render(); }
    } catch (err) { App.toast(err.message); }
  });
  $('#feed').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target.closest('form[data-comment]'); if (!f) return;
    const id = f.closest('.post').dataset.id; const text = f.querySelector('input').value.trim(); if (!text) return;
    try { const p = await App.api(`/api/feed/${id}/comments`, { method: 'POST', body: { text } }); posts = posts.map((x) => (x.id === p.id ? p : x)); App.feed.render(); }
    catch (err) { App.toast(err.message); }
  });
})();
