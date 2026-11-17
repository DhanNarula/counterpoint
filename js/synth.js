// Counterpoint — the studio. Every sound is synthesized from math at play time:
// no samples, no audio libraries.
//
//   FM electric piano  · Karplus–Strong plucked strings (physical model, allpass-tuned)
//   additive-wave lead · detuned pad · sub+saw bass · 808-style metallic cymbals
//   pitch-swept kick   · noise snare/clap · generated convolution reverb
//   tempo-synced feedback delay · sidechain "pump" bus · master limiter

import { midiToFreq } from './theory.js';

export class Studio {
  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    ctx.resume(); // don't block boot on it; any later gesture also resumes
    const g = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
    this.g = g;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12; this.limiter.knee.value = 8; this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.004; this.limiter.release.value = 0.18;
    this.limiter.connect(ctx.destination);
    this.master = g(0.8, this.limiter);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.5;
    this.limiter.connect(this.analyser);

    // Reverb: impulse response generated procedurally (decaying, darkening noise)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8);
    this.reverb.connect(g(0.32, this.master));

    // Dotted-eighth feedback delay with a lowpass in the loop
    this.delay = ctx.createDelay(2);
    const fb = g(0.32);
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay); dlp.connect(g(0.5, this.master));

    this.drums = g(0.9, this.master); this.drums.connect(g(0.06, this.reverb));
    this.bassBus = g(0.75, this.master);
    this.duck = g(1, this.master);                 // sidechain target
    this.chords = g(0.5, this.duck); this.chords.connect(g(0.45, this.reverb));
    this.lead = g(0.55, this.master); this.lead.connect(g(0.3, this.reverb)); this.lead.connect(g(0.18, this.delay));

    const sr = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, sr * 2, sr);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Additive waveforms: harmonic amplitudes chosen by hand
    this.leadWave = this.periodic((n) => (n % 2 ? 1 : 0.5) / n, 28);   // between saw and square
    this.padWave = this.periodic((n) => (n <= 6 ? 1 : 0.45) / Math.pow(n, 1.1), 36);
    this.ksCache = new Map();
    this.setTempo(120);

    await ctx.audioWorklet.addModule(new URL('./pitch-worklet.js', import.meta.url));
  }

  setTempo(bpm) { if (this.delay) this.delay.delayTime.value = (60 / bpm) * 0.75; }

  periodic(fn, N) {
    const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) imag[n] = fn(n);
    return this.ctx.createPeriodicWave(real, imag);
  }

  impulse(dur) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.018);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp((-t * 6.5) / dur);
        const a = 0.85 * Math.exp(-t * 2.2) + 0.06; // one-pole lowpass that closes over time
        lp += a * (Math.random() * 2 - 1 - lp);
        d[i] = lp * env;
      }
      // a few early reflections
      for (const [ms, amp] of [[11, 0.5], [23, 0.35], [37, 0.25], [53, 0.2]]) {
        const k = pre + Math.floor((ms + c * 3) * sr / 1000);
        if (k < len) d[k] += amp * (c ? -1 : 1);
      }
    }
    return buf;
  }

  // ADSR via setTargetAtTime (robust to overlapping automation)
  env(t, peak, a, d, s, dur, r, dest) {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, Math.max(d, 0.003) / 3);
    const rel = Math.max(t + dur, t + a + 0.01);
    p.setTargetAtTime(0, rel, r / 4);
    g.connect(dest);
    return { g, end: rel + r * 1.8 };
  }

  pan(value, dest) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, value));
    p.connect(dest);
    return p;
  }

  // ---------------------------------------------------------------- drums
  drum(name, t, v) {
    switch (name) {
      case 'kick': return this.kick(t, v);
      case 'snare': return this.snare(t, v);
      case 'clap': return this.clap(t, v);
      case 'hat': return this.metal(t, v * 0.16, 0.05, 10000, 40);
      case 'openHat': return this.metal(t, v * 0.14, 0.3, 9500, 40);
      case 'hatPedal': return this.metal(t, v * 0.12, 0.035, 9000, 42);
      case 'ride': return this.metal(t, v * 0.085, 1.1, 7200, 61);
    }
  }

  noiseHit(t, v, decay, type, freq, dest, q = 0.7) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(v, 1e-4), t);
    g.gain.exponentialRampToValueAtTime(1e-4, t + decay);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5, decay + 0.05);
  }

  kick(t, v) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 0.01), t + 0.003);
    g.gain.exponentialRampToValueAtTime(1e-3, t + 0.45);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.5);
    this.noiseHit(t, v * 0.22, 0.006, 'highpass', 3000, this.drums);
  }

  snare(t, v) {
    const c = this.ctx;
    this.noiseHit(t, v * 0.5, 0.19, 'highpass', 1400, this.drums);
    this.noiseHit(t, v * 0.25, 0.12, 'bandpass', 3500, this.drums, 1);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(v * 0.45, t); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.11);
    o.connect(g); g.connect(this.drums); o.start(t); o.stop(t + 0.15);
  }

  clap(t, v) {
    for (const dt of [0, 0.011, 0.023]) this.noiseHit(t + dt, v * 0.35, 0.03, 'bandpass', 1200, this.drums, 0.9);
    this.noiseHit(t + 0.03, v * 0.35, 0.2, 'bandpass', 1100, this.drums, 0.8);
  }

  // 808-style cymbal: six detuned square waves at inharmonic ratios, band-limited
  metal(t, v, decay, bp, base) {
    const c = this.ctx;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = bp; f1.Q.value = 0.8;
    const f2 = c.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = bp * 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(Math.max(v, 2e-4), t + 0.002);
    g.gain.exponentialRampToValueAtTime(1e-4, t + decay);
    f1.connect(f2); f2.connect(g); g.connect(this.drums);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = base * r;
      o.connect(f1); o.start(t); o.stop(t + decay + 0.02);
    }
  }

  // ---------------------------------------------------------------- bass
  bass(t, midi, dur, v) {
    const c = this.ctx, f = midiToFreq(midi);
    const { g, end } = this.env(t, 0.5 * v, 0.006, 0.3, 0.75, dur, 0.08, this.bassBus);
    const sub = c.createOscillator(); sub.frequency.value = f;
    const saw = c.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(260 + 900 * v, t);
    lp.frequency.setTargetAtTime(230, t + 0.01, 0.08);
    const sg = c.createGain(); sg.gain.value = 0.35;
    sub.connect(g); saw.connect(sg); sg.connect(lp); lp.connect(g);
    sub.start(t); saw.start(t); sub.stop(end); saw.stop(end);
  }

  // ---------------------------------------------------------------- keys
  // 2-operator FM electric piano + a short high-ratio "tine" modulator for the bark
  ep(t, midi, dur, v) {
    const c = this.ctx, f = midiToFreq(midi);
    const out = this.pan((midi - 62) / 24, this.chords);
    const { g, end } = this.env(t, 0.15 * v, 0.004, 1.8, 0.0, dur, 0.3, out);
    const car = c.createOscillator(); car.frequency.value = f;
    const mod = c.createOscillator(); mod.frequency.value = f;
    const mi = c.createGain();
    mi.gain.setValueAtTime(f * (0.8 + 2.2 * v), t);
    mi.gain.setTargetAtTime(f * 0.18, t, 0.35);
    const tine = c.createOscillator(); tine.frequency.value = f * 14;
    const ti = c.createGain();
    ti.gain.setValueAtTime(f * 1.4 * v, t);
    ti.gain.setTargetAtTime(0, t, 0.025);
    mod.connect(mi); mi.connect(car.frequency);
    tine.connect(ti); ti.connect(car.frequency);
    car.connect(g);
    for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
  }

  pad(t, midi, dur, v) {
    const c = this.ctx, f = midiToFreq(midi);
    const out = this.pan((midi - 64) / 20, this.chords);
    const { g, end } = this.env(t, 0.075 * v, 0.16, 0.6, 0.75, dur, 0.5, out);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.setTargetAtTime(900 + 1600 * v, t, 0.15);
    lp.connect(g);
    for (const det of [-9, 9]) {
      const o = c.createOscillator(); o.setPeriodicWave(this.padWave);
      o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(end);
    }
  }

  // Karplus–Strong string: a noise burst circulating in a tuned delay line
  // through an averaging lowpass (energy loss) and a first-order allpass that
  // supplies the fractional delay for exact tuning.
  ks(midi) {
    if (this.ksCache.has(midi)) return this.ksCache.get(midi);
    const sr = this.ctx.sampleRate, f = midiToFreq(midi);
    const P = sr / f;
    let N = Math.floor(P - 0.5);
    let dfrac = P - 0.5 - N;
    if (dfrac < 0.1) { N -= 1; dfrac += 1; }
    const C = (1 - dfrac) / (1 + dfrac);
    const len = Math.floor(sr * 1.8);
    const buf = this.ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const line = new Float32Array(N);
    let prevN = 0;
    for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; line[i] = 0.5 * (r + prevN); prevN = r; }
    const damp = 0.996 - Math.min(0.012, f / 120000);
    let idx = 0, last = 0, apX = 0, apY = 0;
    for (let i = 0; i < len; i++) {
      const x = line[idx];
      out[i] = x;
      const avg = 0.5 * (x + last); last = x;
      const ap = C * avg + apX - C * apY; apX = avg; apY = ap;
      line[idx] = ap * damp;
      idx = (idx + 1) % N;
    }
    this.ksCache.set(midi, buf);
    return buf;
  }

  pluck(t, midi, v) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.ks(midi);
    const g = c.createGain(); g.gain.value = 0.42 * v;
    s.connect(g); g.connect(this.pan((midi - 64) / 18, this.chords));
    s.start(t);
  }

  // ---------------------------------------------------------------- lead (your notes)
  leadVoice(t, midi, v) {
    const c = this.ctx, f = midiToFreq(midi);
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.2 * v, t + 0.012);
    amp.gain.setTargetAtTime(0.14 * v, t + 0.012, 0.08);
    amp.connect(this.lead);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(1400 + 3200 * v, t);
    lp.frequency.setTargetAtTime(1100 + 1500 * v, t + 0.02, 0.2);
    lp.connect(amp);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.4;
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(14, t + 0.7); // delayed vibrato
    lfo.connect(depth);
    const oscs = [lfo];
    for (const det of [-5, 5]) {
      const o = c.createOscillator(); o.setPeriodicWave(this.leadWave);
      o.frequency.value = f; o.detune.value = det;
      depth.connect(o.detune);
      o.connect(lp); oscs.push(o);
    }
    oscs.forEach((o) => o.start(t));
    let done = false;
    return {
      release: (tr) => {
        if (done) return; done = true;
        const tt = Math.max(tr, t + 0.02);
        amp.gain.cancelScheduledValues(tt);
        amp.gain.setTargetAtTime(0, tt, 0.07);
        oscs.forEach((o) => o.stop(tt + 0.5));
      },
      kill: () => { try { amp.disconnect(); } catch {} },
    };
  }
  leadOn(midi, v) { return this.leadVoice(this.ctx.currentTime, midi, v); }
  leadAt(t, midi, dur, v) { const h = this.leadVoice(t, midi, v); h.release(t + dur); return h; }

  // ---------------------------------------------------------------- sidechain
  duckAt(t, len) {
    const p = this.duck.gain;
    p.setValueAtTime(0.25, t);
    p.linearRampToValueAtTime(1, t + len * 0.85);
  }
  resetDuck() {
    const p = this.duck.gain;
    p.cancelScheduledValues(0);
    p.setValueAtTime(1, this.ctx.currentTime);
  }

  // ---------------------------------------------------------------- microphone
  async startMic(onFrame) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(this.ctx, 'yin-pitch');
    src.connect(node);
    node.connect(this.g(0, this.ctx.destination)); // keep the worklet pulled, silently
    src.connect(this.analyser);                     // show your voice on the spectrum
    node.port.onmessage = (e) => onFrame(e.data);
    this.mic = { stream, src, node };
  }
  stopMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    try { this.mic.src.disconnect(); this.mic.node.disconnect(); } catch {}
    this.mic = null;
  }
}
