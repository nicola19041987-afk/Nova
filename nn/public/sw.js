/* Ideas — solo notifiche push, nessuna cache delle pagine. asset-v=12 */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Idea ti sta chiamando';
  const body = data.body || data.reason || '';
  const url = '/?incoming=' + encodeURIComponent(data.callId || '');
  event.waitUntil(self.registration.showNotification(title, {
    body,
    lang: 'it',
    tag: 'idea-call-' + (data.callId || 'x'),
    renotify: true,
    requireInteraction: true,
    data: { url, callId: data.callId || '' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try { await c.focus(); c.postMessage({ type: 'incoming', url }); return; } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
