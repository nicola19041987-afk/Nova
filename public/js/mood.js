/* mood.js — Umore di Nova: riepilogo, barre e andamento degli ultimi 7 giorni. */
(function () {
  const LABELS = [
    ['allegria', 'Allegria'], ['affetto', 'Affetto'], ['fiducia', 'Fiducia'],
    ['desiderio', 'Desiderio'], ['irritazione', 'Irritazione'], ['energia', 'Energia'],
  ];
  const COLORS = { allegria: '#1E6FD9', affetto: '#2F80ED', fiducia: '#5B8DEF', desiderio: '#7AA7F5', irritazione: '#8B949E', energia: '#1A1D21' };
  function dlg() {
    let d = $('#mood-dialog');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'mood-dialog'; d.className = 'sheet mood-sheet';
    d.innerHTML = `<form method="dialog">
      <h3>Umore di Nova</h3>
      <p id="mood-summary" class="mood-summary">…</p>
      <div id="mood-bars"></div>
      <p class="muted small">Ultimi 7 giorni</p>
      <canvas id="mood-chart" width="640" height="220"></canvas>
      <button type="submit" class="block">Chiudi</button>
    </form>`;
    (document.getElementById('app-shell') || document.body).appendChild(d);
    return d;
  }
  function bars(values) {
    $('#mood-bars').innerHTML = LABELS.map(([k, name]) => {
      const v = Math.max(0, Math.min(100, Number(values[k]) || 0));
      return `<div class="mood-row"><span>${name}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`;
    }).join('');
  }
  function chart(history) {
    const c = $('#mood-chart'); if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height, pad = 28;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#F7F8FA'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#D0D5DD'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, 8); ctx.lineTo(pad, h - pad); ctx.lineTo(w - 8, h - pad); ctx.stroke();
    const pts = (history || []).filter((p) => p && p.t);
    if (!pts.length) return;
    const t0 = Date.now() - 7 * 864e5, t1 = Date.now();
    const x = (t) => pad + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (w - pad - 8);
    const y = (v) => (h - pad) - (Math.max(0, Math.min(100, v)) / 100) * (h - pad - 8);
    for (const [k] of LABELS) {
      ctx.beginPath(); ctx.strokeStyle = COLORS[k]; ctx.lineWidth = 2;
      pts.forEach((p, i) => { const X = x(p.t), Y = y(p[k]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
  }
  async function open() {
    const d = dlg();
    $('#mood-summary').textContent = 'Carico…';
    d.showModal();
    try {
      const r = await App.api('/api/mood');
      $('#mood-summary').textContent = r.summary || 'Oggi è serena.';
      bars(r.values || {});
      chart(r.history || []);
    } catch (e) { $('#mood-summary').textContent = e.message || 'Umore non disponibile'; }
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('#mood-open')) { e.preventDefault(); open(); return; }
    const title = e.target.closest('#title, .wa-title');
    if (title && document.body.classList.contains('solo-mode') && !e.target.closest('button')) open();
  });
  App.mood = { open };
})();
