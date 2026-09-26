// Adaptive generative music. Quiet, sparse and never looping the same way:
// soft pad chords from the biome's key and mode, a plucked melody that
// wanders stepwise, an occasional low root, and long rests between sections.
// Time of day, weather and biome change key, mode, timbre, tempo and
// brightness; discoveries, lamps and requests trigger short stingers.
import { midiToHz } from './AudioEngine.js';

export const SCALES = {
  major_pent: [0, 2, 4, 7, 9],
  minor_pent: [0, 3, 5, 7, 10],
  phrygian_pent: [0, 1, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
};

const TIMBRE = {
  gentle: 'harp', nostalgic: 'harp', lush: 'marimba', rain: 'marimba', vast: 'flute', cold: 'flute', mysterious: 'flute',
  clear: 'bell', crystalline: 'bell', wonder: 'bell', ancient: 'harp', epic: 'harp', bright: 'marimba',
};

/** Pure: pick the musical context from biome, time and weather. */
export function musicContext({ biomeMusic, night = 0, storm = 0, rain = 0, golden = 0 }) {
  let scale = biomeMusic?.scale ?? 'major_pent';
  let root = biomeMusic?.root ?? 60;
  const mood = biomeMusic?.mood ?? 'gentle';
  if (storm > 0.4) scale = scale.includes('pent') ? 'minor_pent' : 'aeolian';
  else if (night > 0.6 && (scale === 'major_pent' || scale === 'ionian')) scale = 'lydian';
  const tempo = 62 - night * 10 - storm * 4 + golden * 4; // bpm
  const brightness = 1400 + golden * 600 - night * 500 - rain * 300 - storm * 400; // pad filter Hz
  if (night > 0.6) root -= 2;
  return { scale, root, mood, timbre: TIMBRE[mood] ?? 'harp', tempo, brightness: Math.max(500, brightness), density: 0.32 - night * 0.1 + golden * 0.08 };
}

/** Pure: chord (midi notes) on scale degree `deg` stacking every other scale tone. */
export function chordOn(root, scale, deg, voices = 3) {
  const s = SCALES[scale] ?? SCALES.major_pent;
  const notes = [];
  for (let v = 0; v < voices; v++) {
    const i = deg + v * 2;
    notes.push(root + s[i % s.length] + 12 * Math.floor(i / s.length));
  }
  return notes;
}

export class Music {
  constructor(engine) {
    this.e = engine;
    this.state = 'rest';
    this.timer = 8; // first music after a short while
    this.nextBeat = 0;
    this.beat = 0;
    this.melodyIdx = 4;
    this.ctx = musicContext({});
    this.chordDeg = 0;
    this.out = null;
  }

  ensureOut() {
    if (this.out) return;
    const e = this.e;
    this.out = e.ctx.createGain();
    this.out.gain.value = 0.55;
    this.out.connect(e.buses.music);
    this.send = e.ctx.createGain();
    this.send.gain.value = 0.55;
    this.out.connect(this.send).connect(e.reverb);
  }

  setContext(ctx) {
    this.ctx = ctx;
  }

  /** Called every frame with real dt. */
  update(dt) {
    const e = this.e;
    if (!e.running) return;
    this.ensureOut();
    this.timer -= dt;
    if (this.state === 'rest') {
      if (this.timer <= 0) this.startSection();
      return;
    }
    if (this.timer <= 0) { this.state = 'rest'; this.timer = 35 + Math.random() * 70; return; }
    const spb = 60 / this.ctx.tempo;
    const now = e.now;
    if (this.nextBeat < now) this.nextBeat = now + 0.1;
    while (this.nextBeat < now + 0.6) {
      this.scheduleBeat(this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  startSection(soon = false) {
    this.state = 'play';
    this.timer = 70 + Math.random() * 60;
    this.beat = 0;
    this.nextBeat = this.e.now + (soon ? 0.2 : 1);
    this.chordDeg = 0;
  }

  /** Next section starts soon (e.g. on entering a new land). */
  cue() {
    if (this.state === 'rest') this.timer = Math.min(this.timer, 3);
  }

  scheduleBeat(t, spb) {
    const c = this.ctx;
    const barBeat = this.beat % 8;
    if (barBeat === 0) {
      // Pad chord each 8 beats; walk the progression around the tonic.
      if (this.beat > 0) {
        const moves = [0, 3, 4, 5, 1, 2];
        this.chordDeg = Math.random() < 0.35 ? 0 : moves[Math.floor(Math.random() * moves.length)];
      }
      const scaleLen = (SCALES[c.scale] ?? SCALES.major_pent).length;
      const notes = chordOn(c.root - 12, c.scale, this.chordDeg % scaleLen, 3);
      this.pad(notes, t, spb * 8.4);
      if (Math.random() < 0.6) this.bass(c.root - 24 + (SCALES[c.scale][this.chordDeg % scaleLen] ?? 0), t, spb * 6);
    }
    // Melody: sparse, stepwise, resting on longer notes.
    if (this.beat > 3 && Math.random() < c.density * (barBeat % 2 === 0 ? 1.3 : 0.6)) {
      const s = SCALES[c.scale] ?? SCALES.major_pent;
      const step = Math.random() < 0.7 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
      this.melodyIdx = Math.max(0, Math.min(s.length * 2, this.melodyIdx + step));
      const i = this.melodyIdx;
      const midi = c.root + s[i % s.length] + 12 * Math.floor(i / s.length);
      this.pluck(midi, t + (Math.random() < 0.2 ? spb * 0.5 : 0), c.timbre, 0.14);
      if (Math.random() < 0.12) this.pluck(midi + 12, t + spb * 0.25, c.timbre, 0.05);
    }
  }

  pad(notes, t, dur) {
    const e = this.e;
    const ctx = e.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.ctx.brightness;
    f.Q.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 2.2);
    g.gain.setValueAtTime(0.06, t + dur - 2.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.5);
    f.connect(g).connect(this.out);
    for (const n of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midiToHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 1.6);
      }
    }
  }

  bass(midi, t, dur) {
    const e = this.e;
    e.tone(this.out, { type: 'sine', freq: midiToHz(midi), t, attack: 0.4, dur, peak: 0.07 });
  }

  pluck(midi, t, timbre, peak = 0.12) {
    const e = this.e;
    const f = midiToHz(midi);
    if (timbre === 'bell') {
      e.tone(this.out, { type: 'sine', freq: f, t, attack: 0.005, dur: 3.2, peak });
      e.tone(this.out, { type: 'sine', freq: f * 2.76, t, attack: 0.005, dur: 1.2, peak: peak * 0.25 });
    } else if (timbre === 'marimba') {
      e.tone(this.out, { type: 'sine', freq: f, t, attack: 0.004, dur: 0.9, peak: peak * 1.2 });
      e.tone(this.out, { type: 'sine', freq: f * 4, t, attack: 0.002, dur: 0.12, peak: peak * 0.3 });
    } else if (timbre === 'flute') {
      const o = e.tone(this.out, { type: 'sine', freq: f, t, attack: 0.25, dur: 1.8, peak: peak * 0.8 });
      const lfo = e.ctx.createOscillator();
      const lg = e.ctx.createGain();
      lfo.frequency.value = 5; lg.gain.value = 6;
      lfo.connect(lg).connect(o.detune);
      lfo.start(t); lfo.stop(t + 2.2);
    } else {
      e.tone(this.out, { type: 'triangle', freq: f, t, attack: 0.004, dur: 2.2, peak });
      e.tone(this.out, { type: 'sine', freq: f * 2, t, attack: 0.003, dur: 0.6, peak: peak * 0.3 });
    }
  }

  /** Short musical punctuation for gameplay moments. */
  moment(kind) {
    const e = this.e;
    if (!e.running) return;
    this.ensureOut();
    const c = this.ctx;
    const s = SCALES[c.scale] ?? SCALES.major_pent;
    const t = e.now + 0.05;
    const n = (i) => c.root + s[i % s.length] + 12 * Math.floor(i / s.length);
    if (kind === 'discovery') [0, 2, 4].forEach((i, k) => this.pluck(n(i + 3), t + k * 0.18, c.timbre, 0.1));
    else if (kind === 'quest') [4, 7].forEach((i, k) => this.pluck(n(i), t + k * 0.22, 'bell', 0.09));
    else if (kind === 'wonder' || kind === 'lamp') {
      this.pad(chordOn(c.root - 12, c.scale, 0, 4), t, 7);
      [0, 2, 4, 7].forEach((i, k) => this.pluck(n(i + 5), t + 0.6 + k * 0.35, 'bell', 0.08));
    } else if (kind === 'biome') this.cue();
    else if (kind === 'chapter') { this.pad(chordOn(c.root - 12, c.scale, 0, 4), t, 9); this.startSection(true); }
  }
}
