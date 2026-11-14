'use strict';
/* net.js — v2d-36: movimento «secondo la connessione». Nicola: «i video si bloccano» (iPhone, rete lenta).
   Misura la velocità reale sui clip scaricati (Resource Timing) e guarda navigator.connection:
   - 'std'   : clip normali (540x960, ~600 kbps)
   - 'lite'  : clip leggeri (360x640, ~260 kbps) se il look li ha
   - 'still' : niente clip, la foto con un respiro leggerissimo (mai un fermo immagine)
   Durante la sessione si scende soltanto (niente su e giù). Per i test: App.ls 'netMode' = std|lite|still. */
(function (root) {
  const ORDER = ['std', 'lite', 'still'];
  const S = { mode: 'std', kbps: 0, samples: 0, fails: 0, why: '' };
  const conn = () => (root.navigator && root.navigator.connection) || null;
  function forced() { try { const m = root.App && App.ls && App.ls.get('netMode', ''); return ORDER.includes(m) ? m : ''; } catch { return ''; } }
  function down(to, why) { if (ORDER.indexOf(to) > ORDER.indexOf(S.mode)) { S.mode = to; S.why = why; try { root.dispatchEvent(new CustomEvent('nova-net', { detail: { mode: to, why } })); } catch { /* */ } } }
  function fromConnection() {
    const c = conn(); if (!c) return;
    const et = String(c.effectiveType || '');
    if (/(^|-)2g$/.test(et)) down('still', 'rete ' + et);
    else if (c.saveData || et === '3g' || (c.downlink && c.downlink < 1.2)) down('lite', c.saveData ? 'risparmio dati' : 'rete ' + (et || c.downlink + ' Mbps'));
  }
  function sample(bytes, ms) {
    if (!(bytes > 40000) || !(ms > 30)) return; // file piccoli o dalla cache: non dicono niente
    const k = (bytes * 8) / ms; // kbit/s
    S.kbps = S.samples ? S.kbps * 0.6 + k * 0.4 : k; S.samples++;
    if (S.samples >= 2 && S.kbps < 450) down('still', Math.round(S.kbps) + ' kbps');
    else if (S.kbps < 1600) down('lite', Math.round(S.kbps) + ' kbps');
  }
  function observe() {
    if (!root.PerformanceObserver) return;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!/\/api\/motion\//.test(e.name)) continue;
          const bytes = e.encodedBodySize || e.transferSize || 0;
          sample(bytes, e.responseEnd - e.responseStart);
        }
      }).observe({ type: 'resource', buffered: true });
    } catch { /* */ }
  }
  const api = {
    mode() { return forced() || S.mode; },
    info() { return { ...S, mode: api.mode() }; },
    stall() { S.fails++; if (S.fails >= 2) down(S.mode === 'std' ? 'lite' : 'still', 'clip lenti a partire'); },
    sample, down, reset() { S.mode = 'std'; S.kbps = 0; S.samples = 0; S.fails = 0; S.why = ''; fromConnection(); },
    // sceglie i clip del look per la qualità attuale: con 'lite' solo i leggeri (se ci sono), con 'std' mai i leggeri
    pick(lib) {
      const m = api.mode();
      if (m === 'still') return [];
      const lite = lib.filter((c) => c.quality === 'lite'), std = lib.filter((c) => c.quality !== 'lite');
      if (m === 'lite' && lite.length >= 2) return lite;
      return std.length ? std : lite;
    },
  };
  fromConnection();
  try { const c = conn(); if (c && c.addEventListener) c.addEventListener('change', fromConnection); } catch { /* */ }
  observe();
  root.NovaNet = api;
  if (root.App) root.App.net = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
