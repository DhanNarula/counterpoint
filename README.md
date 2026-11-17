# Counterpoint

**An accompanist that listens.** Play your keyboard or a MIDI controller, or just sing or hum. Counterpoint works out your key and follows your melody in real time, and a band built entirely from math plays along with you. It harmonizes, voice-leads, walks the bass and keeps the groove in four musical styles.

**▶ Live:** https://dhannarula.github.io/counterpoint/

No samples, no audio libraries, no frameworks and no build step. Every sound is synthesized live and every musical decision is computed in the browser.

---

## What it does

| You do | Counterpoint does |
|---|---|
| Play a melody (keys, MIDI, on-screen piano) | Tracks the key, scores all seven diatonic chords against your melody every half-bar, and comps the winner with smooth voice leading |
| Sing or hum into the mic | Detects your pitch (YIN, on the audio thread), turns it into notes, and harmonizes your voice |
| Hold a chord (3+ notes) | Recognizes it (`Am7`, `C/E`, `G7`…) and the band follows you exactly |
| Stop playing | Keeps improvising a progression from a functional-harmony model, with cadences at phrase ends |
| Switch style | The same melody is re-harmonized from a different musical point of view |

### Four styles, four points of view
- **Jazz.** Rootless 3-7-9 voicings, ii-V-I gravity, a walking bass that approaches the *predicted* next chord chromatically, swung ride on an FM electric piano.
- **Gospel / R&B.** Five-voice 9th chords, plagal (IV→I) lift, a laid-back pocket with ghost notes.
- **Indie / Folk.** Open add9 shapes, Karplus-Strong plucked strings, straight eighths.
- **Electronic.** vi-IV-I-V loop pull, four-on-the-floor, sidechain "pump" on the chord bus.

Bilingual interface: **English / Français**. In French, note names switch to solfège (Do, Ré, Mi…).

---

## How it works

```
 mic ─► YIN pitch worklet ─► note segmenter ─┐
 keys / MIDI / piano ────────────────────────┼─► melody memory ─► key tracker (Krumhansl–Kessler)
                                             │                         │
                                             ▼                         ▼
                              chord recognizer ──►  harmonizer: fit + transition + cadence
                                                               │
                                                     voice-leading search
                                                               │
       look-ahead scheduler (16th grid, swing) ─► drums · bass · comping · arps
                                                               │
                         FM EP · Karplus–Strong · additive lead · pad · 808 metals
                                                               │
                              sidechain bus · generated reverb · synced delay · limiter
```

**Pitch detection, YIN** (`js/pitch-worklet.js`). Difference function, cumulative-mean normalization, absolute threshold and parabolic interpolation, running inside an `AudioWorklet` at ~47 analyses per second. A segmenter adds vibrato tolerance and onset/offset hysteresis to turn frames into notes.

**Key finding** (`js/theory.js › KeyTracker`). Notes build a pitch-class histogram that fades over time (7 s half-life). That histogram is correlated against Krumhansl-Kessler probe-tone profiles for all 24 keys, with hysteresis so the key only changes on clear evidence. The circle of fifths shows all 24 correlations live.

**Harmonizer** (`Harmonizer.choose`). Each half-bar, every diatonic chord gets a score:

```
score = 1.8 · presence · melodyFit  +  0.45 · ln P(chord | previous chord)  +  phraseBonus
```
- *melodyFit* rewards melody notes that are chord tones (7ths and 9ths count partially) and penalizes clashes and chromatic notes.
- *P* is a hand-tuned functional-harmony transition model (tonic → predominant → dominant), adjusted per style.
- *phraseBonus* places the tonic at the start of 4-bar phrases and the dominant leading into them.
- When nobody is playing, it samples the softmax instead of taking the argmax, so it improvises.

The "Why this chord" panel shows every term, live.

**Voice leading** (`voiceChord`). Searches every voicing of the chord within the style's range. It rejects voicings missing required tones (3rd and 7th in jazz) and minimizes total voice movement plus penalties for parallel 5ths/octaves, low-register mud, register drift and top-voice leaps.

**Synthesis** (`js/synth.js`):
- 2-operator **FM** electric piano with a high-ratio "tine" modulator for the bark
- **Karplus-Strong** physical-model strings, with an allpass fractional delay for exact tuning
- **Additive** lead and pad waveforms built from hand-chosen harmonic series
- **808-style** cymbals from six inharmonic square waves, a pitch-swept kick, and noise snare and clap
- **Convolution reverb** from a procedurally generated impulse response (a decaying noise tail that darkens over time, plus early reflections)
- A dotted-eighth delay synced to the tempo, and a **sidechain** gain bus ducked by the kick

**Timing.** A "two clocks" look-ahead scheduler: a JS timer schedules sample-accurate Web Audio events about 120 ms ahead, with swing applied on the 8th-note offbeats.

---

## Run it

It's static files, so serve the folder:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. The mic needs `localhost` or HTTPS.

Tests for the theory engine (key finding, chord recognition, harmonizer, voice leading):

```bash
node test/theory.test.mjs
```

### Controls
- `A W S E D F T G Y H U J K O L P ; '` play a chromatic octave and a half (uses physical key positions, so AZERTY works too)
- `Z` / `X` change octave · `Space` start/stop the band
- Any MIDI keyboard works (Chrome / Edge)
- **Sing / Hum** turns on pitch detection. Use headphones so the band doesn't feed back into the mic.
