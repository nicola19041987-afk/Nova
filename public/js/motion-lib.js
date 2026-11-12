/* Libreria di movimenti della foto 2D. Combinazioni di gesti non allusivi.
   Nessun contenuto sessuale. La foto si muove tutta insieme: niente warp del viso.
   Il video di riferimento chiede cenni sul parlato, sguardo in alto a destra quando pensa,
   ascolto più fermo e un respiro più fondo prima di una frase. L'inclinazione resta piccola
   perché la foto intera non può ruotare di decine di gradi senza rovesciare il ritratto. */
(function (root) {
  const BASES = [
    { id: 'respiro-quieto', name: 'Respiro quieto', groups: ['idle', 'listen'], sway: 0.004, gazeX: 0, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 0.8, ms: 4200 },
    { id: 'inclina-sinistra', name: 'Inclinazione a sinistra', groups: ['idle'], sway: 0.012, gazeX: -0.15, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2800 },
    { id: 'inclina-destra', name: 'Inclinazione a destra', groups: ['idle'], sway: -0.012, gazeX: 0.15, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2800 },
    { id: 'cenno-si', name: 'Cenno di sì', groups: ['speak', 'listen', 'greet'], sway: 0.003, gazeX: 0, gazeY: 0.05, smile: 0.08, brow: 0, blink: '', nod: 1, shake: 0, shrug: 0, breath: 1, ms: 1600 },
    { id: 'cenno-no', name: 'Cenno di no', groups: ['speak'], sway: 0.01, gazeX: 0, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 1, shrug: 0, breath: 1, ms: 1500 },
    { id: 'sguardo-sinistra', name: 'Sguardo a sinistra', groups: ['idle'], sway: 0.006, gazeX: -0.55, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2400 },
    { id: 'sguardo-destra', name: 'Sguardo a destra', groups: ['idle'], sway: -0.006, gazeX: 0.55, gazeY: 0, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2400 },
    { id: 'sguardo-alto', name: 'Sguardo in alto a destra', groups: ['think'], sway: 0.016, gazeX: 0.62, gazeY: -0.55, smile: 0, brow: 0.35, blink: 'single', nod: 0, shake: 0, shrug: 0.1, breath: 0.9, ms: 2600 },
    { id: 'sguardo-basso', name: 'Sguardo in basso', groups: ['sad'], sway: 0.003, gazeX: 0, gazeY: 0.4, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0.2, breath: 0.75, ms: 2600 },
    { id: 'sguardo-camera', name: 'Sguardo in camera', groups: ['speak', 'listen'], sway: 0.003, gazeX: 0, gazeY: 0, smile: 0.05, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2200 },
    { id: 'ammiccamento', name: 'Ammiccamento', groups: ['idle', 'listen'], sway: 0.002, gazeX: 0, gazeY: 0, smile: 0, brow: 0, blink: 'single', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 1800 },
    { id: 'doppio-ammiccamento', name: 'Doppio ammiccamento', groups: ['idle'], sway: 0.002, gazeX: 0, gazeY: 0, smile: 0, brow: 0, blink: 'double', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2000 },
    { id: 'occhiolino-sinistro', name: 'Occhiolino sinistro', groups: ['happy'], sway: 0.006, gazeX: -0.1, gazeY: 0, smile: 0.25, brow: 0.15, blink: 'winkL', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 1400 },
    { id: 'occhiolino-destro', name: 'Occhiolino destro', groups: ['happy'], sway: -0.006, gazeX: 0.1, gazeY: 0, smile: 0.25, brow: 0.15, blink: 'winkR', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 1400 },
    { id: 'sorriso', name: 'Sorriso', groups: ['speak', 'happy', 'greet'], sway: 0.004, gazeX: 0, gazeY: 0, smile: 0.45, brow: 0.05, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1, ms: 2200 },
    { id: 'sopracciglia', name: 'Sopracciglia alte', groups: ['surprise', 'speak'], sway: 0.003, gazeX: 0, gazeY: -0.1, smile: 0, brow: 0.7, blink: '', nod: 0, shake: 0, shrug: 0, breath: 1.05, ms: 1600 },
    { id: 'respiro-lento', name: 'Respiro lento', groups: ['sad', 'listen'], sway: 0.003, gazeX: 0, gazeY: 0.1, smile: 0, brow: 0, blink: '', nod: 0, shake: 0, shrug: 0, breath: 0.65, ms: 5200 },
    { id: 'respiro-profondo', name: 'Respiro profondo', groups: ['idle', 'speak'], sway: 0.003, gazeX: 0, gazeY: 0, smile: 0, brow: 0.05, blink: '', nod: 0, shake: 0, shrug: 0.2, breath: 1.5, ms: 3600 },
    { id: 'spalle', name: 'Alzata di spalle', groups: ['think', 'speak'], sway: 0.008, gazeX: 0.08, gazeY: 0.02, smile: 0, brow: 0.15, blink: '', nod: 0, shake: 0, shrug: 1, breath: 1, ms: 1800 },
    { id: 'risata', name: 'Risata breve', groups: ['laugh', 'happy'], sway: 0.008, gazeX: 0, gazeY: 0, smile: 0.6, brow: 0.2, blink: 'single', nod: 0, shake: 0, shrug: 0.3, breath: 1.4, ms: 1800 },
    { id: 'pensierosa', name: 'Pensierosa', groups: ['think'], sway: 0.01, gazeX: 0.45, gazeY: -0.5, smile: 0, brow: 0.22, blink: 'single', nod: 0, shake: 0, shrug: 0.15, breath: 0.85, ms: 3000 },
    { id: 'sorpresa', name: 'Sorpresa', groups: ['surprise'], sway: 0.004, gazeX: 0, gazeY: -0.15, smile: 0.1, brow: 0.85, blink: 'single', nod: 0, shake: 0, shrug: 0, breath: 1.2, ms: 1400 },
    { id: 'ascolto', name: 'In ascolto', groups: ['listen'], sway: 0.001, gazeX: 0, gazeY: 0, smile: 0.03, brow: 0, blink: '', nod: 0.05, shake: 0, shrug: 0, breath: 0.65, ms: 3400 },
    { id: 'saluto', name: 'Saluto con il capo', groups: ['greet', 'speak'], sway: 0.005, gazeX: 0, gazeY: 0, smile: 0.35, brow: 0.1, blink: '', nod: 1, shake: 0, shrug: 0, breath: 1.05, ms: 1800 },
  ];
  const INT = [['lieve', 0.45], ['media', 0.75], ['marcata', 1]];
  const SPEED = [['lenta', 1.35], ['naturale', 1], ['viva', 0.72]];
  const DUR = [['breve', 0.7], ['media', 1], ['lunga', 1.4]];
  const PRESETS = [];
  BASES.forEach((b) => {
    INT.forEach((i) => {
      SPEED.forEach((s) => {
        DUR.forEach((d) => {
          PRESETS.push({
            id: b.id + '-' + i[0] + '-' + s[0] + '-' + d[0],
            name: b.name + ' · ' + i[0] + ' · ' + s[0] + ' · ' + d[0],
            groups: b.groups,
            sway: b.sway * i[1],
            swayMs: Math.round(2400 * s[1]),
            breath: b.breath,
            smile: b.smile * i[1],
            brow: b.brow * i[1],
            gazeX: b.gazeX * i[1],
            gazeY: b.gazeY * i[1],
            blink: b.blink,
            nod: b.nod * i[1],
            shake: b.shake * i[1],
            shrug: b.shrug * i[1],
            ms: Math.round(b.ms * d[1] * s[1]),
          });
        });
      });
    });
  });
  const byId = new Map(PRESETS.map((p) => [p.id, p]));
  // Micro-movimenti dell'immagine intera (niente warp di viso o mani).
  // I bersagli cambiano a intervalli irregolari e non ripetono l'ultimo gesto.
  const DRIVES = [
    { id: 'respiro', x: 0, y: 0.22, rot: 0, lean: 0.2, shoulder: 0 },
    { id: 'sway-l', x: -0.72, y: 0.08, rot: -0.55, lean: 0.05, shoulder: -0.45 },
    { id: 'sway-r', x: 0.72, y: 0.08, rot: 0.55, lean: 0.05, shoulder: 0.45 },
    { id: 'nod', x: 0.04, y: 0.9, rot: 0.06, lean: 0.12, shoulder: 0.05 },
    { id: 'tilt-l', x: -0.18, y: 0.06, rot: -0.85, lean: 0, shoulder: -0.25 },
    { id: 'tilt-r', x: 0.18, y: 0.06, rot: 0.85, lean: 0, shoulder: 0.25 },
    { id: 'lean', x: 0.02, y: -0.28, rot: 0.04, lean: 1, shoulder: 0.08 },
    { id: 'shoulder', x: 0.28, y: 0.05, rot: 0.16, lean: 0.08, shoulder: 1 },
  ];
  const CALM_IDS = { respiro: 1, 'sway-l': 1, 'sway-r': 1, 'tilt-l': 1, 'tilt-r': 1 };
  function createDrive() {
    return { x: 0, y: 0, rot: 0, lean: 0, shoulder: 0, tx: 0, ty: 0, tr: 0, tl: 0, ts: 0, until: 0, recent: [], breath: 0, period: 3900, phase: 0.4, hold: '' };
  }
  function pickDrive(energy, recent, now) {
    const skip = new Set(recent || []);
    let bag = DRIVES.filter((m) => !skip.has(m.id));
    if (energy < 0.22) bag = bag.filter((m) => CALM_IDS[m.id]);
    if (!bag.length) bag = DRIVES.filter((m) => !skip.has(m.id));
    if (!bag.length) bag = DRIVES.slice();
    const n = Math.abs((Math.floor(now / 13) + (recent ? recent.length : 0) * 13) % bag.length);
    return bag[n];
  }
  function drive(state, now, dt, energy) {
    const s = state || createDrive();
    const e = Math.max(0, Math.min(1, Number(energy) || 0));
    if (!s.until || now >= s.until) {
      const move = pickDrive(e, s.recent, now + (s.recent.length * 97));
      s.recent = (s.recent || []).concat(move.id).slice(-5);
      const amp = 0.34 + e * 0.9;
      const j = ((Math.floor(now / 90) % 11) - 5) / 40;
      s.tx = move.x * amp * (1 + j * 0.35);
      s.ty = move.y * amp;
      s.tr = move.rot * amp * (e > 0.5 ? 0.72 : 1);
      s.tl = Math.max(0, move.lean) * (0.22 + e * 0.95);
      s.ts = move.shoulder * amp;
      s.until = now + (e > 0.5 ? 680 : 1500) + (Math.floor(now) % 740);
      s.hold = move.id;
    }
    const step = Math.max(0, Math.min(80, dt || 16));
    const k = 1 - Math.exp(-step / (e > 0.5 ? 160 : 460));
    s.x += (s.tx - s.x) * k;
    s.y += (s.ty - s.y) * k;
    s.rot += (s.tr - s.rot) * k;
    s.lean += (s.tl - s.lean) * k;
    s.shoulder += (s.ts - s.shoulder) * k;
    const want = (e > 0.5 ? 2400 : 4300) + ((Math.floor(now / 900) % 6) * 160);
    s.period += (want - (s.period || want)) * 0.03;
    s.phase += step / Math.max(900, s.period);
    s.breath = Math.sin(s.phase * Math.PI * 2);
    const talk = e > 0.45 ? Math.sin(now / (260 + (1 - e) * 220)) * e : 0;
    return {
      id: s.hold,
      x: s.x,
      y: s.y + s.breath * (0.28 + e * 0.5) + talk * 0.42,
      rot: s.rot * (e > 0.5 ? 0.55 : 1) + talk * 0.05,
      lean: s.lean + Math.max(0, s.breath) * 0.12 * e,
      shoulder: s.shoulder,
      breath: s.breath,
      energy: e,
    };
  }
  function cssPose(p) {
    const e = Math.max(0, Math.min(1, (p && p.energy) || 0));
    const gain = 0.5 + e * 0.85;
    const x = ((p.x || 0) * 8 + (p.shoulder || 0) * 5) * gain;
    const y = (p.y || 0) * (4.5 + e * 8);
    const rot = (p.rot || 0) * (0.45 + e * 0.55);
    const scale = 1 + Math.max(0, p.lean || 0) * (0.006 + e * 0.014);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    return {
      x: clamp(x, -16, 16),
      y: clamp(y, -18, 18),
      rot: clamp(rot, -1.35, 1.35),
      scale: clamp(scale, 1, 1.028),
    };
  }
  function cssTransform(p) {
    const c = cssPose(p);
    return 'translate3d(' + c.x.toFixed(2) + 'px,' + c.y.toFixed(2) + 'px,0) rotate(' + c.rot.toFixed(3) + 'deg) scale(' + c.scale.toFixed(4) + ')';
  }
  function pick(ctx, now, recent) {
    const skip = new Set(recent || []);
    let bag = PRESETS.filter((p) => p.groups.indexOf(ctx) >= 0 && !skip.has(p.id));
    if (!bag.length) bag = PRESETS.filter((p) => p.groups.indexOf(ctx) >= 0);
    if (!bag.length) bag = PRESETS.filter((p) => !skip.has(p.id));
    if (!bag.length) bag = PRESETS;
    const n = Math.abs((Math.floor(now || 0) + (recent ? recent.length : 0) * 17) % bag.length);
    return bag[n];
  }
  const HAND_3D = [
    'Mani in grembo a riposo',
    'Sistema i capelli, testa inclinata di lato',
    'Palmo aperto che scandisce le parole',
    'Spazzata in basso con alzata di spalle',
    'Entrambe le mani aperte verso l’esterno',
    'Si alza e si sporge verso la camera',
  ];
  // Gesti della mano: pochi secondi, poi posa neutra (lift 0). A riposo un micro-movimento,
  // così la mano non resta piantata. Nessun gesto dura più di HAND_PLAY_MS.
  const HAND_PLAY_MS = 2800;
  const HAND_REST_MS = 4300;
  function createHand() {
    return { phase: 'rest', t0: 0, until: 0, side: 1, lift: 0 };
  }
  function stepHand(state, now) {
    const s = state || createHand();
    const t = Number(now) || 0;
    if (!s.until) { s.phase = 'rest'; s.t0 = t; s.until = t + 700; s.lift = 0; s.side = 1; }
    if (s.phase !== 'go' && t >= s.until) {
      s.phase = 'go';
      s.t0 = t;
      s.side = s.side > 0 ? -1 : 1;
      s.until = t + HAND_PLAY_MS;
    }
    let lift = 0;
    if (s.phase === 'go') {
      const u = (t - s.t0) / HAND_PLAY_MS;
      if (u >= 1) {
        s.phase = 'rest';
        s.t0 = t;
        s.until = t + HAND_REST_MS + ((Math.floor(t / 1000) % 4) * 450);
        lift = 0;
      } else if (u < 0.2) lift = u / 0.2;
      else if (u < 0.58) lift = 1;
      else lift = Math.max(0, 1 - (u - 0.58) / 0.42);
    }
    s.lift = lift;
    const idle = Math.sin(t / 900) * 0.22 + Math.sin(t / 1500 + 1.2) * 0.12;
    return { phase: s.phase, side: s.side, lift, idle, msLeft: s.phase === 'go' ? Math.max(0, s.until - t) : 0 };
  }
  // Il video idle sul disco non va in loop: un tratto breve, poi la foto (posa neutra), poi un altro tratto.
  const CLIP_PLAY_MS = 3200;
  const CLIP_GAP_MS = 4800;
  function createClipPlay() { return { on: false, from: 0, slot: 0, until: 0, next: 0 }; }
  function stepClipPlay(state, now, durationMs) {
    const s = state || createClipPlay();
    const t = Number(now) || 0;
    const dur = Math.max(0, Number(durationMs) || 0);
    if (!s.next) s.next = t + 500;
    if (s.on) {
      if (t >= s.until) { s.on = false; s.next = t + CLIP_GAP_MS + ((Math.floor(t / 1000) % 3) * 400); return { play: false, seek: null }; }
      return { play: true, seek: null };
    }
    if (t < s.next) return { play: false, seek: null };
    let from = 0;
    if (dur > CLIP_PLAY_MS + 400) {
      const slots = Math.max(1, Math.floor(dur / CLIP_PLAY_MS));
      s.slot = (s.slot + 1) % slots;
      from = Math.min(Math.max(0, dur - CLIP_PLAY_MS), s.slot * CLIP_PLAY_MS);
    }
    s.on = true; s.from = from; s.until = t + Math.min(CLIP_PLAY_MS, dur || CLIP_PLAY_MS);
    return { play: true, seek: from };
  }
  const api = { PRESETS, count: PRESETS.length, pick, get: (id) => byId.get(id) || null, HAND_3D, createDrive, drive, cssPose, cssTransform, DRIVES, createHand, stepHand, HAND_PLAY_MS, createClipPlay, stepClipPlay, CLIP_PLAY_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MotionLib = api;
  function paintCount() {
    const t = 'Movimenti della foto: ' + api.count;
    const a = document.getElementById('motion-lib-count');
    const b = document.getElementById('motion-lib-menu');
    if (a) a.textContent = t;
    if (b) b.textContent = t;
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintCount);
    else paintCount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
