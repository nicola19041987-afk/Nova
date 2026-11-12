// Service worker: mette in cache solo la "scocca" dell'app (nessun dato privato).
const CACHE = 'app-privata-v2d-29';
const SHELL = ['/', '/index.html', '/style.css', '/avatar.js', '/js/motion-lib.js', '/js/live-motion.js', '/js/core.js', '/js/simli.js', '/js/auth.js', '/js/account.js', '/js/chat.js', '/js/voice-note.js', '/js/voice.js', '/js/editor.js', '/js/docs.js', '/js/media.js', '/js/feed.js', '/js/motion.js', '/js/stage.js', '/js/gestures.js', '/js/actions.js', '/js/realtime.js', '/js/rt-worklet.js', '/js/callmic.js', '/js/diag.js', '/js/call.js', '/js/ios.js', '/js/gallery.js', '/js/presets.js', '/js/sight.js', '/js/solo.js', '/js/mood.js', '/js/support.js', '/js/close.js', '/js/archive.js', '/js/frame.js', '/js/live.js', '/js/look-parse.js', '/js/avatar-look.js', '/js/main.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-180.png'];

self.addEventListener('install', (e) => {
  // v8.4.5: la nuova versione si attiva subito SOLO alla prima installazione; negli aggiornamenti aspetta che la pagina
  // dica che è libera (nessuna chiamata, nessuna voce in corso). La pagina non viene MAI ricaricata da sola.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => { if (!self.registration.active) return self.skipWaiting(); }));
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.searchParams.get('refresh') === '2d' || url.searchParams.get('refresh') === '2d-face' || url.searchParams.get('refresh') === '2d-see' || url.searchParams.get('refresh') === '2d-6' || url.searchParams.get('refresh') === '2d-7' || url.searchParams.get('refresh') === '2d-8' || url.searchParams.get('refresh') === '2d-9' || url.searchParams.get('refresh') === '2d-10' || url.searchParams.get('refresh') === '2d-11' || url.searchParams.get('refresh') === '2d-12' || url.searchParams.get('refresh') === '2d-13' || url.searchParams.get('refresh') === '2d-14' || url.searchParams.get('refresh') === '2d-15' || url.searchParams.get('refresh') === '2d-16' || url.searchParams.get('refresh') === '2d-17' || url.searchParams.get('refresh') === '2d-18' || url.searchParams.get('refresh') === '2d-19' || url.searchParams.get('refresh') === '2d-20' || url.searchParams.get('refresh') === '2d-21' || url.searchParams.get('refresh') === '2d-22' || url.searchParams.get('refresh') === '2d-23' || url.searchParams.get('refresh') === '2d-24' || url.searchParams.get('refresh') === '2d-25' || url.searchParams.get('refresh') === '2d-26' || url.searchParams.get('refresh') === '2d-27' || url.searchParams.get('refresh') === '2d-28') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/vendor/')) return; // vendor: grandi file, gestiti dalla cache HTTP // API e dati privati: sempre dalla rete, mai in cache
  // rete prima, cache come riserva offline. v8: se la rete è lentissima (>5 s) e c'è una copia in cache, usa quella;
  // la pagina di riserva (index.html) solo per le navigazioni, non per script o immagini.
  e.respondWith((async () => {
    const net = fetch(e.request).then((r) => {
      if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
      return r;
    });
    net.catch(() => {});
    const cached = () => caches.match(e.request, { ignoreSearch: true });
    try {
      return await Promise.race([net, new Promise((ok, ko) => setTimeout(() => cached().then((r) => (r ? ok(r) : net.then(ok, ko))), 5000))]);
    } catch {
      const r = await cached();
      if (r) return r;
      if (e.request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return Response.error();
    }
  })());
});
