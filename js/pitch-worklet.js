// YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002),
// running on the audio thread inside an AudioWorklet.
//
//  1. difference function      d(τ)  = Σ (x[j] − x[j+τ])²
//  2. cumulative-mean normalize d'(τ) = d(τ) · τ / Σ_{k≤τ} d(k)
//  3. absolute threshold: first dip below 0.12, then slide to its local minimum
//  4. parabolic interpolation around the minimum for sub-sample precision
//
// Posts { f0, clarity, rms } to the main thread every hop (~21 ms).

class YinPitch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.frame = new Float32Array(this.size);
    this.write = 0;
    this.hop = 1024;
    this.since = 0;
    this.W = 1024;                                             // integration window
    this.tauMax = Math.min(this.size - this.W - 2, Math.floor(sampleRate / 60)); // lowest ~60 Hz
    this.tauMin = Math.max(2, Math.floor(sampleRate / 1400));  // highest ~1.4 kHz
    this.d = new Float32Array(this.tauMax + 2);
    this.threshold = 0.12;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.write] = ch[i];
      this.write = (this.write + 1) % this.size;
    }
    this.since += ch.length;
    if (this.since >= this.hop) { this.since = 0; this.analyze(); }
    return true;
  }

  analyze() {
    const n = this.size, f = this.frame, W = this.W, tauMax = this.tauMax, d = this.d;
    for (let i = 0; i < n; i++) f[i] = this.buf[(this.write + i) % n];
    const start = n - W - tauMax - 1;

    let rms = 0;
    for (let j = n - W; j < n; j++) rms += f[j] * f[j];
    rms = Math.sqrt(rms / W);
    if (rms < 0.004) { this.port.postMessage({ f0: 0, clarity: 0, rms }); return; }

    // 1. difference function
    d[0] = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = f[start + j] - f[start + j + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    // 2. cumulative mean normalized difference
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    // 3. absolute threshold + local minimum
    let tau = -1;
    for (let t = this.tauMin; t <= tauMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) { // no confident dip: report global minimum with low clarity
      let best = this.tauMin;
      for (let t = this.tauMin; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      tau = best;
    }
    // 4. parabolic interpolation
    const x0 = d[tau - 1], x1 = d[tau], x2 = d[tau + 1];
    const denom = x0 + x2 - 2 * x1;
    const shift = Math.abs(denom) > 1e-9 ? (x0 - x2) / (2 * denom) : 0;
    const refined = tau + Math.max(-1, Math.min(1, shift));
    this.port.postMessage({ f0: sampleRate / refined, clarity: Math.max(0, 1 - x1), rms });
  }
}

registerProcessor('yin-pitch', YinPitch);
