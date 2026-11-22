/* v2d-67: schermata a tutto schermo quando Ira chiama (Web Push o messaggio dal service worker). */
(function () {
  if (window.__novaIncomingBound) return;
  window.__novaIncomingBound = true;
  if (!window.App) return;
  const App = window.App;
  let ringing = false;

  function el() { return document.getElementById('incoming-call'); }

  function show(payload) {
    const box = el();
    if (!box) return false;
    if (App.call && App.call.active) return false;
    const name = document.getElementById('incoming-name');
    const face = document.getElementById('incoming-face');
    if (name) name.textContent = (payload && payload.name) || 'Ira';
    if (face) {
      // viso ufficiale v8, invariato
      face.src = (App.IRA_OFFICIAL_FACE || '/api/avatars/c2d6200000000001.jpg');
      face.alt = (payload && payload.name) || 'Ira';
    }
    box.hidden = false;
    document.body.classList.add('incoming-call-on');
    ringing = true;
    return true;
  }

  function hide() {
    const box = el();
    if (box) box.hidden = true;
    document.body.classList.remove('incoming-call-on');
    ringing = false;
  }

  function accept() {
    if (!ringing && el() && el().hidden) return;
    hide();
    try {
      if (App.call && App.call.requestStart) App.call.requestStart('video');
      else if (App.call && App.call.start) App.call.start('video');
    } catch {}
  }

  function decline() { hide(); }

  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('#incoming-accept')) { e.preventDefault(); accept(); }
    if (e.target && e.target.closest && e.target.closest('#incoming-decline')) { e.preventDefault(); decline(); }
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e && e.data;
      if (d && d.type === 'incoming-call') show(d);
    });
  }

  function fromQuery() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('incoming') === '1') show({ name: 'Ira' });
    } catch {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromQuery);
  else fromQuery();

  App.incomingCall = { show, hide, accept, decline, ringing: () => ringing };
})();
