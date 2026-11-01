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
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
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
      if (!this.c.isConnected || this.c.offsetParent === null) return; // non visibile: risparmia batteria
      const ctx = this.ctx, S = this.c.width;
      this.mouth += (this.target(now) - this.mouth) * 0.4;
      const breath = Math.sin(now / 4000 * Math.PI * 2);
      const sway = Math.sin(now / 6500 * Math.PI * 2) * 0.018 + Math.sin(now / 2300) * 0.006;
      const talkNod = this.mouth * 0.012;
      // battito di ciglia
      if (now > this.nextBlink) { this.blinkStart = now; this.nextBlink = now + 2500 + Math.random() * 4000; }
      const bt = (now - this.blinkStart) / 160; const blink = bt < 1 ? Math.sin(bt * Math.PI) : 0;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S, S);
      if (!this.transparent) { ctx.fillStyle = this.colors.background; ctx.fillRect(0, 0, S, S); }
      const col = this.colors;
      ctx.filter = `hue-rotate(${col.hue}deg) saturate(${col.saturation}%) brightness(${col.brightness}%)`;
      ctx.translate(S / 2, S * 0.62);
      ctx.rotate(sway + talkNod);
      const sc = 1.03 + breath * 0.008;
      ctx.scale(sc, sc + breath * 0.006);
      ctx.translate(-S / 2, -S * 0.62);

      if (this.img) {
        drawCover(ctx, this.img, S);
        // Gesti (mezzo busto / figura intera): braccia che si muovono col ritmo e l'intensità del parlato.
        // Approssimazione 2.5D: le zone laterali (braccia) ruotano attorno alle spalle.
        const tgt = this.speaking ? 0.35 + this.mouth * 0.7 + (now - this.emph < 700 ? 0.6 : 0) : 0;
        this.gesture += (tgt - this.gesture) * 0.06;
        if (this.gesturesOn && this.framing !== 'ritratto' && this.gesture > 0.02) {
          const sh = this.framing === 'figura intera' ? 0.24 : 0.42; // altezza spalle
          const mx = this.lm.mouth.x;
          [-1, 1].forEach((side) => {
            const px = (mx + side * (this.framing === 'figura intera' ? 0.09 : 0.2)) * S, py = sh * S;
            const ang = side * this.gesture * 0.07 * Math.sin(now / 260 + (side > 0 ? 0 : 1.3));
            const rx = side < 0 ? 0 : px, rw = side < 0 ? px : S - px;
            ctx.save(); ctx.beginPath(); ctx.rect(rx, py, rw, S - py); ctx.clip();
            ctx.translate(px, py); ctx.rotate(ang); ctx.translate(-px, -py - this.gesture * S * 0.006);
            drawCover(ctx, this.img, S, { sx: rx, sy: py - S * 0.05, sw: rw, sh: S - py + S * 0.05 }); ctx.restore();
          });
        }
        const m = this.lm.mouth, open = Math.max(0, this.mouth);
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
        if (blink > 0.05) {
          [this.lm.eyeL, this.lm.eyeR].forEach((e, i) => {
            ctx.fillStyle = this.lidColor[i];
            ctx.beginPath(); ctx.ellipse(e.x * S, e.y * S - S * 0.012 * (1 - blink), S * 0.045, S * 0.026 * blink, 0, 0, Math.PI * 2); ctx.fill();
          });
        }
      } else {
        ctx.font = `${S * 0.6}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(1 + this.mouth * 0.04, 1 - this.mouth * 0.06 + blink * 0.0);
        ctx.fillText(this.emoji, 0, S * 0.03); ctx.restore();
      }
      ctx.filter = 'none';
      if (this.transparent && this.img) { // modalità Presenza: bordi sfumati per fondersi con la stanza
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in';
        const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, S, S); ctx.globalCompositeOperation = 'source-over';
      }
      const stage = this.c.parentElement;
      if (stage) { stage.classList.toggle('speaking', this.speaking); stage.style.setProperty('--glow', col.glow); }
      this.c.style.boxShadow = this.speaking ? `0 0 0 3px ${col.glow}, 0 0 22px ${col.glow}88` : '';
    }
  }

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
