/* motion.js — tracciamento LOCALE con MediaPipe Tasks Vision (file serviti dall'app in /vendor/mediapipe, nessuna CDN):
 * - Face Landmarker (inclinazione/annuire/girare la testa), Hand Landmarker (gesti), Pose Landmarker lite (braccia, ritmo).
 * - Delegato GPU se c'è WebGL2, altrimenti (o se la GPU fallisce) CPU.
 * - Riconoscimento gesti dai landmark: saluto, mano aperta, pollice in su, OK, pace (✌️), indicare.
 * - Stima del ritmo dei movimenti (autocorrelazione) per sincronizzare l'oscillazione dell'avatar.
 * Nessun fotogramma lascia il telefono. Script classico: espone window.Motion. */
(function () {
  const V = '/vendor/mediapipe';
  const MODELS = { face: 'face_landmarker.task', hands: 'hand_landmarker.task', pose: 'pose_landmarker_lite.task' };
  const NAMES = { face: 'viso', hands: 'mani', pose: 'corpo' };
  const st = { vision: null, files: null, tasks: {}, delegate: {}, loading: {}, imageFace: null };

  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  function hasWebGL2() { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } }
  const fail = (part, msg, e) => { const err = new Error(msg); err.part = part; err.cause = e; if (e) console.warn(msg, e); return err; };
  async function head(url) { try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch { return false; } }

  async function loadVision() {
    if (st.vision) return;
    if (typeof WebAssembly !== 'object') throw fail('wasm', 'Questo browser non supporta WebAssembly: tracciamento non disponibile.');
    try { st.vision = await import(`${V}/vision_bundle.mjs`); }
    catch (e) { throw fail('bundle', 'Libreria MediaPipe non caricata (vision_bundle.mjs). Controlla la connessione e ricarica la pagina.', e); }
    if (!(await head(`${V}/wasm/vision_wasm_internal.wasm`)) || !(await head(`${V}/wasm/vision_wasm_internal.js`))) {
      throw fail('wasm', 'File WebAssembly di MediaPipe mancanti sul server (/vendor/mediapipe/wasm): serve rifare "npm install" sul server.');
    }
    try { st.files = await st.vision.FilesetResolver.forVisionTasks(`${V}/wasm`); }
    catch (e) { throw fail('wasm', 'Motore WebAssembly di MediaPipe non avviato su questo browser.', e); }
  }
  // Crea un task con GPU (se possibile) e ripiega sulla CPU
  async function createTask(kind, runningMode = 'VIDEO') {
    await loadVision();
    const T = { face: st.vision.FaceLandmarker, hands: st.vision.HandLandmarker, pose: st.vision.PoseLandmarker }[kind];
    if (!T) throw fail(kind, `Modulo ${NAMES[kind]} assente nella libreria MediaPipe.`);
    if (!(await head(`${V}/${MODELS[kind]}`))) throw fail(kind, `Modello ${NAMES[kind]} (${MODELS[kind]}) mancante sul server.`);
    const extra = kind === 'face' ? { numFaces: 1 } : kind === 'hands' ? { numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 } : { numPoses: 1 };
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: `${V}/${MODELS[kind]}`, delegate }, runningMode, ...extra });
    if (hasWebGL2()) {
      try { const t = await T.createFromOptions(st.files, opts('GPU')); return { t, delegate: 'GPU' }; }
      catch (e) { console.warn(`GPU non disponibile per ${kind}, uso la CPU`, e); }
    }
    try { const t = await T.createFromOptions(st.files, opts('CPU')); return { t, delegate: 'CPU' }; }
    catch (e) { throw fail(kind, `Riconoscimento ${NAMES[kind]} non avviato su questo dispositivo.`, e); }
  }
  async function ensure(kind) {
    if (st.tasks[kind]) return st.tasks[kind];
    if (!st.loading[kind]) st.loading[kind] = createTask(kind).then((r) => { st.tasks[kind] = r.t; st.delegate[kind] = r.delegate; return r.t; }).finally(() => { st.loading[kind] = null; });
    return st.loading[kind];
  }
  async function imageFace() { if (!st.imageFace) st.imageFace = (await createTask('face', 'IMAGE')).t; return st.imageFace; }

  // ---------- gesti della mano ----------
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function classify(lm) {
    const w = lm[0], size = d(w, lm[9]) || 1e-3;
    const ext = (tip, pip) => d(w, lm[tip]) > d(w, lm[pip]) * 1.12;
    const idx = ext(8, 6), mid = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
    const thumb = d(lm[4], lm[17]) > d(lm[3], lm[17]) * 1.05 && d(lm[4], lm[5]) > size * 0.45;
    if (d(lm[4], lm[8]) < size * 0.33 && mid && ring && pinky) return 'ok';
    if (thumb && !idx && !mid && !ring && !pinky && lm[4].y < lm[3].y && lm[4].y < lm[5].y - size * 0.25) return 'thumbs';
    if (idx && mid && !ring && !pinky) return 'peace';
    if (idx && !mid && !ring && !pinky) return 'point';
    if (idx && mid && ring && pinky) return 'open';
    return null;
  }
  class Gestures {
    constructor() { this.cand = null; this.n = 0; this.last = 0; this.lastKind = {}; this.wx = []; }
    update(hands, now) {
      const lm = hands && hands[0]; if (!lm) { this.cand = null; this.n = 0; this.wx = []; return null; }
      let g = classify(lm);
      if (g === 'open') { // saluto = mano aperta che oscilla di lato
        this.wx.push({ t: now, x: lm[0].x }); this.wx = this.wx.filter((p) => now - p.t < 1500);
        let changes = 0, dir = 0, min = 1, max = 0;
        for (let i = 1; i < this.wx.length; i++) {
          const dx = this.wx[i].x - this.wx[i - 1].x; min = Math.min(min, this.wx[i].x); max = Math.max(max, this.wx[i].x);
          if (Math.abs(dx) > 0.006) { const s = Math.sign(dx); if (dir && s !== dir) changes++; dir = s; }
        }
        if (changes >= 2 && max - min > d(lm[0], lm[9]) * 0.5) { g = 'wave'; this.wx = []; }
      } else this.wx = [];
      if (g !== this.cand) { this.cand = g; this.n = 0; }
      this.n++;
      const need = g === 'wave' ? 1 : 4; // gesti statici: stabili per ~4 rilevamenti
      if (!g || this.n < need || now - this.last < 2500 || now - (this.lastKind[g] || 0) < 4000) return null;
      this.last = now; this.lastKind[g] = now; this.n = -1000; // non ripetere finché la mano non cambia
      return g;
    }
  }
  // ---------- ritmo dei movimenti ----------
  class Rhythm {
    constructor() { this.s = []; this.lastCalc = 0; this.out = null; }
    push(t, v) { this.s.push({ t, v }); const lim = t - 6000; while (this.s.length && this.s[0].t < lim) this.s.shift(); }
    estimate(now) {
      if (now - this.lastCalc < 1000) return this.out; this.lastCalc = now;
      if (this.s.length < 30 || this.s[this.s.length - 1].t - this.s[0].t < 4000) return (this.out = null);
      const step = 100, t0 = this.s[0].t, N = Math.floor((this.s[this.s.length - 1].t - t0) / step); const x = []; let j = 0;
      for (let i = 0; i < N; i++) { const t = t0 + i * step; while (j < this.s.length - 2 && this.s[j + 1].t < t) j++; const a = this.s[j], b = this.s[j + 1] || a; const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0; x.push(a.v + (b.v - a.v) * k); }
      const mean = x.reduce((p, c) => p + c, 0) / x.length; const y = x.map((v) => v - mean);
      const e0 = y.reduce((p, c) => p + c * c, 0); const sd = Math.sqrt(e0 / y.length);
      if (sd < 0.004) return (this.out = null);
      let best = 0, lag = 0;
      for (let L = 4; L <= 20; L++) { let s = 0; for (let i = L; i < y.length; i++) s += y[i] * y[i - L]; const r = s / e0 * (y.length / (y.length - L)); if (r > best) { best = r; lag = L; } }
      return (this.out = best > 0.35 ? { period: lag * step, strength: Math.min(1, best) } : null);
    }
  }
  // ---------- elaborazione di un fotogramma (con limitazione per iPhone) ----------
  const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
  class Processor {
    constructor() { this.frame = 0; this.lastT = 0; this.g = new Gestures(); this.r = new Rhythm(); this.prev = null; this.base = null; this.minGap = isIOS() ? 70 : 45; this.hands = null; this.pose = null; }
    // opts: { mirrorX, face, hands, pose }
    process(video, now, opts) {
      if (now - this.lastT < this.minGap || !video.videoWidth) return null;
      this.lastT = now; this.frame++;
      const X = (p) => (opts.mirrorX ? 1 - p.x : p.x);
      const out = { gesture: null, mirror: null, rhythm: null };
      const ts = Math.round(now);
      try {
        if (opts.hands && st.tasks.hands && this.frame % 2 === 0) { const r = st.tasks.hands.detectForVideo(video, ts); this.hands = r.landmarks || []; out.gesture = this.g.update(this.hands, now); }
        if (opts.pose && st.tasks.pose && this.frame % 3 === 1) { const r = st.tasks.pose.detectForVideo(video, ts); this.pose = (r.landmarks && r.landmarks[0]) || null; }
        let face = null;
        if (opts.face && st.tasks.face) { const r = st.tasks.face.detectForVideo(video, ts); face = r.faceLandmarks && r.faceLandmarks[0]; }
        if (opts.face) {
          const W = video.videoWidth, H = video.videoHeight; const m = { tilt: 0, pitch: 0, yaw: 0, lift: [0, 0], energy: 0 };
          const pts = [];
          if (face) {
            const eL = face[33], eR = face[263], nose = face[1], chin = face[152];
            const ax = (X(eR) - X(eL)) * W, ay = (eR.y - eL.y) * H;
            let ang = Math.atan2(ay, ax); if (Math.abs(ang) > Math.PI / 2) ang -= Math.sign(ang) * Math.PI;
            m.tilt = clamp(ang / 0.45);
            const midX = (X(eL) + X(eR)) / 2, midY = (eL.y + eR.y) / 2, ed = Math.abs(X(eR) - X(eL)) || 1e-3;
            m.yaw = clamp((X(nose) - midX) / ed * 2.2);
            const pr = (nose.y - midY) / ((chin.y - midY) || 1e-3);
            this.base = this.base == null ? pr : this.base + (pr - this.base) * 0.01; // si ri-centra lentamente
            m.pitch = clamp((pr - this.base) * 5);
            pts.push({ x: X(nose), y: nose.y });
          }
          (this.hands || []).forEach((h) => { const w = h[0]; const side = X(w) < 0.5 ? 0 : 1; m.lift[side] = Math.max(m.lift[side], clamp((0.8 - w.y) / 0.5, 0, 1)); pts.push({ x: X(w), y: w.y }); });
          if (this.pose) {
            const p = this.pose; const sh = (p[11].y + p[12].y) / 2;
            for (const wi of [15, 16]) { const w = p[wi]; if ((w.visibility ?? 1) < 0.5) continue; const side = X(w) < X(p[0]) ? 0 : 1; m.lift[side] = Math.max(m.lift[side], clamp((sh + 0.15 - w.y) / 0.35, 0, 1)); pts.push({ x: X(w), y: w.y }); }
            if (!face) pts.push({ x: X(p[0]), y: p[0].y });
          }
          if (this.prev && pts.length && this.prev.length === pts.length) {
            const dt = Math.max(1, now - this.prevT) / 1000; let sp = 0; pts.forEach((q, i) => { sp += d(q, this.prev[i]); });
            m.energy = clamp(sp / pts.length / dt / 0.5, 0, 1);
          }
          this.prev = pts; this.prevT = now;
          if (pts.length) { this.r.push(now, pts.reduce((s, q) => s + q.y, 0) / pts.length); out.mirror = m; }
          out.rhythm = this.r.estimate(now);
        }
      } catch (e) { console.warn('Tracciamento: fotogramma saltato', e); }
      return out;
    }
  }

  window.Motion = { ensure, imageFace, Processor, classify, hasWebGL2, isIOS, isStandalone, delegate: st.delegate, NAMES,
    REACTIONS: { wave: ['wave', '👋'], open: ['smile', '✋'], thumbs: ['nod', '👍'], peace: ['smile', '✌️'], ok: ['nod', '👌'], point: ['tilt', '👉'] } };
})();
