/* v2d-67: iscrizione Web Push per «Ira ti chiama». La chiave privata VAPID sta solo sul server. */
(function () {
  if (window.__novaPushBound) return;
  window.__novaPushBound = true;
  if (!window.App) return;
  const App = window.App;

  function b64urlToUint8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function config() {
    try { return await App.api('/api/push/config'); } catch { return { enabled: false, publicKey: '' }; }
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.Notification) return { ok: false, reason: 'non-supportato' };
    const cfg = await config();
    if (!cfg || !cfg.enabled || !cfg.publicKey) return { ok: false, reason: 'push-disabilitato' };
    if (Notification.permission === 'denied') return { ok: false, reason: 'negato' };
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, reason: 'negato' };
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToUint8(cfg.publicKey),
    });
    const body = sub.toJSON ? sub.toJSON() : { endpoint: sub.endpoint, keys: {} };
    const r = await App.api('/api/push/subscribe', { method: 'POST', body });
    return r && r.ok ? { ok: true } : { ok: false, reason: 'server' };
  }

  async function enableIfGranted() {
    if (!window.Notification || Notification.permission !== 'granted') return { ok: false, reason: 'no-permesso' };
    try { return await subscribe(); } catch { return { ok: false, reason: 'errore' }; }
  }

  App.push = { config, subscribe, enableIfGranted };
})();
