/* clip-compose.js — v2d-66: composizione di movimenti in chiamata.
 * Libreria MOVIMENTI separata dai pacchetti LUOGO. Un percorso è una catena di
 * segmenti con lo stesso luogo e lo stesso outfit, posa finale → posa iniziale
 * compatibile, uniti con breve dissolvenza sul lettore a doppio buffer.
 * Si dice che l'azione è fatta solo quando il primo clip della catena è davvero visibile.
 */
(function (root) {
  const ACTIONS = new Set(['stand', 'sit', 'turn', 'step-back', 'approach', 'gesture', 'idle', 'talk']);
  const ALIASES = {
    stand: 'stand', stare: 'stand', alzarsi: 'stand', 'alzati': 'stand', 'in piedi': 'stand',
    sit: 'sit', sedersi: 'sit', siediti: 'sit', seduta: 'sit', sgabello: 'sit',
    turn: 'turn', girarsi: 'turn', girati: 'turn', gira: 'turn',
    'step-back': 'step-back', indietreggiare: 'step-back', indietro: 'step-back',
    approach: 'approach', avvicinarsi: 'approach', passi: 'approach', cammina: 'approach', camminare: 'approach',
    gesture: 'gesture', gesto: 'gesture', saluto: 'gesture', saluta: 'gesture', bacio: 'gesture', risata: 'gesture',
    capelli: 'gesture', piega: 'gesture', piegarsi: 'gesture', mostra: 'gesture', vestito: 'gesture', 'mostra vestito': 'gesture',
    giro360: 'turn', 'giro 360': 'turn',
    idle: 'idle', riposo: 'idle',
    talk: 'talk', parla: 'talk', parlare: 'talk',
  };

  function normAction(s) {
    const t = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t) return '';
    if (ACTIONS.has(t)) return t;
    if (ALIASES[t]) return ALIASES[t];
    for (const [k, v] of Object.entries(ALIASES)) {
      if (t.includes(k)) return v;
    }
    return t;
  }

  function compatiblePose(endPose, startPose) {
    const a = String(endPose || '').trim() || 'stand';
    const b = String(startPose || '').trim() || 'stand';
    if (a === b) return true;
    // petto (vecchi pacchetti close-up) si tratta come stand per i tagli
    if ((a === 'petto' && (b === 'stand' || b === 'petto')) || (b === 'petto' && (a === 'stand' || a === 'petto'))) return true;
    return false;
  }

  function asClip(c, lib) {
    if (!c) return null;
    const id = String(c.id || '');
    const url = c.url || (c.file ? '/api/' + (lib === 'movement' ? 'movements/' : '') + c.file : '');
    return {
      id, url: c.url || url,
      library: c.library || lib || 'movement',
      place: String(c.place || ''),
      outfit: String(c.outfit || ''),
      mood: c.mood || 'neutral',
      action: normAction(c.action || (c.kind === 'parla' ? 'talk' : 'idle')),
      from: c.from || 'stand',
      to: c.to || c.from || 'stand',
      in: Number(c.in) || 0,
      out: c.out == null ? null : Number(c.out),
      kind: c.kind === 'parla' ? 'parla' : 'base',
      label: String(c.label || c.id || '').slice(0, 80),
      weight: Math.max(0.05, Math.min(10, Number(c.weight) || 1)),
    };
  }

  function library(list, lib) {
    return (Array.isArray(list) ? list : []).map((c) => asClip(c, lib)).filter((c) => c && c.id && c.url);
  }

  function sameContext(a, b) {
    return a && b && a.place === b.place && a.outfit === b.outfit && a.place && a.outfit;
  }

  // Percorso minimo (BFS) di segmenti compatibili verso un'azione richiesta.
  function plan(azione, opts) {
    const action = normAction(azione);
    const place = String((opts && opts.place) || '');
    const outfit = String((opts && opts.outfit) || '');
    const fromPose = String((opts && (opts.from || opts.fromPose)) || 'stand');
    const movements = library((opts && opts.movements) || [], 'movement');
    const location = library((opts && opts.location) || [], 'location');
    // I movimenti restano una libreria a parte: si mescolano al luogo solo se place+outfit coincidono.
    const pool = movements.concat(location).filter((c) => (!place || c.place === place) && (!outfit || c.outfit === outfit));
    if (!action) return { ok: false, reason: 'azione-mancante', path: [], action };
    if (!place || !outfit) return { ok: false, reason: 'contesto-mancante', path: [], action, place, outfit };
    const goals = pool.filter((c) => c.action === action);
    if (!goals.length) return { ok: false, reason: 'azione-assente', path: [], action, place, outfit, missing: action };

    // BFS: stato = posa corrente, arco = clip che parte da quella posa
    const byFrom = {};
    for (const c of pool) {
      const k = c.from || 'stand';
      (byFrom[k] || (byFrom[k] = [])).push(c);
    }
    const startKey = fromPose || 'stand';
    const queue = [{ pose: startKey, path: [] }];
    const seen = new Set([startKey + '|']);
    let best = null;
    while (queue.length) {
      const cur = queue.shift();
      const edges = [].concat(byFrom[cur.pose] || [], (cur.pose === 'stand' ? byFrom.petto : []) || [], (cur.pose === 'petto' ? byFrom.stand : []) || []);
      const uniq = [];
      const used = new Set();
      for (const e of edges) { if (!used.has(e.id)) { used.add(e.id); uniq.push(e); } }
      for (const clip of uniq) {
        if (cur.path.some((p) => p.id === clip.id)) continue; // no loops
        if (!compatiblePose(cur.pose, clip.from)) continue;
        const next = cur.path.concat([clip]);
        if (clip.action === action) {
          if (!best || next.length < best.path.length) best = { ok: true, action, place, outfit, path: next };
          continue;
        }
        const key = (clip.to || clip.from || 'stand') + '|' + next.map((p) => p.id).join(',');
        if (seen.has(key) || next.length > 6) continue;
        seen.add(key);
        queue.push({ pose: clip.to || clip.from || 'stand', path: next });
      }
    }
    if (best) return best;
    return { ok: false, reason: 'nessun-percorso', path: [], action, place, outfit, missing: action };
  }

  function report(opts) {
    const movements = library((opts && opts.movements) || [], 'movement');
    const location = library((opts && opts.location) || [], 'location');
    const all = movements.concat(location);
    const byPlace = {};
    for (const c of all) {
      const k = (c.place || '?') + '|' + (c.outfit || '?');
      (byPlace[k] || (byPlace[k] = { place: c.place, outfit: c.outfit, actions: new Set(), clips: [] })).actions.add(c.action);
      byPlace[k].clips.push(c.id);
    }
    const wanted = ['idle', 'talk', 'stand', 'sit', 'turn', 'step-back', 'approach', 'gesture'];
    const out = [];
    for (const row of Object.values(byPlace)) {
      const have = [...row.actions];
      out.push({
        place: row.place,
        outfit: row.outfit,
        composable: have,
        missing: wanted.filter((a) => !row.actions.has(a)),
        clips: row.clips,
      });
    }
    return out;
  }

  async function play(planned) {
    if (!planned || !planned.ok || !planned.path || !planned.path.length) return false;
    const P = (typeof App !== 'undefined' && App.motionPlayer) || null;
    if (!P || !P.playSequence) return false;
    try {
      const ok = await P.playSequence(planned.path);
      if (ok && typeof App !== 'undefined' && App.motionMemory && App.motionMemory.record) {
        planned.path.forEach((c) => App.motionMemory.record(c));
      }
      return !!ok;
    } catch { return false; }
  }


  async function load() {
    try {
      if (typeof App === 'undefined' || !App.api) return [];
      const r = await App.api('/api/movements');
      const list = (r && Array.isArray(r.clips)) ? r.clips : (Array.isArray(r) ? r : []);
      api._movements = library(list, 'movement');
      return api._movements;
    } catch { api._movements = []; return []; }
  }
  const api = { ACTIONS, normAction, compatiblePose, library, plan, report, play, asClip, load, _movements: [] };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ClipCompose = api;
  if (typeof App !== 'undefined') App.compose = api;
  if (typeof document !== 'undefined') {
    const bootLoad = () => { if (typeof App !== 'undefined' && App.api) load(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootLoad);
    else bootLoad();
  }
})(typeof window !== 'undefined' ? window : globalThis);
