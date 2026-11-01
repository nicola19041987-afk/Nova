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
      this.scene = { nightstand: false, drawerOpen: false }; this.drawerAmt = 0; this.drawerAnim = 0; // comodino (solo disegno, nessuna immagine)
      this.loop = this.loop.bind(this);
      this._frame = 0; this.simUntil = 0;
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      requestAnimationFrame(this.loop); // parte subito, anche senza fotocamera
    }
    // Canvas nitido su retina: la risoluzione interna segue la dimensione a schermo x devicePixelRatio (max 3x, max 1400 px).
    // Tutto il disegno usa S = this.c.width, quindi scala da solo.
    resize() {
      const css = this.c.clientWidth || 0; if (!css) return;
      const px = Math.round(Math.min(1400, css * Math.min(3, window.devicePixelRatio || 1)));
      if (Math.abs(px - this.c.width) > 2) { this.c.width = px; this.c.height = px; }
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
    // ---- scena: comodino con cassetto (disegnato sul canvas) ----
    setScene(sc) { this.scene = { ...this.scene, ...sc }; }
    // Lei si gira verso il comodino e apre il cassetto (animazione ~3 s); senza animazione resta solo aperto
    openDrawer(animate) { if (!this.scene.nightstand) return; this.scene.drawerOpen = true; if (animate) this.drawerAnim = performance.now(); }
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
      const ctx = this.ctx, S = this.c.width;
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
      const rAmp = (this.rhythm ? 0.028 + this.rhythm.strength * 0.02 : sens ? 0.034 : 0.028) * (this.rhythm ? 1 : styleAmp);
      const breath = Math.sin(now / (sens ? 5200 : 4000) * Math.PI * 2) * (sens ? 1.4 : 1);
      let sway = Math.sin(this._ph * Math.PI * 2) * rAmp + Math.sin(now / 2300) * 0.009;
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
      if (now > mc.nextLook) { mc.lookT = Math.random() < 0.45 ? 0 : (Math.random() * 2 - 1) * (0.25 + ST.headAmp); mc.nextLook = now + 2500 + Math.random() * 5000 * (1.2 - ST.energy); }
      mc.look += (mc.lookT - mc.look) * Math.min(1, dt / 600);
      const idle = R ? 0.25 : 1;
      const tgtTilt = (R ? R.tilt * g : 0) + mc.look * 0.25 * idle, tgtYaw = (R ? R.yaw * g : 0) + mc.look * 0.6 * idle, tgtPitch = R ? R.pitch * g : 0;
      M.tilt = spring(M.tilt, tgtTilt, 'tilt', 26); M.yaw = spring(M.yaw, tgtYaw, 'yaw', 22); M.pitch = spring(M.pitch, tgtPitch, 'pitch', 26);
      // piccole alzate di braccio a riposo, più frequenti per chi gesticola di più (solo mezzo busto / figura intera)
      if (now > mc.nextIdleLift) { mc.idleLiftT = Math.random() * (0.15 + ST.energy * 0.35); mc.nextIdleLift = now + (mc.idleLiftT > 0.05 ? 1600 : 0) + 60000 / Math.max(1, ST.gestPerMin + 2) * (0.6 + Math.random()); setTimeout(() => { mc.idleLiftT = 0; }, 1400 + Math.random() * 900); }
      M.lift[0] = Math.max(0, spring(M.lift[0], R ? R.lift[0] * (g + 0.1) : 0, 'l0', 18));
      M.lift[1] = Math.max(0, spring(M.lift[1], R ? R.lift[1] * (g + 0.1) : mc.idleLiftT * (R ? 0 : 1), 'l1', 18));
      M.energy += ((R ? R.energy * g : ST.energy * 0.12 * learned) - M.energy) * Math.min(1, dt / 500);
      sway += M.tilt * 0.12;
      bob += M.pitch * S * 0.02 + breath * S * 0.004;
      // girata verso il comodino durante l'animazione del cassetto
      let turn = 0;
      if (this.drawerAnim) { const t = now - this.drawerAnim; if (t > 3400) this.drawerAnim = 0; else turn = ease(t < 1000 ? t / 1000 : t < 2300 ? 1 : 1 - (t - 2300) / 1100); }
      const shiftX = M.yaw * S * 0.025 - turn * S * 0.05;
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

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S, S);
      if (!this.transparent) { ctx.fillStyle = this.colors.background; ctx.fillRect(0, 0, S, S); }
      const col = this.colors;
      ctx.filter = `hue-rotate(${col.hue}deg) saturate(${col.saturation}%) brightness(${col.brightness}%)`;
      ctx.translate(S / 2 + shiftX + rx, S * 0.62 + bob + ry);
      ctx.rotate(sway + talkNod + rRot - turn * 0.05);
      const sc = 1.04 + breath * 0.014;
      ctx.scale(sc, sc + breath * 0.01);
      ctx.translate(-S / 2, -S * 0.62);

      if (this.img) {
        drawCover(ctx, this.img, S);
        // Gesti (mezzo busto / figura intera): braccia che si muovono col ritmo e l'intensità del parlato.
        // Approssimazione 2.5D: le zone laterali (braccia) ruotano attorno alle spalle.
        const tgt = (this.speaking ? 0.35 + this.mouth * 0.7 + (now - this.emph < 700 ? 0.6 : 0) : 0) + M.energy * 0.6 + wave * 0.8;
        this.gesture = Math.max(0, spring(this.gesture, tgt, 'gesture', 9)); // gesti morbidi (molla smorzata)
        const lifted = M.lift[0] > 0.05 || M.lift[1] > 0.05;
        if (this.gesturesOn && this.framing !== 'ritratto' && (this.gesture > 0.02 || lifted)) {
          const sh = this.framing === 'figura intera' ? 0.24 : 0.42; // altezza spalle
          const mx = this.lm.mouth.x;
          [-1, 1].forEach((side) => {
            const px = (mx + side * (this.framing === 'figura intera' ? 0.09 : 0.2)) * S, py = sh * S;
            // braccio alzato dall'utente (specchio: la mano destra dell'utente muove il lato destro dello schermo) + saluto
            const lift = side < 0 ? M.lift[0] : M.lift[1];
            const waveSide = wave && side > 0 ? Math.sin(now / 120) * 0.08 * wave - 0.12 * wave : 0;
            const ang = side * this.gesture * 0.07 * Math.sin(now / 260 + (side > 0 ? 0 : 1.3)) - side * lift * 0.16 + waveSide;
            const rx = side < 0 ? 0 : px, rw = side < 0 ? px : S - px;
            ctx.save(); ctx.beginPath(); ctx.rect(rx, py, rw, S - py); ctx.clip();
            ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py - this.gesture * S * 0.006);
            drawCover(ctx, this.img, S, { sx: rx, sy: py - S * 0.05, sw: rw, sh: S - py + S * 0.05 }); ctx.restore();
          });
        }
        const m = this.lm.mouth, open = Math.max(0, this.mouth);
        if (smile > 0.05 && open < 0.2) {
          // sorriso approssimato: la zona della bocca si allarga e sale di poco
          const w = S * 0.2, h = S * 0.09;
          ctx.save(); ctx.beginPath(); ctx.ellipse(m.x * S, m.y * S, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(m.x * S, m.y * S); ctx.scale(1 + smile * 0.07, 1 - smile * 0.02); ctx.translate(-m.x * S, -m.y * S - smile * S * 0.004);
          drawCover(ctx, this.img, S, { sx: m.x * S - w / 2, sy: m.y * S - h / 2, sw: w, sh: h }); ctx.restore();
        }
        if (open > 0.03) {
          // mascella: la parte sotto la bocca scende un poco
          const jw = S * 0.34, jh = S * 0.26, jx = m.x * S - jw / 2, jy = m.y * S;
          const drop = open * S * 0.028;
          ctx.save(); ctx.beginPath(); ctx.ellipse(m.x * S, jy + jh * 0.45, jw / 2, jh * 0.6, 0, 0, Math.PI * 2); ctx.clip();
          ctx.translate(0, drop); drawCover(ctx, this.img, S, { sx: jx, sy: jy, sw: jw, sh: jh }); ctx.restore();
          // interno bocca
          ctx.fillStyle = 'rgba(45,8,14,0.88)';
          ctx.beginPath(); ctx.ellipse(m.x * S, m.y * S + drop * 0.5, S * 0.045 * (0.8 + open * 0.3), Math.max(1, drop * 0.75), 0, 0, Math.PI * 2); ctx.fill();
        }
        // microespressioni sulla foto: sguardo (zona occhio spostata di poco) e sopracciglia (zona sopra l'occhio sale)
        const gxp = mc.gx * S * 0.0045, gyp = mc.gy * S * 0.0025, bup = mc.brow * S * 0.007;
        [this.lm.eyeL, this.lm.eyeR].forEach((e) => {
          if (Math.abs(gxp) > 0.4 || Math.abs(gyp) > 0.4) {
            const w = S * 0.075, h = S * 0.036;
            ctx.save(); ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
            ctx.translate(gxp, gyp); drawCover(ctx, this.img, S, { sx: e.x * S - w / 2 - 4, sy: e.y * S - h / 2 - 4, sw: w + 8, sh: h + 8 }); ctx.restore();
          }
          if (bup > 0.4) {
            const w = S * 0.12, h = S * 0.045, cy = e.y * S - S * 0.075; // sopra la palpebra, senza toccare l'occhio
            ctx.save(); ctx.beginPath(); ctx.ellipse(e.x * S, cy, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
            ctx.translate(0, -bup); drawCover(ctx, this.img, S, { sx: e.x * S - w / 2, sy: cy - h / 2, sw: w, sh: h + bup + 4 }); ctx.restore();
          }
        });
        if (blink > 0.05) {
          [this.lm.eyeL, this.lm.eyeR].forEach((e, i) => {
            ctx.fillStyle = this.lidColor[i];
            ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S - S * 0.026 * (1 - blink), S * 0.045, S * 0.026 * blink, /* la palpebra scende dall'alto */ 0, 0, Math.PI * 2); ctx.fill();
          });
        }
      } else {
        ctx.font = `${S * 0.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(1 + this.mouth * 0.04, 1 - this.mouth * 0.06 + blink * 0.0);
        ctx.translate(mc.gx * S * 0.004, -mc.brow * S * 0.006); ctx.fillText(this.emoji, 0, S * 0.03); ctx.restore();
      }
      ctx.filter = 'none';
      // piccole icone che salgono (risposta ai gesti: 👋 👍 ✌️ 👌 …)
      if (this.badges.length) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        this.badges = this.badges.filter((b) => now - b.t < 1800);
        for (const b of this.badges) { const p = (now - b.t) / 1800; ctx.globalAlpha = 1 - p; ctx.font = `${S * 0.12}px system-ui, "Apple Color Emoji", sans-serif`; ctx.fillText(b.e, b.x * S, S * (0.82 - p * 0.35)); }
        ctx.globalAlpha = 1;
      }
      if (this.transparent && this.img) { // modalità Presenza: bordi sfumati per fondersi con la stanza
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); ctx.globalCompositeOperation = 'source-over';
      }
      if (this.scene.nightstand) this.drawNightstand(ctx, S, now);
      const stage = this.c.parentElement;
      if (stage) { stage.classList.toggle('speaking', this.speaking); stage.style.setProperty('--glow', col.glow); }
      const pulse = sens ? Math.round(14 + Math.sin(now / 1400) * 8) : 0;
      this.c.style.boxShadow = this.speaking ? `0 0 0 3px ${col.glow}, 0 0 22px ${col.glow}88` : sens ? `0 0 ${pulse}px ${col.glow}66` : '';
    }
  }

  // Comodino stilizzato in basso a sinistra (legno, piano, cassetto con pomello). Aperto: interno scuro e icone astratte.
  TalkingAvatar.prototype.drawNightstand = function (ctx, S, now) {
    const animOpen = this.drawerAnim ? Math.min(1, Math.max(0, (now - this.drawerAnim - 1000) / 800)) : 0;
    const target = this.scene.drawerOpen ? (this.drawerAnim ? animOpen : 1) : 0;
    this.drawerAmt += (target - this.drawerAmt) * 0.15;
    const x = S * 0.03, w = S * 0.26, top = S * 0.74, h = S * 0.26, o = this.drawerAmt;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.96;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + S * 0.01, top + S * 0.015, w, h); // ombra
    ctx.fillStyle = '#6b4226'; ctx.fillRect(x, top, w, h); // corpo
    ctx.fillStyle = '#8a5a36'; ctx.fillRect(x - S * 0.008, top - S * 0.02, w + S * 0.016, S * 0.024); // piano
    // lampada stilizzata
    ctx.fillStyle = '#c9a06a'; ctx.fillRect(x + w * 0.62, top - S * 0.07, S * 0.008, S * 0.05);
    ctx.fillStyle = 'rgba(255,214,150,0.85)'; ctx.beginPath(); ctx.moveTo(x + w * 0.52, top - S * 0.07); ctx.lineTo(x + w * 0.8, top - S * 0.07); ctx.lineTo(x + w * 0.74, top - S * 0.11); ctx.lineTo(x + w * 0.58, top - S * 0.11); ctx.closePath(); ctx.fill();
    const dy = top + h * 0.18, dh = h * 0.34, out = o * S * 0.045;
    if (o > 0.02) { ctx.fillStyle = '#1e120a'; ctx.fillRect(x + w * 0.08, dy, w * 0.84, dh); } // interno
    ctx.fillStyle = '#7d4f2e'; ctx.fillRect(x + w * 0.06 - out * 0.3, dy + out, w * 0.88 + out * 0.6, dh); // frontale del cassetto
    ctx.strokeStyle = '#4a2c18'; ctx.lineWidth = Math.max(1, S * 0.004); ctx.strokeRect(x + w * 0.06 - out * 0.3, dy + out, w * 0.88 + out * 0.6, dh);
    ctx.fillStyle = '#d8b46a'; ctx.beginPath(); ctx.arc(x + w / 2, dy + out + dh / 2, S * 0.009, 0, Math.PI * 2); ctx.fill(); // pomello
    if (o > 0.5) { // icone astratte (nessuna immagine esplicita)
      ctx.globalAlpha = (o - 0.5) * 2 * (0.75 + Math.sin(now / 400) * 0.25);
      ctx.font = `${S * 0.05}px system-ui, "Apple Color Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✨', x + w * 0.3, dy - S * 0.01); ctx.fillText('💗', x + w * 0.7, dy - S * 0.025);
    }
    ctx.restore();
  };

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
