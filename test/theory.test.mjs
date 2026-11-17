// Run: node test/theory.test.mjs
import assert from 'node:assert/strict';
import {
  KeyTracker, Harmonizer, voiceChord, degreeTones, recognizeChord, chordSymbol, romanFor, mod12, freqToMidi,
} from '../js/theory.js';
import { STYLES } from '../js/styles.js';

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('✓', name); };

test('pitch math', () => {
  assert.equal(Math.round(freqToMidi(440)), 69);
  assert.equal(Math.round(freqToMidi(261.63)), 60);
});

test('key finding: C major melody → C major', () => {
  const k = new KeyTracker();
  for (const m of [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]) k.add(m, 1);
  k.add(60, 2); k.add(67, 1);
  assert.deepEqual(k.analyze(), { tonic: 0, mode: 'major' });
});

test('key finding: A harmonic minor → A minor', () => {
  const k = new KeyTracker();
  for (const m of [69, 71, 72, 74, 76, 77, 80, 81, 76, 69, 69, 72]) k.add(m, 1);
  assert.deepEqual(k.analyze(), { tonic: 9, mode: 'minor' });
});

test('key finding: hysteresis then modulation to F', () => {
  const k = new KeyTracker(2);
  for (const m of [60, 64, 67, 72, 65, 69]) k.add(m, 1); k.decayTo(0); k.analyze();
  k.decayTo(10);
  for (const m of [65, 69, 72, 70, 65, 67, 70, 69, 65]) k.add(m, 1);
  assert.deepEqual(k.analyze(), { tonic: 5, mode: 'major' });
});

test('chord recognition', () => {
  assert.equal(recognizeChord([57, 60, 64, 67]).sym, 'm7');
  const c = recognizeChord([64, 67, 72]);
  assert.equal(c.root, 0); assert.equal(c.bass, 4);
  assert.equal(recognizeChord([55, 59, 62, 65]).sym, '7');
});

test('chord symbols', () => {
  assert.equal(chordSymbol(2, [2, 5, 9, 0, 4]), 'm9');
  assert.equal(chordSymbol(7, [7, 11, 2, 5]), '7');
  assert.equal(chordSymbol(0, [0, 4, 7, 11, 2]), 'maj9');
  assert.equal(romanFor({ tonic: 0, mode: 'major' }, 10, ''), '♭VII');
});

test('harmonizer picks the chord the melody outlines', () => {
  const h = new Harmonizer();
  const key = { tonic: 0, mode: 'major' };
  const w = new Float64Array(12); w[7] = 1; w[11] = 1; w[2] = 1; // G B D
  h.prev = 3;
  assert.equal(h.choose({ key, weights: w, slot: 2, style: STYLES.jazz }).pick.roman, 'V');
  const w2 = new Float64Array(12); w2[9] = 1; w2[0] = 1; w2[4] = 0.5; // A C E
  h.prev = 0;
  assert.equal(h.choose({ key, weights: w2, slot: 2, style: STYLES.jazz }).pick.roman, 'vi');
});

test('minor key V uses the leading tone', () => {
  const t = degreeTones({ tonic: 9, mode: 'minor' }, 4);
  assert.equal(t.third, 8); // G♯ in E major chord
});

test('voice leading: smooth, no parallels, required tones', () => {
  const key = { tonic: 0, mode: 'major' };
  const spec = STYLES.jazz.voicing;
  let prev = null, total = 0;
  for (const d of [1, 4, 0, 5]) { // ii V I vi
    const t = degreeTones(key, d);
    const v = voiceChord(t, spec, prev);
    const pcs = new Set(v.notes.map(mod12));
    assert.ok(pcs.has(t.third) && pcs.has(t.seventh), 'has 3rd and 7th');
    assert.equal(v.parallels, 0);
    if (prev) total += v.movement;
    prev = v.notes;
  }
  assert.ok(total <= 18, `ii-V-I-vi moved ${total} semitones`);
});

console.log(`\n${pass} tests passed`);
