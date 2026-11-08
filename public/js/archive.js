/* archive.js — Galleria totale, sola lettura. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  function wanted() {
    const h = (location.hash || '').replace(/^#/, '').toLowerCase();
    const p = (location.pathname || '/').replace(/\/+$/, '') || '/';
    return h === 'galleria' || p === '/galleria';
  }
  function when(iso) {
    if (!iso) return 'data sconosciuta';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'data sconosciuta';
    return d.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function render(data) {
    const t = data.totals || { photos: 0, videos: 0, by: {}, first: null, last: null };
    const by = t.by || {};
    $('#archive-totals').innerHTML = `<p><b>${t.videos || 0}</b> video · <b>${t.photos || 0}</b> foto</p>
      <p>Nicola ${by.Nicola || 0} · Luisa ${by.Luisa || 0} · Nova ${by['Nova-generated'] || 0} · sconosciuto ${by.sconosciuto || 0}</p>
      <p class="muted small">${t.first ? 'dal ' + esc(when(t.first)) + ' al ' + esc(when(t.last)) : 'Nessuna foto o video sul server.'}</p>`;
    const grid = $('#archive-grid');
    const items = data.items || [];
    grid.innerHTML = items.length ? items.map((it) => `<button type="button" class="arch-item" data-id="${esc(it.id)}" data-kind="${esc(it.kind)}" data-url="${esc(it.url)}">
      ${it.thumb ? `<img loading="lazy" decoding="async" alt="" src="${esc(it.thumb)}">` : '<span class="arch-play" aria-hidden="true">▶</span>'}
      <span class="arch-meta">${esc(when(it.at))}<br>${esc(it.uploader)} · ${esc(it.source)}${it.trash ? ' · nel cestino' : ''}${it.label ? '<br>' + esc(it.label) : ''}</span>
    </button>`).join('') : '<p class="muted">Nessuna foto o video sul server.</p>';
    const tg = data.telegram || { code: false, hits: [] };
    const hits = tg.hits || [];
    $('#archive-telegram').innerHTML = `<h3>Telegram</h3>
      <p class="muted small">Nel programma non c’è un bot, un token o un import da Telegram.</p>
      ${hits.length ? hits.map((h) => `<article><p class="arch-meta">${esc(when(h.at))} · ${esc(h.who)} · ${esc(h.source)}</p><p>${esc(h.text)}</p></article>`).join('') : '<p>Nessun messaggio o file nei dati cita Telegram.</p>'}`;
  }
  function showMedia(btn) {
    const dlg = $('#archive-view');
    const img = $('#archive-full');
    const vid = $('#archive-video');
    const cap = $('#archive-cap');
    const card = btn.querySelector('.arch-meta');
    cap.textContent = card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
    vid.pause(); vid.removeAttribute('src'); vid.hidden = true; img.hidden = true; img.removeAttribute('src');
    if (btn.dataset.kind === 'video') { vid.hidden = false; vid.src = btn.dataset.url; vid.play().catch(() => {}); }
    else { img.hidden = false; img.src = btn.dataset.url; }
    if (!dlg.open) dlg.showModal();
  }
  App.archive = {
    wanted,
    async open() {
      if (!App.me) return;
      const page = $('#archive-page'); if (!page) return;
      page.hidden = false;
      document.body.classList.add('archive-on');
      $('#archive-totals').textContent = 'Carico l’elenco…';
      const data = await App.api('/api/archive');
      render(data);
      page.scrollTop = 0;
    },
    close() {
      const page = $('#archive-page'); if (page) page.hidden = true;
      document.body.classList.remove('archive-on');
      const dlg = $('#archive-view');
      if (dlg && dlg.open) dlg.close();
      const vid = $('#archive-video'); if (vid) { vid.pause(); vid.removeAttribute('src'); }
      const path = (location.pathname || '/').replace(/\/+$/, '') || '/';
      if (path === '/galleria' || location.hash === '#galleria') history.replaceState(null, '', '/');
    },
  };
  document.addEventListener('click', (e) => {
    const back = e.target.closest('#archive-back');
    if (back) { e.preventDefault(); App.archive.close(); return; }
    const x = e.target.closest('#archive-view-x');
    if (x) { const dlg = $('#archive-view'); if (dlg && dlg.open) dlg.close(); const vid = $('#archive-video'); if (vid) { vid.pause(); vid.removeAttribute('src'); } return; }
    const item = e.target.closest('#archive-grid .arch-item');
    if (item) { e.preventDefault(); showMedia(item); }
  });
  window.addEventListener('hashchange', () => {
    if (App.archive.wanted()) { if (App.me) App.archive.open().catch((e) => App.toast(e.message)); }
    else if ($('#archive-page') && !$('#archive-page').hidden) App.archive.close();
  });
})();
