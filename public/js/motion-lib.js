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
  const api = { PRESETS, count: PRESETS.length, pick, get: (id) => byId.get(id) || null, HAND_3D };
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
