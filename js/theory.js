// Counterpoint — music theory core.
// Pure functions and small stateful trackers. No audio lives here, so all of it
// can be unit-tested in Node (see test/theory.test.mjs).

export const mod12 = (n) => ((n % 12) + 12) % 12;
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// ---------------------------------------------------------------------------
// Names (English letters / French solfège)
// ---------------------------------------------------------------------------
const NAMES_MAJ = {
  en: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'],
  fr: ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'],
};
const NAMES_MIN = {
  en: ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'],
  fr: ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'Si♭', 'Si'],
};
export const pcName = (pc, lang = 'en', minorSpelling = false) =>
  (minorSpelling ? NAMES_MIN : NAMES_MAJ)[lang][mod12(pc)];
export const midiName = (m, lang = 'en') => pcName(m, lang, true) + (Math.floor(m / 12) - 1);
export function keyName(key, lang = 'en') {
  const n = pcName(key.tonic, lang, key.mode === 'minor');
  if (lang === 'fr') return `${n} ${key.mode === 'major' ? 'majeur' : 'mineur'}`;
  return `${n} ${key.mode}`;
}

// ---------------------------------------------------------------------------
// Key finding — Krumhansl–Kessler probe-tone profiles, correlated against a
// time-decaying pitch-class histogram (the "chroma" of what you've played).
// ---------------------------------------------------------------------------
export const KK = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

function pearson(x, y) {
  let mx = 0, my = 0;
  for (let i = 0; i < 12; i++) { mx += x[i]; my += y[i]; }
  mx /= 12; my /= 12;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < 12; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

export class KeyTracker {
  constructor(halfLife = 7) {
    this.halfLife = halfLife; // seconds — how fast old notes fade from memory
    this.reset();
  }
  reset() {
    this.chroma = new Float64Array(12);
    this.key = { tonic: 0, mode: 'major' };
    this.scores = [];
    for (let t = 0; t < 12; t++) for (const mode of ['major', 'minor']) this.scores.push({ tonic: t, mode, r: 0 });
    this.confidence = 0;
    this.hasData = false;
    this.last = null;
  }
  decayTo(time) {
    if (this.last !== null && time > this.last) {
      const k = Math.pow(0.5, (time - this.last) / this.halfLife);
      for (let i = 0; i < 12; i++) this.chroma[i] *= k;
    }
    this.last = time;
  }
  add(pcOrMidi, weight) { this.chroma[mod12(pcOrMidi)] += weight; }
  total() { let s = 0; for (let i = 0; i < 12; i++) s += this.chroma[i]; return s; }
  analyze() {
    const rot = new Array(12);
    const scores = [];
    for (let t = 0; t < 12; t++) {
      for (let i = 0; i < 12; i++) rot[i] = this.chroma[(i + t) % 12];
      scores.push({ tonic: t, mode: 'major', r: pearson(rot, KK.major) });
      scores.push({ tonic: t, mode: 'minor', r: pearson(rot, KK.minor) });
    }
    this.scores = scores;
    // Don't commit to a key on a handful of notes — wait for real evidence.
    if (this.total() < (this.hasData ? 0.5 : 2.5)) { this.confidence *= 0.98; return this.key; }
    let best = scores[0];
    for (const s of scores) if (s.r > best.r) best = s;
    const cur = scores.find((s) => s.tonic === this.key.tonic && s.mode === this.key.mode);
    // Hysteresis: only modulate when the new key clearly beats the current one.
    if (!this.hasData || best.r > cur.r + 0.06) {
      this.key = { tonic: best.tonic, mode: best.mode };
      this.hasData = true;
    }
    const now = scores.find((s) => s.tonic === this.key.tonic && s.mode === this.key.mode);
    this.confidence = Math.max(0, Math.min(1, now.r));
    return this.key;
  }
}

// ---------------------------------------------------------------------------
// Chords: naming, recognition from played notes, Roman numerals
// ---------------------------------------------------------------------------
export const TEMPLATES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['°', [0, 3, 6]], ['+', [0, 4, 8]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
  ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['m7♭5', [0, 3, 6, 10]], ['°7', [0, 3, 6, 9]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
];
const TEMPLATE_MAP = Object.fromEntries(TEMPLATES);

/** Name a chord from its root and the set of pitch classes actually sounding. */
export function chordSymbol(root, pcs) {
  const iv = new Set([...pcs].map((p) => mod12(p - root)));
  const has = (i) => iv.has(i);
  const maj = has(4), min = has(3) && !has(4);
  let q;
  if (maj && has(8) && !has(7)) q = '+';
  else if (min && has(6) && !has(7)) q = has(10) ? 'm7♭5' : has(9) ? '°7' : '°';
  else if (min) q = has(10) ? 'm7' : has(11) ? 'm(maj7)' : 'm';
  else if (maj) q = has(11) ? 'maj7' : has(10) ? '7' : '';
  else if (has(5)) q = 'sus4';
  else if (has(2)) q = 'sus2';
  else q = '5';
  if (has(2) && (maj || min)) {
    q = { maj7: 'maj9', '7': '9', m7: 'm9', '': 'add9', m: 'm(add9)' }[q] ?? q;
  }
  return q;
}

/** Recognize the chord a player is holding (3+ notes). Template matching with a bass bonus. */
export function recognizeChord(midis) {
  const pcs = new Set(midis.map(mod12));
  if (pcs.size < 3) return null;
  const bass = mod12(Math.min(...midis));
  let best = null;
  for (let root = 0; root < 12; root++) {
    if (!pcs.has(root)) continue;
    for (const [sym, iv] of TEMPLATES) {
      let match = 0;
      for (const i of iv) if (pcs.has(mod12(root + i))) match++;
      const missing = iv.length - match, extra = pcs.size - match;
      const score = match * 2 - missing * 1.6 - extra * 1.4 + (bass === root ? 0.7 : 0) - iv.length * 0.05;
      if (!best || score > best.score) best = { root, sym, bass, score };
    }
  }
  return best && best.score > 3 ? best : null;
}

const RN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
export function romanFor(key, root, sym) {
  let r = RN[mod12(root - key.tonic)];
  const minorish = (sym.startsWith('m') && !sym.startsWith('maj')) || sym.startsWith('°');
  if (minorish) r = r.toLowerCase();
  if (sym.startsWith('°')) r += '°';
  else if (sym.includes('♭5')) r += 'ø';
  return r;
}

// ---------------------------------------------------------------------------
// Diatonic harmony
// ---------------------------------------------------------------------------
export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
export const ROMAN = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'V', 'VI', 'VII'],
};
export const FUNC = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D']; // tonic / predominant / dominant

export const scaleSet = (key) => new Set(SCALES[key.mode].map((s) => mod12(key.tonic + s)));

/** Stack thirds inside the scale. Minor-mode V borrows the harmonic-minor leading tone. */
export function degreeTones(key, degree) {
  let scale = SCALES[key.mode];
  if (key.mode === 'minor' && degree === 4) scale = [0, 2, 3, 5, 7, 8, 11];
  const at = (k) => mod12(key.tonic + scale[(degree + k) % 7]);
  return { root: at(0), third: at(2), fifth: at(4), seventh: at(6), ninth: at(1) };
}

/** Tones for a chord the player is holding (used in "follow" mode). */
export function buildTones(rec, key) {
  const iv = TEMPLATE_MAP[rec.sym];
  const r = rec.root;
  const t = { root: r, third: mod12(r + iv[1]), fifth: mod12(r + iv[2]), ninth: mod12(r + 2) };
  if (iv[3] !== undefined) t.seventh = mod12(r + iv[3]);
  else if (iv[1] === 3) t.seventh = mod12(r + 10);
  else t.seventh = scaleSet(key).has(mod12(r + 11)) ? mod12(r + 11) : mod12(r + 10);
  return t;
}

// Functional-harmony transition model: P(next degree | current degree).
// Rows: from I..vii, columns: to I..vii. Hand-tuned from common-practice tendencies.
const BASE_T = [
  [0.10, 0.14, 0.06, 0.22, 0.22, 0.20, 0.06],
  [0.05, 0.06, 0.03, 0.08, 0.55, 0.08, 0.15],
  [0.06, 0.08, 0.05, 0.25, 0.08, 0.40, 0.08],
  [0.25, 0.12, 0.04, 0.06, 0.35, 0.08, 0.10],
  [0.50, 0.04, 0.06, 0.08, 0.08, 0.22, 0.02],
  [0.08, 0.28, 0.08, 0.30, 0.14, 0.06, 0.06],
  [0.70, 0.02, 0.10, 0.02, 0.06, 0.08, 0.02],
];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Harmonizer {
  constructor(seed = 1729) {
    this.prev = 0;
    this.rng = mulberry32(seed);
    this.cache = new Map();
  }
  matrix(style) {
    const id = style ? style.id : 'base';
    if (this.cache.has(id)) return this.cache.get(id);
    const T = BASE_T.map((r) => r.slice());
    for (const [a, b, amt] of (style && style.biases) || []) T[a][b] += amt;
    for (const row of T) { const s = row.reduce((x, y) => x + y, 0); for (let j = 0; j < 7; j++) row[j] /= s; }
    this.cache.set(id, T);
    return T;
  }
  degreeOf(key, rootPc) {
    return SCALES[key.mode].findIndex((s) => mod12(key.tonic + s) === mod12(rootPc));
  }
  /**
   * Score all seven diatonic chords against what the melody is doing.
   *   score = 1.8·presence·fit  +  0.45·ln P(transition)  +  phrase/cadence bonus
   * fit rewards melody notes that are chord tones and punishes clashes; the
   * transition term keeps the progression idiomatic; the cadence term makes
   * 4-bar phrases breathe (tonic on bar 1, dominant leading into bar 1).
   */
  choose({ key, weights, slot, style }) {
    const T = this.matrix(style);
    const inScale = scaleSet(key);
    let total = 0;
    for (let i = 0; i < 12; i++) total += weights[i];
    const presence = Math.min(1, total / 0.6);
    const cands = [];
    for (let d = 0; d < 7; d++) {
      const t = degreeTones(key, d);
      let fit = 0;
      if (total > 0) {
        for (let pc = 0; pc < 12; pc++) {
          const w = weights[pc];
          if (!w) continue;
          let v;
          if (pc === t.root || pc === t.third || pc === t.fifth) v = 1;
          else if (pc === t.seventh) v = 0.45;
          else if (pc === t.ninth) v = 0.15;
          else if (inScale.has(pc)) v = -0.3;
          else v = -0.9;
          fit += w * v;
        }
        fit /= total;
      }
      const trans = Math.log(T[this.prev][d]);
      let cad = 0;
      if (slot === 0 && d === 0) cad += 0.35;
      if ((slot === 6 || slot === 7) && d === 4) cad += 0.4;
      const score = 1.8 * presence * fit + 0.45 * trans + cad;
      cands.push({ degree: d, roman: ROMAN[key.mode][d], func: FUNC[d], tones: t, fit, trans, cad, score });
    }
    cands.sort((a, b) => b.score - a.score);
    let pick = cands[0];
    if (presence < 0.3) {
      // Nobody's playing: improvise a progression by sampling the softmax.
      const temp = 0.35;
      const ws = cands.map((c) => Math.exp((c.score - cands[0].score) / temp));
      let r = this.rng() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r <= 0) { pick = cands[i]; break; } }
    }
    this.prev = pick.degree;
    return { pick, cands, presence };
  }
  predictNext(style) {
    const row = this.matrix(style)[this.prev];
    let best = -1, bp = -1;
    for (let j = 0; j < 7; j++) if (j !== this.prev && row[j] > bp) { bp = row[j]; best = j; }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Voice leading — exhaustive search over voicings, minimizing a cost:
// voice movement + parallel 5ths/8ves + register drift + spacing/mud rules.
// ---------------------------------------------------------------------------
export function voiceChord(tones, spec, prev) {
  const deg = { 1: tones.root, 3: tones.third, 5: tones.fifth, 7: tones.seventh, 9: tones.ninth };
  let use = spec.use.slice();
  if (mod12(tones.ninth - tones.root) !== 2) use = use.filter((u) => u !== 9); // only a natural 9th
  const pcs = [...new Set(use.map((u) => deg[u]))];
  const N = spec.voices;
  const search = (required) => {
    const pool = [];
    for (let m = spec.lo; m <= spec.hi; m++) if (pcs.includes(mod12(m))) pool.push(m);
    let best = null;
    const combo = [];
    const evaluate = () => {
      const v = combo;
      const have = new Set(v.map(mod12));
      for (const r of required) if (!have.has(r)) return;
      let cost = (pcs.length - have.size) * 2.5;
      for (let i = 0; i < N - 1; i++) {
        const iv = v[i + 1] - v[i];
        if (iv < 3 && v[i] < 55) cost += 4; // low clusters turn to mud
        if (iv === 1) cost += 0.8;
      }
      if (v[N - 1] - v[0] > 26) cost += 3;
      const avg = v.reduce((a, b) => a + b, 0) / N;
      cost += Math.abs(avg - spec.center) * 0.35;
      let movement = 0, parallels = 0;
      if (prev && prev.length === N) {
        for (let i = 0; i < N; i++) movement += Math.abs(v[i] - prev[i]);
        cost += movement * 0.9;
        for (let i = 0; i < N; i++) {
          for (let j = i + 1; j < N; j++) {
            const a = mod12(prev[j] - prev[i]), b = mod12(v[j] - v[i]);
            const mi = v[i] - prev[i], mj = v[j] - prev[j];
            if (a === b && (b === 7 || b === 0) && mi !== 0 && Math.sign(mi) === Math.sign(mj)) {
              parallels++; cost += 6;
            }
          }
        }
        if (Math.abs(v[N - 1] - prev[N - 1]) > 7) cost += 2; // keep the top line singable
      }
      if (!best || cost < best.cost) best = { notes: v.slice(), cost, movement, parallels };
    };
    const rec = (start) => {
      if (combo.length === N) { evaluate(); return; }
      for (let i = start; i <= pool.length - (N - combo.length); i++) {
        const m = pool[i];
        if (combo.length && m - combo[combo.length - 1] > 12) break;
        combo.push(m); rec(i + 1); combo.pop();
      }
    };
    rec(0);
    return best;
  };
  const required = [...new Set(spec.required.map((u) => deg[u]))];
  return search(required) || search([]) || {
    notes: [tones.root, tones.third, tones.fifth].map((pc) => 60 + mod12(pc - 0)).sort((a, b) => a - b),
    cost: 0, movement: 0, parallels: 0,
  };
}
