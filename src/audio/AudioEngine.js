// Audio engine: one AudioContext, mix buses (music / ambience / effects / ui)
// with user volumes, a shared procedural reverb, cached noise buffers and
// small synthesis helpers. Everything is generated in code; there are no
// audio files.

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.focused = true;
    this.noise = {};
  }

  /** Create the context (must follow a user gesture to actually start). */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'playback' }));
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);
    this.buses = {};
    for (const k of ['music', 'ambience', 'effects', 'ui']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[k] = g;
    }
    // Shared reverb send (generated impulse response).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.9;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this.noise.white = this.noiseBuffer('white');
    this.noise.pink = this.noiseBuffer('pink');
    this.noise.brown = this.noiseBuffer('brown');
    this.applyVolumes();
    this.settings.on('change:audio', () => this.applyVolumes());
    window.addEventListener('blur', () => { this.focused = false; this.applyVolumes(); });
    window.addEventListener('focus', () => { this.focused = true; this.applyVolumes(); });
    this.ready = true;
  }

  /** Resume on user gesture (autoplay policy). */
  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get running() {
    return this.ctx && this.ctx.state === 'running';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.get('audio');
    const mute = a.muteUnfocused && !this.focused ? 0 : 1;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(a.master * mute, t, 0.15);
    for (const k of Object.keys(this.buses)) this.buses[k].gain.setTargetAtTime(a[k === 'effects' ? 'effects' : k] ?? 1, t, 0.1);
  }

  noiseBuffer(kind, seconds = 4) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const f = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  /** A looping noise source through a filter into a gain; returns handles. */
  noiseLoop(kind, bus, { type = 'lowpass', freq = 800, q = 0.7, gain = 0, reverb = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[kind];
    src.loop = true;
    src.loopStart = Math.random() * 2;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.buses[bus]);
    if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.reverb); }
    src.start(ctx.currentTime, Math.random() * 3);
    return { src, filter, gain: g };
  }

  /** Stereo panner + gain + optional reverb send for one-shots. */
  voice(bus, { pan = 0, gain = 1, reverb = 0.15 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.buses[bus]); } else g.connect(this.buses[bus]);
    if (reverb > 0) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.reverb); }
    return g;
  }

  /** Oscillator note with an attack/decay envelope. */
  tone(dest, { type = 'sine', freq = 440, t = this.now, attack = 0.01, dur = 0.3, peak = 0.3, endFreq = null, detune = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  /** Filtered noise burst. */
  burst(dest, { kind = 'white', t = this.now, type = 'bandpass', freq = 1200, q = 1, attack = 0.005, dur = 0.2, peak = 0.3, endFreq = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[kind];
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 3);
    src.stop(t + attack + dur + 0.05);
  }
}

export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
