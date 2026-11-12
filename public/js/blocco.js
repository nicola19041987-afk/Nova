/* blocco.js — v2d-30: Blocco note 📝 di Nova (solo lettura). Le note si aggiungono SOLO dicendo a Nova
   «segna», «segnala», «segnalo» o «segnalalo», in chat o a voce: niente salvataggi automatici, niente invio a nessuno. */
(function () {
  let notes = [], timer = 0;
  function fmt(iso) {
    try { return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }); } catch { return ''; }
  }
  function badge() {
    const b = document.getElementById('blocco-count');
    if (b) { b.textContent = notes.length ? String(Math.min(notes.length, 99)) : ''; b.hidden = !notes.length; }
  }
  function dlg() {
    let d = document.getElementById('blocco-dialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'blocco-dialog'; d.className = 'sheet';
    d.innerHTML = `<form method="dialog" id="blocco-form">
      <div class="blocco-head"><h3>📝 Blocco note</h3></div>
      <p class="muted small blocco-hint">Per segnare qualcosa di' a Nova «segna», «segnala», «segnalo» o «segnalalo», in chat o a voce.</p>
      <div id="blocco-list" class="blocco-list" aria-live="polite"></div>
    </form>`;
    (document.getElementById('app-shell') || document.body).appendChild(d);
    return d;
  }
  function paint() {
    const box = document.getElementById('blocco-list'); if (!box) return;
    box.innerHTML = notes.length ? notes.map((n) => `<article class="blocco-item">
      <p class="txt">${esc(n.text || '')}</p>
      <p class="who">${esc(n.from || '')} · ${esc(fmt(n.at))}${n.channel === 'voce' ? ' · 🎙️' : ''}</p>
    </article>`).join('') : '<p class="muted small blocco-empty">Nessuna nota ancora.</p>';
  }
  async function load() {
    if (!App.me) return; // prima dell'accesso niente richieste (un 401 riaprirebbe il PIN)
    try { const r = await App.api('/api/blocco-note'); notes = Array.isArray(r && r.notes) ? r.notes : []; }
    catch { /* offline o sessione scaduta: resta l'ultima lista */ }
    badge(); paint();
  }
  async function open() {
    const d = dlg();
    if (App.closeSheets) App.closeSheets(d);
    paint();
    if (!d.open) d.showModal();
    await load();
  }
  function soon() { clearTimeout(timer); timer = setTimeout(load, 1200); }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#blocco-btn')) { e.preventDefault(); open(); }
  });
  // il contatore si aggiorna quando arrivano messaggi nuovi (es. dopo un «segna»), senza toccare la chat
  function watch() {
    const m = document.getElementById('messages');
    if (m && window.MutationObserver) new MutationObserver(soon).observe(m, { childList: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(); });
    soon();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  App.blocco = { open, load };
})();
