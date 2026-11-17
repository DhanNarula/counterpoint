import { Studio } from './synth.js';
import { Engine } from './engine.js';
import { Inputs, PitchSegmenter, KEY_LETTERS } from './input.js';
import { STYLES } from './styles.js';
import { drawCircle, drawChroma, Spectrogram, Piano } from './viz.js';
import { pcName, keyName, chordSymbol, midiName, recognizeChord, mod12, ROMAN } from './theory.js';
import { T, getLang, setLang, applyI18n } from './i18n.js';

const $ = (id) => document.getElementById(id);
const studio = new Studio();
let engine, inputs, spectro, piano, seg;
const view = { user: new Set(), harmony: new Set(), bass: null, chord: null };
const COLORS = { user: '#ff6b4a', harmony: '#f5c46b', bass: '#4fd1c5' };

const chordName = (root, sym) => pcName(root, getLang()) + (getLang() === 'fr' && sym ? ' ' : '') + sym;

// ------------------------------------------------------------------ language
function refreshLang() {
  applyI18n();
  $('lang').textContent = getLang() === 'en' ? 'FR' : 'EN';
  document.querySelectorAll('.lang-pick').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  renderStyles();
  if (engine) {
    $('playTxt').textContent = T(engine.playing ? 'stop' : 'play');
    $('demoTxt').textContent = T(engine.demo ? 'demoStop' : 'demo');
    $('micTxt').textContent = T(studio.mic ? 'micOn' : 'mic');
    if (view.chord) renderChord(view.chord);
    renderTimeline();
  }
}
document.querySelectorAll('.lang-pick').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); refreshLang(); }));
$('lang').addEventListener('click', () => { setLang(getLang() === 'en' ? 'fr' : 'en'); refreshLang(); });
refreshLang();

// ------------------------------------------------------------------ styles
function renderStyles() {
  const nav = $('styles');
  const cur = engine ? engine.style.id : 'jazz';
  nav.innerHTML = '';
  for (const id of Object.keys(STYLES)) {
    const [name, desc] = T('styles')[id];
    const b = document.createElement('button');
    b.className = 'style-card' + (id === cur ? ' on' : '');
    b.style.setProperty('--c', STYLES[id].color);
    b.innerHTML = `<b>${name}</b><span>${desc}</span>`;
    b.addEventListener('click', () => {
      if (!engine) return;
      engine.setStyle(id);
      b.blur();
    });
    nav.appendChild(b);
  }
}

// ------------------------------------------------------------------ boot
$('enter').addEventListener('click', async () => {
  $('enter').disabled = true;
  await studio.init();
  engine = new Engine(studio);
  spectro = new Spectrogram($('spectro'));
  piano = new Piano($('piano'), {
    lo: 36, hi: 96,
    onDown: (m) => { autoStart(); engine.noteOn(m, 0.8, 'key'); },
    onUp: (m) => engine.noteOff(m),
  });
  inputs = new Inputs(engine, {
    onMidiStatus: (ok) => { $('midi').textContent = T(ok ? 'midiOk' : 'midiNone'); $('midi').classList.toggle('ok', ok); },
    onOctave: () => {},
    onFirstNote: autoStart,
  });
  wire();
  $('overlay').classList.add('gone');
  requestAnimationFrame(frame);
});

function autoStart() { if (engine && !engine.playing) engine.start(); }

function wire() {
  engine.on('style', (st) => {
    document.documentElement.style.setProperty('--style', st.color);
    $('tempo').value = st.tempo; $('tempoOut').textContent = st.tempo;
    renderStyles();
  });
  engine.emit('style', engine.style);
  engine.on('transport', (on) => {
    $('play').classList.toggle('on', on);
    $('playIco').textContent = on ? '■' : '▶';
    $('playTxt').textContent = T(on ? 'stop' : 'play');
    if (!on) document.querySelectorAll('#beats i').forEach((i) => i.classList.remove('on'));
  });
  engine.on('demo', (on) => { $('demo').classList.toggle('on', on); $('demoTxt').textContent = T(on ? 'demoStop' : 'demo'); });
  engine.on('note', ({ midi, on }) => {
    on ? view.user.add(midi) : view.user.delete(midi);
    renderYou();
  });

  $('play').addEventListener('click', () => { engine.playing ? engine.stop() : engine.start(); $('play').blur(); });
  $('demo').addEventListener('click', () => { engine.demo ? engine.stopDemo() : engine.startDemo(); $('demo').blur(); });
  $('tempo').addEventListener('input', (e) => { const v = +e.target.value; $('tempoOut').textContent = v; engine.setTempo(v); });
  $('mic').addEventListener('click', toggleMic);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); engine.playing ? engine.stop() : engine.start(); }
  });
}

async function toggleMic() {
  $('mic').blur();
  if (studio.mic) {
    studio.stopMic(); seg && seg.flush();
    $('mic').classList.remove('on'); $('micTxt').textContent = T('mic'); $('tuner').textContent = '';
    return;
  }
  seg = new PitchSegmenter({
    onOn: (m) => { autoStart(); engine.noteOn(m, 0.8, 'mic'); },
    onOff: (m) => engine.noteOff(m),
    onFrame: (info) => {
      $('tuner').textContent = info ? `${midiName(info.midi, getLang())} ${info.cents >= 0 ? '+' : ''}${info.cents}¢` : '';
    },
  });
  try {
    await studio.startMic((f) => seg.push(f));
    $('mic').classList.add('on'); $('micTxt').textContent = T('micOn');
  } catch (err) {
    $('tuner').textContent = T('micDenied');
  }
}

// ------------------------------------------------------------------ rendering
function renderYou() {
  const notes = [...view.user].sort((a, b) => a - b);
  if (!notes.length) { $('youPlay').textContent = '—'; return; }
  const rec = notes.length >= 3 ? recognizeChord(notes) : null;
  if (rec) {
    const name = chordName(rec.root, rec.sym) + (rec.bass !== rec.root ? '/' + pcName(rec.bass, getLang()) : '');
    $('youPlay').textContent = name;
  } else {
    $('youPlay').textContent = notes.map((m) => midiName(m, getLang())).join(' · ');
  }
}

const meter = (v, lo, hi, color, diverging) => {
  const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  if (diverging) {
    const left = Math.min(0.5, f), width = Math.abs(f - 0.5);
    return `<span class="meter div"><i style="left:${left * 100}%;width:${width * 100}%;background:${color}"></i></span>`;
  }
  return `<span class="meter"><i style="left:0;width:${f * 100}%;background:${color}"></i></span>`;
};

function renderChord(ch) {
  const lang = getLang();
  const el = $('chordName');
  el.textContent = chordName(ch.root, ch.sym);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  $('roman').textContent = ch.roman;
  const f = $('func'); f.textContent = T(ch.func); f.className = 'func f-' + ch.func;

  const rows = $('brainRows');
  if (ch.follow) {
    rows.innerHTML = `<div class="follow">${T('following')}<b>${chordName(ch.root, ch.sym)}</b></div>`;
  } else {
    const head = `<div class="rowh"><span></span><span></span><span>${T('fit')}</span><span>${T('flow')}</span><span>${T('cadence')}</span><span style="text-align:right">${T('total')}</span></div>`;
    rows.innerHTML = (ch.presence < 0.3 ? `<div class="rowh" style="text-transform:none;letter-spacing:0;font-size:12px;padding-bottom:4px">${T('improvising')}</div>` : '') + head + ch.cands.map((c) => {
      const triad = chordSymbol(c.tones.root, [c.tones.root, c.tones.third, c.tones.fifth]);
      return `<div class="row ${c.degree === ch.degree ? 'pick' : ''}">
        <span class="rn">${c.roman}</span><span class="nm">${chordName(c.tones.root, triad)}</span>
        ${meter(c.fit, -1, 1, c.fit >= 0 ? 'var(--T)' : 'var(--D)', true)}
        ${meter(c.trans, -4.5, 0, 'var(--PD)')}
        ${meter(c.cad, 0, 0.45, 'var(--X)')}
        <span class="sc">${c.score.toFixed(2)}</span></div>`;
    }).join('');
  }

  const heard = ch.weights.map((w, pc) => [w, pc]).filter(([w]) => w > 0.05).sort((a, b) => b[0] - a[0]).slice(0, 6)
    .map(([, pc]) => pcName(pc, lang, ch.key.mode === 'minor'));
  const voicing = ch.notes.map((m) => midiName(m, lang)).join(' ');
  const nextRoman = ROMAN[ch.key.mode][ch.predicted];
  $('brainFoot').innerHTML = `
    <div><b>${T('heard')}:</b> <span class="h">${heard.length ? heard.join(' ') : '—'}</span></div>
    <div><b>${T('voiceLead')}:</b> <span class="n">${voicing}</span> · ${ch.movement} ${T('moved')} · ${T('parallels')}: ${ch.parallels || T('none')}</div>
    <div><b>${T('next')}:</b> ${nextRoman}</div>`;
}

function renderTimeline() {
  const box = $('timeline');
  const hist = engine.history.slice(-10);
  box.innerHTML = hist.map((c) =>
    `<div class="chip" style="--fc:var(--${c.func})"><div class="r">${c.roman}</div><div class="n">${chordName(c.root, c.sym)}</div></div>`).join('');
}

let lastKey = '';
function frame() {
  const now = studio.ctx.currentTime;
  for (const e of engine.flush(now)) {
    if (e.type === 'chord') {
      view.chord = e.chord;
      view.harmony = new Set(e.chord.notes);
      renderChord(e.chord);
      renderTimeline();
    } else if (e.type === 'step' && e.s % 4 === 0) {
      document.querySelectorAll('#beats i').forEach((el, i) => el.classList.toggle('on', i === e.s / 4));
    } else if (e.type === 'bass') {
      view.bass = { midi: e.midi, until: e.time + e.dur };
    } else if (e.type === 'note') {
      e.on ? view.user.add(e.midi) : view.user.delete(e.midi);
      renderYou();
    }
  }

  const k = engine.key;
  const kn = keyName(k.key, getLang());
  if (kn !== lastKey) { $('keyName').textContent = kn; lastKey = kn; }
  $('confBar').style.width = `${Math.round(k.confidence * 100)}%`;
  $('confTxt').textContent = `${Math.round(k.confidence * 100)}% ${T('confidence')}`;

  const accent = engine.style.color;
  drawCircle($('circle'), { scores: k.scores, key: k.key, chord: view.chord, lang: getLang(), accent, harmony: COLORS.harmony });
  drawChroma($('chroma'), { chroma: Array.from(k.chroma), key: k.key, lang: getLang(), accent });
  spectro.draw(studio.analyser);

  const labels = new Map(KEY_LETTERS.map((l, i) => [inputs.octave + i, l]));
  piano.draw({
    user: view.user, harmony: view.harmony,
    bass: view.bass && view.bass.until > now ? view.bass.midi : null,
    labels, colors: COLORS,
  });
  requestAnimationFrame(frame);
}
