// v2d-66: memoria dei gesti — solo metadati e conteggi d'uso, niente file media.
// I clip del catalogo luogo sono protetti; si eliminano prima chi non è mai stato usato.
'use strict';

const CAP = 80;
const URL_RE = /^\/api\/(locations\/[a-z0-9_-]+|movements)\/[a-zA-Z0-9._-]+\.mp4$/;

function allowedUrl(url, catalog) {
  if (typeof url !== 'string' || !URL_RE.test(url)) return false;
  if (catalog && typeof catalog.has === 'function') return catalog.has(url);
  if (Array.isArray(catalog)) return catalog.includes(url);
  return true;
}

function evict(clips, opts = {}) {
  const cap = Math.max(1, Number(opts.cap) || CAP);
  const catalog = opts.catalog || new Set();
  const isProtected = (url) => (catalog.has ? catalog.has(url) : false);
  const out = { ...(clips && typeof clips === 'object' && !Array.isArray(clips) ? clips : {}) };
  for (const url of Object.keys(out)) {
    if (!allowedUrl(url, opts.allowAll ? null : catalog)) delete out[url];
  }
  const over = () => Object.keys(out).length > cap;
  while (over()) {
    const keys = Object.keys(out);
    const evictable = keys.filter((u) => !isProtected(u));
    const pool = evictable.length ? evictable : keys; // solo se il catalogo stesso sfora il cap
    pool.sort((a, b) => {
      const A = out[a] || {}, B = out[b] || {};
      const ca = Number(A.playCount) || 0, cb = Number(B.playCount) || 0;
      if (ca !== cb) return ca - cb; // mai usati (0) prima
      const ta = Date.parse(A.lastPlayedAt || A.firstPlayedAt || 0) || 0;
      const tb = Date.parse(B.lastPlayedAt || B.firstPlayedAt || 0) || 0;
      return ta - tb;
    });
    if (!pool.length) break;
    delete out[pool[0]];
  }
  return out;
}

function boostWeight(base, playCount) {
  const w = Math.max(0.05, Number(base) || 1);
  const n = Math.max(0, Number(playCount) || 0);
  return w * (1 + Math.log1p(n));
}

function recordPlay(clips, url, at) {
  const now = at || new Date().toISOString();
  const cur = { ...(clips && typeof clips === 'object' && !Array.isArray(clips) ? clips : {}) };
  const e = cur[url] ? { ...cur[url] } : { playCount: 0, firstPlayedAt: now };
  e.playCount = (Number(e.playCount) || 0) + 1;
  e.lastPlayedAt = now;
  if (!e.firstPlayedAt) e.firstPlayedAt = now;
  cur[url] = e;
  return cur;
}

module.exports = { CAP, URL_RE, allowedUrl, evict, boostWeight, recordPlay };
