// Service worker: mette in cache solo la "scocca" dell'app (nessun dato privato).
const CACHE = 'app-privata-v3';
const SHELL = ['/', '/index.html', '/style.css', '/avatar.js', '/js/core.js', '/js/auth.js', '/js/account.js', '/js/chat.js', '/js/voice.js', '/js/editor.js', '/js/docs.js', '/js/media.js', '/js/feed.js', '/js/live.js', '/js/main.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/vendor/')) return; // vendor: grandi file, gestiti dalla cache HTTP // API e dati privati: sempre dalla rete, mai in cache
  // rete prima, cache come riserva offline
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
