// Each style is a musical point of view: how a player from that tradition would
// harmonize, voice and groove under the very same melody.
//
// Drum strings are 16 sixteenth-notes:  X = accent, x = normal, g = ghost, . = rest
// comp: [step, durationInSteps, velocity]
// biases: [fromDegree, toDegree, extraProbability] added to the functional-harmony model
// voicing.use / required: chord members (1 3 5 7 9) the voice-leading search may / must use

export const STYLES = {
  jazz: {
    id: 'jazz', tempo: 120, swing: 0.64, color: '#f5c46b',
    biases: [[1, 4, 0.35], [4, 0, 0.25], [0, 5, 0.12], [5, 1, 0.22], [2, 5, 0.15]],
    voicing: { use: [3, 5, 7, 9], required: [3, 7], voices: 4, lo: 50, hi: 72, center: 61 },
    chordInstr: 'ep',
    comp: [[0, 3, 0.7], [6, 2, 0.55], [11, 3, 0.5]],
    arp: null,
    bass: 'walk',
    drums: {
      ride: 'X...x.x.X...x.x.',
      hatPedal: '....x.......x...',
      kick: 'g.......g.......',
      snare: '......g.......g.',
    },
    sidechain: false,
  },
  gospel: {
    id: 'gospel', tempo: 76, swing: 0.56, color: '#c99bff',
    biases: [[3, 0, 0.25], [0, 3, 0.2], [2, 5, 0.2], [5, 1, 0.15], [1, 4, 0.15]],
    voicing: { use: [1, 3, 5, 7, 9], required: [3, 7], voices: 5, lo: 50, hi: 77, center: 64 },
    chordInstr: 'ep',
    comp: [[0, 6, 0.75], [7, 1, 0.4], [8, 5, 0.7], [14, 2, 0.45]],
    arp: null,
    bass: 'gospel',
    drums: {
      kick: 'X......x..X.....',
      snare: '....X..g....X..g',
      hat: 'x.g.x.g.x.g.x.gx',
    },
    sidechain: false,
  },
  indie: {
    id: 'indie', tempo: 100, swing: 0.5, color: '#7fd4a8',
    biases: [[0, 3, 0.2], [3, 5, 0.15], [5, 4, 0.15], [3, 0, 0.15]],
    voicing: { use: [1, 3, 5, 9], required: [1, 3], voices: 4, lo: 52, hi: 74, center: 63 },
    chordInstr: 'pad',
    comp: [[0, 8, 0.45], [8, 8, 0.42]],
    arp: { every: 2, vel: 0.55, up: 0 },
    bass: 'eighths',
    drums: {
      kick: 'X.......X.x.....',
      snare: '....X.......X...',
      hat: 'x.x.x.x.x.x.x.x.',
    },
    sidechain: false,
  },
  electronic: {
    id: 'electronic', tempo: 122, swing: 0.5, color: '#5ec8ff',
    biases: [[5, 3, 0.3], [3, 0, 0.2], [0, 4, 0.15], [4, 5, 0.25]],
    voicing: { use: [1, 3, 5, 7], required: [1, 3], voices: 4, lo: 55, hi: 76, center: 66 },
    chordInstr: 'pad',
    comp: [[0, 8, 0.5], [8, 8, 0.5]],
    arp: { every: 1, vel: 0.28, up: 12 },
    bass: 'offbeat',
    drums: {
      kick: 'X...X...X...X...',
      clap: '....X.......X...',
      openHat: '..x...x...x...x.',
      hat: 'g.g.g.g.g.g.g.g.',
    },
    sidechain: true,
  },
};

// Bass lines are generated per half-bar (8 sixteenth steps) from the chord root,
// its fifth, and the engine's *prediction* of the next root (for approach notes).
export const BASS = {
  walk({ root, fifth, next }) {
    const approach = next !== root ? next + (next > root ? -1 : 1) : fifth;
    return [{ s: 0, m: root, d: 3.6, v: 0.9 }, { s: 4, m: approach, d: 3.6, v: 0.72 }];
  },
  gospel({ root, fifth }) {
    return [{ s: 0, m: root, d: 2.8, v: 0.95 }, { s: 3, m: root + 12, d: 0.9, v: 0.5 }, { s: 6, m: fifth, d: 1.8, v: 0.7 }];
  },
  eighths({ root }) {
    return [0, 2, 4, 6].map((s, i) => ({ s, m: root, d: 1.7, v: [0.9, 0.6, 0.75, 0.6][i] }));
  },
  offbeat({ root }) {
    return [{ s: 2, m: root, d: 1.5, v: 0.9 }, { s: 6, m: root, d: 1.5, v: 0.8 }];
  },
};

// An original 8-bar melody for the demo: [bar, beat, lengthInBeats, midi].
// It loops, modulating up a fourth each other pass, so you can watch the key tracker move.
export const DEMO_MELODY = [
  [0, 0, 1.5, 60], [0, 1.5, 0.5, 64], [0, 2, 1, 72], [0, 3, 1, 71],
  [1, 0, 2, 69], [1, 2, 1, 67], [1, 3, 1, 64],
  [2, 0, 1.5, 65], [2, 1.5, 0.5, 69], [2, 2, 1.5, 74], [2, 3.5, 0.5, 72],
  [3, 0, 2, 71], [3, 2, 2, 67],
  [4, 0, 1.5, 76], [4, 1.5, 0.5, 74], [4, 2, 1, 72], [4, 3, 1, 69],
  [5, 0, 1, 74], [5, 1, 1, 72], [5, 2, 1, 69], [5, 3, 1, 65],
  [6, 0, 1, 67], [6, 1, 1, 71], [6, 2, 1, 74], [6, 3, 1, 77],
  [7, 0, 1, 76], [7, 1, 2.5, 72],
];
export const DEMO_BARS = 8;
export const DEMO_TRANSPOSE = [0, 5];
