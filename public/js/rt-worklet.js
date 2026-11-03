/* rt-worklet.js — v8.4: cattura del microfono per la conversazione in tempo reale.
 * Ricampiona a 24 kHz mono, PCM16, blocchi da 100 ms (formato richiesto dalla xAI Voice Agent API). Gira nel thread audio. */
class RtCapture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 24000; this.pos = 0; this.prev = 0; this.out = new Int16Array(2400); this.n = 0; this.e = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch || !ch.length) return true;
    const X = (k) => (k === 0 ? this.prev : ch[k - 1]); // X(0) = ultimo campione del blocco precedente
    let p = this.pos;
    while (p < ch.length) {
      const i = Math.floor(p), f = p - i, v = X(i) + (X(i + 1) - X(i)) * f;
      const s = v > 1 ? 1 : v < -1 ? -1 : v;
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff; this.e += s * s;
      if (this.n === this.out.length) { const b = this.out.slice(0); this.port.postMessage({ pcm: b.buffer, rms: Math.sqrt(this.e / this.n) }, [b.buffer]); this.n = 0; this.e = 0; }
      p += this.ratio;
    }
    this.pos = p - ch.length; this.prev = ch[ch.length - 1];
    return true;
  }
}
registerProcessor('rt-capture', RtCapture);
