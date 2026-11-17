// Visuals: circle of fifths (live key likelihoods), chroma vs. key profile,
// log-frequency spectrogram, and a playable piano.

import { mod12, pcName, KK } from './theory.js';

const DPR = () => Math.min(2, window.devicePixelRatio || 1);
export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), d = DPR();
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
  return false;
}
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ------------------------------------------------------------------ circle of fifths
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export function drawCircle(cv, { scores, key, chord, lang, accent, harmony }) {
  fitCanvas(cv);
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, d = DPR();
  c.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 8 * d;
  const outer = [R * 0.7, R], inner = [R * 0.4, R * 0.68];
  const sMaj = new Map(), sMin = new Map();
  for (const s of scores) (s.mode === 'major' ? sMaj : sMin).set(s.tonic, s.r);
  const all = scores.map((s) => s.r);
  const lo = Math.min(...all), hi = Math.max(...all);
  const norm = (r) => (hi - lo > 1e-6 ? Math.pow((r - lo) / (hi - lo), 2.2) : 0);
  const step = (Math.PI * 2) / 12;
  const ink = css('--ink') || '#eee', dim = css('--ink-3') || '#777';

  const sector = (rr, i, fill, stroke, lw) => {
    const a0 = -Math.PI / 2 + (i - 0.5) * step + 0.012, a1 = a0 + step - 0.024;
    c.beginPath();
    c.arc(cx, cy, rr[1], a0, a1);
    c.arc(cx, cy, rr[0], a1, a0, true);
    c.closePath();
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  };

  const keyMaj = key.mode === 'major' ? key.tonic : mod12(key.tonic + 3);
  const ki = FIFTHS.indexOf(keyMaj);

  for (let i = 0; i < 12; i++) {
    const maj = FIFTHS[i], min = mod12(maj + 9);
    const inKey = Math.min((i - ki + 12) % 12, (ki - i + 12) % 12) <= 1;
    sector(outer, i, hexA(accent, 0.05 + 0.78 * norm(sMaj.get(maj) ?? lo)), inKey ? hexA(accent, 0.35) : null, 1 * d);
    sector(inner, i, hexA(accent, 0.05 + 0.78 * norm(sMin.get(min) ?? lo)), inKey ? hexA(accent, 0.35) : null, 1 * d);
    const a = -Math.PI / 2 + i * step;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = inKey ? ink : dim;
    c.font = `600 ${Math.round(R * 0.095)}px Inter, system-ui, sans-serif`;
    const ro = (outer[0] + outer[1]) / 2, ri = (inner[0] + inner[1]) / 2;
    c.fillText(pcName(maj, lang), cx + Math.cos(a) * ro, cy + Math.sin(a) * ro);
    c.font = `500 ${Math.round(R * 0.07)}px Inter, system-ui, sans-serif`;
    c.fillText(pcName(min, lang, true) + 'm', cx + Math.cos(a) * ri, cy + Math.sin(a) * ri);
  }

  // current key: glowing outline
  c.save();
  c.shadowColor = accent; c.shadowBlur = 18 * d;
  sector(key.mode === 'major' ? outer : inner, ki, 'rgba(0,0,0,0)', accent, 2.5 * d);
  c.restore();

  // current chord: a marker on its home on the circle
  if (chord) {
    const minorish = chord.sym.startsWith('m') && !chord.sym.startsWith('maj');
    const dimish = chord.sym.startsWith('°') || chord.sym.includes('♭5');
    const idx = FIFTHS.indexOf(minorish || dimish ? mod12(chord.root + 3) : chord.root);
    const rr = minorish || dimish ? inner[0] - 10 * d : outer[1] - 0;
    const a = -Math.PI / 2 + idx * step;
    const x = cx + Math.cos(a) * (minorish || dimish ? rr : outer[1] + 0.5 * d);
    const y = cy + Math.sin(a) * (minorish || dimish ? rr : outer[1] + 0.5 * d);
    c.beginPath(); c.arc(x, y, 6 * d, 0, Math.PI * 2);
    c.fillStyle = harmony; c.shadowColor = harmony; c.shadowBlur = 14 * d; c.fill(); c.shadowBlur = 0;
    // line from center towards the chord
    c.beginPath(); c.moveTo(cx + Math.cos(a) * R * 0.12, cy + Math.sin(a) * R * 0.12);
    c.lineTo(cx + Math.cos(a) * R * 0.36, cy + Math.sin(a) * R * 0.36);
    c.strokeStyle = hexA(harmony, 0.7); c.lineWidth = 2 * d; c.stroke();
  }
}

// ------------------------------------------------------------------ chroma vs. profile
export function drawChroma(cv, { chroma, key, lang, accent }) {
  fitCanvas(cv);
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, d = DPR();
  c.clearRect(0, 0, W, H);
  const pad = 6 * d, labelH = 18 * d;
  const bw = (W - pad * 2) / 12;
  const max = Math.max(1e-6, ...chroma);
  const prof = KK[key.mode];
  const pmax = Math.max(...prof), pmin = Math.min(...prof);
  const plotH = H - labelH - pad;
  const ink3 = css('--ink-3') || '#777', ink = css('--ink') || '#eee';
  for (let pc = 0; pc < 12; pc++) {
    const x = pad + pc * bw;
    const h = (chroma[pc] / max) * plotH;
    const inScale = prof[mod12(pc - key.tonic)] > 3.4;
    c.fillStyle = pc === key.tonic ? accent : inScale ? hexA(accent, 0.55) : 'rgba(255,255,255,0.14)';
    c.beginPath();
    c.roundRect ? c.roundRect(x + bw * 0.16, pad + plotH - h, bw * 0.68, Math.max(h, 1), 3 * d) : c.rect(x + bw * 0.16, pad + plotH - h, bw * 0.68, h);
    c.fill();
    c.fillStyle = pc === key.tonic ? ink : ink3;
    c.font = `500 ${Math.round(11 * d)}px Inter, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.fillText(pcName(pc, lang, key.mode === 'minor'), x + bw / 2, H - 4 * d);
  }
  // the Krumhansl profile for the detected key, as a line
  c.beginPath();
  for (let pc = 0; pc < 12; pc++) {
    const v = (prof[mod12(pc - key.tonic)] - pmin) / (pmax - pmin);
    const x = pad + pc * bw + bw / 2, y = pad + plotH - v * plotH * 0.95;
    pc ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1.5 * d; c.setLineDash([4 * d, 4 * d]); c.stroke(); c.setLineDash([]);
}

// ------------------------------------------------------------------ spectrogram
function makeLut() {
  const stops = [[0, [7, 7, 11]], [0.25, [42, 17, 80]], [0.5, [138, 31, 106]], [0.72, [232, 85, 58]], [0.88, [249, 181, 74]], [1, [255, 244, 214]]];
  const lut = [];
  for (let i = 0; i < 256; i++) {
    const v = Math.pow(i / 255, 1.4);
    let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (v - p0) / (p1 - p0)));
    lut.push(c0.map((x, j) => Math.round(x + (c1[j] - x) * f)));
  }
  return lut;
}
export class Spectrogram {
  constructor(cv) { this.cv = cv; this.c = cv.getContext('2d'); this.lut = makeLut(); this.map = null; this.data = null; }
  draw(analyser) {
    const cv = this.cv, c = this.c;
    const resized = fitCanvas(cv);
    const W = cv.width, H = cv.height;
    if (!this.data) this.data = new Uint8Array(analyser.frequencyBinCount);
    if (resized || !this.map) {
      this.map = new Int32Array(H);
      const ny = analyser.context.sampleRate / 2, fLo = 40, fHi = 12000;
      for (let y = 0; y < H; y++) {
        const f = fLo * Math.pow(fHi / fLo, 1 - y / (H - 1));
        this.map[y] = Math.min(this.data.length - 1, Math.round((f / ny) * this.data.length));
      }
      c.fillStyle = '#07070b'; c.fillRect(0, 0, W, H);
    }
    analyser.getByteFrequencyData(this.data);
    const sh = Math.max(1, Math.round(2 * DPR()));
    c.drawImage(cv, -sh, 0);
    const img = c.createImageData(sh, H);
    for (let y = 0; y < H; y++) {
      const [r, g, b] = this.lut[this.data[this.map[y]]];
      for (let x = 0; x < sh; x++) {
        const i = (y * sh + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    c.putImageData(img, W - sh, 0);
  }
}

// ------------------------------------------------------------------ piano
const BLACK = new Set([1, 3, 6, 8, 10]);
export class Piano {
  constructor(cv, { lo = 36, hi = 96, onDown, onUp }) {
    Object.assign(this, { cv, lo, hi, onDown, onUp });
    this.pointer = new Map();
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const m = this.hit(e); if (m == null) return;
      this.pointer.set(e.pointerId, m); onDown(m);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.pointer.has(e.pointerId)) return;
      const m = this.hit(e), old = this.pointer.get(e.pointerId);
      if (m != null && m !== old) { onUp(old); onDown(m); this.pointer.set(e.pointerId, m); }
    });
    const up = (e) => { if (!this.pointer.has(e.pointerId)) return; onUp(this.pointer.get(e.pointerId)); this.pointer.delete(e.pointerId); };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }
  layout() {
    const W = this.cv.width, H = this.cv.height;
    const whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
    const ww = W / whites.length, bw = ww * 0.6;
    const keys = new Map();
    whites.forEach((m, i) => keys.set(m, { x: i * ww, w: ww, h: H, black: false }));
    for (let m = this.lo; m <= this.hi; m++) {
      if (!BLACK.has(m % 12)) continue;
      const left = keys.get(m - 1);
      if (left) keys.set(m, { x: left.x + ww - bw / 2, w: bw, h: H * 0.62, black: true });
    }
    this.keys = keys;
  }
  hit(e) {
    const r = this.cv.getBoundingClientRect(), d = this.cv.width / r.width;
    const x = (e.clientX - r.left) * d, y = (e.clientY - r.top) * d;
    for (const [m, k] of this.keys) if (k.black && x >= k.x && x <= k.x + k.w && y <= k.h) return m;
    for (const [m, k] of this.keys) if (!k.black && x >= k.x && x <= k.x + k.w) return m;
    return null;
  }
  draw({ user, harmony, bass, labels, colors }) {
    if (fitCanvas(this.cv) || !this.keys) this.layout();
    const c = this.cv.getContext('2d'), d = DPR(), H = this.cv.height;
    c.clearRect(0, 0, this.cv.width, H);
    const fillFor = (m, black) => {
      if (user.has(m)) return colors.user;
      if (bass === m) return colors.bass;
      if (harmony.has(m)) return colors.harmony;
      return black ? '#15151b' : '#e9e5dc';
    };
    for (const pass of [false, true]) {
      for (const [m, k] of this.keys) {
        if (k.black !== pass) continue;
        c.fillStyle = fillFor(m, k.black);
        c.beginPath();
        if (c.roundRect) c.roundRect(k.x + 1, 0, k.w - 2, k.h - 1, [0, 0, 4 * d, 4 * d]); else c.rect(k.x + 1, 0, k.w - 2, k.h - 1);
        c.fill();
        if (!k.black && m % 12 === 0) {
          c.fillStyle = 'rgba(0,0,0,0.38)'; c.font = `600 ${Math.round(9 * d)}px Inter, sans-serif`;
          c.textAlign = 'center'; c.fillText('C' + (m / 12 - 1), k.x + k.w / 2, H - 7 * d);
        }
        const lab = labels.get(m);
        if (lab) {
          c.fillStyle = k.black ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
          c.font = `600 ${Math.round(10 * d)}px "JetBrains Mono", monospace`;
          c.textAlign = 'center';
          c.fillText(lab, k.x + k.w / 2, k.h - (k.black ? 8 : 22) * d);
        }
      }
    }
  }
}
