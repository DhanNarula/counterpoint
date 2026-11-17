// Counterpoint — the band. A look-ahead scheduler ("two clocks": a JS timer
// that schedules sample-accurate Web Audio events ~120 ms ahead) drives drums,
// bass and comping on a 16th-note grid. Every half-bar the engine *listens*
// (melody window → pitch-class weights), updates its sense of key, and decides
// the next chord, its voicing, and a bass line that anticipates the chord after.

import {
  KeyTracker, Harmonizer, voiceChord, chordSymbol, recognizeChord, buildTones,
  romanFor, degreeTones, mod12, FUNC,
} from './theory.js';
import { STYLES, BASS, DEMO_MELODY, DEMO_BARS, DEMO_TRANSPOSE } from './styles.js';

const bassMidi = (pc) => { const m = 36 + mod12(pc); return m > 45 ? m - 12 : m; };

export class Engine {
  constructor(studio) {
    this.s = studio;
    this.ctx = studio.ctx;
    this.key = new KeyTracker(7);
    this.harm = new Harmonizer();
    this.notes = [];          // melody memory: { midi, start, end|null, source }
    this.held = new Map();    // live notes currently down
    this.queue = [];          // timed events for the UI
    this.listeners = {};
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.voicing = null;
    this.chord = null;
    this.bassPlan = [];
    this.history = [];
    this.demo = null;
    this.setStyle('jazz');
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, d) { (this.listeners[ev] || []).forEach((f) => f(d)); }
  get sd() { return 60 / this.tempo / 4; } // seconds per 16th

  setStyle(id) {
    this.style = STYLES[id];
    this.tempo = this.style.tempo;
    this.s.setTempo(this.tempo);
    this.voicing = null;
    this.s.resetDuck();
    if (this.demo) this.restartDemo();
    this.emit('style', this.style);
  }
  setTempo(bpm) {
    this.tempo = bpm;
    this.s.setTempo(bpm);
    if (this.demo) this.restartDemo();
  }

  start() {
    if (this.playing) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    this.emit('transport', true);
  }
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.stopDemo();
    this.s.resetDuck();
    this.emit('transport', false);
  }

  tick() {
    const horizon = this.ctx.currentTime + 0.12;
    while (this.nextTime < horizon) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += this.sd;
      this.step++;
    }
    if (this.demo && this.demo.endStep - this.step < 20) this.queueDemoLoop();
  }

  swing(s) { return s % 4 === 2 ? (this.style.swing - 0.5) * 4 * this.sd : 0; }

  scheduleStep(step, t) {
    const s = step % 16, st = this.style, sd = this.sd;
    if (s % 8 === 0) this.decide(step, t);
    const ts = t + this.swing(s);
    const hum = () => (Math.random() - 0.5) * 0.006; // a little human looseness

    for (const [voice, pat] of Object.entries(st.drums)) {
      const ch = pat[s];
      if (ch === '.') continue;
      const v = ch === 'X' ? 1 : ch === 'x' ? 0.72 : 0.32;
      this.s.drum(voice, ts + hum(), v);
      if (voice === 'kick' && st.sidechain) this.s.duckAt(ts, 4 * sd);
    }

    const rel = s % 8;
    for (const n of this.bassPlan) {
      if (n.s !== rel) continue;
      this.s.bass(ts, n.m, n.d * sd, n.v);
      this.queue.push({ time: ts, type: 'bass', midi: n.m, dur: n.d * sd });
    }

    if (this.voicing) {
      const ns = this.voicing.notes;
      for (const [cs, dur, vel] of st.comp) {
        if (cs !== s) continue;
        ns.forEach((m, i) => this.s[st.chordInstr](ts + i * 0.006 + hum(), m, dur * sd, vel * (0.85 + Math.random() * 0.15)));
      }
      if (st.arp && s % st.arp.every === 0) {
        const k = Math.floor(s / st.arp.every);
        const cyc = ns.concat(ns.slice(1, -1).reverse()); // up-down
        this.s.pluck(ts, cyc[k % cyc.length] + st.arp.up, st.arp.vel * (s % 4 === 0 ? 1.15 : 0.9));
      }
    }
    this.queue.push({ time: t, type: 'step', s });
  }

  /** What has the melody been doing around time t? Returns duration-weighted pitch-class energy (in beats). */
  melodyWeights(t, half) {
    const w = new Float64Array(12);
    const a = t - half * 0.6, b = t + half;
    const now = this.ctx.currentTime;
    for (const n of this.notes) {
      const e = n.end ?? Math.max(now, t) + half * 0.3;
      const ov = Math.min(e, b) - Math.max(n.start, a);
      if (ov <= 0) continue;
      let wt = ov;
      if (n.start >= t - 0.03 && n.start < t + half * 0.25) wt *= 1.6; // downbeat notes define harmony
      w[mod12(n.midi)] += wt;
    }
    const beat = 4 * this.sd;
    for (let i = 0; i < 12; i++) w[i] /= beat;
    return w;
  }

  decide(step, t) {
    const half = 8 * this.sd;
    const slot = Math.floor(step / 8) % 8; // position in a 4-bar phrase
    const now = this.ctx.currentTime;
    this.notes = this.notes.filter((n) => (n.end ?? Infinity) > now - 12);
    this.key.decayTo(now);
    const key = this.key.analyze();
    const weights = this.melodyWeights(t, half);

    let tones, info;
    const live = [...this.held.values()].filter((h) => h.note.source !== 'mic').map((h) => h.note.midi);
    const rec = live.length >= 3 ? recognizeChord(live) : null;
    if (rec) {
      // You're playing chords: the band follows you exactly.
      tones = buildTones(rec, key);
      const deg = this.harm.degreeOf(key, rec.root);
      if (deg >= 0) this.harm.prev = deg;
      info = { follow: true, degree: deg, roman: romanFor(key, rec.root, rec.sym), func: deg >= 0 ? FUNC[deg] : 'X', cands: [] };
    } else {
      const r = this.harm.choose({ key, weights, slot, style: this.style });
      tones = r.pick.tones;
      info = { follow: false, degree: r.pick.degree, roman: r.pick.roman, func: r.pick.func, cands: r.cands, presence: r.presence };
    }

    const v = voiceChord(tones, this.style.voicing, this.voicing && this.voicing.notes);
    this.voicing = v;
    const sym = chordSymbol(tones.root, new Set([tones.root, ...v.notes.map(mod12)]));

    const nextDeg = this.harm.predictNext(this.style);
    const root = bassMidi(tones.root);
    const next = bassMidi(degreeTones(key, nextDeg).root);
    this.bassPlan = BASS[this.style.bass]({ root, fifth: root + 7, next });

    const chord = {
      root: tones.root, sym, ...info, notes: v.notes, movement: v.movement, parallels: v.parallels,
      key: { ...key }, slot, weights: Array.from(weights), predicted: nextDeg, time: t,
    };
    this.chord = chord;
    this.history.push(chord);
    if (this.history.length > 24) this.history.shift();
    this.queue.push({ time: t, type: 'chord', chord });
  }

  // ------------------------------------------------------------ live input
  noteOn(midi, vel = 0.8, source = 'key') {
    if (this.held.has(midi)) return;
    const now = this.ctx.currentTime;
    const handle = source === 'mic' ? null : this.s.leadOn(midi, vel);
    const note = { midi, start: now, end: null, source };
    this.notes.push(note);
    this.held.set(midi, { note, handle });
    this.key.decayTo(now);
    this.key.add(midi, 0.35);
    this.key.analyze();
    this.emit('note', { midi, on: true, source });
  }
  noteOff(midi) {
    const h = this.held.get(midi);
    if (!h) return;
    const now = this.ctx.currentTime;
    h.note.end = now;
    if (h.handle) h.handle.release(now);
    this.held.delete(midi);
    this.key.decayTo(now);
    this.key.add(midi, Math.max(0.1, Math.min(2, now - h.note.start)));
    this.emit('note', { midi, on: false, source: h.note.source });
  }
  heldMidis() { return [...this.held.keys()]; }

  // ------------------------------------------------------------ demo
  startDemo() {
    if (!this.playing) this.start();
    this.demo = { loop: 0, endStep: null, handles: [] };
    this.queueDemoLoop();
    this.emit('demo', true);
  }
  restartDemo() { this.stopDemo(); if (this.playing) this.startDemo(); }
  stopDemo() {
    if (!this.demo) return;
    const now = this.ctx.currentTime;
    this.demo.handles.forEach((h) => h.kill());
    this.notes = this.notes.filter((n) => n.source !== 'demo' || n.start <= now);
    for (const n of this.notes) if (n.source === 'demo' && n.end > now) n.end = now;
    this.queue = this.queue.filter((e) => !(e.type === 'note' && e.on));
    this.demo = null;
    this.emit('demo', false);
  }
  queueDemoLoop() {
    const d = this.demo;
    const startStep = d.endStep ?? Math.ceil((this.step + 4) / 16) * 16;
    const tr = DEMO_TRANSPOSE[d.loop % DEMO_TRANSPOSE.length];
    d.loop++;
    const B = 4 * this.sd;
    const t0 = this.nextTime + (startStep - this.step) * this.sd;
    for (const [bar, beat, len, midi] of DEMO_MELODY) {
      const frac = beat % 1;
      const bt = Math.floor(beat) + (Math.abs(frac - 0.5) < 1e-6 ? this.style.swing : frac);
      const start = t0 + (bar * 4 + bt) * B;
      const end = start + len * B * 0.92;
      const m = midi + tr;
      this.notes.push({ midi: m, start, end, source: 'demo' });
      d.handles.push(this.s.leadAt(start, m, end - start, 0.75));
      this.queue.push({ time: start, type: 'note', on: true, midi: m, source: 'demo', dur: end - start });
      this.queue.push({ time: end, type: 'note', on: false, midi: m, source: 'demo' });
    }
    d.endStep = startStep + DEMO_BARS * 16;
  }

  /** Hand the UI every event whose time has come; demo notes also feed the key tracker here. */
  flush(now) {
    const due = [], keep = [];
    for (const e of this.queue) (e.time <= now ? due : keep).push(e);
    this.queue = keep;
    for (const e of due) {
      if (e.type === 'note' && e.on) {
        this.key.decayTo(now);
        this.key.add(e.midi, 0.35 + Math.min(1.5, e.dur || 0.3));
        this.key.analyze();
      }
    }
    return due;
  }
}
