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
      this.c = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
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
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      requestAnimationFrame(this.loop); // parte subito, anche senza fotocamera
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
      this.lm = JSON.parse(JSON.stringify(ch.landmarks || this.lm));
      if (ch.appearance && ch.appearance.colors) this.setColors(ch.appearance.colors);
      this.framing = (ch.appearance && ch.appearance.framing) || 'ritratto';
      this.setImage(ch.avatar);
    }
    setImage(src) {
      if (src && (src.startsWith('/api/') || src.startsWith('data:'))) {
        if (this.img && this.img._src === src) return;
        const im = new Image();
        im.onload = () => { this.img = im; this.img._src = src; this.sampleLids(); };
        im.src = src;
      } else { this.img = null; this.emoji = src || '🙂'; }
    }
    // ---- reazioni (gesti della mano riconosciuti dalla fotocamera) ----
    // kind: 'wave' (saluta), 'smile' (sorride), 'nod' (annuisce), 'tilt' (inclina la testa), 'shake'
    react(kind, badge) {
      const dur = { wave: 1800, smile: 2200, nod: 1200, tilt: 1600, shake: 1100 }[kind] || 1500;
      this.reaction = { kind, start: performance.now(), dur };
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
    setLandmarks(lm) { this.lm = JSON.parse(JSON.stringify(lm)); this.sampleLids(); }
    setColors(c) { this.colors = { ...this.colors, ...c }; if (!this.transparent) this.c.style.background = this.colors.background; }

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
    target(now) {
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
      requestAnimationFrame(this.loop);
      // non visibile: risparmia batteria (getClientRects funziona anche dentro contenitori position:fixed su iOS)
      if (!this.c.isConnected || this.c.getClientRects().length === 0) return;
      if (++this._frame % 30 === 0) this.resize();
      if (this.simUntil && now > this.simUntil) { this.simUntil = 0; this.speaking = false; }
      const ctx = this.ctx, S = VS; // spazio virtuale; la trasformazione porta tutto alle dimensioni reali del canvas
      this.mouth += (this.target(now) - this.mouth) * 0.4;
      const dt = Math.min(100, now - (this._last || now)); this._last = now;
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
      let rx = 0, ry = 0, rRot = 0, smile = sens ? 0.25 : 0, wave = 0;
      const re = this.reaction;
      if (re) {
        const p = (now - re.start) / re.dur;
        if (p >= 1) this.reaction = null;
        else {
          const env = p < 0.3 ? ease(p / 0.3) : p > 0.65 ? ease((1 - p) / 0.35) : 1; // attacco e rilascio morbidi
          if (re.kind === 'nod') ry = Math.sin(p * Math.PI * 4) * S * 0.014 * env;
          if (re.kind === 'shake') rx = Math.sin(p * Math.PI * 6) * S * 0.012 * env;
          if (re.kind === 'tilt') rRot = 0.07 * env;
          if (re.kind === 'smile' || re.kind === 'wave') smile = Math.max(smile, env);
          if (re.kind === 'wave') { wave = env; rRot = Math.sin(p * Math.PI * 6) * 0.03 * env; }
        }
      }
      // battito di ciglia (in modalità sensuale: più lento, palpebre un po' abbassate)
      // ammiccamenti variabili: durata 120–240 ms, a volte doppi o a metà; più frequenti mentre parla
      if (now > this.nextBlink) {
        this.blinkStart = now; this.blinkDur = (sens ? 260 : 120) + Math.random() * 120; this.blinkAmp = Math.random() < 0.12 ? 0.55 : 1;
        const dbl = !this.blinkDouble && Math.random() < 0.15; this.blinkDouble = dbl ? 1 : 0;
        this.nextBlink = dbl ? now + this.blinkDur + 90 : now + ((sens ? 3500 : 2500) + Math.random() * 4000) * (this.speaking ? 0.7 : 1);
      }
      const bt = (now - this.blinkStart) / this.blinkDur; let blink = bt < 1 ? Math.sin(bt * Math.PI) * this.blinkAmp : 0;
      // sopracciglia: alzate rapide su enfasi/reazioni e piccole alzate spontanee
      if ((now - this.emph < 120 || (re && now - re.start < 80)) && mc.browUntil < now) { mc.browT = 0.7 + Math.random() * 0.3; mc.browUntil = now + 380; }
      if (now > mc.nextBrow) { mc.browT = 0.3 + Math.random() * 0.4; mc.browUntil = now + 250 + Math.random() * 250; mc.nextBrow = now + 6000 + Math.random() * 8000; }
      if (now > mc.browUntil) mc.browT = 0;
      mc.brow += (mc.browT - mc.brow) * Math.min(1, dt / (mc.browT > mc.brow ? 70 : 220));
      // sguardo: saccadi rapide verso punti vicini, poi fissazione; con l'imitazione tende a guardare l'utente
      if (now > mc.nextSacc) { const r = R ? 0.35 : 1; mc.gtx = (Math.random() * 2 - 1) * r - (R ? R.yaw * 0.3 : 0); mc.gty = (Math.random() * 2 - 1) * 0.5 * r; if (Math.random() < 0.35) { mc.gtx = 0; mc.gty = 0; } mc.nextSacc = now + 700 + Math.random() * 2600; }
      const sk = Math.min(1, dt / 35); mc.gx += (mc.gtx - mc.gx) * sk; mc.gy += (mc.gty - mc.gy) * sk;
      // sorrisi accennati spontanei (più spesso in modalità sensuale)
      if (now > mc.nextSmile) { mc.smileT = 0.2 + Math.random() * 0.25; mc.smileUntil = now + 1200 + Math.random() * 1800; mc.nextSmile = now + (sens ? 6000 : 9000) + Math.random() * 12000; }
      if (now > mc.smileUntil) mc.smileT = 0;
      mc.smile += (mc.smileT - mc.smile) * Math.min(1, dt / 400);
      const realSmile = smile; smile = Math.max(smile, mc.smile);
      if (sens) blink = Math.max(blink, 0.22 + Math.sin(now / 3000) * 0.06);
      const squint = realSmile; // solo sorrisi veri (reazioni/sensuale) socchiudono gli occhi, non quelli accennati
      if (squint > 0.3) blink = Math.max(blink, squint * 0.25); // occhi che "sorridono"

      // ---- disegno: contenimento (contain) nel riquadro, mai ritagliato; scena cinematografica facoltativa ----
      const A = { now, S, rot: Math.max(-ROT_MAX, Math.min(ROT_MAX, sway + talkNod + rRot)), shiftX: Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, shiftX + rx)), bob: Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, bob + ry)), skew, breath, smile, blink, wave, mc, M, spring };
      const CW = this.c.width, CH = this.c.height, col = this.colors;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, CW, CH);
      const scn = this.sceneOn();
      if (scn) this.paintScene(ctx, CW, CH, A, scn);
      else {
        if (!this.transparent) { ctx.fillStyle = col.background; ctx.fillRect(0, 0, CW, CH); }
        const r = this.paintAvatar(ctx, { x: 0, y: 0, w: CW, h: CH }, A, true);
        if (this.transparent && this.img) feather(ctx, r);
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
      if (stage) { stage.classList.toggle('speaking', this.speaking); stage.style.setProperty('--glow', col.glow); }
      const pulse = sens ? Math.round(14 + Math.sin(now / 1400) * 8) : 0;
      this.c.style.boxShadow = this.speaking ? `0 0 0 3px ${col.glow}, 0 0 22px ${col.glow}88` : sens ? `0 0 ${pulse}px ${col.glow}66` : '';
    }

    // Estensione dell'immagine intera nello spazio "quadrato S" dei punti del viso (il quadrato centrale = 0..S)
    extent(img) {
      const S = VS;
      if (!img) return { x0: 0, y0: 0, w: S, h: S };
      const nw = img.naturalWidth, nh = img.naturalHeight, s = Math.min(nw, nh), k = s / S;
      return { x0: -((nw - s) / 2) / k, y0: -((nh - s) / 2) / k, w: nw / k, h: nh / k };
    }
    // Avatar intero dentro box (px del canvas), con margine per oscillazione/respiro: nessuna parte esce dal riquadro.
    paintAvatar(ctx, box, A, top, alignBottom) {
      const S = VS, img = this.img, E = this.extent(img), col = this.colors;
      // ingombro massimo durante il movimento: rotazione (limitata a ROT_MAX) + spostamenti + respiro
      const th = ROT_MAX, pad = SHIFT_MAX + S * 0.022; // margine = spostamento max + scarto del perno + respiro
      const bw = E.w * Math.cos(th) + E.h * Math.sin(th) + pad * 2, bh = E.w * Math.sin(th) + E.h * Math.cos(th) + E.w * SKEW_MAX * 1.1 + pad * 2;
      const fit = Math.min(box.w / bw, box.h / bh);
      const cx = box.x + box.w / 2, cy = alignBottom ? box.y + box.h - (bh * fit) / 2 : box.y + box.h / 2;
      const ox = cx - (E.x0 + E.w / 2) * fit, oy = cy - (E.y0 + E.h / 2) * fit;
      ctx.setTransform(fit, 0, 0, fit, ox, oy);
      const plain = !+col.hue && +col.saturation === 100 && +col.brightness === 100; // filtro solo se serve (è costoso)
      ctx.filter = plain ? 'none' : `hue-rotate(${col.hue}deg) saturate(${col.saturation}%) brightness(${col.brightness}%)`;
      const pv = { x: S / 2, y: Math.min(E.y0 + E.h * 0.85, S * 0.62) }; // perno: collo/busto
      ctx.translate(pv.x + A.shiftX, pv.y + A.bob); ctx.rotate(A.rot); if (A.skew) ctx.transform(1, A.skew || 0, 0, 1, 0, 0);
      const sc = 1 + A.breath * 0.006; ctx.scale(sc, sc + A.breath * 0.004); ctx.translate(-pv.x, -pv.y);
      if (top) { // ingombro reale (per verifica): angoli dell'immagine trasformati
        const T = ctx.getTransform(); const pts = [[E.x0, E.y0], [E.x0 + E.w, E.y0], [E.x0, E.y0 + E.h], [E.x0 + E.w, E.y0 + E.h]].map(([x, y]) => [T.a * x + T.c * y + T.e, T.b * x + T.d * y + T.f]);
        this._bounds = { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])), cw: this.c.width, ch: this.c.height };
      }
      const { mc, M, spring, now, smile, blink, wave } = A;
      const act = top ? this.actionAlpha(now) : null; // azione in corso (clip o posa): dissolvenza incrociata
      if (act && act.a >= 0.999) { this.paintAction(ctx, E, A, act); ctx.filter = 'none'; const T = ctx.getTransform(); ctx.setTransform(1, 0, 0, 1, 0, 0); return { x: ox + E.x0 * fit, y: oy + E.y0 * fit, w: E.w * fit, h: E.h * fit, T }; }
      if (act) ctx.globalAlpha = 1 - act.a;
      if (img) {
        ctx.drawImage(img, E.x0, E.y0, E.w, E.h);
        // Gesti (mezzo busto / figura intera): braccia che si muovono col ritmo e l'intensità del parlato.
        const tgt = (this.speaking ? 0.35 + this.mouth * 0.7 + (now - this.emph < 700 ? 0.6 : 0) : 0) + M.energy * 0.6 + wave * 0.8;
        this.gesture = Math.max(0, spring(this.gesture, tgt, 'gesture', 9)); // gesti morbidi (molla smorzata)
        const lifted = M.lift[0] > 0.05 || M.lift[1] > 0.05;
        if (this.gesturesOn && this.framing !== 'ritratto' && (this.gesture > 0.02 || lifted)) {
          const sh = this.framing === 'figura intera' ? 0.24 : 0.42; // altezza spalle
          const mx = this.lm.mouth.x, X1 = E.x0 + E.w, Y1 = E.y0 + E.h;
          [-1, 1].forEach((side) => {
            const px = (mx + side * (this.framing === 'figura intera' ? 0.09 : 0.2)) * S, py = sh * S;
            const lift = side < 0 ? M.lift[0] : M.lift[1];
            const waveSide = wave && side > 0 ? Math.sin(now / 120) * 0.08 * wave - 0.12 * wave : 0;
            const ang = side * this.gesture * 0.07 * Math.sin(now / 260 + (side > 0 ? 0 : 1.3)) - side * lift * 0.16 + waveSide;
            const rx = side < 0 ? E.x0 : px, rw = side < 0 ? px - E.x0 : X1 - px;
            ctx.save(); ctx.beginPath(); ctx.rect(rx, py, rw, Y1 - py); ctx.clip();
            ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py - this.gesture * S * 0.006);
            drawCover(ctx, img, S, { sx: rx, sy: py - S * 0.05, sw: rw, sh: Y1 - py + S * 0.05 }); ctx.restore();
          });
        }
        this.paintFace(ctx, img, this.lm, A, 1, this.lidColor);
      } else {
        ctx.font = `${S * 0.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(1 + this.mouth * 0.04, 1 - this.mouth * 0.06);
        ctx.translate(mc.gx * S * 0.004, -mc.brow * S * 0.006); ctx.fillText(this.emoji, 0, S * 0.03); ctx.restore();
      }
      if (act) { ctx.globalAlpha = act.a; this.paintAction(ctx, E, A, act); ctx.globalAlpha = 1; }
      ctx.filter = 'none';
      const T = ctx.getTransform(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      return { x: ox + E.x0 * fit, y: oy + E.y0 * fit, w: E.w * fit, h: E.h * fit, T };
    }
    // ---- AZIONI (v7): clip video o posa, disegnate nel riquadro dell'avatar con gli stessi movimenti (niente ritagli) ----
    // spec: { kind: 'video', url } | { kind: 'pose', url, lm? }. Restituisce una Promise che si risolve a fine azione.
    playAction(spec) {
      this.stopAction(true);
      return new Promise((resolve, reject) => {
        const done = (ok) => { if (this.act && this.act.resolve === resolve) { this.act = null; } resolve(ok); };
        const fail = (e) => { if (this.act && this.act.resolve === resolve) this.act = null; reject(e); };
        if (spec.kind === 'video') {
          const v = this._vid || (this._vid = document.createElement('video'));
          v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.preload = 'auto'; v.loop = false;
          const act = { kind: 'video', el: v, resolve, start: 0, fadeIn: 380, fadeOut: 520, endAt: 0, ready: false };
          this.act = act;
          const to = setTimeout(() => fail(new Error('Video non caricato')), 9000);
          v.oncanplay = () => { if (this.act !== act || act.ready) return; act.ready = true; clearTimeout(to); act.start = performance.now(); v.play().catch((e) => fail(e)); };
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
      const cx = E.x0 + E.w / 2, cy = E.y0 + E.h / 2, px = Math.sin(st.t / 1300) * E.w * 0.004; // leggera parallasse
      ctx.save(); ctx.beginPath(); ctx.rect(E.x0, E.y0, E.w, E.h); ctx.clip();
      ctx.translate(cx + px, cy); ctx.scale(k * zoom, k * zoom); ctx.translate(-(E2.x0 + E2.w / 2), -(E2.y0 + E2.h / 2));
      ctx.drawImage(im, E2.x0, E2.y0, E2.w, E2.h);
      if (a.lm) this.paintFace(ctx, im, a.lm, A, 1, a.lids); // labiale, ammiccamenti, sguardo anche sulla posa
      ctx.restore();
    }
    // Espressioni sul viso della foto (labiale, sorriso, sguardo, sopracciglia, palpebre). fs = scala del viso (1 = ritratto).
    paintFace(ctx, img, lm, A, fs, lids) {
      const S = VS, { mc, smile, blink } = A;
      const m = lm.mouth, open = Math.max(0, this.mouth), F = S * fs;
      if (smile > 0.05 && open < 0.2) {
        const w = F * 0.2, h = F * 0.09;
        ctx.save(); ctx.beginPath(); ctx.ellipse(m.x * S, m.y * S, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
        ctx.translate(m.x * S, m.y * S); ctx.scale(1 + smile * 0.07, 1 - smile * 0.02); ctx.translate(-m.x * S, -m.y * S - smile * F * 0.004);
        drawCover(ctx, img, S, { sx: m.x * S - w / 2, sy: m.y * S - h / 2, sw: w, sh: h }); ctx.restore();
      }
      if (open > 0.03) {
        const jw = F * 0.34, jh = F * 0.26, jx = m.x * S - jw / 2, jy = m.y * S, drop = open * F * 0.028;
        ctx.save(); ctx.beginPath(); ctx.ellipse(m.x * S, jy + jh * 0.45, jw / 2, jh * 0.6, 0, 0, Math.PI * 2); ctx.clip();
        ctx.translate(0, drop); drawCover(ctx, img, S, { sx: jx, sy: jy, sw: jw, sh: jh }); ctx.restore();
        ctx.fillStyle = 'rgba(45,8,14,0.88)';
        ctx.beginPath(); ctx.ellipse(m.x * S, m.y * S + drop * 0.5, F * 0.045 * (0.8 + open * 0.3), Math.max(F * 0.002, drop * 0.75), 0, 0, Math.PI * 2); ctx.fill();
      }
      const gxp = mc.gx * F * 0.0045, gyp = mc.gy * F * 0.0025, bup = mc.brow * F * 0.007, px = F * 0.0006;
      [lm.eyeL, lm.eyeR].forEach((e) => {
        if (Math.abs(gxp) > px || Math.abs(gyp) > px) {
          const w = F * 0.075, h = F * 0.036, b = F * 0.006;
          ctx.save(); ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(gxp, gyp); drawCover(ctx, img, S, { sx: e.x * S - w / 2 - b, sy: e.y * S - h / 2 - b, sw: w + 2 * b, sh: h + 2 * b }); ctx.restore();
        }
        if (bup > px) {
          const w = F * 0.12, h = F * 0.045, cy = e.y * S - F * 0.075; // sopra la palpebra, senza toccare l'occhio
          ctx.save(); ctx.beginPath(); ctx.ellipse(e.x * S, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(0, -bup); drawCover(ctx, img, S, { sx: e.x * S - w / 2, sy: cy - h / 2, sw: w, sh: h + bup + F * 0.006 }); ctx.restore();
        }
      });
      if (blink > 0.05) {
        [lm.eyeL, lm.eyeR].forEach((e, i) => {
          ctx.fillStyle = lids[i];
          ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S - F * 0.026 * (1 - blink), F * 0.045, F * 0.026 * blink, 0, 0, Math.PI * 2); ctx.fill(); // la palpebra scende dall'alto
        });
      }
    }

    // ---- scena cinematografica: figura intera in una stanza ----
    // cfg: { on, room: 'salotto'|'camera'|'terrazza', url: immagine scena (16:9) o null, landmarks: punti del viso sulla scena o null }
    setSceneMode(cfg) {
      const c = cfg && cfg.on ? { on: true, room: ROOMS[cfg.room] ? cfg.room : 'salotto', url: cfg.url || null, landmarks: cfg.landmarks || null } : { on: false };
      const prev = this.sceneCfg || {};
      this.sceneCfg = { ...c, img: c.url && prev.url === c.url ? prev.img : null, lids: prev.url === c.url ? prev.lids : null };
      if (c.url && prev.url !== c.url) {
        const im = new Image(); im.onload = () => { if (this.sceneCfg.url === c.url) { this.sceneCfg.img = im; this.sceneCfg.lids = c.landmarks ? lidsFor(im, c.landmarks) : null; } }; im.src = c.url;
      } else if (c.url && c.landmarks && this.sceneCfg.img && JSON.stringify(c.landmarks) !== JSON.stringify(prev.landmarks)) this.sceneCfg.lids = lidsFor(this.sceneCfg.img, c.landmarks);
    }
    sceneOn() { return this.sceneCfg && this.sceneCfg.on && !this.transparent ? this.sceneCfg : null; }
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
          ctx.translate(nx + A.shiftX * fs * 0.4, ny + A.bob * fs * 0.4); ctx.rotate(A.rot * 0.45); ctx.translate(-nx, -ny);
          drawCover(ctx, img, S, { sx: hx - rx * 1.15, sy: hy - ry * 1.15, sw: rx * 2.3, sh: ry * 2.3 });
          this.paintFace(ctx, img, lm, A, fs, sc.lids || ['#c99', '#c99']);
          ctx.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        vignette(ctx, F); ctx.restore();
        return;
      }
      // nessuna immagine scena: stanza illustrata (locale) + avatar attuale sfumato sul divano/letto/panchina
      const F = fr(Math.max(0.75, Math.min(2.39, CW / CH)));
      const key = `${sc.room}:${Math.round(F.w)}x${Math.round(F.h)}`;
      if (!this._room || this._room.key !== key) { const rc = document.createElement('canvas'); rc.width = Math.max(1, Math.round(F.w)); rc.height = Math.max(1, Math.round(F.h)); ROOMS[sc.room](rc.getContext('2d'), rc.width, rc.height); this._room = { key, c: rc }; }
      ctx.drawImage(this._room.c, F.x, F.y);
      const reg = { x: F.x + F.w * 0.12, y: F.y + F.h * 0.08, w: F.w * 0.76, h: F.h * (sc.room === 'terrazza' ? 0.84 : 0.82) };
      const ls = Math.min(1, Math.sqrt(1.2e6 / Math.max(1, reg.w * reg.h)));
      const L = this._layer || (this._layer = document.createElement('canvas'));
      const lw = Math.max(1, Math.round(reg.w * ls)), lh = Math.max(1, Math.round(reg.h * ls));
      if (L.width !== lw || L.height !== lh) { L.width = lw; L.height = lh; }
      const lc = L.getContext('2d'); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, lw, lh);
      const r = this.paintAvatar(lc, { x: 0, y: 0, w: lw, h: lh }, A, false, true);
      if (this.img) feather(lc, r, 0.8); // bordi appena sfumati: la figura resta intera
      ctx.drawImage(L, reg.x, reg.y, reg.w, reg.h);
      this._bounds = { frame: F, cw: CW, ch: CH, region: reg, img: { x: reg.x + r.x / ls, y: reg.y + r.y / ls, w: r.w / ls, h: r.h / ls } };
      vignette(ctx, F);
    }
  }

  const VS = 1000; // unità virtuale dello spazio del viso (il canvas reale scala con una trasformazione)
  const ROT_MAX = 0.075; const SHIFT_MAX = 0.042 * 1000; const SKEW_MAX = 0.018; // v7: movimenti più ampi (spalle comprese), sempre dentro il riquadro // rotazione massima della testa/busto (radianti): l'ingombro è calcolato su questo valore
  // Bordi sfumati (Presenza e scena senza immagine): ellisse sull'area dell'immagine
  function feather(ctx, r, inner = 0.62) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in';
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.scale(Math.max(1, r.w / 2), Math.max(1, r.h / 2));
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, 1.02); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-60, -60, 120, 120); ctx.restore();
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

  // ---------- stanze illustrate (solo canvas, nessuna immagine esterna) ----------
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const lin = (c, x0, y0, x1, y1, stops) => { const g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; };
  const glow = (c, x, y, r, col) => { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
  function sofa(c, W, H, x, y, w, h, colA, colB) {
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(x + w / 2, y + h * 1.02, w * 0.55, h * 0.08, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = lin(c, 0, y - h * 0.55, 0, y + h * 0.4, [[0, colA], [1, colB]]); rr(c, x + w * 0.04, y - h * 0.55, w * 0.92, h * 0.8, h * 0.18); c.fill(); // schienale
    c.fillStyle = lin(c, 0, y + h * 0.1, 0, y + h, [[0, colA], [1, colB]]); rr(c, x, y + h * 0.15, w, h * 0.7, h * 0.14); c.fill(); // seduta
    c.fillStyle = colB; rr(c, x - w * 0.03, y - h * 0.15, w * 0.1, h * 0.95, h * 0.1); c.fill(); rr(c, x + w * 0.93, y - h * 0.15, w * 0.1, h * 0.95, h * 0.1); c.fill(); // braccioli
    c.fillStyle = 'rgba(255,255,255,0.06)'; rr(c, x + w * 0.1, y + h * 0.12, w * 0.38, h * 0.14, h * 0.06); c.fill(); rr(c, x + w * 0.52, y + h * 0.12, w * 0.38, h * 0.14, h * 0.06); c.fill();
  }
  const ROOMS = {
    salotto(c, W, H) {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, '#4a2c28'], [0.7, '#2d1a19'], [1, '#1d1110']]); c.fillRect(0, 0, W, H);
      // finestra serale
      const wx = W * 0.07, wy = H * 0.12, ww = W * 0.22, wh = H * 0.42;
      c.fillStyle = lin(c, 0, wy, 0, wy + wh, [[0, '#24315e'], [0.6, '#7a4a6a'], [1, '#e08a5a']]); c.fillRect(wx, wy, ww, wh);
      c.strokeStyle = '#1a0f0e'; c.lineWidth = Math.max(2, W * 0.008); c.strokeRect(wx, wy, ww, wh); c.beginPath(); c.moveTo(wx + ww / 2, wy); c.lineTo(wx + ww / 2, wy + wh); c.moveTo(wx, wy + wh * 0.5); c.lineTo(wx + ww, wy + wh * 0.5); c.stroke();
      c.fillStyle = 'rgba(120,40,50,0.55)'; c.fillRect(wx - W * 0.03, wy - H * 0.03, W * 0.035, wh + H * 0.1); c.fillRect(wx + ww, wy - H * 0.03, W * 0.035, wh + H * 0.1); // tende
      // quadro
      c.fillStyle = '#20120f'; c.fillRect(W * 0.42, H * 0.13, W * 0.18, H * 0.2); c.fillStyle = lin(c, W * 0.43, 0, W * 0.59, 0, [[0, '#a0574a'], [1, '#d9a066']]); c.fillRect(W * 0.43, H * 0.145, W * 0.16, H * 0.17);
      // pavimento + tappeto
      c.fillStyle = lin(c, 0, H * 0.74, 0, H, [[0, '#3b2416'], [1, '#22140c']]); c.fillRect(0, H * 0.74, W, H * 0.26);
      c.fillStyle = 'rgba(160,70,90,0.35)'; c.beginPath(); c.ellipse(W * 0.5, H * 0.92, W * 0.36, H * 0.07, 0, 0, Math.PI * 2); c.fill();
      // lampada da terra
      glow(c, W * 0.86, H * 0.3, Math.max(W, H) * 0.35, 'rgba(255,190,110,0.35)');
      c.fillStyle = '#1a0f0e'; c.fillRect(W * 0.858, H * 0.33, W * 0.006, H * 0.47); c.fillStyle = '#e8c08a'; c.beginPath(); c.moveTo(W * 0.82, H * 0.34); c.lineTo(W * 0.9, H * 0.34); c.lineTo(W * 0.88, H * 0.24); c.lineTo(W * 0.84, H * 0.24); c.closePath(); c.fill();
      // pianta
      c.fillStyle = '#3a2a22'; rr(c, W * 0.06, H * 0.7, W * 0.07, H * 0.1, 4); c.fill(); c.fillStyle = '#2f5a3a'; for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(W * (0.07 + (i % 3) * 0.02), H * (0.6 + (i % 2) * 0.05), W * 0.02, H * 0.07, (i - 3) * 0.35, 0, Math.PI * 2); c.fill(); }
      sofa(c, W, H, W * 0.2, H * 0.62, W * 0.6, H * 0.2, '#7c3b4a', '#4e2230');
      glow(c, W * 0.5, H * 0.55, Math.max(W, H) * 0.5, 'rgba(255,170,120,0.08)');
    },
    camera(c, W, H) {
      c.fillStyle = lin(c, 0, 0, 0, H, [[0, '#2f2140'], [0.7, '#1f1630'], [1, '#140e1f']]); c.fillRect(0, 0, W, H);
      // finestra con luna
      const wx = W * 0.72, wy = H * 0.12, ww = W * 0.2, wh = H * 0.36;
      c.fillStyle = lin(c, 0, wy, 0, wy + wh, [[0, '#0d1430'], [1, '#2a3566']]); c.fillRect(wx, wy, ww, wh); glow(c, wx + ww * 0.65, wy + wh * 0.3, ww * 0.35, 'rgba(230,235,255,0.6)');
      c.fillStyle = '#f2f0e6'; c.beginPath(); c.arc(wx + ww * 0.65, wy + wh * 0.3, ww * 0.08, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#0c0814'; c.lineWidth = Math.max(2, W * 0.007); c.strokeRect(wx, wy, ww, wh);
      c.fillStyle = 'rgba(180,150,210,0.25)'; c.fillRect(wx - W * 0.04, wy - H * 0.04, W * 0.05, wh + H * 0.14); c.fillRect(wx + ww - W * 0.01, wy - H * 0.04, W * 0.05, wh + H * 0.14);
      // applique calde
      glow(c, W * 0.14, H * 0.32, Math.max(W, H) * 0.25, 'rgba(255,190,120,0.35)'); glow(c, W * 0.58, H * 0.32, Math.max(W, H) * 0.18, 'rgba(255,190,120,0.18)');
      c.fillStyle = '#e8c08a'; rr(c, W * 0.125, H * 0.29, W * 0.03, H * 0.05, 3); c.fill();
      // pavimento
      c.fillStyle = lin(c, 0, H * 0.78, 0, H, [[0, '#2a1d18'], [1, '#160e0b']]); c.fillRect(0, H * 0.78, W, H * 0.22);
      // letto: testiera imbottita, materasso, piumone, cuscini
      c.fillStyle = lin(c, 0, H * 0.3, 0, H * 0.6, [[0, '#5b4470'], [1, '#3b2b4c']]); rr(c, W * 0.2, H * 0.33, W * 0.6, H * 0.3, H * 0.04); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(1, W * 0.003); for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(W * (0.2 + i * 0.1), H * 0.35); c.lineTo(W * (0.2 + i * 0.1), H * 0.6); c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(W * 0.5, H * 0.95, W * 0.38, H * 0.05, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = lin(c, 0, H * 0.6, 0, H * 0.95, [[0, '#ece6ef'], [1, '#b9aec4']]); rr(c, W * 0.16, H * 0.62, W * 0.68, H * 0.3, H * 0.05); c.fill();
      c.fillStyle = '#d8cfe0'; rr(c, W * 0.24, H * 0.56, W * 0.22, H * 0.09, H * 0.04); c.fill(); rr(c, W * 0.54, H * 0.56, W * 0.22, H * 0.09, H * 0.04); c.fill();
      c.fillStyle = 'rgba(120,60,110,0.55)'; rr(c, W * 0.16, H * 0.74, W * 0.68, H * 0.1, H * 0.03); c.fill();
    },
    terrazza(c, W, H) {
      c.fillStyle = lin(c, 0, 0, 0, H * 0.7, [[0, '#2b2a5c'], [0.45, '#b4587a'], [0.8, '#f2a25c'], [1, '#f7c87a']]); c.fillRect(0, 0, W, H);
      glow(c, W * 0.7, H * 0.6, Math.max(W, H) * 0.35, 'rgba(255,210,140,0.65)');
      // skyline
      c.fillStyle = '#2a1830'; let x = 0; let i = 0; while (x < W) { const bw = W * (0.04 + ((i * 37) % 5) * 0.012), bh = H * (0.08 + ((i * 53) % 7) * 0.025); c.fillRect(x, H * 0.62 - bh, bw, bh + H * 0.1); x += bw + W * 0.004; i++; }
      c.fillStyle = 'rgba(255,220,150,0.8)'; for (let j = 0; j < 60; j++) { const px = ((j * 97) % 100) / 100 * W, py = H * (0.5 + ((j * 31) % 12) / 100); c.fillRect(px, py, Math.max(1, W * 0.003), Math.max(1, H * 0.004)); }
      // pavimento in cotto
      c.fillStyle = lin(c, 0, H * 0.7, 0, H, [[0, '#7a3f2c'], [1, '#4a2418']]); c.fillRect(0, H * 0.7, W, H * 0.3);
      // ringhiera
      c.strokeStyle = '#1b1015'; c.lineWidth = Math.max(2, W * 0.006); c.beginPath(); c.moveTo(0, H * 0.6); c.lineTo(W, H * 0.6); c.moveTo(0, H * 0.7); c.lineTo(W, H * 0.7); c.stroke();
      c.lineWidth = Math.max(1, W * 0.003); for (let k = 0; k <= 30; k++) { c.beginPath(); c.moveTo(k * W / 30, H * 0.6); c.lineTo(k * W / 30, H * 0.7); c.stroke(); }
      // lucine
      c.strokeStyle = 'rgba(30,20,20,0.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, H * 0.08); c.quadraticCurveTo(W * 0.5, H * 0.24, W, H * 0.08); c.stroke();
      for (let k = 1; k < 16; k++) { const t = k / 16, px = t * W, py = H * 0.08 + Math.sin(t * Math.PI) * H * 0.08; glow(c, px, py, Math.max(W, H) * 0.02, 'rgba(255,220,150,0.9)'); }
      // piante in vaso
      [[0.08, 0.74], [0.9, 0.74]].forEach(([px, py]) => { c.fillStyle = '#5a2c1e'; rr(c, W * (px - 0.035), H * py, W * 0.07, H * 0.1, 4); c.fill(); c.fillStyle = '#2f5a3a'; for (let k = 0; k < 6; k++) { c.beginPath(); c.ellipse(W * (px + (k - 2.5) * 0.012), H * (py - 0.05), W * 0.015, H * 0.06, (k - 2.5) * 0.4, 0, Math.PI * 2); c.fill(); } });
      sofa(c, W, H, W * 0.22, H * 0.66, W * 0.56, H * 0.18, '#d9c9b0', '#a8957a');
    },
  };
  TalkingAvatar.ROOMS = Object.keys(ROOMS);


  // Disegna l'immagine ritagliata a quadrato (center crop); opzionalmente solo una regione (in coord. del quadrato)
  function drawCover(ctx, img, S, region) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const ox = (img.naturalWidth - s) / 2, oy = (img.naturalHeight - s) / 2, k = s / S;
    if (!region) return ctx.drawImage(img, ox, oy, s, s, 0, 0, S, S);
    const { sx, sy, sw, sh } = region;
    ctx.drawImage(img, ox + sx * k, oy + sy * k, sw * k, sh * k, sx, sy, sw, sh);
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

  window.TalkingAvatar = TalkingAvatar;
  window.LandmarkEditor = LandmarkEditor;
})();
