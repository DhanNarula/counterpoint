// English / Français. Keys use solfège in French (Do, Ré, Mi…), as in Québec and France.

const STR = {
  en: {
    tagline: 'an accompanist that listens',
    enter: 'Enter the studio',
    enterSub: 'Play, sing or hum. Counterpoint hears your key, understands your melody, and a band built from pure math plays along — every sound is synthesized live, no samples.',
    enterHint: 'Headphones recommended for the microphone.',
    play: 'Play', stop: 'Stop', demo: 'Demo', demoStop: 'Stop demo',
    mic: 'Sing / Hum', micOn: 'Listening', tempo: 'Tempo',
    key: 'Key', chord: 'The band plays', youPlay: 'You', confidence: 'match',
    brain: 'Why this chord', brainSub: 'Every half-bar the engine scores all seven chords of the key against your melody.',
    fit: 'melody fit', flow: 'flow', cadence: 'phrase', total: 'score',
    heard: 'Heard', voiceLead: 'Voice leading', moved: 'semitones moved', parallels: 'parallel 5ths/8ves', none: 'none',
    next: 'Expecting next',
    circle: 'Circle of fifths', circleSub: 'Brightness = how strongly each key matches what you played.',
    chroma: 'What it heard', chromaSub: 'Pitch energy (bars) vs. the Krumhansl key profile (dashed).',
    timeline: 'Progression', spectro: 'Spectrum',
    keys: 'Play', keysHint: 'Keys A → ’ play notes · Z / X change octave · MIDI keyboards work · or click the piano',
    T: 'Tonic', PD: 'Predominant', D: 'Dominant', X: 'Borrowed',
    following: 'Following your chord', improvising: 'Nobody’s playing — improvising a progression',
    midiNone: 'No MIDI', midiOk: 'MIDI ●',
    micDenied: 'Microphone unavailable',
    styles: {
      jazz: ['Jazz', 'Rootless 9th voicings · walking bass · swung ride'],
      gospel: ['Gospel / R&B', 'Lush 9ths · plagal lift · laid-back pocket'],
      indie: ['Indie / Folk', 'Open add9 shapes · plucked strings · straight 8ths'],
      electronic: ['Electronic', 'Minor-loop pull · sidechain pump · four on the floor'],
    },
  },
  fr: {
    tagline: 'un accompagnateur qui écoute',
    enter: 'Entrer dans le studio',
    enterSub: 'Jouez, chantez ou fredonnez. Counterpoint reconnaît votre tonalité, comprend votre mélodie, et un groupe fait de pures mathématiques vous accompagne — chaque son est synthétisé en direct, sans échantillons.',
    enterHint: 'Écouteurs recommandés pour le micro.',
    play: 'Jouer', stop: 'Arrêt', demo: 'Démo', demoStop: 'Arrêter la démo',
    mic: 'Chanter', micOn: 'À l’écoute', tempo: 'Tempo',
    key: 'Tonalité', chord: 'Le groupe joue', youPlay: 'Vous', confidence: 'correspondance',
    brain: 'Pourquoi cet accord', brainSub: 'À chaque demi-mesure, le moteur évalue les sept accords de la tonalité selon votre mélodie.',
    fit: 'mélodie', flow: 'enchaînement', cadence: 'phrase', total: 'score',
    heard: 'Entendu', voiceLead: 'Conduite des voix', moved: 'demi-tons de mouvement', parallels: 'quintes/octaves parallèles', none: 'aucune',
    next: 'Accord attendu',
    circle: 'Cycle des quintes', circleSub: 'Luminosité = correspondance de chaque tonalité avec votre jeu.',
    chroma: 'Ce qu’il entend', chromaSub: 'Énergie par note (barres) vs. profil de Krumhansl (pointillé).',
    timeline: 'Progression', spectro: 'Spectre',
    keys: 'Jouer', keysHint: 'Touches A → ’ pour jouer · Z / X changent l’octave · claviers MIDI acceptés · ou cliquez sur le piano',
    T: 'Tonique', PD: 'Pré-dominante', D: 'Dominante', X: 'Emprunt',
    following: 'Suit votre accord', improvising: 'Personne ne joue — improvisation d’une progression',
    midiNone: 'Pas de MIDI', midiOk: 'MIDI ●',
    micDenied: 'Micro indisponible',
    styles: {
      jazz: ['Jazz', 'Voicings sans fondamentale · walking bass · ride swing'],
      gospel: ['Gospel / R&B', 'Neuvièmes riches · cadence plagale · groove posé'],
      indie: ['Indie / Folk', 'Accords add9 ouverts · cordes pincées · croches droites'],
      electronic: ['Électronique', 'Boucle mineure · pompe sidechain · quatre temps'],
    },
  },
};

let lang = 'en';
try {
  const saved = localStorage.getItem('cp-lang');
  lang = saved || ((navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en');
} catch { /* storage unavailable */ }

export const getLang = () => lang;
export function T(k) { return STR[lang][k] ?? STR.en[k] ?? k; }
export function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
}
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('cp-lang', l); } catch { /* ignore */ }
  applyI18n();
}
