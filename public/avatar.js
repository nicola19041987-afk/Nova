/* Avatar parlante 2.5D su canvas, tutto lato client (nessun servizio esterno).
 * - Movimento a riposo: respiro, leggera oscillazione della testa, battito di ciglia.
 * - Labiale: dagli eventi "boundary" di speechSynthesis + approssimazione di visemi per sillaba;
 *   se si riproduce un audio, ampiezza dal Web Audio AnalyserNode.
 * - Punti del viso (occhi, bocca) segnati a mano dall'utente (coordinate 0..1 sul ritaglio quadrato).
 */
(function () {
  const VOWEL_OPEN = { a: 1, à: 1, e: 0.7, è: 0.75, é: 0.7, o: 0.8, ò: 0.85, ó: 0.8, i: 0.45, ì: 0.45, u: 0.5, ù: 0.5 };
  const CLOSERS = /[mbp]/i; // consonanti bilabiali: bocca chiusa

  // Stima i keyframe del labiale per una parola (visemi approssimati per sillaba)
  function wordKeyframes(word, start, rate) {
    const w = word.toLowerCase().replace(/[^a-zàèéìòóù]/g, '');
    if (!w) return [];
    const dur = Math.max(160, w.length * 62) / (rate || 1);
    const syl = w.match(/[^aeiouàèéìòóù]*[aeiouàèéìòóù]+/g) || [w];
    const step = dur / syl.length;
    const kf = [];
    syl.forEach((s, i) => {
      const t = start + i * step;
      const vowel = (s.match(/[aeiouàèéìòóù]/) || ['a'])[0];
      if (CLOSERS.test(s[0] || '')) kf.push({ t, v: 0.05 });
      kf.push({ t: t + step * 0.35, v: VOWEL_OPEN[vowel] || 0.6 });
      kf.push({ t: t + step * 0.9, v: 0.15 });
    });
    kf.push({ t: start + dur + 40, v: 0 });
    return kf;
  }

  const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }; // smoothstep
  class TalkingAvatar {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); // v8.1: canvas su GPU (le letture di pixel usano canvas temporanei)
      this.breathM = new Breath(); this.breather = null; this._wasSpk = false; // v8.1: respiro realistico (modello + deformazione morbida WebGL)
      this.img = null; this.emoji = '🙂';
      this.lm = { eyeL: { x: 0.38, y: 0.42 }, eyeR: { x: 0.62, y: 0.42 }, mouth: { x: 0.5, y: 0.7 } };
      this.colors = { hue: 0, saturation: 100, brightness: 100, background: '#2b1530', glow: '#d14b8f' };
      this.mouth = 0; this.kf = []; this.speaking = false; this.analyser = null;
      this.nextBlink = performance.now() + 1500; this.blinkStart = 0;
      this.lidColor = ['#c99', '#c99'];
      this.transparent = false; this.framing = 'ritratto'; this.gesturesOn = true; this.gesture = 0; this.emph = 0;
      // Reazioni ai gesti delle mani, imitazione dei movimenti, ritmo, modalità sensuale (tutto locale, solo canvas)
      this.reaction = null; this.badges = [];
      this.mir = { tilt: 0, pitch: 0, yaw: 0, lift: [0, 0], energy: 0, active: false, at: 0 }; // valori grezzi dai landmark
      this.m = { tilt: 0, pitch: 0, yaw: 0, lift: [0, 0], energy: 0 }; // valori smorzati usati nel disegno
      this.swayPeriod = 6500; this.rhythm = null; // { period, strength }
      this.sensual = false;
      // Imitazione naturale: coda dei campioni (ritardo 300–800 ms), ampiezza parziale, molle smorzate; stile appreso dell'utente
      this.mirQ = []; this.lag = 550; this.lagTarget = 550; this.nextLagAt = 0; this.gain = 0.5;
      this.vel = { tilt: 0, pitch: 0, yaw: 0, l0: 0, l1: 0, gesture: 0 };
      this.style = { energy: 0.22, headAmp: 0.22, tempo: 1300, gestPerMin: 1.5, confidence: 0 };
      // microespressioni: sopracciglia, sguardo (saccadi), sorrisi accennati, ammiccamenti variabili, sguardi a riposo
      this.micro = { brow: 0, browT: 0, browUntil: 0, nextBrow: performance.now() + 4000,
        gx: 0, gy: 0, gtx: 0, gty: 0, nextSacc: performance.now() + 900,
        smile: 0, smileT: 0, smileUntil: 0, nextSmile: performance.now() + 7000,
        look: 0, lookT: 0, nextLook: performance.now() + 5000, idleLift: 0, idleLiftT: 0, nextIdleLift: performance.now() + 9000 };
      this.blinkDur = 160; this.blinkAmp = 1; this.blinkDouble = 0;
      this.loop = this.loop.bind(this);
      this._frame = 0; this.simUntil = 0;
      this.dist = 0.75; this._dEff = 0.75; this._nod = 0; this._nodV = 0; this._mh = 0; // v8.4.1: distanza dalla camera, cenni del capo
      this._pf = { draw: new Float32Array(240), gap: new Float32Array(240), n: 0 }; // v8.4.1: tempi dei fotogrammi (media e p95)
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      this._raf = requestAnimationFrame(this.loop); // parte subito, anche senza fotocamera
      this._wd = setInterval(() => { try { this.watchdog(); } catch {} }, 1000);
    }
    // Canvas nitido su retina: risoluzione interna = dimensione a schermo (larghezza e altezza, anche non quadrata) x devicePixelRatio,
    // con un tetto di pixel per restare fluidi su iPhone. Il disegno usa uno spazio virtuale e scala da solo.
    resize() {
      const w = this.c.clientWidth || 0, h = this.c.clientHeight || 0; if (!w || !h) return;
      let d = Math.min(3, window.devicePixelRatio || 1); const MAXPX = 1.8e6, MAXD = 2000;
      d = Math.min(d, Math.sqrt(MAXPX / (w * h)), MAXD / Math.max(w, h));
      const pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(h * d));
      if (Math.abs(pw - this.c.width) > 2 || Math.abs(ph - this.c.height) > 2) { this.c.width = pw; this.c.height = ph; }
    }
    // Labiale "simulato" dal testo (risposte scritte quando la lettura vocale è spenta, o arrivate dall'altro profilo)
    talkText(text, rate = 1.15) {
      if (!text || (this.speaking && !this.simUntil)) return; // se sta già parlando con la voce vera, non sovrapporre
      const now = performance.now(); let t = Math.max(now, this.kf.length ? this.kf[this.kf.length - 1].t : now);
      for (const w of String(text).split(/\s+/).slice(0, 80)) { const k = wordKeyframes(w, t, rate); this.kf.push(...k); t = (k.length ? k[k.length - 1].t : t) + 60 / rate; if (/[!?]$/.test(w)) this.emph = now; }
      this.speaking = true; this.simUntil = t + 100;
    }
    // Piccola reazione emotiva in base al testo della risposta
    emote(text) {
      const t = String(text || '');
      if (/😂|🤣|😄|😁|ahah|haha|😊|☺️|🥰/i.test(t)) this.react('smile');
      else if (/😘|💋|❤️|😍|💕/.test(t)) this.react('smile', '💕');
      else if (/😢|😞|😔|uff|offes/i.test(t)) this.react('tilt');
      else if (/\?\s*$/.test(t.trim())) this.react('tilt');
      else if (/!/.test(t)) this.react('nod');
    }
    setCharacter(ch) {
      if (!ch) return;
      // v8.4.3: senza punti del viso propri NON si ereditano quelli del personaggio precedente (occhi/bocca storti): predefiniti «incerti»
      this.lm = JSON.parse(JSON.stringify(ch.landmarks && ch.landmarks.eyeL ? ch.landmarks : DEF_LM));
      if (ch.appearance && ch.appearance.colors) this.setColors(ch.appearance.colors);
      this.framing = (ch.appearance && ch.appearance.framing) || 'ritratto';
      this.setDistance(ch.frameDist == null ? 0.75 : ch.frameDist, true);
      const ff = ch.frameFill;
      if (ff && ff.url && !ff.off && ff.src === ch.avatar && ff.landmarks && ff.landmarks.eyeL) { this.lm = JSON.parse(JSON.stringify(ff.landmarks)); this.setImage(ff.url); }
      else this.setImage(ch.avatar);
      if (window.App && App.frame && this.c && this.c.id === 'avatar-canvas') App.frame.check(ch);
    }
    // v8.4.1: distanza dalla camera (0 = vicina come in v8.4, 1 = lontana: testa ~18% dell'altezza); passaggio morbido
    setDistance(d, instant) { this.dist = Math.max(0, Math.min(1, Number(d) || 0)); if (instant && !this.img) this._dEff = this.dist; }
    perf() {
      const P = this._pf, n = Math.min(P.n, 240); if (!n) return null;
      const st = (a) => { const v = Array.from(a.slice(0, n)).sort((x, y) => x - y); return { avg: +(v.reduce((x, y) => x + y, 0) / n).toFixed(2), p95: +v[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2) }; };
      return { frames: n, draw: st(P.draw), interval: st(P.gap) };
    }
    setImage(src) {
      if (src && (src.startsWith('/api/') || src.startsWith('data:'))) {
        if (this.img && this.img._src === src) return;
        const im = new Image();
        im.onload = () => {
          if (this.img && this.c.width > 1) { try { const c = document.createElement('canvas'); c.width = this.c.width; c.height = this.c.height; c.getContext('2d').drawImage(this.c, 0, 0); this._snap = { c, t: performance.now() }; } catch {} }
          this.img = im; this.img._src = src; this.sampleLids();
        };
        im.src = src;
      } else { this.img = null; this.emoji = src || '🙂'; }
    }
    // ---- reazioni (gesti della mano riconosciuti dalla fotocamera) ----
    // kind: 'wave' (saluta), 'smile' (sorride), 'nod' (annuisce), 'tilt' (inclina la testa), 'shake'
    react(kind, badge) {
      const dur = { wave: 1800, smile: 2200, nod: 1200, tilt: 1600, shake: 1100 }[kind] || 1500;
      this.reaction = { kind, start: performance.now(), dur };
      if (kind === 'nod') { const n = Math.random() < 0.55 ? 1 : 2; Object.assign(this.reaction, { n, amp: 0.6 + Math.random() * 0.4, dur: (n === 1 ? 650 : 1050) + Math.random() * 350 }); } // v8.4.1: cenni vari (uno o due, ampiezza e durata diverse)
      if (badge === '😄' && this.breathM) this.breathM.laugh(performance.now()); // ride davvero: il petto sobbalza
      if (badge) this.badges.push({ t: performance.now(), e: badge, x: 0.18 + Math.random() * 0.1 });
      if (this.badges.length > 4) this.badges.shift();
    }
    // ---- imitazione: valori normalizzati (-1..1) da volto/mani/corpo dell'utente ----
    setMirror(v) {
      const now = performance.now();
      this.mirQ.push({ t: now, v: { tilt: v.tilt || 0, pitch: v.pitch || 0, yaw: v.yaw || 0, lift: [(v.lift || [0, 0])[0] || 0, (v.lift || [0, 0])[1] || 0], energy: v.energy || 0 } });
      while (this.mirQ.length > 2 && this.mirQ[1].t < now - 1200) this.mirQ.shift();
      this.mir.active = true; this.mir.at = now;
    }
    clearMirror() { this.mir.active = false; this.mirQ = []; }
    // stile di movimento appreso (Motion.Style.profile()): influenza anche il comportamento a riposo, senza fotocamera
    setStyle(p) { if (!p) return; const c = (v, a, b, d) => (Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d); this.style = { energy: c(p.energy, 0, 1, 0.22), headAmp: c(p.headAmp, 0, 1, 0.22), tempo: c(p.tempo, 330, 2400, 1300), gestPerMin: c(p.gestPerMin, 0, 20, 1.5), confidence: c(p.confidence, 0, 1, 0) }; }
    // stato interno per diagnostica/test
    debugState() { return { lag: Math.round(this.lag), gain: +this.gain.toFixed(3), m: { ...this.m, lift: [...this.m.lift] }, brow: +this.micro.brow.toFixed(3), gaze: [+this.micro.gx.toFixed(3), +this.micro.gy.toFixed(3)], smile: +this.micro.smile.toFixed(3), look: +this.micro.look.toFixed(3), blinkDur: Math.round(this.blinkDur), blinkAmp: this.blinkAmp, style: { ...this.style }, swayPeriod: Math.round(this.swayPeriod) }; }
    // ---- ritmo: periodo (ms) stimato dai movimenti dell'utente; l'oscillazione a riposo si sincronizza ----
    setRhythm(period, strength) { this.rhythm = period ? { period: Math.min(2400, Math.max(330, period)), strength: Math.min(1, strength || 0.5) } : null; }
    setLandmarks(lm) {
      const next = JSON.parse(JSON.stringify(lm));
      // v8.5.2: i punti nuovi arrivano con una dissolvenza (niente salti del warp quando il telefono rivaluta il viso)
      if (this.lm && this.lm.eyeL && next && next.eyeL) {
        this._lmFrom = JSON.parse(JSON.stringify(this.lm)); this._lmTo = next; this._lmT0 = performance.now(); this._lmDur = 420;
      } else { this.lm = next; this._lmFrom = this._lmTo = null; }
      this.sampleLids(); this._trustKey = '';
    }
    _lerpLm(now) {
      if (!this._lmTo || !this._lmFrom) return;
      const p = Math.min(1, (now - (this._lmT0 || now)) / (this._lmDur || 420));
      const e = p * p * (3 - 2 * p), mix = (a, b) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
      const f = this._lmFrom, t = this._lmTo;
      this.lm = { ...t, eyeL: mix(f.eyeL, t.eyeL), eyeR: mix(f.eyeR, t.eyeR), mouth: mix(f.mouth, t.mouth) };
      if (p >= 1) { this.lm = t; this._lmFrom = this._lmTo = null; this.sampleLids(); }
    }
    // v8.4.3: i punti del viso valgono per QUESTA foto? (rilevati in automatico su questa immagine, o messi a mano e plausibili)
    // Se no: niente deformazioni locali di occhi/bocca/testa (venivano storte), solo respiro e movimento dell'immagine intera,
    // e si rilevano i punti giusti in background (MediaPipe sul telefono).
    faceTrusted() {
      const img = this.img, lm = this.lm; if (!img || !lm) return false;
      const key = (img._src || '') + '|' + JSON.stringify([lm.eyeL, lm.eyeR, lm.mouth, lm.auto, lm.src]);
      if (this._trustKey === key) return this._trust;
      const fk = (x) => (window.App && App.faceKey ? App.faceKey(x) : String(x));
      let ok = !!(lm.eyeL && lm.eyeR && lm.mouth);
      if (ok) {
        const mine = lm.auto === true ? (!lm.src || lm.src === fk(img._src)) : lm.auto === false; // predefiniti (senza «auto») = incerti
        const ed = Math.hypot(lm.eyeR.x - lm.eyeL.x, lm.eyeR.y - lm.eyeL.y), ang = Math.atan2(lm.eyeR.y - lm.eyeL.y, lm.eyeR.x - lm.eyeL.x);
        const my = (lm.eyeL.y + lm.eyeR.y) / 2, mx = (lm.eyeL.x + lm.eyeR.x) / 2;
        const sane = ed > 0.006 && ed < 0.7 && Math.abs(ang) < 0.45 && lm.mouth.y > my + ed * 0.45 && lm.mouth.y < my + ed * 2.2 && Math.abs(lm.mouth.x - mx) < ed * 0.6;
        ok = mine && sane;
      }
      this._trustKey = key; this._trust = ok;
      if (!ok) this.detectFace();
      return ok;
    }
    detectFace() {
      const src = this.img && this.img._src; if (!src || !(window.App && App.autoFace) || this._det === src) return;
      this._det = src; this._detTries = this._detTries || {}; const n = (this._detTries[src] || 0) + 1; this._detTries[src] = n; if (n > 2) return;
      // v8.4.5: il rilevamento del viso (MediaPipe) occupa il thread principale per qualche secondo (molto di più su iPhone in
      // Risparmio energetico): parte solo quando lei NON sta parlando e il browser è libero, così l'avatar non si blocca a metà frase
      const go = () => { if (!this.img || this.img._src !== src) { this._det = null; return; } if (this.speaking || document.visibilityState !== 'visible') return setTimeout(go, 1500); run(); };
      const run = () => (window.requestIdleCallback ? requestIdleCallback(go2, { timeout: 4000 }) : go2());
      const go2 = () => {
        App.autoFace(src).then((lm) => {
          if (!lm || !this.img || this.img._src !== src) { this._det = null; return; }
          this.setLandmarks(lm); if (App.faceFound) App.faceFound(src, lm, this);
        }).catch((e) => { console.warn('Viso non rilevato', e); this._det = null; });
      };
      setTimeout(go, 600);
    }
    setColors(c) { this.colors = { ...this.colors, ...c }; if (!this.transparent && !this._cssPhoto) { this.c.style.background = this.colors.background; this._bdKey = ''; } }

    // colore della palpebra: campiona la pelle sopra ciascun occhio
    sampleLids() {
      if (!this.img) return;
      try {
        const S = 64, tmp = document.createElement('canvas'); tmp.width = tmp.height = S;
        const t = tmp.getContext('2d', { willReadFrequently: true }); drawCover(t, this.img, S);
        this.lidColor = [this.lm.eyeL, this.lm.eyeR].map((e) => {
          const d = t.getImageData(Math.round(e.x * S), Math.max(0, Math.round((e.y - 0.06) * S)), 1, 1).data;
          return `rgb(${d[0]},${d[1]},${d[2]})`;
        });
      } catch { /* immagine non leggibile: colore di default */ }
    }

    // ---- labiale ----
    speakUtterance(u, text) {
      const rate = u.rate || 1; let gotBoundary = false;
      u.addEventListener('start', () => {
        this.breathCue(text, false);
        this.speaking = true; this.kf = [];
        setTimeout(() => { if (!gotBoundary && this.speaking) this.simulateText(text, rate); }, 450); // iOS: boundary spesso assenti
      });
      u.addEventListener('boundary', (e) => {
        if (e.name && e.name !== 'word') return;
        gotBoundary = true;
        const rest = text.slice(e.charIndex); const word = (rest.match(/^\S+/) || [''])[0];
        if (/[!?]$/.test(word) || word.length > 9) this.emph = performance.now(); // enfasi -> gesto più ampio
        const now = performance.now();
        this.kf = this.kf.filter((k) => k.t < now).concat(wordKeyframes(word, now, rate));
      });
      const stop = () => { this.speaking = false; this.kf = [{ t: performance.now() + 60, v: 0 }]; };
      u.addEventListener('end', stop); u.addEventListener('error', stop);
    }
    simulateText(text, rate) {
      let t = performance.now();
      for (const w of text.split(/\s+/)) { if (/[!?]$/.test(w)) setTimeout(() => { this.emph = performance.now(); }, t - performance.now()); const k = wordKeyframes(w, t, rate); this.kf.push(...k); t = (k.length ? k[k.length - 1].t : t) + 70 / rate; }
    }
    // Audio riprodotto (es. un vocale): ampiezza reale con AnalyserNode
    attachAudio(audioEl) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        this.ac = this.ac || new AC();
        const src = this.ac.createMediaElementSource(audioEl);
        const an = this.ac.createAnalyser(); an.fftSize = 512;
        src.connect(an); an.connect(this.ac.destination);
        this.analyser = an; this.buf = new Uint8Array(an.fftSize);
        audioEl.addEventListener('play', () => { this.ac.resume(); this.speaking = true; });
        audioEl.addEventListener('pause', () => { this.speaking = false; });
        audioEl.addEventListener('ended', () => { this.speaking = false; });
      } catch (e) { console.warn('AnalyserNode non disponibile', e); }
    }
    // v8: labiale guidato dall'ampiezza reale dell'audio (inviluppo RMS precalcolato, a 60 punti/secondo)
    speakAudio(el, env, text, rate = 60) {
      this.breathCue(text, this.speaking);
      this._env = env && env.length ? { el, env, rate } : null;
      this.kf = []; this.simUntil = 0; this.speaking = true; this._spkText = text || ''; this._spkAt = performance.now(); this._openAt = 0; this._simFb = false;
      if (!this._env && text) this.simulateText(text, 1); // inviluppo non disponibile: labiale stimato dal testo
    }
    // v8.1: il respiro segue il parlato: presa di fiato tra le frasi, risata, sospiro
    breathCue(text, cont) {
      const B = this.breathM; if (!B) return; const now = performance.now(), t = String(text || '');
      if (cont) B.gap(now);
      if (/\[laugh\]|\bah(ah)+\b|\bih(ih)+\b/i.test(t)) B.laugh(now + 150);
      else if (/\b(uff+|ehh+|mah+|sigh)\b|sospir/i.test(t)) B.sigh(now);
    }
    // v8.4: labiale dal vivo (voce in streaming della conversazione in tempo reale): livello e "apertura larga" letti a ogni fotogramma
    speakLive(levelFn, wideFn) { this._live = { levelFn, wideFn }; this._env = null; this.kf = []; this.simUntil = 0; this.speaking = true; }
    stopAudio() { this._live = null; this._env = null; this.speaking = false; this.kf = [{ t: performance.now() + 60, v: 0 }]; }
    target(now) {
      if (this.breathM && this.breathM.inhaling(now)) return 0.12; // v8.1: bocca appena socchiusa mentre prende fiato prima di parlare
      if (this._live && this.speaking) { let v = 0; try { v = this._live.levelFn() || 0; this.vWide = this._live.wideFn ? this._live.wideFn() || 0 : 0; } catch {} return v; }
      if (this._env && this.speaking) {
        const { el, env, rate } = this._env;
        if (el.paused || el.ended) return 0;
        const x = el.currentTime * rate + 2, i = Math.floor(x), f = x - i; // +2: anticipo di ~30 ms (la bocca si apre un filo prima del suono)
        const a = env[Math.min(env.length - 1, i)] || 0, b = env[Math.min(env.length - 1, i + 1)] || 0;
        // v8.4: "visemi" approssimati: ogni sillaba (~130 ms) ha una forma diversa (A aperta, E larga, O/U stretta)
        const syl = Math.floor(x / 8), h = Math.sin(syl * 12.9898 + 78.233) * 43758.5453; this.vWide = (h - Math.floor(h)) * (a > 0.15 ? 1 : 0.5);
        return a + (b - a) * f;
      }
      if (this.analyser && this.speaking) {
        this.analyser.getByteTimeDomainData(this.buf);
        let sum = 0; for (const b of this.buf) { const v = (b - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / this.buf.length) * 6);
      }
      const kf = this.kf; if (!kf.length) return 0;
      while (kf.length > 1 && kf[1].t <= now) kf.shift();
      const a = kf[0], b = kf[1];
      if (!b) { if (a.t <= now) { this.kf = []; return a.v; } return 0; }
      if (now < a.t) return 0;
      return a.v + (b.v - a.v) * ((now - a.t) / (b.t - a.t));
    }

    // ---- disegno ----
    loop(now) {
      this._raf = requestAnimationFrame(this.loop);
      // v8.4.5: un errore di disegno non deve MAI fermare l'avatar: si passa a modalità sempre più semplici
      try { this.frame(now); this._okFrames = (this._okFrames || 0) + 1; if (this._cssPhoto && this._okFrames > 120) { this._cssPhoto = false; this.c.style.background = ''; } } catch (e) { this.drawError(e); }
    }
    drawError(e) {
      this._errs = (this._errs || 0) + 1; this._lastErr = String((e && e.message) || e).slice(0, 160); this._okFrames = 0;
      if (this._errs === 1) console.warn('Avatar: errore di disegno, passo a una modalità più semplice', e);
      if (this._errs >= 2 && !this._safe) { this._safe = true; this.breathOn = false; if (this.breather) this.breather.ok = false; this._fallback = 'semplice (senza WebGL né ritocchi del viso)'; }
      try { this.ctx.restore(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.globalAlpha = 1; this.ctx.filter = 'none'; } catch {}
      // il canvas non riesce proprio a disegnare: la foto diventa lo sfondo CSS del canvas (che il movimento CSS fa respirare)
      if (this._errs >= 6 && !this._cssPhoto && this.img && this.img.src) { this._cssPhoto = true; this._fallback = 'foto CSS (canvas non disponibile)'; try { this.ctx.clearRect(0, 0, this.c.width, this.c.height); } catch {} this._cssBg = `#000 url("${String(this.img.src).replace(/"/g, '%22')}") center 22% / cover no-repeat`; this.c.style.background = this._cssBg; }
    }
    // v8.4.5: «cane da guardia»: se i fotogrammi si fermano (iOS Risparmio energetico, errore, rAF sospeso) riparte il ciclo e
    // il movimento CSS (respiro/ondeggiamento sul canvas, gestito dal compositore del browser) diventa più evidente
    // v8.5.2: isteresi sul fallback CSS — niente flip-flop fotogramma per fotogramma (causa del "saltella")
    watchdog() {
      const c = this.c, st = c.parentElement, now = performance.now();
      const vis = document.visibilityState === 'visible' && c.isConnected && c.getClientRects().length > 0;
      const age = now - (this._drawn || 0);
      const stale = vis && age > 1600;
      if (stale) {
        this._stalls = (this._stalls || 0) + 1;
        if (!this._stallSince) this._stallSince = now;
        try { cancelAnimationFrame(this._raf); } catch {}
        this._raf = requestAnimationFrame(this.loop);
      } else this._stallSince = 0;
      const want = !!this._safe || !!this._cssPhoto || (!!this._stallSince && now - this._stallSince > 700);
      if (want) this._stalledOn = true;
      else if ((this._okFrames || 0) > 60) this._stalledOn = false;
      if (st && st.classList && st.classList.contains('av-stalled') !== !!this._stalledOn) st.classList.toggle('av-stalled', !!this._stalledOn);
    }
    frame(now) {
      // non visibile: risparmia batteria (getClientRects funziona anche dentro contenitori position:fixed su iOS)
      if (!this.c.isConnected || this.c.getClientRects().length === 0) return;
      this._lerpLm(now);
      if (++this._frame % 30 === 0) this.resize();
      // v8.4.1: ritmo costante ~60 fotogrammi al secondo anche a riposo (prima 30: il movimento sembrava "a scatti");
      // sugli schermi a 120 Hz si salta un fotogramma su due (stesso ritmo, metà lavoro)
      if (now - (this._drawn || 0) < 12) return;
      const gap = this._drawn ? now - this._drawn : 16.7; this._drawn = now; const tP0 = performance.now();
      if (this.simUntil && now > this.simUntil) { this.simUntil = 0; this.speaking = false; }
      const ctx = this.ctx, S = VS; // spazio virtuale; la trasformazione porta tutto alle dimensioni reali del canvas
      const dt = Math.min(100, now - (this._last || now)); this._last = now;
      const kf = (a) => 1 - Math.pow(1 - a, dt / 16.67); // v8.4.1: smorzamenti indipendenti dal frame rate (uguali a 30, 60 o 120 Hz)
      { const tg = this.target(now); this.mouth += (tg - this.mouth) * kf(tg > this.mouth ? 0.5 : 0.28); // apertura rapida, chiusura morbida
        // v8.4.5: parla ma la bocca resta chiusa (audio non analizzabile, es. iOS): passa al labiale stimato dal testo
        if (this.speaking && this._env) { if (tg > 0.05) this._openAt = now; else if (!this._simFb && this._spkText && now - Math.max(this._spkAt || 0, this._openAt || 0) > 900) { this._simFb = true; this._env = null; this.simulateText(this._spkText, 1); } } }
      this.wide = (this.wide || 0.5) + (((this.speaking ? this.vWide : 0.5) ?? 0.5) - (this.wide || 0.5)) * kf(0.25); // forma della bocca interpolata
      this._dEff += (this.dist - this._dEff) * (1 - Math.exp(-dt / 260)); // distanza: avvicinamento/allontanamento morbido
      this._mh += (this.mouth - this._mh) * (1 - Math.exp(-dt / 140));
      // ritmo: se l'utente si muove a tempo, l'oscillazione segue il suo periodo (fase continua, niente scatti)
      const sens = this.sensual;
      const ST = this.style, learned = ST.confidence;
      // a riposo l'oscillazione segue (in parte) il tempo appreso dell'utente, anche a fotocamera spenta
      const idlePeriod = (sens ? 8000 : 6500) * (1 - learned * 0.5) + ST.tempo * 3 * learned * 0.5;
      const targetPeriod = this.rhythm ? this.rhythm.period * 2 : idlePeriod;
      this.swayPeriod += (targetPeriod - this.swayPeriod) * 0.02;
      this._ph = ((this._ph || 0) + dt / this.swayPeriod) % 1;
      const styleAmp = 0.75 + ST.headAmp * 0.9 + ST.energy * 0.35; // chi si muove di più → lei un po' più mobile
      const rAmp = (this.rhythm ? 0.034 + this.rhythm.strength * 0.022 : sens ? 0.05 : 0.042) * (this.rhythm ? 1 : styleAmp);
      const breath = Math.sin(now / (sens ? 5200 : 4000) * Math.PI * 2) * (sens ? 1.4 : 1);
      // v8.1: respiro accoppiato al parlato (inspira prima, espira piano mentre parla, riprende fiato tra le frasi)
      if (this.speaking !== this._wasSpk) { this._wasSpk = this.speaking; if (this.speaking) this.breathM.speechStart(now); else this.breathM.speechEnd(now); }
      const vol = this.breathM.vol(now);
      let sway = Math.sin(this._ph * Math.PI * 2) * rAmp + Math.sin(now / 2300) * 0.014 + Math.sin(now / 9100 + 2) * 0.01;
      let bob = this.rhythm ? Math.abs(Math.sin(this._ph * Math.PI * 2)) * this.rhythm.strength * S * 0.008 : 0;
      const talkNod = this.mouth * 0.02 + (this.speaking ? Math.sin(now / 330) * 0.008 : 0);
      // imitazione naturale: legge il campione di 300–800 ms fa (ritardo che varia), ne prende solo una parte (35–65%)
      // e ci arriva con molle smorzate (movimenti morbidi). Si spegne da sola se i dati non arrivano da ~1,5 s.
      if (now > this.nextLagAt) { this.lagTarget = 300 + (1 - ST.energy) * 380 + Math.random() * 120; this.nextLagAt = now + 2500 + Math.random() * 3000; }
      this.lag += (this.lagTarget - this.lag) * Math.min(1, dt / 900);
      this.gain = 0.5 + Math.sin(now / 7300) * 0.1 + Math.sin(now / 3100 + 1) * 0.05;
      const mirOn = this.mir.active && now - this.mir.at < 1500 + this.lag;
      let R = null;
      if (mirOn) { const tt = now - this.lag; for (let i = this.mirQ.length - 1; i >= 0; i--) if (this.mirQ[i].t <= tt) { R = this.mirQ[i].v; break; } }
      const M = this.m, V = this.vel, g = this.gain, sdt = dt / 1000;
      const spring = (cur, tgt, key, K) => { const D = 2 * Math.sqrt(K) * 0.95; V[key] += ((tgt - cur) * K - V[key] * D) * sdt; return cur + V[key] * sdt; };
      // a riposo: ogni tanto lei guarda altrove (girata e inclinazione leggere, ampiezza secondo lo stile appreso)
      const mc = this.micro;
      if (now > mc.nextLook) { mc.lookT = Math.random() < 0.35 ? 0 : (Math.random() * 2 - 1) * (0.5 + ST.headAmp); mc.nextLook = now + 2000 + Math.random() * 4000 * (1.2 - ST.energy); }
      mc.look += (mc.lookT - mc.look) * Math.min(1, dt / 600);
      const idle = R ? 0.25 : 1;
      const tgtTilt = (R ? R.tilt * g : 0) + mc.look * 0.35 * idle, tgtYaw = (R ? R.yaw * g : 0) + mc.look * 0.9 * idle, tgtPitch = R ? R.pitch * g : 0;
      M.tilt = spring(M.tilt, tgtTilt, 'tilt', 26); M.yaw = spring(M.yaw, tgtYaw, 'yaw', 22); M.pitch = spring(M.pitch, tgtPitch, 'pitch', 26);
      // piccole alzate di braccio a riposo, più frequenti per chi gesticola di più (solo mezzo busto / figura intera)
      if (now > mc.nextIdleLift) { mc.idleLiftT = Math.random() * (0.25 + ST.energy * 0.35); mc.nextIdleLift = now + (mc.idleLiftT > 0.05 ? 1600 : 0) + 60000 / Math.max(1, ST.gestPerMin + 4) * (0.6 + Math.random()); setTimeout(() => { mc.idleLiftT = 0; }, 1400 + Math.random() * 900); }
      M.lift[0] = Math.max(0, spring(M.lift[0], R ? R.lift[0] * (g + 0.1) : 0, 'l0', 18));
      M.lift[1] = Math.max(0, spring(M.lift[1], R ? R.lift[1] * (g + 0.1) : mc.idleLiftT * (R ? 0 : 1), 'l1', 18));
      M.energy += ((R ? R.energy * g : ST.energy * 0.12 * learned) - M.energy) * Math.min(1, dt / 500);
      sway += M.tilt * 0.12;
      bob += M.pitch * S * 0.02 + breath * S * 0.004;
      const shiftX = M.yaw * S * 0.04 + Math.sin(now / 5200) * S * 0.012 * idle; // girata + spostamento del peso
      // spalle: una sale mentre l'altra scende (lento), più marcato quando alza un braccio
      const skew = Math.max(-SKEW_MAX, Math.min(SKEW_MAX, Math.sin(now / 3700 + 1) * 0.011 * idle + (M.lift[1] - M.lift[0]) * 0.01 + M.tilt * 0.004));
      // reazione in corso
      let rx = 0, ry = 0, rRot = 0, smile = sens ? 0.25 : 0, wave = 0, A_nod = 0;
      const re = this.reaction;
      if (re) {
        const p = (now - re.start) / re.dur;
        if (p >= 1) this.reaction = null;
        else {
          const env = p < 0.3 ? ease(p / 0.3) : p > 0.65 ? ease((1 - p) / 0.35) : 1; // attacco e rilascio morbidi
          if (re.kind === 'nod') { ry = Math.sin(p * Math.PI * 4) * S * 0.014 * env; A_nod = Math.max(0, Math.sin(p * Math.PI * (re.n || 2) * 2)) * env * (re.amp || 1); }
          if (re.kind === 'shake') rx = Math.sin(p * Math.PI * 6) * S * 0.012 * env;
          if (re.kind === 'tilt') rRot = 0.07 * env;
          if (re.kind === 'smile' || re.kind === 'wave') smile = Math.max(smile, env);
          if (re.kind === 'wave') { wave = env; rRot = Math.sin(p * Math.PI * 6) * 0.03 * env; }
        }
      }
      // v8.4.1: cenni del capo (solo verticali, nessun movimento laterale): reazioni "annuisce", micro-movimenti a riposo con
      // rumore a strati (3 sinusoidi lente non multiple), leggero accento sulle sillabe mentre parla; tutto con una molla smorzata
      const idleN = (Math.sin(now / 1730) * 0.5 + Math.sin(now / 2970 + 1.3) * 0.3 + Math.sin(now / 5310 + 2.1) * 0.2) * (this.speaking ? 0.6 : 1);
      const nodT = A_nod * 1.0 + idleN * 0.07 + this._mh * 0.16;
      { const K = 70, D = 2 * Math.sqrt(K) * 0.9, sd = dt / 1000; this._nodV += ((nodT - this._nod) * K - this._nodV * D) * sd; this._nod += this._nodV * sd; }
      // battito di ciglia (in modalità sensuale: più lento, palpebre un po' abbassate)
      // ammiccamenti variabili: durata 120–240 ms, a volte doppi o a metà; più frequenti mentre parla
      // v8.4: ogni 2–6 s (a volte doppio); chiusura rapida (~150 ms) e riapertura più lenta (curva asimmetrica)
      if (now > this.nextBlink) {
        this.blinkStart = now; this.blinkDur = (sens ? 330 : 250) + Math.random() * 70; this.blinkAmp = Math.random() < 0.08 ? 0.6 : 1;
        const dbl = !this.blinkDouble && Math.random() < 0.14; this.blinkDouble = dbl ? 1 : 0;
        this.nextBlink = dbl ? now + this.blinkDur + 70 : now + (2000 + Math.random() * 4000) * (sens ? 1.25 : 1);
      }
      const bt = (now - this.blinkStart) / this.blinkDur, BC = 0.36;
      let blink = bt < 0 || bt >= 1 ? 0 : (bt < BC ? Math.sin((bt / BC) * Math.PI / 2) ** 1.6 : 1 - ease((bt - BC) / (1 - BC))) * this.blinkAmp;
      // palpebre rilassate: a riposo a volte un filo abbassate (mai mentre parla con enfasi)
      if (now > (mc.nextLid || 0)) { mc.lidT = Math.random() < 0.45 ? 0 : 0.06 + Math.random() * 0.1; mc.nextLid = now + 3500 + Math.random() * 5500; }
      mc.lid = (mc.lid || 0) + (((this.speaking ? 0 : mc.lidT) || 0) - (mc.lid || 0)) * Math.min(1, dt / 700);
      blink = Math.max(blink, mc.lid);
      // sopracciglia: alzate rapide su enfasi/reazioni e piccole alzate spontanee
      if ((now - this.emph < 120 || (re && now - re.start < 80)) && mc.browUntil < now) { mc.browT = 0.7 + Math.random() * 0.3; mc.browUntil = now + 380; }
      if (now > mc.nextBrow) { mc.browT = 0.3 + Math.random() * 0.4; mc.browUntil = now + 250 + Math.random() * 250; mc.nextBrow = now + 6000 + Math.random() * 8000; }
      if (now > mc.browUntil) mc.browT = 0;
      mc.brow += (mc.browT - mc.brow) * Math.min(1, dt / (mc.browT > mc.brow ? 70 : 220));
      // sguardo: saccadi rapide verso punti vicini, poi fissazione; con l'imitazione tende a guardare l'utente
      // v8.4: mentre parla guarda in camera (saccadi piccole); i grandi spostamenti di sguardo spesso portano un ammiccamento
      if (now > mc.nextSacc) {
        const r = R ? 0.35 : this.speaking ? 0.28 : 1, ox = mc.gtx, oy = mc.gty;
        mc.gtx = (Math.random() * 2 - 1) * r - (R ? R.yaw * 0.3 : 0); mc.gty = (Math.random() * 2 - 1) * 0.5 * r;
        if (Math.random() < (this.speaking ? 0.6 : 0.35)) { mc.gtx = 0; mc.gty = 0; }
        if (Math.hypot(mc.gtx - ox, mc.gty - oy) > 0.55 && Math.random() < 0.45 && now - this.blinkStart > 700) this.nextBlink = now + 20;
        mc.nextSacc = now + (this.speaking ? 900 : 700) + Math.random() * 2600;
      }
      if (now > (mc.nextMicro || 0)) { mc.mx = (Math.random() * 2 - 1) * 0.07; mc.my = (Math.random() * 2 - 1) * 0.05; mc.nextMicro = now + 280 + Math.random() * 420; } // micro-saccadi
      const sk = Math.min(1, dt / 30); mc.gx += (mc.gtx + (mc.mx || 0) - mc.gx) * sk; mc.gy += (mc.gty + (mc.my || 0) - mc.gy) * sk;
      // sorrisi accennati spontanei (più spesso in modalità sensuale)
      if (now > mc.nextSmile) { mc.smileT = 0.2 + Math.random() * 0.25; mc.smileUntil = now + 1200 + Math.random() * 1800; mc.nextSmile = now + (sens ? 6000 : 9000) + Math.random() * 12000; }
      if (now > mc.smileUntil) mc.smileT = 0;
      mc.smile += (mc.smileT - mc.smile) * Math.min(1, dt / 400);
      const realSmile = smile; smile = Math.max(smile, mc.smile);
      if (sens) blink = Math.max(blink, 0.18 + Math.sin(now / 3000) * 0.05);
      const squint = realSmile; // solo sorrisi veri (reazioni/sensuale) socchiudono gli occhi, non quelli accennati
      if (squint > 0.3) blink = Math.max(blink, squint * 0.25); // occhi che "sorridono"

      // ---- disegno: contenimento (contain) nel riquadro, mai ritagliato; scena cinematografica facoltativa ----
      const A = { nod: this._nod, now, S, rot: Math.max(-ROT_MAX, Math.min(ROT_MAX, sway + talkNod + rRot)), shiftX: Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, shiftX + rx)), bob: Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, bob + ry)), skew, breath, vol, smile, blink, wave, mc, M, spring };
      if (!this.transparent && (this._frame % 10 === 0 || !this.bd)) this.syncBackdrop();
      const CW = this.c.width, CH = this.c.height, col = this.colors;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, CW, CH);
      const scn = this.sceneOn();
      if (scn && scn.landmarks && scn.landmarks.auto) {
        // v8.3: scena seduta al tavolo (foto 9:16) disegnata come la foto dell'avatar: intera, respiro da seduta, viso animato, gesti
        const sv = [this.img, this.lm, this.lidColor];
        this.img = scn.img; this.lm = scn.landmarks; this.lidColor = scn.lids || sv[2];
        try { const r = this.paintAvatar(ctx, { x: 0, y: 0, w: CW, h: CH }, A, true); if (!this.soloFill()) this.featherEdges(ctx, r, CW, CH); }
        finally { this.img = sv[0]; this.lm = sv[1]; this.lidColor = sv[2]; }
      } else if (scn) this.paintScene(ctx, CW, CH, A, scn);
      else {
        // con la foto: canvas trasparente intorno, sotto c'è lo sfondo sfocato CSS (syncBackdrop); senza foto (emoji): colore pieno
        if (!this.transparent && !this.img) { ctx.fillStyle = col.background; ctx.fillRect(0, 0, CW, CH); }
        const r = this.paintAvatar(ctx, { x: 0, y: 0, w: CW, h: CH }, A, true);
        if (this.img) { if (this.transparent) featherRect(ctx, r); else if (!this.soloFill()) this.featherEdges(ctx, r, CW, CH); }
      }
      // cambio foto: dissolvenza dall'ultima immagine (niente salti di dimensione)
      if (this._snap) {
        const p = (now - this._snap.t) / 420;
        if (p >= 1 || this._snap.c.width !== CW || this._snap.c.height !== CH) this._snap = null;
        else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - ease(p); ctx.drawImage(this._snap.c, 0, 0); ctx.globalAlpha = 1; }
      }
      // piccole icone che salgono (risposta ai gesti: 👋 👍 ✌️ 👌 …)
      if (this.badges.length) {
        const U = Math.min(CW, CH);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        this.badges = this.badges.filter((b) => now - b.t < 1800);
        for (const b of this.badges) { const p = (now - b.t) / 1800; ctx.globalAlpha = 1 - p; ctx.font = `${U * 0.12}px system-ui, "Apple Color Emoji", sans-serif`; ctx.fillText(b.e, b.x * CW, CH * (0.82 - p * 0.35)); }
        ctx.globalAlpha = 1;
      }
      const stage = this.c.parentElement;
      if (stage && (this._stSp !== this.speaking || this._stGl !== col.glow)) { this._stSp = this.speaking; this._stGl = col.glow; stage.classList.toggle('speaking', this.speaking); stage.style.setProperty('--glow', col.glow); }
      const pulse = sens ? Math.round(14 + Math.sin(now / 1400) * 8) : 0;
      // v8.4.5: niente più contorno pieno colorato (a schermo intero sembrava un bordo rosso di "registrazione"): solo un alone
      // morbido nella vista normale, nessun alone a schermo intero o in chiamata
      const bare = stage && stage.classList && (stage.classList.contains('fs') || stage.classList.contains('call'));
      const bs = bare ? '' : this.speaking ? `0 0 18px ${col.glow}55` : sens ? `0 0 ${pulse}px ${col.glow}44` : '';
      if (bs !== this._bs) { this._bs = bs; this.c.style.boxShadow = bs; } // v8.4.1: niente scritture di stile a ogni fotogramma
      const P = this._pf, i = P.n++ % 240; P.draw[i] = performance.now() - tP0; P.gap[i] = gap;
    }

    // Estensione dell'immagine intera nello spazio "quadrato S" dei punti del viso (il quadrato centrale = 0..S)
    extent(img) {
      const S = VS;
      if (!img) return { x0: 0, y0: 0, w: S, h: S };
      const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), k = s / S;
      return { x0: -((nw - s) / 2) / k, y0: -((nh - s) / 2) / k, w: nw / k, h: nh / k };
    }
    // v7.1: avatar GRANDE e fermo. La foto è contenuta per intero (contain, mai ritagliata) e riempie il più possibile il riquadro;
    // lo spazio avanzato è coperto da una copia sfocata e statica della stessa foto (v7.2: sfondo CSS sfocato, vedi syncBackdrop).
    // Il riquadro della foto NON si muove: il movimento è una deformazione interna (strisce orizzontali) che fa ondeggiare busto e testa.
    // v8.4: riempimento intelligente della cornice 9:16: "cover" ancorato al viso, ma al massimo ~12% tagliato per lato
    // e mai la testa; se la foto è troppo diversa dalla cornice restano bande riempite col colore dei bordi (mai sfocate).
    soloFill() {
      return typeof document !== 'undefined' && document.body && document.body.classList.contains('solo-mode') && this.c && this.c.id === 'avatar-canvas';
    }
    // v8.6.1: cover sul palco intero, ancorato al viso (circa 22% dall'alto). La testa resta nel riquadro.
    soloCover(box, E) {
      const S = VS, lm = this.lm || {};
      const eL = lm.eyeL || { x: 0.42, y: 0.38 }, eR = lm.eyeR || { x: 0.58, y: 0.38 };
      const ed = Math.max(1, Math.hypot(eR.x - eL.x, eR.y - eL.y) * S);
      const fx = ((eL.x + eR.x) / 2) * S, fy = Math.min(eL.y, eR.y) * S;
      const headTop = fy - ed * 1.75;
      const chin = (lm.mouth && lm.mouth.y ? lm.mouth.y * S : fy + ed) + ed * 0.35;
      const fit = Math.max(box.w / Math.max(1, E.w), box.h / Math.max(1, E.h));
      const W = E.w * fit, H = E.h * fit;
      const ovw = Math.max(0, W - box.w), ovh = Math.max(0, H - box.h);
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      const imgY = (y) => ((y - E.y0) / E.h) * H;
      const eyeX = ((fx - E.x0) / E.w) * W;
      const cl = ovw > 0 ? clamp(eyeX - box.w / 2, 0, ovw) : -(box.w - W) / 2;
      let ct = ovh > 0 ? clamp(imgY(E.y0 + E.h * 0.22) - box.h * 0.22, 0, ovh) : -(box.h - H) / 2;
      if (ovh > 0) {
        const margin = box.h * 0.02;
        const ctMax = clamp(imgY(headTop) - margin, 0, ovh);
        const ctMin = clamp(imgY(chin) - (box.h - margin), 0, ovh);
        ct = ctMin <= ctMax ? clamp(ct, ctMin, ctMax) : ctMax;
      }
      this._headFrac = (ed * 3.6 * fit) / Math.max(1, box.h);
      return { fit, ox: box.x - cl - E.x0 * fit, oy: box.y - ct - E.y0 * fit };
    }
    photoRect(box, E, alignBottom) {
      if (this.soloFill() && this.img && !this.transparent && !this.noCover) return this.soloCover(box, E);
      const fc = Math.max(1e-6, Math.min(box.w / E.w, box.h / E.h));
      if (!this.img || this.transparent || this.noCover) {
        const pad = Math.min(box.w, box.h) * 0.006, fit = Math.max(1e-6, Math.min((box.w - 2 * pad) / E.w, (box.h - 2 * pad) / E.h));
        const cx = box.x + box.w / 2, cy = alignBottom ? box.y + box.h - pad - (E.h * fit) / 2 : box.y + box.h / 2;
        return { fit, ox: cx - (E.x0 + E.w / 2) * fit, oy: cy - (E.y0 + E.h / 2) * fit };
      }
      const CROP = 0.12, fv = Math.max(box.w / E.w, box.h / E.h), fit = Math.min(fv, fc / (1 - 2 * CROP));
      const W = E.w * fit, H = E.h * fit, S = VS, lm = this.lm || {};
      const eL = lm.eyeL || { x: 0.42, y: 0.4 }, eR = lm.eyeR || { x: 0.58, y: 0.4 }, ed = Math.hypot(eR.x - eL.x, eR.y - eL.y) * S;
      const fx = ((eL.x + eR.x) / 2) * S, fy = Math.min(eL.y, eR.y) * S, head = fy - ed * 1.6; // cima della testa (stima)
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      // v8.4.1: più lontana. La testa (≈3,6 × distanza fra gli occhi) punta al 18–32% dell'altezza della cornice secondo la
      // "distanza" (predefinita 0,75 ≈ 21%): meno taglio, più corpo e più stanza. Solo rimpicciolimento e al massimo fino a
      // contenere la foto (niente riquadri dentro la cornice); per allontanarla davvero c'è «🔭 Allontana con l'IA» (foto più ampia).
      const dd = this._dEff == null ? this.dist || 0 : this._dEff;
      if (dd > 0.01) {
        const T = 0.32 - 0.14 * dd, fD = (T * box.h) / Math.max(1, ed * 3.6), fMin = fc, f2 = clamp(fD, fMin, fit); // mai una "foto nella foto": al massimo fino a contenerla (bande in tinta solo sul lato corto)
        if (f2 < fit - 1e-9) {
          const W2 = E.w * f2, H2 = E.h * f2, ow = W2 - box.w, oh = H2 - box.h;
          const eyeX = ((fx - E.x0) / E.w) * W2, eyeY = ((fy - E.y0) / E.h) * H2;
          const cl2 = ow > 0 ? clamp(eyeX - box.w / 2, 0, ow) : -(box.w - W2) / 2;
          const hp = ((head - E.y0) / E.h) * H2;
          const ct2 = oh > 0 ? clamp(eyeY - box.h * 0.33, 0, Math.max(0, Math.min(oh, hp - box.h * 0.03))) : -(box.h - H2) / 2;
          this._headFrac = (ed * 3.6 * f2) / box.h;
          return { fit: f2, ox: box.x - cl2 - E.x0 * f2, oy: box.y - ct2 - E.y0 * f2 };
        }
      }
      this._headFrac = (ed * 3.6 * fit) / box.h;
      const ovw = Math.max(0, W - box.w), ovh = Math.max(0, H - box.h);
      const cl = ovw ? clamp(((fx - E.x0) / E.w) * W - box.w / 2, Math.max(0, ovw - CROP * W), Math.min(ovw, CROP * W)) : -(box.w - W) / 2;
      const headPx = ((head - E.y0) / E.h) * H;
      const ctMax = Math.max(0, Math.min(ovh, CROP * H, headPx - box.h * 0.02));
      const ct = ovh ? (alignBottom ? ovh : clamp(((fy - E.y0) / E.h) * H - box.h * 0.36, Math.min(ctMax, Math.max(0, ovh - CROP * H)), ctMax)) : -(box.h - H) / 2;
      return { fit, ox: box.x - cl - E.x0 * fit, oy: box.y - ct - E.y0 * fit };
    }
    paintAvatar(ctx, box, A, top, alignBottom) {
      const S = VS, img = this.img, E = this.extent(img), col = this.colors;
      const { fit, ox, oy } = this.photoRect(box, E, alignBottom);
      const rect = { x: ox + E.x0 * fit, y: oy + E.y0 * fit, w: E.w * fit, h: E.h * fit };
      ctx.setTransform(fit, 0, 0, fit, ox, oy);
      const plain = !+col.hue && +col.saturation === 100 && +col.brightness === 100; // filtro solo se serve (è costoso)
      ctx.filter = plain ? 'none' : `hue-rotate(${col.hue}deg) saturate(${col.saturation}%) brightness(${col.brightness}%)`;
      if (top) {
        this._shown = { img, lm: this.lm }; // v8.2/8.3: ritratto della chiamata vocale (avatar o scena al tavolo)
        this._bounds = { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h, cw: this.c.width, ch: this.c.height, static: true, warp: 0 };
      }
      const { mc, M, spring, now, wave } = A;
      const done = () => { ctx.filter = 'none'; const T = ctx.getTransform(); ctx.setTransform(1, 0, 0, 1, 0, 0); return { ...rect, T }; };
      const act = top ? this.actionAlpha(now) : null; // azione in corso (clip o posa): dissolvenza incrociata
      if (act && act.a >= 0.999) { this.paintAction(ctx, E, A, act); return done(); }
      if (act) ctx.globalAlpha = 1 - act.a;
      if (img) {
        // v7.2: foto disegnata in un colpo solo (niente strisce: su iPhone Safari lasciavano giunture orizzontali).
        // Respiro: compressione verticale minima ancorata in basso (≤ 0,25%), sempre dentro il riquadro.
        // v8.1: respiro realistico con deformazione morbida WebGL (spalle/petto/testa, sfondo fermo); se WebGL manca, il vecchio respiro.
        let src = img, headDy = 0; const trust = this.faceTrusted();
        if (trust && !this._safe && this.breathOn !== false && img.naturalWidth) {
          if (!this.breather) this.breather = new Breather();
          if (this.breather.ok && this.breather.setup(img, this.lm)) { const amp = Math.min(1.25, this.breathAmp || 1.2); src = this.breather.render(A.vol, amp, A.nod || 0); headDy = this.breather.headDy(A.vol, amp, A.nod || 0); }
        }
        // v8.4.3: senza respiro WebGL (o con punti incerti) il respiro dell'immagine intera è VISIBILE (prima 0,25%: sembrava ferma),
        // più un leggero "sollevarsi" mentre parla; solo verticale, ancorato in basso: la cornice resta ferma, niente ondeggiamento laterale
        const br = Math.max(-1, Math.min(1, A.breath)), talk = this.speaking ? Math.min(1, this._mh || 0) : 0;
        // Senza WebGL (Safari) e senza clip: il busto si alza in modo liscio, ancorato in basso, seguendo la bocca già filtrata.
        const Y1b = E.y0 + E.h, bs = src === img ? 1 + (trust ? 0.0035 : 0.008) * (1 + br) + talk * (trust ? 0.006 : 0.02) : 1;
        ctx.save(); ctx.beginPath(); ctx.rect(E.x0, E.y0, E.w, E.h); ctx.clip();
        const cxb = E.x0 + E.w / 2; ctx.translate(cxb, Y1b); ctx.scale(src === img ? 1 + (bs - 1) * 0.25 : 1, bs); ctx.translate(-cxb, -Y1b);
        ctx.drawImage(src, E.x0, E.y0, E.w, E.h);
        // Gesti (mezzo busto / figura intera): braccia che si muovono col ritmo e l'intensità del parlato.
        const tgt = (this.speaking ? 0.35 + this.mouth * 0.7 + (now - this.emph < 700 ? 0.6 : 0) : 0) + M.energy * 0.6 + wave * 0.8;
        this.gesture = Math.max(0, spring(this.gesture, tgt, 'gesture', 9)); // gesti morbidi (molla smorzata)
        const lifted = M.lift[0] > 0.05 || M.lift[1] > 0.05;
        if (GESTURE_REGIONS && this.gesturesOn && this.framing !== 'ritratto' && (this.gesture > 0.02 || lifted)) { // v7.1: disattivato (creava giunture e spostamenti laterali)
          const sh = this.framing === 'figura intera' ? 0.24 : 0.42; // altezza spalle
          const mx = this.lm.mouth.x, X1 = E.x0 + E.w, Y1 = E.y0 + E.h;
          ctx.save(); ctx.beginPath(); ctx.rect(E.x0, E.y0, E.w, E.h); ctx.clip();
          [-1, 1].forEach((side) => {
            const px = (mx + side * (this.framing === 'figura intera' ? 0.09 : 0.2)) * S, py = sh * S, odx = 0;
            const lift = side < 0 ? M.lift[0] : M.lift[1];
            const waveSide = wave && side > 0 ? Math.sin(now / 120) * 0.08 * wave - 0.12 * wave : 0;
            const ang = side * this.gesture * 0.07 * Math.sin(now / 260 + (side > 0 ? 0 : 1.3)) - side * lift * 0.16 + waveSide;
            const rx = side < 0 ? E.x0 : px, rw = side < 0 ? px - E.x0 : X1 - px;
            ctx.save(); ctx.translate(odx, 0); ctx.beginPath(); ctx.rect(rx, py, rw, Y1 - py); ctx.clip();
            ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py - this.gesture * S * 0.006);
            drawCover(ctx, img, S, { sx: rx, sy: py - S * 0.05, sw: rw, sh: Y1 - py + S * 0.05 }); ctx.restore();
          });
          ctx.restore();
        }
        // viso (labiale, occhi, sopracciglia): le "toppe" sono scalate sulla distanza reale fra gli occhi (v7.2: prima erano
        // dimensionate per un primo piano, e su una figura intera la toppa delle sopracciglia diventava una striscia scura sulla fronte)
        // la testa è salita col respiro: le espressioni usano i punti spostati di quanto (nella foto deformata il viso è lì)
        const lmF = headDy ? shiftLm(this.lm, headDy / S) : this.lm;
        if (trust && !this._safe) this.paintFace(ctx, src, lmF, A, faceScale(this.lm), this.lidColor); // v8.4.3: occhi/bocca solo con punti certi
        ctx.restore();
      } else {
        ctx.font = `${S * 0.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(1 + this.mouth * 0.04, 1 - this.mouth * 0.06);
        ctx.translate(0, -mc.brow * S * 0.006 + A.bob * 0.3); ctx.fillText(this.emoji, 0, S * 0.03); ctx.restore();
      }
      if (act) { ctx.globalAlpha = act.a; this.paintAction(ctx, E, A, act); ctx.globalAlpha = 1; }
      return done();
    }
    // v7.2: sfondo sfocato fatto dal BROWSER (CSS filter: blur su un elemento dietro al canvas), liscio anche su iPhone Safari.
    // Prima era una sfocatura manuale nel canvas (rimpicciolisci/ingrandisci) che su iOS usciva a blocchi con bordi netti.
    syncBackdrop(force) {
      const c = this.c, par = c.parentElement; if (!par) return;
      const show = !this.transparent && !!this.img && !this.sceneOn();
      if (!this.bd) {
        if (this.transparent) return;
        if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
        const bd = document.createElement('div'); bd.className = 'av-backdrop'; bd.setAttribute('aria-hidden', 'true');
        const inner = document.createElement('div'); bd.appendChild(inner); par.insertBefore(bd, c); this.bd = bd; this._bdKey = '';
      }
      const bd = this.bd, f = this.colorFilter();
      const key = [show, this.img && this.img._src, c.offsetLeft, c.offsetTop, c.offsetWidth, c.offsetHeight, f, this.colors.background, getComputedStyle(c).borderRadius].join('|');
      if (!force && key === this._bdKey) return; this._bdKey = key;
      bd.hidden = !show;
      c.style.background = this._cssPhoto ? this._cssBg : show ? 'transparent' : this.colors.background;
      if (!show) return;
      Object.assign(bd.style, { left: c.offsetLeft + 'px', top: c.offsetTop + 'px', width: c.offsetWidth + 'px', height: c.offsetHeight + 'px', borderRadius: getComputedStyle(c).borderRadius, background: this.colors.background });
      const inner = bd.firstChild;
      // v8.4: bande riempite coi colori dei bordi della foto (sfumatura), mai una copia sfocata
      const ed = this.edgeColors(), wideImg = this.img.naturalWidth / this.img.naturalHeight > c.offsetWidth / Math.max(1, c.offsetHeight);
      inner.style.backgroundImage = ed ? (wideImg ? `linear-gradient(180deg, ${ed.t} 0%, ${ed.t} 30%, ${ed.b} 70%, ${ed.b} 100%)` : `linear-gradient(90deg, ${ed.l} 0%, ${ed.l} 30%, ${ed.r} 70%, ${ed.r} 100%)`) : 'none';
      inner.style.filter = f === 'none' ? 'none' : f;
    }
    // bordi della foto sfumati verso lo sfondo (trasparenza nel canvas, lo sfondo CSS si vede sotto); lati a filo del riquadro lasciati netti
    featherEdges(ctx, r, CW, CH) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-out';
      const bx = Math.max(6, r.w * EDGE_SIDE), by = Math.max(6, Math.max(r.h * EDGE_TB, bx));
      const side = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh); };
      if (r.x > CW * 0.02) side(r.x, 0, r.x + bx, 0, r.x - 1, r.y - 1, bx + 1, r.h + 2);
      if (r.x + r.w < CW * 0.98) side(r.x + r.w, 0, r.x + r.w - bx, 0, r.x + r.w - bx, r.y - 1, bx + 1, r.h + 2);
      if (r.y > CH * 0.02) side(0, r.y, 0, r.y + by, r.x - 1, r.y - 1, r.w + 2, by + 1);
      if (r.y + r.h < CH * 0.98) side(0, r.y + r.h, 0, r.y + r.h - by, r.x - 1, r.y + r.h - by, r.w + 2, by + 1);
      ctx.restore();
    }
    edgeColors() {
      const im = this.img; if (!im || !im.naturalWidth) return null;
      if (im._edges) return im._edges;
      try {
        const n = 24, t = document.createElement('canvas'); t.width = t.height = n; const g = t.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, n, n); const d = g.getImageData(0, 0, n, n).data;
        const avg = (xs, ys) => { let r = 0, gg = 0, b = 0, k = 0; for (const y of ys) for (const x of xs) { const i = (y * n + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; k++; } return `rgb(${(r / k) | 0},${(gg / k) | 0},${(b / k) | 0})`; };
        const all = [...Array(n).keys()];
        im._edges = { l: avg([0, 1], all), r: avg([n - 2, n - 1], all), t: avg(all, [0, 1]), b: avg(all, [n - 2, n - 1]) };
      } catch { im._edges = null; }
      return im._edges;
    }
    colorFilter() { const col = this.colors; return (!+col.hue && +col.saturation === 100 && +col.brightness === 100) ? 'none' : `hue-rotate(${col.hue}deg) saturate(${col.saturation}%) brightness(${col.brightness}%)`; }
    // ---- AZIONI (v7): clip video o posa, disegnate nel riquadro dell'avatar con gli stessi movimenti (niente ritagli) ----
    // spec: { kind: 'video', url } | { kind: 'pose', url, lm? }. Restituisce una Promise che si risolve a fine azione.
    playAction(spec) {
      this.stopAction(true);
      return new Promise((resolve, reject) => {
        const done = (ok) => { if (this.act && this.act.resolve === resolve) { this.act = null; } resolve(ok); };
        const fail = (e) => { if (this.act && this.act.resolve === resolve) this.act = null; reject(e); };
        if (spec.kind === 'video') {
          const v = this._vid || (this._vid = document.createElement('video'));
          const snd = !!(window.App && App.audio && App.audio.clipSound()); v.muted = !snd; v.defaultMuted = !snd; v.volume = 1; v.playsInline = true; // v7.3: audio della clip se la lettura è attiva e l'audio sbloccato
           v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'auto'; v.loop = false;
          const act = { kind: 'video', el: v, resolve, start: 0, fadeIn: 420, fadeOut: 560, endAt: 0, ready: false };
          this.act = act;
          const to = setTimeout(() => fail(new Error('Video non caricato')), 9000);
          v.oncanplay = () => { if (this.act !== act || act.ready) return; act.ready = true; clearTimeout(to); act.start = performance.now(); v.play().catch((e) => { if (!v.muted) { v.muted = true; v.play().catch((e2) => fail(e2)); } else fail(e); }); }; // se l'audio è bloccato, riparte muta
          v.onended = () => { if (this.act === act && !act.endAt) act.endAt = performance.now(); };
          v.onerror = () => { clearTimeout(to); fail(new Error('Video non riproducibile')); };
          act.finish = () => done(true);
          v.src = spec.url; v.load();
        } else {
          const im = new Image();
          const act = { kind: 'pose', img: im, lm: spec.lm || null, resolve, start: 0, dur: spec.dur || 3400, fadeIn: 520, fadeOut: 620, ready: false };
          this.act = act;
          im.onload = () => { if (this.act !== act) return; act.ready = true; act.start = performance.now(); if (act.lm) act.lids = lidsFor(im, act.lm); };
          im.onerror = () => fail(new Error('Immagine non caricata'));
          act.finish = () => done(true);
          im.src = spec.url;
        }
      });
    }
    setActionLandmarks(lm) { if (this.act && this.act.kind === 'pose' && lm) { this.act.lm = lm; try { this.act.lids = lidsFor(this.act.img, lm); } catch {} } }
    stopAction(silent) { const a = this.act; if (!a) return; if (a.el) { try { a.el.pause(); } catch {} } this.act = null; if (!silent) a.resolve(false); else a.resolve(false); }
    actionBusy() { return !!this.act; }
    // opacità dell'azione: entra, resta, esce (per i video l'uscita parte alla fine della clip)
    actionAlpha(now) {
      const a = this.act; if (!a || !a.ready || !a.start) return null;
      const t = now - a.start; let al;
      if (a.kind === 'video') {
        const v = a.el, left = (v.duration && isFinite(v.duration)) ? (v.duration - v.currentTime) * 1000 : 9999;
        if (!a.endAt && left < a.fadeOut) a.endAt = now + left - a.fadeOut;
        if (t > 15000 && !a.endAt) a.endAt = now; // tetto di sicurezza
        if (a.endAt) { const p = (now - a.endAt) / a.fadeOut; if (p >= 1) { a.finish(); return null; } al = Math.min(1, t / a.fadeIn) * (1 - Math.max(0, p)); }
        else al = Math.min(1, t / a.fadeIn);
      } else {
        if (t >= a.dur) { a.finish(); return null; }
        al = Math.min(1, t / a.fadeIn, (a.dur - t) / a.fadeOut);
      }
      return { a: ease(Math.max(0, Math.min(1, al))), t, act: a };
    }
    paintAction(ctx, E, A, st) {
      const a = st.act;
      if (a.kind === 'video') {
        const v = a.el, vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return;
        const k = Math.max(E.w / vw, E.h / vh), sw = E.w / k, sh = E.h / k; // riempie esattamente il riquadro dell'avatar (stesso formato)
        ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, E.x0, E.y0, E.w, E.h);
        return;
      }
      const im = a.img, E2 = this.extent(im);
      const k = Math.min(E.w / E2.w, E.h / E2.h), zoom = 1 + 0.045 * Math.min(1, st.t / a.dur); // Ken Burns lento, dentro il riquadro
      const cx = E.x0 + E.w / 2, cy = E.y0 + E.h / 2, px = 0; // v7.1: niente parallasse laterale
      ctx.save(); ctx.beginPath(); ctx.rect(E.x0, E.y0, E.w, E.h); ctx.clip();
      ctx.translate(cx + px, cy); ctx.scale(k * zoom, k * zoom); ctx.translate(-(E2.x0 + E2.w / 2), -(E2.y0 + E2.h / 2));
      ctx.drawImage(im, E2.x0, E2.y0, E2.w, E2.h);
      if (a.lm) this.paintFace(ctx, im, a.lm, A, faceScale(a.lm), a.lids); // labiale, ammiccamenti, sguardo anche sulla posa
      ctx.restore();
    }
    // Espressioni sul viso della foto (labiale, sorriso, sguardo, sopracciglia, palpebre). fs = scala del viso (1 = ritratto).
    paintFace(ctx, img, lm, A, fs, lids) {
      const S = VS, { mc, smile, blink } = A;
      const open = Math.max(0, this.mouth), F = S * fs;
      const EW = lm.eyeW ? lm.eyeW * S : F * 0.072, EH = lm.eyeH ? Math.max(lm.eyeH * S, EW * 0.22) : F * 0.026;
      // v8.4: angoli e forma della bocca: larghezza (visemi) e sorriso spostano gli angoli; patch ancorate ai punti del viso
      // A riposo non si disegna nulla sulla bocca: i pixel restano quelli della foto.
      // Parlando, mascella e labbra si aprono in modo simmetrico attorno alla bocca vera, lungo la sua linea
      // (non la linea degli occhi). Nessuna rotazione solo della bocca: se la testa è inclinata, la bocca resta con il viso.
      if (open > 0.02) paintMouth(ctx, img, lm, open, Math.max(0, Math.min(1, (this.wide ?? 0.5) + smile * 0.06)));
      const gxp = mc.gx * F * 0.0045, gyp = mc.gy * F * 0.0025, bup = mc.brow * F * 0.007, px = F * 0.0006;
      [lm.eyeL, lm.eyeR].forEach((e, ei) => {
        if (Math.abs(gxp) > px || Math.abs(gyp) > px) {
          const w = EW * 1.04, h = Math.max(EH * 1.4, EW * 0.45), b = F * 0.006;
          ctx.save(); ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(gxp, gyp); drawCover(ctx, img, S, { sx: e.x * S - w / 2 - b, sy: e.y * S - h / 2 - b, sw: w + 2 * b, sh: h + 2 * b }); ctx.restore();
        }
        if (bup > px) {
          const br = ei ? lm.browR : lm.browL; // v8: posizione vera del sopracciglio, se rilevata
          const w = Math.max(F * 0.1, EW * 1.6), h = w * 0.37, cx = br ? br.x * S : e.x * S, cy = br ? br.y * S : e.y * S - F * 0.075; // sopra la palpebra, senza toccare l'occhio
          ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(0, -bup); drawCover(ctx, img, S, { sx: cx - w / 2, sy: cy - h / 2, sw: w, sh: h + bup + F * 0.006 }); ctx.restore();
        }
      });
      if (blink > 0.035) {
        // v8.4: palpebra superiore vera: la pelle sopra l'occhio (dalla foto) scende seguendo la forma dell'occhio,
        // con ombra sul bordo e ciglia; inclinata come la linea degli occhi. Tutto ancorato ai punti del viso.
        const roll = Math.atan2(lm.eyeR.y - lm.eyeL.y, lm.eyeR.x - lm.eyeL.x);
        [lm.eyeL, lm.eyeR].forEach((e, i) => {
          const ex = e.x * S, ey = e.y * S, hw = EW * 0.6, eh = Math.max(EH * 0.62, EW * 0.16), b = Math.min(1, blink);
          const up = (t) => ey - eh * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.12 * t * (i ? -1 : 1)); // bordo superiore (un po' asimmetrico)
          const lo = (t) => ey + eh * 0.72 * Math.sqrt(Math.max(0, 1 - t * t));
          const edge = (t) => up(t) + (lo(t) - up(t)) * b, skin = eh * 1.5, N = 14;
          ctx.save(); ctx.translate(ex, ey); ctx.rotate(roll); ctx.translate(-ex, -ey);
          ctx.beginPath(); ctx.moveTo(ex - hw * 1.08, ey);
          for (let k = 0; k <= N; k++) { const t = -1 + (2 * k) / N; ctx.lineTo(ex + t * hw * 1.04, up(t) - skin * Math.sqrt(Math.max(0, 1 - t * t)) * 0.9); }
          ctx.lineTo(ex + hw * 1.08, ey);
          for (let k = N; k >= 0; k--) { const t = -1 + (2 * k) / N; ctx.lineTo(ex + t * hw, Math.max(edge(t), up(t))); }
          ctx.closePath(); ctx.clip();
          // pelle della palpebra: la fascia sopra l'occhio, allungata verso il basso fino al bordo
          const sy0 = ey - eh - skin, sh0 = skin, dh = skin + eh * 1.72 * b + eh * 0.12 * b;
          if (img.naturalWidth) { const sq = Math.min(img.naturalWidth, img.naturalHeight), k = sq / S, ox = (img.naturalWidth - sq) / 2, oy = (img.naturalHeight - sq) / 2;
            ctx.drawImage(img, ox + (ex - hw * 1.1) * k, oy + sy0 * k, hw * 2.2 * k, sh0 * k, ex - hw * 1.1, sy0, hw * 2.2, dh); }
          const mm = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(String(lids && lids[i]).replace(/\s/g, ''));
          const rgb = mm ? `${mm[1]},${mm[2]},${mm[3]}` : '200,150,150';
          // un velo del colore della pelle (uniforma) e ombra verso il bordo della palpebra
          const g = ctx.createLinearGradient(0, sy0, 0, ey + eh);
          g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.45, `rgba(${rgb},${0.4 * b})`); g.addColorStop(1, `rgba(${rgb},${0.55 * b})`);
          ctx.fillStyle = g; ctx.fillRect(ex - hw * 1.2, sy0, hw * 2.4, ey + eh * 2 - sy0);
          ctx.restore();
          // piega e ciglia sul bordo
          ctx.save(); ctx.translate(ex, ey); ctx.rotate(roll); ctx.translate(-ex, -ey);
          ctx.lineCap = 'round';
          ctx.strokeStyle = `rgba(60,30,30,${0.18 * b})`; ctx.lineWidth = Math.max(F * 0.0015, eh * 0.12);
          ctx.beginPath(); for (let k = 2; k <= N - 2; k++) { const t = -1 + (2 * k) / N, y = edge(t) - eh * 0.35 * Math.sqrt(1 - t * t); k === 2 ? ctx.moveTo(ex + t * hw * 0.95, y) : ctx.lineTo(ex + t * hw * 0.95, y); } ctx.stroke();
          const la = Math.min(0.9, 0.25 + b * 0.75), outer = i ? 1 : -1; // le ciglia si infittiscono verso l'angolo esterno
          const pathE = (t0, t1) => { ctx.beginPath(); for (let k = 0; k <= 16; k++) { const t = t0 + (t1 - t0) * k / 16, x = ex + t * hw * 0.98, y = Math.max(edge(t), up(t)) + eh * 0.03; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
          ctx.lineJoin = 'round';
          ctx.strokeStyle = `rgba(28,16,16,${la * 0.85})`; ctx.lineWidth = Math.max(F * 0.0012, eh * 0.1); pathE(-0.92, 0.92); ctx.stroke();
          ctx.strokeStyle = `rgba(22,12,12,${la * 0.7})`; ctx.lineWidth = Math.max(F * 0.0016, eh * 0.15); outer > 0 ? pathE(0.25, 0.97) : pathE(-0.97, -0.25); ctx.stroke(); // angolo esterno più folto
          if (b > 0.6) { // ciglia chiuse: piccole punte verso il basso, sottili e sfumate
            ctx.lineWidth = Math.max(F * 0.0007, eh * 0.04); ctx.strokeStyle = `rgba(30,18,18,${(b - 0.6) * 1.2})`;
            for (let k = 2; k < N - 1; k++) { const t = -1 + (2 * k) / N, x = ex + t * hw * 0.98, y = edge(t) + eh * 0.03, w8 = 0.5 + 0.7 * Math.max(0, t * outer);
              ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + outer * eh * 0.06, y + eh * 0.16 * w8, x + (t * 0.12 + outer * 0.1) * eh * w8, y + eh * 0.24 * w8); ctx.stroke(); }
          }
          ctx.restore();
        });
      }
    }

    // ---- scena cinematografica: figura intera in una stanza ----
    // cfg: { on, room: 'salotto'|'camera'|'terrazza', url: immagine scena (16:9) o null, landmarks: punti del viso sulla scena o null }
    setSceneMode(cfg) {
      const c = cfg && cfg.on ? { on: true, room: 'soggiorno', url: cfg.url || null, landmarks: cfg.landmarks || null } : { on: false };
      const prev = this.sceneCfg || {};
      this.sceneCfg = { ...c, img: c.url && prev.url === c.url ? prev.img : null, lids: prev.url === c.url ? prev.lids : null };
      if (c.url && prev.url !== c.url) {
        const im = new Image(); im.onload = () => { if (this.sceneCfg.url === c.url) { this.sceneCfg.img = im; this.sceneCfg.lids = c.landmarks ? lidsFor(im, c.landmarks) : null; } }; im.src = c.url;
      } else if (c.url && c.landmarks && this.sceneCfg.img && JSON.stringify(c.landmarks) !== JSON.stringify(prev.landmarks)) this.sceneCfg.lids = lidsFor(this.sceneCfg.img, c.landmarks);
    }
    // v8: la scena si vede solo quando la foto del soggiorno è caricata; altrimenti l'avatar normale (niente stanze disegnate, niente effetto ritaglio)
    sceneOn() { return this.sceneCfg && this.sceneCfg.on && this.sceneCfg.img && !this.transparent ? this.sceneCfg : null; }
    paintScene(ctx, CW, CH, A, sc) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
      const img = sc.img, S = VS;
      const fr = (aspect) => { const ca = CW / CH; return ca >= aspect ? { w: CH * aspect, h: CH, x: (CW - CH * aspect) / 2, y: 0 } : { w: CW, h: CW / aspect, x: 0, y: (CH - CW / aspect) / 2 }; };
      if (img) {
        // immagine scena: finestra orizzontale centrata sul viso (in verticale si vede la parte centrale, la persona resta intera)
        const nw = img.naturalWidth, nh = img.naturalHeight, ia = nw / nh;
        const winA = Math.max(Math.min(ia, 0.62), Math.min(ia, CW / CH));
        const F = fr(winA), winW = nh * winA, s = Math.min(nw, nh), k = s / S, ox = (nw - s) / 2, oy = (nh - s) / 2;
        const lm = sc.landmarks;
        const fx = lm ? ox + ((lm.eyeL.x + lm.eyeR.x) / 2) * s : nw / 2;
        const winX = Math.max(0, Math.min(nw - winW, fx - winW / 2)), q = F.h / nh;
        this._bounds = { frame: F, cw: CW, ch: CH, win: { x: winX, w: winW, nw, nh } };
        ctx.save(); ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
        ctx.drawImage(img, winX, 0, winW, nh, F.x, F.y, F.w, F.h);
        if (lm) {
          ctx.setTransform(k * q, 0, 0, k * q, F.x + (ox - winX) * q, F.y + oy * q); // spazio S della scena -> canvas
          const ed = Math.hypot(lm.eyeR.x - lm.eyeL.x, lm.eyeR.y - lm.eyeL.y), fs = Math.max(0.05, Math.min(2.5, ed / 0.24));
          const hx = ((lm.eyeL.x + lm.eyeR.x) / 2) * S, ey = ((lm.eyeL.y + lm.eyeR.y) / 2) * S, Fs = S * fs;
          // respiro: il busto si espande appena (ancorato in basso)
          const tx = hx - Fs * 0.6, ty = ey + Fs * 0.42, tw = Fs * 1.2, th = Fs * 1.25, b = 1 + A.breath * 0.006;
          ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, th); ctx.clip();
          ctx.translate(hx, ty + th); ctx.scale(1 + A.breath * 0.003, b); ctx.translate(-hx, -(ty + th));
          drawCover(ctx, img, S, { sx: tx, sy: ty - Fs * 0.02, sw: tw, sh: th + Fs * 0.02 }); ctx.restore();
          // testa: piccola oscillazione attorno al collo (stessi movimenti dell'avatar, scalati)
          const hy = ey + Fs * 0.05, rx = Fs * 0.3, ry = Fs * 0.42, nx = hx, ny = ey + Fs * 0.4;
          ctx.save(); ctx.beginPath(); ctx.ellipse(hx, hy, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(nx, ny + A.bob * fs * 0.25); ctx.translate(-nx, -ny); // v7.1: niente oscillazione laterale
          drawCover(ctx, img, S, { sx: hx - rx * 1.15, sy: hy - ry * 1.15, sw: rx * 2.3, sh: ry * 2.3 });
          this.paintFace(ctx, img, lm, A, fs, sc.lids || ['#c99', '#c99']);
          ctx.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        vignette(ctx, F); ctx.restore();
        return;
      }
    }
  }

  // scala del viso: 1 = primo piano (occhi distanti ~0,24 del quadrato centrale); figura intera ≈ 0,3–0,5
  function faceScale(lm) { try { const ed = Math.hypot(lm.eyeR.x - lm.eyeL.x, lm.eyeR.y - lm.eyeL.y); return Math.max(0.12, Math.min(1.6, ed / 0.24)); } catch { return 1; } }
  const GESTURE_REGIONS = false; // v7.1: niente rotazione di pezzi di braccio sulla foto: solo respiro e viso
  const WARP_MAX = 0.03, WARP_STRIPS = 40, EDGE_SIDE = 0.07, EDGE_TB = 0.1; // v7.1: deformazione interna max (frazione della larghezza) e bande sfumate
  const DEF_LM = { eyeL: { x: 0.38, y: 0.42 }, eyeR: { x: 0.62, y: 0.42 }, mouth: { x: 0.5, y: 0.7 } }; // v8.4.3: predefiniti (incerti)
  const VS = 1000; // unità virtuale dello spazio del viso (il canvas reale scala con una trasformazione)
  const ROT_MAX = 0.075; const SHIFT_MAX = 0.042 * 1000; const SKEW_MAX = 0.018; // v7: movimenti più ampi (spalle comprese), sempre dentro il riquadro // rotazione massima della testa/busto (radianti): l'ingombro è calcolato su questo valore
  // Bordi sfumati (Presenza e scena senza immagine): ellisse sull'area dell'immagine
  function feather(ctx, r, inner = 0.62) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in';
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(Math.max(1, r.w / 2), Math.max(1, r.h / 2));
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, 1.02); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-60, -60, 120, 120); ctx.restore();
  }
  // v7.1 Presenza: bordi rettangolari appena sfumati (niente ovale che mangia mani e capelli); il riquadro è fermo
  function featherRect(ctx, r) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-out';
    const b = Math.min(r.w, r.h) * 0.08;
    const side = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh); };
    side(r.x, 0, r.x + b, 0, r.x - 1, r.y - 1, b + 1, r.h + 2); side(r.x + r.w, 0, r.x + r.w - b, 0, r.x + r.w - b, r.y - 1, b + 1, r.h + 2);
    side(0, r.y, 0, r.y + b, r.x - 1, r.y - 1, r.w + 2, b + 1); side(0, r.y + r.h, 0, r.y + r.h - b * 0.6, r.x - 1, r.y + r.h - b * 0.6, r.w + 2, b * 0.6 + 1);
    ctx.restore();
  }
  function vignette(ctx, F) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(F.x + F.w / 2, F.y + F.h / 2); ctx.scale(F.w / 2, F.h / 2);
    const g = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1.45); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  // colore della palpebra campionato sopra gli occhi (immagine scena: campione più grande perché il viso è piccolo)
  function lidsFor(img, lm) {
    try {
      const S = 512, tmp = document.createElement('canvas'); tmp.width = tmp.height = S;
      const t = tmp.getContext('2d', { willReadFrequently: true }); drawCover(t, img, S);
      const ed = Math.hypot(lm.eyeR.x - lm.eyeL.x, lm.eyeR.y - lm.eyeL.y);
      return [lm.eyeL, lm.eyeR].map((e) => { const d = t.getImageData(Math.round(e.x * S), Math.max(0, Math.round((e.y - ed * 0.25) * S)), 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; });
    } catch { return ['#c99', '#c99']; }
  }

  // v8: niente più stanze disegnate: una sola scena, il soggiorno fotografico generato con l'IA (9:16).
  TalkingAvatar.ROOMS = ['soggiorno'];


  // Disegna l'immagine ritagliata a quadrato (center crop); opzionalmente solo una regione (in coord. del quadrato)
  function shiftLm(lm, dy) { const o = {}; for (const k of Object.keys(lm)) { const p = lm[k]; o[k] = p && typeof p === 'object' && 'y' in p ? { x: p.x, y: p.y + dy } : p; } return o; }
  function drawCover(ctx, img, S, region) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const ox = (img.naturalWidth - s) / 2, oy = (img.naturalHeight - s) / 2, k = s / S;
    if (!region) return ctx.drawImage(img, ox, oy, s, s, 0, 0, S, S);
    const { sx, sy, sw, sh } = region;
    const dx = region.dx == null ? sx : region.dx, dy = region.dy == null ? sy : region.dy;
    const dw = region.dw == null ? sw : region.dw, dh = region.dh == null ? sh : region.dh;
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(img, ox + sx * k, oy + sy * k, sw * k, sh * k, dx, dy, dw, dh);
  }
  // Apertura simmetrica attorno alla bocca vera, perpendicolare alla linea delle labbra già nella foto.
  // Non usa l'inclinazione degli occhi: la bocca non si raddrizza da sola e non si storce da un lato.
  function paintMouth(ctx, img, lm, open, wide) {
    const S = VS, c = lm.mouth; if (!c) return;
    const span0 = Math.max(S * 0.05, (lm.mouthW || 0.14) * S);
    const L = lm.mouthL || { x: c.x - (lm.mouthW || 0.14) / 2, y: c.y };
    const R = lm.mouthR || { x: c.x + (lm.mouthW || 0.14) / 2, y: c.y };
    const ang = Math.atan2((R.y - L.y) * S, (R.x - L.x) * S);
    const len = Math.max(span0, Math.hypot((R.x - L.x) * S, (R.y - L.y) * S));
    const cx = c.x * S, cy = c.y * S;
    const wF = 1 + (Math.max(0, Math.min(1, wide)) - 0.5) * 0.18;
    const half = len * 0.52 * wF;
    const jaw = open * len * 0.46, upper = open * len * 0.14;
    const cols = 17, above = len * 0.26, below = len * 0.72, colW = (half * 2) / cols;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang); ctx.translate(-cx, -cy);
    ctx.beginPath();
    ctx.rect(cx - half - 1, cy - above - upper - 1, half * 2 + 2, above + below + jaw + upper + 2);
    ctx.clip();
    for (let i = 0; i < cols; i++) {
      const u = ((i + 0.5) / cols) * 2 - 1;
      const att = Math.max(0, 1 - u * u);
      const x = cx - half + i * colW;
      const up = upper * att, dn = jaw * att;
      drawCover(ctx, img, S, { sx: x, sy: cy - above, sw: colW + 0.8, sh: above, dx: x, dy: cy - above - up, dw: colW + 0.8, dh: above + up * 0.9 });
      drawCover(ctx, img, S, { sx: x, sy: cy, sw: colW + 0.8, sh: below, dx: x, dy: cy + dn * 0.08, dw: colW + 0.8, dh: below + dn * 0.92 });
    }
    ctx.restore();
  }

  // Editor dei punti del viso: trascina 👁 👁 👄
  function LandmarkEditor(canvas, onChange) {
    const ctx = canvas.getContext('2d'); let img = null, lm = null, drag = null;
    const S = canvas.width;
    const keys = [['eyeL', '👁'], ['eyeR', '👁'], ['mouth', '👄']];
    function draw() {
      ctx.clearRect(0, 0, S, S);
      if (img) drawCover(ctx, img, S);
      if (!lm) return;
      ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const [k, ic] of keys) {
        const p = lm[k];
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(p.x * S, p.y * S, 15, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillText(ic, p.x * S, p.y * S + 1);
      }
    }
    function pos(e) { const r = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; }
    canvas.addEventListener('pointerdown', (e) => {
      if (!lm) return; const p = pos(e); let best = null, bd = 1;
      for (const [k] of keys) { const d = Math.hypot(lm[k].x - p.x, lm[k].y - p.y); if (d < bd) { bd = d; best = k; } }
      if (bd < 0.12) { drag = best; canvas.setPointerCapture(e.pointerId); }
    });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; lm[drag] = pos(e); draw(); onChange && onChange(lm); });
    canvas.addEventListener('pointerup', () => { drag = null; });
    return {
      set(src, landmarks) {
        lm = JSON.parse(JSON.stringify(landmarks));
        if (!src) { img = null; draw(); return; }
        const im = new Image(); im.onload = () => { img = im; draw(); }; im.src = src;
      },
    };
  }

  // ---------- v8.1: RESPIRO realistico ----------
  // Modello del volume dei polmoni (0 = fine espirazione, 1 = respiro normale pieno): 12–16 respiri/minuto con variabilità,
  // inspirazione ~40%, espirazione più lenta, breve pausa; respiro più profondo ogni tanto. Accoppiato al parlato:
  // piccola inspirazione prima di parlare, espirazione lenta mentre parla, "presa di fiato" tra le frasi, sospiri e risate.
  class Breath {
    constructor() { this.seg = null; this.mode = 'idle'; this.n = 0; this.laughAt = 0; this.pre = 0; this._v = 0; this.next(performance.now(), 0); }
    ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t); }
    go(now, to, dur, kind, curve) { this.seg = { t0: now, dur: Math.max(60, dur), from: this._v, to, kind, curve: curve || 'sine' }; }
    next(now) { // prossimo segmento del ciclo a riposo
      const s = this.seg ? this.seg.kind : 'hold';
      if (this.mode === 'speak') { // parlando: espira piano finché c'è aria, poi prende fiato veloce
        if (s === 'in' || s === 'catch') return this.go(now, 0.22, 3800 + Math.random() * 1600, 'out', 'lin');
        return this.go(now, 0.78 + Math.random() * 0.15, 320 + Math.random() * 120, 'catch');
      }
      if (s === 'in') return this.go(now, 0, (this.P || 4300) * 0.56, 'out', 'outq');
      if (s === 'out') return this.go(now, this._v, (this.P || 4300) * (0.04 + Math.random() * 0.05), 'hold');
      this.n++; this.P = 3750 + Math.random() * 1250; // 12–16 respiri al minuto
      const deep = this.n % (6 + Math.floor(Math.random() * 4)) === 0;
      this.go(now, (deep ? 1.35 : 0.85 + Math.random() * 0.25), this.P * (deep ? 0.48 : 0.4), 'in');
    }
    speechStart(now) { this.mode = 'speak'; if (this._v < 0.55) this.go(now, 0.85 + Math.random() * 0.1, 330, 'catch'); else this.go(now, 0.22, 4200, 'out', 'lin'); }
    gap(now) { if (this.mode === 'speak' && this._v < 0.6) this.go(now, 0.75, 300, 'catch'); } // presa di fiato tra due frasi
    speechEnd(now) { this.mode = 'idle'; this.go(now, 0, 1300 + Math.random() * 500, 'out', 'outq'); }
    preInhale(now) { this.pre = now + 420; this.go(now, 0.92, 380, 'catch'); } // prima di parlare: bocca appena aperta + inspirazione
    sigh(now) { this.mode = this.mode === 'speak' ? 'speak' : 'idle'; this.go(now, 1.45, 950, 'in'); this.seg.after = () => this.go(performance.now(), 0, 2100, 'out', 'outq'); }
    laugh(now) { this.laughAt = now; }
    // v8.3: gesti (clip) sincronizzati col respiro: la foto "prende fiato" mentre la clip entra, poi riprende fiato quando la clip esce
    gestureStart(kind, now) {
      if (kind === 'starnuto') this.go(now, 1.35, 420, 'in'); // prima dello starnuto: inspirazione
      else if (kind === 'tosse') this.go(now, 0.8, 300, 'catch');
      else if (kind === 'ride') this.laugh(now);
    }
    gestureEnd(kind, now) {
      if (kind === 'tosse' || kind === 'starnuto') { this._v = Math.min(this._v, 0.15); this.go(now, 0.95, 520, 'catch'); } // dopo: un respiro per riprendersi
      else if (kind === 'ride') { this.laugh(now - 300); }
    }
    vol(now) {
      const g = this.seg;
      if (!g) this.next(now);
      let t = (now - this.seg.t0) / this.seg.dur;
      if (t >= 1) { this._v = this.seg.to; const after = this.seg.after; this.seg.after = null; if (after) after(); else this.next(now); t = 0; }
      const k = this.seg.curve === 'lin' ? Math.min(1, t) : this.seg.curve === 'outq' ? 1 - Math.pow(1 - Math.min(1, t), 2) : this.ease(t);
      this._v = this.seg.from + (this.seg.to - this.seg.from) * k;
      let v = this._v;
      const lt = now - this.laughAt; // risata: piccole spinte del diaframma (~5 al secondo) che svaniscono
      if (lt < 1100) v += 0.22 * Math.abs(Math.sin(lt / 1000 * Math.PI * 5)) * (1 - lt / 1100);
      return v;
    }
    inhaling(now) { return now < this.pre; }
  }
  // Deformazione morbida della foto (WebGL, un solo passaggio, niente strisce né giunture):
  // spalle e petto salgono, il petto si espande appena verso chi guarda (pseudo-3D: leggero ingrandimento radiale e luce),
  // la testa sale rigida insieme alle spalle, lo sfondo resta fermo (maschera della persona di MediaPipe, se c'è),
  // il bordo inferiore della foto resta ancorato (niente vuoti), nessun movimento laterale.
  const BR_VS = 'attribute vec2 a;varying vec2 v;void main(){v=a*0.5+0.5;v.y=1.0-v.y;gl_Position=vec4(a,0.0,1.0);}';
  const BR_FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D uI,uM;uniform float uHM,uVol,uRise,uExp,uEd,uShY,uShHW,uWY,uChinY,uFX,uAmp,uNod;uniform vec2 uR,uC,uCR;
float body(vec2 p){if(uHM>0.5){vec2 o=vec2(uEd*0.22)/uR;float m=texture2D(uM,v).r*0.28;m+=texture2D(uM,v+vec2(o.x,0.0)).r*0.12;m+=texture2D(uM,v-vec2(o.x,0.0)).r*0.12;m+=texture2D(uM,v+vec2(0.0,o.y)).r*0.12;m+=texture2D(uM,v-vec2(0.0,o.y)).r*0.12;m+=texture2D(uM,v+o).r*0.06;m+=texture2D(uM,v-o).r*0.06;m+=texture2D(uM,v+vec2(o.x,-o.y)).r*0.06;m+=texture2D(uM,v+vec2(-o.x,o.y)).r*0.06;return smoothstep(0.15,0.85,m);}
float hw=mix(uEd*1.45,uShHW*1.3,smoothstep(uChinY,uShY,p.y));return 1.0-smoothstep(hw*0.8,hw*1.3,abs(p.x-uFX));}
void main(){vec2 p=v*uR;float w=body(p);
float up=1.0-smoothstep(uShY,uWY,p.y);float head=mix(1.0,0.72,1.0-smoothstep(uChinY,uShY,p.y));
float dy=-uRise*uVol*up*head*w*uAmp+uNod*(1.0-smoothstep(uChinY,uShY,p.y))*w;vec2 q=(p-uC)/uCR;float cw=exp(-dot(q,q)*1.7)*w;vec2 dc=(p-uC)*uExp*uVol*cw*uAmp;
vec2 src=(p-vec2(0.0,dy)-dc)/uR;vec4 c=texture2D(uI,clamp(src,vec2(0.0),vec2(1.0)));c.rgb*=1.0+0.014*uVol*cw*uAmp;gl_FragColor=c;}`;
  class Breather {
    constructor() {
      const c = document.createElement('canvas'); this.c = c; this.ok = false;
      try {
        const gl = c.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }); if (!gl) return;
        const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
        const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, BR_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, BR_FS)); gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
        gl.useProgram(pr); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        this.u = {}; ['uI', 'uM', 'uHM', 'uVol', 'uRise', 'uExp', 'uEd', 'uShY', 'uShHW', 'uWY', 'uChinY', 'uFX', 'uR', 'uC', 'uCR', 'uAmp', 'uNod'].forEach((n) => { this.u[n] = gl.getUniformLocation(pr, n); });
        const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE)); [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR)); return t; };
        this.tI = tex(0); this.tM = tex(1); gl.uniform1i(this.u.uI, 0); gl.uniform1i(this.u.uM, 1);
        c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
        this.gl = gl; this.ok = true;
      } catch (e) { console.warn('Respiro WebGL non disponibile, uso quello semplice', e); this.ok = false; }
    }
    // immagine + punti del viso/corpo -> geometria in pixel (calcolata una volta per foto)
    setup(img, lm) {
      if (!this.ok) return false;
      if (this._img === img && this._lm === lm && this.g && this.c.width) return true; // v8.4.1: geometria in cache (calcolata una volta per foto)
      this._img = img; this._lm = lm;
      const gl = this.gl, nw = img.naturalWidth, nh = img.naturalHeight, gs = Math.min(1, 1400 / Math.max(nw, nh));
      const W = Math.max(1, Math.round(nw * gs)), H = Math.max(1, Math.round(nh * gs));
      const key = img.src + '|' + W + 'x' + H;
      if (this.key !== key) {
        this.c.width = W; this.c.height = H; this.c.naturalWidth = W; this.c.naturalHeight = H; gl.viewport(0, 0, W, H);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tI);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); } catch (e) { console.warn('Respiro: immagine non utilizzabile', e); this.ok = false; return false; }
        this.key = key;
      }
      const s = Math.min(nw, nh), ox = (nw - s) / 2, oy = (nh - s) / 2;
      const P = (p) => ({ x: (p.x * s + ox) * gs, y: (p.y * s + oy) * gs });
      const eL = P(lm.eyeL), eR = P(lm.eyeR), M = P(lm.mouth), ed = Math.max(3, Math.hypot(eR.x - eL.x, eR.y - eL.y));
      const fx = (eL.x + eR.x) / 2, chinY = M.y + 0.6 * ed, b = lm.body || {};
      let shY = M.y + 1.35 * ed, shHW = 1.9 * ed, shX = fx;
      if (b.shL && b.shR) { const a = P(b.shL), c = P(b.shR); shY = (a.y + c.y) / 2; shHW = Math.abs(a.x - c.x) / 2; shX = (a.x + c.x) / 2; if (shY < chinY + 0.2 * ed) shY = chinY + 0.5 * ed; }
      let wY = shY + 3.4 * ed;
      if (b.hipL && b.hipR) { const a = P(b.hipL), c = P(b.hipR); const hy = (a.y + c.y) / 2; if (hy > shY + ed) wY = hy; }
      wY = Math.min(wY, H); // ancorato al bordo inferiore se la vita è fuori dalla foto
      // v8.3: seduta al tavolo: il respiro si ferma alla linea del tavolo (sotto non si muove nulla: tavolo e braccia appoggiate)
      if (b.table && Number.isFinite(b.table.y)) { const ty = (b.table.y * s + oy) * gs; if (ty > shY + 0.8 * ed) wY = Math.min(wY, ty); }
      const cY = shY + Math.min(1.1 * ed, (wY - shY) * 0.35);
      this.g = { W, H, gs, ed, fx, chinY, shY, shHW, shX, wY, cX: shX, cY, cRx: shHW * 0.8, cRy: shHW * 0.62,
        rise: Math.max(0.08 * ed, 0.0026 * H), exp: 0.014, /* v8.5.2: respiro visibile e liscio */ k: (s * gs) / 1000 };
      // maschera della persona (facoltativa): ferma lo sfondo
      const m = b.mask;
      if (m !== this.maskSrc) {
        this.maskSrc = m; this.hasMask = false;
        if (m) { const im = new Image(); im.onload = () => { if (this.maskSrc !== m) return; gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tM); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); this.hasMask = true; }; im.src = m; }
      }
      return true;
    }
    render(vol, amp = 1, nod = 0) { this._vol = vol; this._nod = nod; return this.renderGL(vol, amp, nod); }
    renderGL(vol, amp = 1, nod = 0) {
      const gl = this.gl, g = this.g, u = this.u;
      gl.uniform1f(u.uNod, nod * g.ed * 0.075); // cenno del capo: ~7% della distanza fra gli occhi (verso il basso)
      gl.uniform2f(u.uR, g.W, g.H); gl.uniform1f(u.uVol, vol); gl.uniform1f(u.uAmp, amp); gl.uniform1f(u.uRise, g.rise); gl.uniform1f(u.uExp, g.exp);
      gl.uniform1f(u.uEd, g.ed); gl.uniform1f(u.uShY, g.shY); gl.uniform1f(u.uShHW, g.shHW); gl.uniform1f(u.uWY, g.wY); gl.uniform1f(u.uChinY, g.chinY); gl.uniform1f(u.uFX, g.fx);
      gl.uniform2f(u.uC, g.cX, g.cY); gl.uniform2f(u.uCR, g.cRx, g.cRy); gl.uniform1f(u.uHM, this.hasMask ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.c;
    }
    // spostamento verticale della testa (spazio del viso S=1000), per allineare le espressioni alla foto deformata
    headDy(vol, amp = 1, nod = 0) { const g = this.g; return (-g.rise * vol * 0.72 * amp + nod * g.ed * 0.075) / g.k; }
  }
  TalkingAvatar.Breath = Breath; TalkingAvatar.Breather = Breather;

  window.TalkingAvatar = TalkingAvatar;
  window.LandmarkEditor = LandmarkEditor;
})();
