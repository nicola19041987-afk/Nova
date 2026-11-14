/* motion-graph.js — v2d-30: movimento continuo di Nova.
   Libreria di clip collegate da POSE (grafo): ogni clip parte da una posa (from) e finisce in una posa (to).
   Il clip successivo parte sempre dalla posa in cui è finito il precedente, così non ci sono salti.
   Due <video> sovrapposti: mentre uno suona, l'altro è già caricato sul primo fotogramma; alla fine si passa
   al secondo con una dissolvenza brevissima. Scelta automatica in base all'umore della risposta e agli eventi
   del discorso (starnuto, risata, saluto…). I file sono messi in cache sul telefono in anticipo. */
(function (root) {
  const HOME = 'petto'; // posa della foto: mano sul petto. Il labiale lavora su questa foto.
  const TOKEN = /^[a-z_]{1,24}$/;
  const tok = (v, d) => { const s = String(v || '').toLowerCase().trim(); return TOKEN.test(s) ? s : d; };

  // Umori dei tag [umore:…] dell'IA -> famiglia di movimento.
  const MOOD_FAMILY = {
    allegra: 'allegra', maliziosa: 'allegra', sorpresa: 'vivace', vivace: 'vivace', giocosa: 'allegra', felice: 'allegra',
    tenera: 'affettuosa', affettuosa: 'affettuosa', dolce: 'affettuosa',
    pensierosa: 'pensierosa', seria: 'calma', triste: 'pensierosa', offesa: 'calma', calma: 'calma', stanca: 'calma',
  };
  // Clip di "carattere" vivace sono buoni anche per allegra e viceversa.
  const MOOD_NEAR = { allegra: ['vivace'], vivace: ['allegra'], affettuosa: ['calma'], pensierosa: ['calma'], calma: ['pensierosa', 'affettuosa'] };

  function moodFromText(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return null;
    const tag = /\[umore:\s*([a-zà-ù]+)\s*\]/i.exec(t);
    if (tag && MOOD_FAMILY[tag[1]]) return MOOD_FAMILY[tag[1]];
    const n = (re) => (t.match(re) || []).length;
    const happy = n(/ahah|haha|ihih|😂|🤣|😄|😁|😆|😜|😉|evviva|che bello|fantastic|divertent|scherz/g) + (n(/!/g) >= 2 ? 1 : 0);
    const love = n(/❤|💕|😘|🥰|tesoro|amore|caro|cara|abbracci|coccol|ti voglio bene|dolcezza/g);
    const think = n(/\bforse\b|\bpenso\b|\bcredo\b|chissà|mmm|\bboh\b|riflett|\bdipende\b|🤔|\bdubbi/g) + (n(/\?/g) >= 2 ? 1 : 0);
    const sad = n(/mi dispiace|triste|😢|😔|purtroppo|che peccato/g);
    const best = [['allegra', happy], ['affettuosa', love], ['pensierosa', think + sad]].sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'calma';
  }

  // Eventi del discorso -> clip speciale che suona una volta e poi si torna alla base.
  const EVENTS = [
    ['starnuto', /etci[uù]|starnut|🤧/],
    ['tosse', /\btossisc|\bcolpo di tosse|\bcoff\b|\bcough/],
    ['ride', /ahah+|haha+|😂|🤣|\bride(re)?\b|\brisata|mi fai ridere|scoppio a ridere/],
    ['saluta', /👋|\bti saluto\b|\bsaluta(mi)?\b|\bciao ciao\b|\bbuonanotte\b|\ba domani\b/],
    ['annuisce', /\bannuisc|\bsì sì\b|\besatto\b|\bcerto che sì\b/],
    ['nega', /\bscuote la testa\b|\bno no\b|\bassolutamente no\b/],
    ['sbadiglio', /sbadigl|🥱|\bche sonno\b/],
    ['occhiolino', /😉|\bocchiolino\b|\bammicc/],
    ['bacio', /😘|\bbacio\b|\bbacino\b|\bbaci\b/],
    ['capelli', /\bcapelli\b|\bciocca\b|\bpettin/],
    ['pensa', /🤔|\bfammi pensare\b|\bci penso\b/],
    ['applaude', /👏|\bapplaus|\bbrav[ao]!/],
    ['spalle', /🤷|\balzo le spalle\b|\bchi lo sa\b|\bboh\b/],
  ];
  const GESTURE_EVENT = { spiega: 'spiega', annuisce: 'annuisce', ride: 'ride', saluta: 'saluta', nega: 'nega', ammicca: 'occhiolino', pensa: 'pensa', sorride: null, inclina: null };
  function eventFromText(text) {
    const t = String(text || '').toLowerCase();
    const g = /\[gesto:\s*([a-zà-ù_]+)\s*\]/i.exec(t);
    if (g && GESTURE_EVENT[g[1]]) return GESTURE_EVENT[g[1]];
    for (const [ev, re] of EVENTS) if (re.test(t)) return ev;
    return null;
  }

  // Normalizza la libreria del personaggio. Compatibile con il vecchio campo motionVideo (un solo clip petto->petto).
  const URL_RE = /^\/api\/motion\/[a-f0-9]{16}\.mp4$/;
  // v2d-33: outfit = chiave del look attuale (vestito, capelli, trucco). Ogni look ha i suoi clip (campo outfit del clip);
  // i clip senza outfit sono quelli della foto di base. Senza secondo argomento: tutti i clip (come prima).
  function libraryOf(ch, outfit) {
    const out = [];
    const want = outfit === undefined ? null : tok(outfit, '');
    const seen = new Set();
    const list = (ch && Array.isArray(ch.motionClips)) ? ch.motionClips : [];
    for (const c of list) {
      if (!c || !URL_RE.test(String(c.url || ''))) continue;
      if (want !== null && tok(c.outfit, '') !== want) continue;
      const key = [c.url, c.kind, c.event, c.from, c.to].join('|'); // lo stesso file può servire da base e da evento
      if (seen.has(key)) continue;
      seen.add(key);
      const kind = ['base', 'move', 'event', 'parla'].includes(c.kind) ? c.kind : 'base';
      const from = tok(c.from, HOME), to = tok(c.to, from);
      out.push({ id: String(c.id || key), url: c.url, from, to, kind: kind === 'base' && from !== to ? 'move' : kind,
        mood: (Array.isArray(c.mood) ? c.mood : [c.mood]).map((m) => tok(m, '')).filter(Boolean),
        event: tok(c.event, ''), outfit: tok(c.outfit, ''), weight: Math.max(0.05, Math.min(10, Number(c.weight) || 1)), label: String(c.label || '').slice(0, 60) });
    }
    if (!out.length && !want && ch && URL_RE.test(String(ch.motionVideo || ''))) {
      out.push({ id: 'legacy', url: ch.motionVideo, from: HOME, to: HOME, kind: 'base', mood: [], event: '', weight: 1, label: 'idle' });
    }
    return out;
  }
  // v2d-35: movimento «da videochiamata vera». Se il look ha almeno 2 clip calmi (respiro, cenni, testa inclinata) dalla
  // posa della foto, a riposo suonano SOLO quelli; i gesti delle mani diventano eventi, legati al discorso (risata, saluto,
  // «ci penso»…), al massimo uno ogni EVENT_GAP_MS. I clip che partono o finiscono in un'altra posa (braccia ai fianchi,
  // conserte…) si tolgono: niente percorsi strani quando sta per parlare. Senza 2 clip calmi la libreria resta com'era.
  const GESTURE_RE = /gesticol|mani avanti|palmi|braccia|braccio|mano tesa|fianch|conserte|\banca\b|capelli|starnut|saluta|risata|tempia|mento|invit|ciocca|\bdita\b/i;
  const EVENT_OF = [[/risata|ride/i, 'ride'], [/saluta/i, 'saluta'], [/starnut/i, 'starnuto'], [/capelli|ciocca/i, 'capelli'], [/pensa|mento|tempia/i, 'pensa'], [/gesticol|mani avanti|palmi|mano tesa|invit|spiega/i, 'spiega']];
  const EVENT_GAP_MS = 30000;
  function isGesture(c) { return c.kind === 'event' || GESTURE_RE.test(c.label || ''); }
  function calmLibrary(lib) {
    const home = lib.filter((c) => c.from === HOME && c.to === HOME);
    const calm = home.filter((c) => c.kind === 'base' && !isGesture(c));
    if (calm.length < 2) return lib;
    const out = calm.slice();
    for (const c of home) {
      if (c.kind === 'parla') { out.push(c); continue; }
      if (!isGesture(c)) continue;
      const ev = c.kind === 'event' && c.event ? c.event : (EVENT_OF.find(([re]) => re.test(c.label || '')) || [])[1];
      if (ev) out.push({ ...c, kind: 'event', event: ev });
    }
    out.calm = true;
    return out;
  }
  function poses(lib) { const s = new Set([HOME]); for (const c of lib) { s.add(c.from); s.add(c.to); } return [...s]; }

  // Percorso più breve (in numero di clip) tra due pose, usando base/move.
  function pathStep(lib, from, target) {
    if (from === target) return null;
    const edges = lib.filter((c) => (c.kind === 'move' || c.kind === 'base') && c.from !== c.to);
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const p = q.shift();
      if (p === target) break;
      for (const e of edges) if (e.from === p && !prev.has(e.to)) { prev.set(e.to, p); q.push(e.to); }
    }
    if (!prev.has(target)) return null;
    let n = target; while (prev.get(n) !== from) n = prev.get(n);
    return n; // prima posa da raggiungere
  }

  function rnd(r) { return typeof r === 'function' ? r() : Math.random(); }
  // v2d-34: mai lo stesso clip due volte di fila né tra gli ultimi scelti (niente «tic»): se ci sono alternative,
  // i clip usati di recente sono esclusi (2-3 clip: mai lo stesso di fila; 4: mai tra gli ultimi 2; 5+: ultimi 3),
  // lasciando sempre almeno due scelte quando ci sono: niente giro fisso sempre uguale.
  function fresh(cands, st) {
    const recent = (st && st.recent) || [];
    const keep = cands.length < 2 ? 0 : Math.min(3, Math.max(1, cands.length - 2));
    if (keep <= 0) return cands;
    const ban = new Set(recent.slice(0, keep));
    const ok = cands.filter((c) => !ban.has(c.id));
    return ok.length ? ok : cands;
  }
  function weighted(cands, wf, r, pool) {
    if (pool && pool.length) cands = pool;
    const ws = cands.map(wf); const sum = ws.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return cands[0] || null;
    let x = rnd(r) * sum;
    for (let i = 0; i < cands.length; i++) { x -= ws[i]; if (x <= 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  function createState() { return { pose: HOME, recent: [], dwell: 0, event: null, eventUntil: 0, mood: 'calma', moodUntil: 0 }; }

  // Sceglie il prossimo clip. opts: { now, home (tornare alla foto), talk (clip di parlato ammessi), rand }
  function pickNext(lib, st, opts = {}) {
    const now = Number(opts.now) || 0;
    const r = opts.rand;
    const pose = st.pose || HOME;
    const mood = now < (st.moodUntil || 0) ? st.mood : 'calma';
    if (st.event && now > (st.eventUntil || 0)) st.event = null;
    const usable = lib.filter((c) => c.kind !== 'parla' || opts.talk);
    // 1) evento richiesto dal discorso
    if (st.event && !opts.home) {
      const ev = usable.filter((c) => c.kind === 'event' && c.event === st.event);
      const here = ev.filter((c) => c.from === pose);
      if (here.length) { st.event = null; return { clip: weighted(here, (c) => c.weight, r), why: 'evento' }; }
      if (ev.length) {
        const hop = pathStep(usable, pose, ev[0].from);
        if (hop) { const c = weighted(usable.filter((x) => x.from === pose && x.to === hop && x.kind !== 'event'), (x) => x.weight, r); if (c) return { clip: c, why: 'verso-evento' }; }
      } else st.event = null; // nessun clip per questo evento
    }
    // 2) sta per parlare: si torna alla posa della foto (labiale)
    if (opts.home && pose !== HOME) {
      const hop = pathStep(usable, pose, HOME);
      if (hop) { const c = weighted(usable.filter((x) => x.from === pose && x.to === hop && x.kind !== 'event'), (x) => x.weight, r); if (c) return { clip: c, why: 'verso-foto' }; }
    }
    // 3) base: movimenti dalla posa attuale, pesati per umore, senza ripetere, cambiando posa ogni tanto
    let cands = usable.filter((c) => c.from === pose && c.kind !== 'event' && (opts.talk ? true : c.kind !== 'parla'));
    if (opts.home) { const stay = cands.filter((c) => c.to === HOME); if (stay.length) cands = stay; }
    if (opts.talk) { const t = cands.filter((c) => c.kind === 'parla'); if (t.length) cands = t; }
    if (!cands.length) {
      // posa senza uscite (libreria incompleta): qualunque clip che riporti alla foto, o qualunque base
      cands = usable.filter((c) => c.to === HOME && c.kind !== 'event');
      if (!cands.length) cands = usable.filter((c) => c.kind !== 'event');
      if (!cands.length) return { clip: null, why: 'vuota' };
    }
    const near = MOOD_NEAR[mood] || [];
    const pick = weighted(cands, (c) => {
      let w = c.weight;
      if (c.mood.includes(mood)) w *= 4; else if (c.mood.some((m) => near.includes(m))) w *= 1.8;
      if (c.kind === 'move' && c.to !== pose) w *= 1 + Math.min(4, st.dwell); // dopo un po' cambia posa: mani e braccia si spostano
      const k = st.recent.indexOf(c.id);
      if (k === 0) w *= cands.length > 1 ? 0.15 : 1; else if (k > 0) w *= 0.35;
      return w;
    }, r, fresh(cands, st));
    return { clip: pick, why: 'base:' + mood };
  }
  function commit(st, clip) {
    if (!clip) return st;
    st.dwell = clip.to === st.pose ? st.dwell + 1 : 0;
    st.pose = clip.to;
    st.recent = [clip.id, ...st.recent.filter((x) => x !== clip.id)].slice(0, 4);
    if (clip.kind === 'event') st.lastEventAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return st;
  }

  // ---------- cache dei clip (disco del telefono) + URL locali pronti ----------
  const CACHE_NAME = 'nova-motion-v1';
  const blobs = new Map(); // url -> objectURL (LRU)
  const BLOB_MAX = 6; // v2d-32: solo i clip vicini in memoria (prima 24: troppa RAM sul telefono)
  async function cached(url) {
    if (blobs.has(url)) { const u = blobs.get(url); blobs.delete(url); blobs.set(url, u); return u; }
    let res = null;
    try { if (root.caches) { const c = await caches.open(CACHE_NAME); res = await c.match(url); if (!res) { const r = await fetch(url, { credentials: 'same-origin' }); if (r.ok) { await c.put(url, r.clone()); res = r; } } } } catch { res = null; }
    if (!res) return url; // senza Cache API: il browser usa la sua cache HTTP (file immutabili)
    try {
      const b = await res.blob();
      const u = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'video/mp4' }));
      blobs.set(url, u);
      while (blobs.size > BLOB_MAX) { const [k, v] = blobs.entries().next().value; blobs.delete(k); try { URL.revokeObjectURL(v); } catch { /* */ } }
      return u;
    } catch { return url; }
  }
  // v2d-32: se il telefono non riesce a riprodurre un clip da URL locale (blob), da lì in poi si usa l'indirizzo del server
  // (cache HTTP del telefono, 30 giorni): Safari lo legge sempre, a pezzi (Range).
  // Su iPhone/iPad si parte direttamente dall'indirizzo del server: niente copia intera del video in memoria.
  const nav0 = root.navigator || {};
  const IOS = /iPad|iPhone|iPod/.test(nav0.userAgent || '') || (/Macintosh/.test(nav0.userAgent || '') && (nav0.maxTouchPoints || 0) > 1);
  const srcState = { net: IOS, ios: IOS };
  async function srcFor(url) { return srcState.net ? url : cached(url); }
  const prefetchState = { running: false, done: new Set() };
  // v2d-32: scaricamento anticipato «pigro»: parte qualche secondo dopo il primo clip, uno alla volta, con pause,
  // prima i clip della posa della foto; si ferma con l'app in secondo piano. Su iPhone non serve (si legge dal server).
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function prefetchAll(lib, opts = {}) {
    if (!root.caches || prefetchState.running || srcState.net) return;
    const nav = root.navigator || {};
    if (nav.connection && (nav.connection.saveData || /(^|-)2g$/.test(nav.connection.effectiveType || ''))) return;
    prefetchState.running = true;
    try {
      await sleep(opts.delay == null ? 4000 : opts.delay);
      const c = await caches.open(CACHE_NAME);
      const want = new Set(lib.map((x) => x.url));
      for (const req of await c.keys()) { const p = new URL(req.url).pathname; if (!want.has(p)) await c.delete(req); } // clip tolti dalla libreria
      const now = new Set((opts.first || []).map((x) => x.url)); // v2d-33: prima i clip del look attuale
      const order = [...lib].sort((a, b) => (now.has(a.url) ? 0 : 2) + (a.from === HOME ? 0 : 1) - (now.has(b.url) ? 0 : 2) - (b.from === HOME ? 0 : 1));
      for (const x of order) {
        if (srcState.net) break;
        while (root.document && root.document.hidden) await sleep(2000);
        const u = x.url;
        if (prefetchState.done.has(u)) continue;
        try { if (!(await c.match(u))) { const r = await fetch(u, { credentials: 'same-origin' }); if (r.ok) await c.put(u, r); await sleep(opts.gap == null ? 700 : opts.gap); } prefetchState.done.add(u); } catch { /* rete: riprova la prossima volta */ }
      }
    } finally { prefetchState.running = false; }
  }

  // ---------- lettore a due video ----------
  const XFADE_MS = 320;
  function createPlayer(a, b, hooks = {}) {
    const P = { els: [a, b], cur: 0, lib: [], st: createState(), on: false, playing: null, nextClip: null, raf: 0, swapping: false, log: [], hooks };
    for (const v of P.els) {
      v.muted = true; v.defaultMuted = true; v.loop = false; v.playsInline = true; v.autoplay = false; v.preload = 'auto';
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', ''); v.removeAttribute('loop');
      v.style.transition = `opacity ${XFADE_MS}ms linear`;
      v.style.background = 'transparent'; // senza fotogramma pronto si vede il video sotto, non un riquadro nero
    }
    const front = () => P.els[P.cur], back = () => P.els[1 - P.cur];
    function ready(v, ms) {
      return new Promise((ok) => {
        if (v.readyState >= 2) return ok();
        let done = false; const f = () => { if (done) return; done = true; v.removeEventListener('loadeddata', f); v.removeEventListener('error', f); ok(); };
        v.addEventListener('loadeddata', f); v.addEventListener('error', f); setTimeout(f, ms);
      });
    }
    async function load(v, clip) {
      const src = await srcFor(clip.url);
      if (v._clipId === clip.id && v.getAttribute('src') && !v.error) { await rewind(v); return; } // stesso clip: aspettare il ritorno al primo fotogramma, non mostrare l'ultimo
      v._clipId = clip.id; v._url = clip.url;
      if (P.playing) v.removeAttribute('poster'); // la foto di copertina serve solo al primo clip: dopo mostrerebbe la posa sbagliata
      v.src = src;
      try { v.load(); } catch { /* */ }
      await ready(v, 1500);
      if (!v.error && v.readyState < 2) { // iPhone: non scarica finché non si preme play. Play muto e invisibile, poi pausa.
        try { const pr = v.play(); if (pr && pr.then) await Promise.race([pr.then(() => { try { v.pause(); } catch { /* */ } }, () => {}), sleep(1500)]); } catch { /* */ }
        await ready(v, 3000);
      }
      if (v.error && src !== clip.url) { // v2d-32: blob non riproducibile -> indirizzo del server, da qui in poi per tutti i clip
        srcState.net = true;
        v.src = clip.url; try { v.load(); } catch { /* */ }
        await ready(v, 4000);
      }
      await rewind(v);
    }
    // Riporta il video al primo fotogramma e aspetta che sia davvero lì (niente fotogramma vecchio durante la dissolvenza).
    function rewind(v) {
      return new Promise((ok) => {
        if (!(v.currentTime > 0.001)) return ok();
        let done = false; const f = () => { if (done) return; done = true; v.removeEventListener('seeked', f); ok(); };
        v.addEventListener('seeked', f); setTimeout(f, 1200);
        try { v.currentTime = 0; } catch { f(); }
      });
    }
    // v2d-32: iPhone. Senza un tocco (o con «Risparmio energetico») Safari può rifiutare play() anche ai video muti:
    // si ricorda il blocco, si riprova con calma e al primo tocco nella pagina P.unlock() sblocca i due video per sempre.
    function playSafe(v) {
      let pr; try { pr = v.play(); } catch (err) { pr = Promise.reject(err); }
      if (!(pr && pr.then)) return Promise.resolve();
      return pr.then(() => { P.blocked = false; }, (err) => { if (err && err.name === 'NotAllowedError') P.blocked = true; });
    }
    P.unlock = () => {
      for (const v of P.els) {
        if (v._unlocked && !P.blocked) continue;
        v._unlocked = true;
        if (!v.paused) continue;
        const live = P.on && P.playing && v === front();
        let pr; try { pr = v.play(); } catch { pr = null; } // dentro il tocco: Safari toglie il blocco a questo video
        if (pr && pr.catch) pr.catch(() => {});
        if (!live) { try { v.pause(); if (v.getAttribute('src')) v.currentTime = 0; } catch { /* */ } }
      }
      P.blocked = false;
    };
    async function prepareNext() {
      const opts = { now: performance.now(), home: !!(hooks.wantHome && hooks.wantHome()), talk: !!(hooks.talkClips && hooks.talkClips()) };
      const probe = Object.assign({}, P.st, { recent: P.st.recent.slice() });
      const { clip, why } = pickNext(P.lib, probe, opts);
      if (!clip) { P.nextClip = null; return; }
      P.st.event = probe.event; // un evento usato viene consumato
      P.nextClip = clip; P.nextWhy = why; P.nextHome = opts.home;
      await load(back(), clip);
    }
    // v2d-34: pronto = fotogramma decodificato, nessun errore, e il tempo del video avanza (non solo «play» chiamato)
    function playable(v, ms) {
      return new Promise((ok) => {
        const t0 = performance.now(), c0 = v.currentTime;
        const chk = () => {
          if (v.error) return ok(false);
          if (v.readyState >= 2 && !v.paused && v.currentTime > c0 + 0.02) return ok(true);
          if (performance.now() - t0 > ms) return ok(false);
          if (v.paused && performance.now() - t0 > 400) playSafe(v).catch(() => {});
          setTimeout(chk, 50);
        };
        chk();
      });
    }
    async function swap() {
      if (P.swapping || performance.now() < (P._holdUntil || 0)) return; P.swapping = true;
      try {
        const homeNow = !!(hooks.wantHome && hooks.wantHome());
        if (!P.nextClip || P.nextHome !== homeNow) await prepareNext();
        const clip = P.nextClip; if (!clip || !P.on) return;
        const nv = back(), ov = front();
        const first = !P.playing && !(ov && !ov.paused && Number(ov.style.opacity) > 0);
        if (nv._clipId !== clip.id) await load(nv, clip);
        nv.hidden = false; nv.style.opacity = '0'; nv.style.zIndex = '4'; ov.style.zIndex = '3';
        playSafe(nv).catch(() => {});
        // dissolvenza dopo il primo fotogramma vero, non prima
        await new Promise((ok) => { let done = false; const f = () => { if (done) return; done = true; ok(); }; if (nv.requestVideoFrameCallback) nv.requestVideoFrameCallback(f); else nv.addEventListener('playing', f, { once: true }); setTimeout(f, 600); });
        // v2d-34: il clip nuovo entra solo quando suona davvero (fotogramma pronto e tempo che avanza). Prima, su iPhone
        // con la rete lenta, entrava un video ancora vuoto (trasparente) e si vedeva il fondo bianco, poi tutto fermo.
        // Se non è pronto: resta l'immagine attuale, il clip viene ricaricato e si riprova tra poco.
        if (!(await playable(nv, 2500)) || !P.on) {
          try { nv.pause(); } catch { /* */ }
          nv.style.opacity = '0'; nv.style.zIndex = '3'; ov.style.zIndex = '4';
          nv._clipId = null; P.nextClip = null; P._holdUntil = performance.now() + 700;
          P.notReady = (P.notReady || 0) + 1;
          P.log.push({ at: Math.round(performance.now()), id: clip.id, notReady: true, rs: nv.readyState });
          if (P.log.length > 60) P.log.shift();
          if (P.notReady >= 3 && !srcState.net) srcState.net = true;
          return;
        }
        P.notReady = 0;
        if (first) { // primo clip: subito pieno (sotto la foto è già nascosta), niente dissolvenza su fondo vuoto
          nv.style.transition = 'none'; nv.style.opacity = '1'; void nv.offsetWidth;
          requestAnimationFrame(() => { nv.style.transition = `opacity ${XFADE_MS}ms linear`; });
        } else nv.style.opacity = '1';
        P.cur = 1 - P.cur; P.playing = clip;
        commit(P.st, clip);
        P.log.push({ at: Math.round(performance.now()), id: clip.id, from: clip.from, to: clip.to, why: P.nextWhy, t0: Math.round((nv.currentTime || 0) * 1000), poster: nv.hasAttribute('poster') });
        if (P.log.length > 60) P.log.shift();
        if (hooks.onClip) hooks.onClip(clip, P.nextWhy);
        P.nextClip = null;
        // Il video vecchio si tocca solo a dissolvenza finita: caricarci subito il clip seguente mostrava un fotogramma vuoto o sbagliato.
        await new Promise((ok) => setTimeout(ok, XFADE_MS + 40));
        if (front() !== ov) { try { ov.pause(); } catch { /* */ } ov.style.opacity = '0'; }
        if (!P.nextClip) prepareNext().catch(() => {});
      } finally { P.swapping = false; }
    }
    function loop() {
      P.raf = 0;
      if (!P.on) return;
      const v = front();
      const d = v.duration;
      const t = performance.now();
      // v2d-32: guardiano. Se il video davanti non avanza per 1 s si riprova play(); dopo 2,5 s si passa al clip dopo.
      // Tre blocchi di fila con i blob -> indirizzo del server; sei di fila -> si lascia la foto e si riprova tra 20 s.
      if (P.playing && !P.swapping) {
        if (v.currentTime !== P._wt) { P._wt = v.currentTime; P._wAt = t; if (v.currentTime > 0.3) P.stalls = 0; }
        else if (!P.blocked && t - (P._wAt || t) > 1000 && t - (P._retry || 0) > 600) { P._retry = t; if (v.paused || v.readyState < 3) playSafe(v); }
        if (!P.blocked && t - (P._wAt || t) > 2500) {
          P.stalls = (P.stalls || 0) + 1; P._wAt = t; P.log.push({ at: Math.round(t), id: P.playing.id, stall: true });
          if (P.stalls >= 3 && !srcState.net) srcState.net = true;
          v._clipId = null; // la prossima volta si ricarica da capo (niente src tolto qui: sarebbe un fotogramma nero)
          if (P.stalls >= 6) { P.stop(); P.pausedUntil = t + 20000; if (hooks.onFail) hooks.onFail(); return; }
          P.playing = null;
        }
      } else { P._wAt = t; P._wt = -1; }
      // v2d-32: un clip appena partito può non avere ancora la durata (iPhone carica solo al play): si aspetta, non si
      // passa al clip dopo a ogni fotogramma. Se dopo 5 s non c'è ancora, si prova il successivo.
      if (P.playing && !(isFinite(d) && d > 0)) { if (!P._waitAt) P._waitAt = t; if (t - P._waitAt > 5000) { P._waitAt = 0; P.playing = null; } }
      else P._waitAt = 0;
      if (!P.playing) swap().catch(() => {});
      else if (!(isFinite(d) && d > 0)) { if (v.paused && !P.swapping && t - (P._retry || 0) > 1000) { P._retry = t; playSafe(v).catch(() => {}); } }
      else if (v.ended || v.currentTime >= d - (XFADE_MS / 1000) - 0.05) swap().catch(() => {});
      else if (v.paused && !P.swapping && (!P.blocked || t - (P._retry || 0) > 1000)) { P._retry = t; playSafe(v).catch(() => {}); }
      P.raf = requestAnimationFrame(loop);
    }
    // all = libreria completa (tutti i look): resta tutta in cache sul telefono, si suonano solo i clip di lib (look attuale).
    P.setLibrary = (lib, all) => {
      const key = lib.map((c) => c.id + c.from + c.to + c.kind).join('|');
      if (key === P._libKey) return; P._libKey = key; P.lib = lib;
      if (!lib.some((c) => c.from === P.st.pose)) P.st.pose = HOME;
      P.nextClip = null;
      prefetchAll(all && all.length ? all : lib, { first: lib }).catch(() => {});
    };
    P.start = (fromPose) => {
      if (P.on || performance.now() < (P.pausedUntil || 0)) return;
      P.stalls = 0;
      if (fromPose) P.st.pose = fromPose;
      P.on = true; P.playing = null; P.nextClip = null; P.cur = 1; // il primo clip va nel primo video
      for (const v of P.els) v.style.opacity = '0';
      if (!P.raf) P.raf = requestAnimationFrame(loop);
    };
    P.stop = () => {
      P.on = false; if (P.raf) { cancelAnimationFrame(P.raf); P.raf = 0; }
      for (const v of P.els) { try { v.pause(); } catch { /* */ } v.style.opacity = '0'; }
      P.playing = null; P.nextClip = null;
    };
    P.mood = (m, ms = 60000) => { const f = MOOD_FAMILY[m] || (TOKEN.test(m || '') ? m : null); if (!f) return; if (f !== P.st.mood && !P.swapping) P.nextClip = null; /* il prossimo clip segue subito il nuovo umore */ P.st.mood = f; P.st.moodUntil = performance.now() + ms; };
    P.event = (e, ms = 25000) => { if (!e) return; if (P.lib && P.lib.calm && performance.now() - (P.st.lastEventAt || -1e9) < EVENT_GAP_MS) return; /* v2d-35: gesti rari */ P.st.event = e; P.st.eventUntil = performance.now() + ms; P.nextClip = null; };
    return P;
  }

  const api = { calmLibrary, isGesture, EVENT_GAP_MS, IOS, HOME, MOOD_FAMILY, moodFromText, eventFromText, libraryOf, poses, pathStep, pickNext, commit, createState, createPlayer, prefetchAll, cached, srcFor, srcState, CACHE_NAME, XFADE_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MotionGraph = api;
})(typeof window !== 'undefined' ? window : globalThis);
