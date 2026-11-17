// Inputs: computer keyboard (by physical key, so QWERTY and AZERTY both work),
// Web MIDI controllers, and the microphone (YIN frames → note events).

import { freqToMidi } from './theory.js';

const CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ',
  'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
export const KEY_LETTERS = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';', "'"];

export class Inputs {
  constructor(engine, { onMidiStatus, onOctave, onFirstNote }) {
    this.e = engine;
    this.octave = 60;
    this.down = new Map();
    this.onOctave = onOctave;
    this.onFirstNote = onFirstNote;
    window.addEventListener('keydown', (ev) => this.keydown(ev));
    window.addEventListener('keyup', (ev) => this.keyup(ev));
    window.addEventListener('blur', () => { for (const m of this.down.values()) this.e.noteOff(m); this.down.clear(); });
    this.initMidi(onMidiStatus);
  }

  play(m, v, src) { this.onFirstNote && this.onFirstNote(); this.e.noteOn(m, v, src); }

  keydown(ev) {
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target && ev.target.matches && ev.target.matches('input[type=text], textarea')) return;
    if (ev.code === 'KeyZ' || ev.code === 'KeyX') {
      this.octave = Math.max(36, Math.min(84, this.octave + (ev.code === 'KeyZ' ? -12 : 12)));
      this.onOctave && this.onOctave(this.octave);
      return;
    }
    const i = CODES.indexOf(ev.code);
    if (i < 0) return;
    ev.preventDefault();
    const m = this.octave + i;
    this.down.set(ev.code, m);
    this.play(m, 0.8, 'key');
  }
  keyup(ev) {
    const m = this.down.get(ev.code);
    if (m === undefined) return;
    this.down.delete(ev.code);
    this.e.noteOff(m);
  }

  async initMidi(cb) {
    if (!navigator.requestMIDIAccess) { cb && cb(false); return; }
    try {
      const access = await navigator.requestMIDIAccess();
      const bind = () => {
        let n = 0;
        access.inputs.forEach((inp) => { n++; inp.onmidimessage = (e) => this.midi(e.data); });
        cb && cb(n > 0);
      };
      bind();
      access.onstatechange = bind;
    } catch { cb && cb(false); }
  }
  midi([st, d1, d2]) {
    const cmd = st & 0xf0;
    if (cmd === 0x90 && d2 > 0) this.play(d1, 0.35 + 0.65 * (d2 / 127), 'midi');
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this.e.noteOff(d1);
  }
}

/** Turns a stream of YIN pitch frames into stable note-on / note-off events. */
export class PitchSegmenter {
  constructor({ onOn, onOff, onFrame }) {
    Object.assign(this, { onOn, onOff, onFrame });
    this.active = null; this.cand = null; this.count = 0; this.silent = 0;
  }
  push({ f0, clarity, rms }) {
    const voiced = f0 > 60 && f0 < 1400 && clarity > 0.86 && rms > 0.012;
    let info = null;
    if (voiced) {
      const mf = freqToMidi(f0);
      let m = Math.round(mf);
      // Vibrato tolerance: stay on the current note unless we clearly left it.
      if (this.active !== null && Math.abs(mf - this.active) < 0.65) m = this.active;
      info = { midi: m, cents: Math.round((mf - Math.round(mf)) * 100), clarity };
      this.silent = 0;
      if (m === this.cand) this.count++; else { this.cand = m; this.count = 1; }
      if (this.count >= 3 && m !== this.active) {
        if (this.active !== null) this.onOff(this.active);
        this.active = m;
        this.onOn(m);
      }
    } else {
      this.silent++; this.cand = null; this.count = 0;
      if (this.silent >= 4 && this.active !== null) { this.onOff(this.active); this.active = null; }
    }
    this.onFrame(info, rms);
  }
  flush() { if (this.active !== null) this.onOff(this.active); this.active = null; }
}
