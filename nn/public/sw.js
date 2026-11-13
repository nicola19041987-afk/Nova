/* Ideas — solo notifiche push, nessuna cache delle pagine. asset-v=13 */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'skipWaiting') self.skipWaiting(); });
function clearIconBadge() {
  try { if (self.registration.clearAppBadge) return self.registration.clearAppBadge(); } catch {}
  return Promise.resolve();
}
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'Idea ti sta chiamando';
  const body = data.body || data.reason || '';
  const url = '/?incoming=' + encodeURIComponent(data.callId || '');
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      lang: 'it',
      tag: 'idea-call-' + (data.callId || 'x'),
      renotify: true,
      requireInteraction: true,
      data: { url, callId: data.callId || '' },
    });
    // I browser possono mettere da soli un numerino sull'icona: lo togliamo, la notifica resta.
    await clearIconBadge();
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    await clearIconBadge();
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try { await c.focus(); c.postMessage({ type: 'incoming', url }); return; } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
