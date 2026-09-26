// Game audio: river/ wind / rain / waterfall / sea ambience beds, procedural
// wildlife voices (birds, insects, cicadas, frogs, owls), boat and fishing
// effects, thunder, UI sounds, sound captions and the adaptive music.
import { AudioEngine, midiToHz } from './AudioEngine.js';
import { Music, musicContext } from './Music.js';
import { clamp, smoothstep } from '../core/math.js';

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.engine = new AudioEngine(game.settings);
    this.music = new Music(this.engine);
    this.beds = null;
    this.timers = { bird: 3, insect: 1, frog: 4, owl: 30, creak: 5, bell: 40, cicada: 2, drip: 1 };
    this.levels = {};
    const unlock = () => { this.engine.unlock(); if (this.engine.running) { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); } };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.bindEvents();
  }

  get e() { return this.engine; }

  caption(text) {
    if (this.game.settings.get('accessibility.subtitles')) this.game.events.emit('caption', { text });
  }

  bindEvents() {
    const ev = this.game.events;
    const on = (name, fn) => ev.on(name, (p) => { if (this.e.running) { try { fn(p ?? {}); } catch (err) { console.error('[audio]', err); } } });
    on('boat:oar', () => this.oar());
    on('boat:bump', (p) => this.bump(p.strength ?? 0.5));
    on('fishing:land', () => this.plop(0.25));
    on('fishing:nibble', () => this.plop(0.08, 1.6));
    on('fishing:bite', () => { this.plop(0.4, 0.8); this.splash(0.3); });
    on('fishing:escaped', () => this.splash(0.4));
    on('fish:caught', (p) => { this.splash(0.5); this.chime([0, 4, 7], 0.08, p.rarity === 'legendary' || p.rarity === 'mythic' ? 'bell' : 'pluck'); });
    on('wildlife:jump', (p) => this.near(p, 60, (g) => this.splash(0.25 * g)));
    on('wildlife:croak', (p) => this.near(p, 45, (g, pan) => this.frog(g, pan)));
    on('wildlife:flee', () => this.heron());
    on('weather:lightning', (p) => this.thunder(p.distance ?? 800, p.delay ?? 2));
    on('coins', (p) => { if ((p.delta ?? 0) !== 0) this.coins(); });
    on('sfx', (p) => { if (p.name === 'coins') this.coins(); if (p.name === 'shutter') this.shutter(); if (p.name === 'click') this.click(); });
    on('gather', () => this.rustle());
    on('lantern', (p) => this.lantern(p.on));
    on('dialogue:show', (n) => { if (n) this.click(0.5); });
    on('ui:close', () => this.click(0.35));
    on('photo:taken', () => this.shutter());
    on('music:moment', (p) => this.music.moment(p.kind));
    on('story:chapter', () => this.music.moment('chapter'));
    on('toast', (t) => { if (t.kind === 'discovery' || t.kind === 'story') this.click(0.25, 1.6); });
    on('lamp:lit', () => { this.whoosh(0.4); this.caption('[A lamp flares to life]'); });
  }

  // ------------------------------------------------------------ ambience
  buildBeds() {
    const e = this.e;
    this.beds = {
      river: e.noiseLoop('brown', 'ambience', { type: 'lowpass', freq: 420, q: 0.5, reverb: 0.05 }),
      lap: e.noiseLoop('pink', 'ambience', { type: 'bandpass', freq: 900, q: 1.4 }),
      rapids: e.noiseLoop('white', 'ambience', { type: 'bandpass', freq: 2200, q: 0.4, reverb: 0.1 }),
      falls: e.noiseLoop('pink', 'ambience', { type: 'lowpass', freq: 1600, q: 0.3, reverb: 0.25 }),
      wind: e.noiseLoop('pink', 'ambience', { type: 'bandpass', freq: 480, q: 1.6 }),
      gust: e.noiseLoop('white', 'ambience', { type: 'bandpass', freq: 1500, q: 3 }),
      rain: e.noiseLoop('white', 'ambience', { type: 'highpass', freq: 2600, q: 0.3 }),
      rainWater: e.noiseLoop('pink', 'ambience', { type: 'lowpass', freq: 1200, q: 0.3 }),
      sea: e.noiseLoop('brown', 'ambience', { type: 'lowpass', freq: 520, q: 0.5, reverb: 0.1 }),
      night: e.noiseLoop('white', 'ambience', { type: 'bandpass', freq: 5200, q: 8 }),
    };
    this.gustPhase = 0;
  }

  setBed(name, level, tc = 0.6) {
    const b = this.beds[name];
    if (!b) return;
    this.levels[name] = level;
    b.gain.gain.setTargetAtTime(level, this.e.now, tc);
  }

  update(dt, game) {
    const e = this.e;
    // Real time: music and ambience keep breathing in menus, pauses and photo mode.
    const nowMs = performance.now();
    const rdt = Math.min(0.1, (nowMs - (this.lastMs ?? nowMs)) / 1000);
    this.lastMs = nowMs;
    if (!e.running) return;
    if (!this.beds) this.buildBeds();
    const p = game.player();
    const w = game.weather;
    const biome = game.currentBiome;
    const amb = biome?.ambience ?? {};
    const night = game.time.nightFactor;
    const phys = game.boat.physics;
    const inMenu = game.state !== 'playing';
    const muffle = game.paused ? 0.45 : 1;
    // River bed: louder with flow speed and when near banks/shallows.
    const info = game.world.waterInfo(p.x, p.z, this._wi ??= {});
    const flow = Math.abs(game.world.flowAt(p.x, p.z, this._fl ??= {}).speed ?? 0.6);
    this.setBed('river', muffle * (0.05 + clamp(flow, 0, 3) * 0.05 + (game.onFoot ? 0.02 : 0)));
    const boatSpeed = game.onFoot ? 0 : Math.abs(phys.speed ?? 0);
    this.beds.lap.filter.frequency.setTargetAtTime(700 + boatSpeed * 180, e.now, 0.3);
    this.setBed('lap', muffle * (game.onFoot ? 0.01 : 0.025 + clamp(boatSpeed, 0, 4) * 0.02 + Math.abs(Math.sin(game.elapsed * 1.3)) * 0.015), 0.2);
    this.setBed('rapids', muffle * clamp(phys.rapids ?? 0, 0, 1) * 0.22);
    // Waterfalls nearby.
    let falls = 0;
    for (const s of game.content?.spawned.values() ?? []) {
      const m = s.group?.userData?.emitters?.mistDrop;
      if (!m) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      falls = Math.max(falls, (m.strength ?? 1) * (1 - smoothstep(20, 420, d)));
    }
    this.setBed('falls', muffle * falls * 0.35, 1.2);
    if (falls > 0.35 && !this.fallsCaptioned) { this.fallsCaptioned = true; this.caption('[The roar of falling water]'); }
    if (falls < 0.1) this.fallsCaptioned = false;
    // Wind with gusts.
    this.gustPhase += rdt * (0.15 + (w.wind ?? 0.2) * 0.4);
    const gust = 0.5 + 0.5 * Math.sin(this.gustPhase) * Math.sin(this.gustPhase * 0.37 + 1.3);
    const windLevel = ((w.wind ?? 0.2) * (amb.wind ?? 0.5) * 0.12 + (w.storm ?? 0) * 0.12) * (0.6 + gust * 0.6);
    this.setBed('wind', muffle * windLevel, 0.8);
    this.beds.wind.filter.frequency.setTargetAtTime(380 + gust * 420, e.now, 0.8);
    this.setBed('gust', muffle * windLevel * 0.12 * gust, 0.8);
    // Rain.
    const rain = w.rain ?? 0;
    this.setBed('rain', muffle * rain * 0.12, 1);
    this.setBed('rainWater', muffle * rain * 0.16, 1);
    // Sea swell near the coast.
    const coast = info.sea ? 1 : biome?.id === 'coast' ? 0.35 : 0;
    const swell = 0.6 + 0.4 * Math.sin(game.elapsed * 0.45);
    this.setBed('sea', muffle * coast * 0.16 * swell, 0.5);
    // Night insects (continuous shimmer) - fewer in rain and cold.
    this.setBed('night', muffle * night * (amb.insects ?? 0.4) * 0.012 * (1 - rain * 0.8), 2);

    if (!inMenu && !game.paused && !game.timeFrozen) this.scheduleVoices(rdt, game, amb, night, rain);

    // Music context follows biome, time and weather.
    const golden = game.time.phase === 'golden' || game.time.phase === 'sunset' || game.time.phase === 'dawn' ? 1 : 0;
    this.music.setContext(musicContext({ biomeMusic: biome?.music, night, storm: w.storm ?? 0, rain, golden }));
    this.music.update(rdt);
    // Reel ticks while landing a fish (faster when the fish is in the band).
    if (game.fishing?.state === 'reeling') {
      this.reelT = (this.reelT ?? 0) - rdt;
      if (this.reelT <= 0) {
        const inZone = game.fishing.reel?.fishInZone;
        this.reelT = inZone ? 0.07 : 0.16;
        const out = e.voice('effects', { gain: 0.25, reverb: 0 });
        e.tone(out, { type: 'square', freq: inZone ? 2600 : 1900, attack: 0.001, dur: 0.012, peak: 0.05 });
      }
    }
    // Boat creaks when rocking.
    this.timers.creak -= rdt;
    if (!game.onFoot && !inMenu && this.timers.creak <= 0) {
      const rock = Math.abs(phys.roll ?? 0) + Math.abs(phys.pitch ?? 0);
      this.timers.creak = 3 + Math.random() * 6;
      if (rock > 0.02 || boatSpeed > 1 || Math.random() < 0.3) this.creak(0.05 + clamp(rock * 2, 0, 0.1));
    }
  }

  scheduleVoices(dt, game, amb, night, rain) {
    const day = 1 - night;
    const T = this.timers;
    const dawnBoost = game.time.phase === 'dawn' || game.time.phase === 'morning' ? 1.6 : 1;
    T.bird -= dt * (amb.birds ?? 0.5) * day * dawnBoost * (1 - rain * 0.7);
    if (T.bird <= 0) { T.bird = 2 + Math.random() * 6; this.bird(); }
    T.cicada -= dt * (amb.cicadas ?? 0) * day * (game.time.phase === 'midday' || game.time.phase === 'afternoon' ? 1 : 0.3);
    if (T.cicada <= 0) { T.cicada = 6 + Math.random() * 10; this.cicada(); }
    T.insect -= dt * (amb.insects ?? 0.4) * night;
    if (T.insect <= 0) { T.insect = 0.8 + Math.random() * 2.5; this.cricket(); }
    T.frog -= dt * (amb.frogs ?? 0.3) * (0.3 + night) * (1 + rain);
    if (T.frog <= 0) { T.frog = 3 + Math.random() * 7; this.frog(0.5 + Math.random() * 0.5, Math.random() * 2 - 1); }
    T.owl -= dt * night * (amb.birds ?? 0.5);
    if (T.owl <= 0) { T.owl = 40 + Math.random() * 80; this.owl(); }
    const town = game.content?.spawnedOf('settlement').find((s) => Math.hypot(s.item.x - game.player().x, s.item.z - game.player().z) < 400);
    T.bell -= dt * (town ? 1 : 0);
    if (T.bell <= 0) { T.bell = 70 + Math.random() * 120; this.bell(); }
  }

  /** Distance attenuation + pan for a world-positioned sound. */
  near(pos, radius, fn) {
    const g = this.game;
    const p = g.player();
    const x = pos.x - p.x, z = pos.z - p.z;
    const d = Math.hypot(x, z);
    if (d > radius) return;
    const cam = g.camera3;
    const yaw = Math.atan2(cam.matrixWorld.elements[8], cam.matrixWorld.elements[10]);
    const ang = Math.atan2(x, z) - yaw;
    fn(1 - d / radius, -Math.sin(ang));
  }

  // --------------------------------------------------------------- voices
  bird() {
    const e = this.e;
    const out = e.voice('ambience', { pan: Math.random() * 1.6 - 0.8, gain: 0.35 + Math.random() * 0.3, reverb: 0.25 });
    const t = e.now + 0.05;
    const kind = Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    if (kind === 0) { // trill
      for (let i = 0; i < 5 + Math.random() * 5; i++) e.tone(out, { freq: base, endFreq: base * 1.25, t: t + i * 0.07, attack: 0.005, dur: 0.05, peak: 0.08 });
    } else if (kind === 1) { // two-note call
      e.tone(out, { freq: base, endFreq: base * 0.9, t, dur: 0.18, peak: 0.08 });
      e.tone(out, { freq: base * 0.8, endFreq: base * 0.75, t: t + 0.26, dur: 0.22, peak: 0.07 });
    } else if (kind === 2) { // rising whistle
      e.tone(out, { freq: base * 0.6, endFreq: base * 1.1, t, attack: 0.03, dur: 0.35, peak: 0.07 });
    } else { // chatter
      for (let i = 0; i < 3; i++) e.tone(out, { freq: base * (1 + Math.random() * 0.3), endFreq: base * 0.7, t: t + i * 0.11 + Math.random() * 0.04, dur: 0.06, peak: 0.07 });
    }
  }

  cicada() {
    const e = this.e;
    const out = e.voice('ambience', { pan: Math.random() * 1.4 - 0.7, gain: 0.25, reverb: 0.05 });
    const t = e.now;
    const dur = 2 + Math.random() * 3;
    const src = e.ctx.createBufferSource();
    src.buffer = e.noise.white;
    const f = e.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 4800 + Math.random() * 1500; f.Q.value = 6;
    const am = e.ctx.createGain();
    am.gain.value = 0;
    const lfo = e.ctx.createOscillator();
    lfo.frequency.value = 45 + Math.random() * 20;
    const lg = e.ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    const env = e.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.05, t + 0.8);
    env.gain.setValueAtTime(0.05, t + dur - 0.8);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(am).connect(env).connect(out);
    src.start(t); src.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  cricket() {
    const e = this.e;
    const out = e.voice('ambience', { pan: Math.random() * 1.8 - 0.9, gain: 0.2 + Math.random() * 0.2, reverb: 0.15 });
    const t = e.now;
    const f = 4000 + Math.random() * 900;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) e.tone(out, { freq: f, t: t + i * 0.06, attack: 0.004, dur: 0.035, peak: 0.05 });
  }

  frog(gain = 0.6, pan = 0) {
    const e = this.e;
    const out = e.voice('ambience', { pan, gain: gain * 0.7, reverb: 0.2 });
    const t = e.now;
    const base = 110 + Math.random() * 90;
    const f = e.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = base * 4; f.Q.value = 3;
    f.connect(out);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) e.tone(f, { type: 'sawtooth', freq: base, endFreq: base * 0.85, t: t + i * 0.24, attack: 0.02, dur: 0.14, peak: 0.25 });
  }

  owl() {
    const e = this.e;
    const out = e.voice('ambience', { pan: Math.random() * 1.2 - 0.6, gain: 0.35, reverb: 0.5 });
    const t = e.now;
    e.tone(out, { freq: 390, endFreq: 360, t, attack: 0.06, dur: 0.4, peak: 0.08 });
    e.tone(out, { freq: 380, endFreq: 340, t: t + 0.7, attack: 0.05, dur: 0.25, peak: 0.06 });
    e.tone(out, { freq: 390, endFreq: 330, t: t + 1.05, attack: 0.05, dur: 0.55, peak: 0.07 });
    this.caption('[An owl calls]');
  }

  heron() {
    const e = this.e;
    const out = e.voice('ambience', { gain: 0.4, reverb: 0.3 });
    const f = e.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    f.connect(out);
    e.tone(f, { type: 'sawtooth', freq: 320, endFreq: 240, t: e.now, attack: 0.01, dur: 0.35, peak: 0.2 });
  }

  bell() {
    const e = this.e;
    const out = e.voice('ambience', { pan: Math.random() - 0.5, gain: 0.25, reverb: 0.6 });
    const t = e.now;
    const f = midiToHz(67 + Math.floor(Math.random() * 3) * 2);
    for (let i = 0; i < 3; i++) {
      e.tone(out, { freq: f, t: t + i * 1.4, attack: 0.003, dur: 3, peak: 0.08 });
      e.tone(out, { freq: f * 2.76, t: t + i * 1.4, attack: 0.002, dur: 1.2, peak: 0.02 });
    }
    this.caption('[A distant village bell]');
  }

  // --------------------------------------------------------------- effects
  oar() {
    const e = this.e;
    const out = e.voice('effects', { pan: 0, gain: 0.5, reverb: 0.05 });
    const t = e.now;
    e.burst(out, { kind: 'pink', t, type: 'bandpass', freq: 900, endFreq: 400, q: 0.8, attack: 0.02, dur: 0.35, peak: 0.12 });
    e.burst(out, { kind: 'white', t: t + 0.03, type: 'highpass', freq: 3000, attack: 0.01, dur: 0.12, peak: 0.03 });
    e.tone(out, { type: 'triangle', freq: 180, endFreq: 150, t: t + 0.4, attack: 0.002, dur: 0.05, peak: 0.03 }); // oarlock knock
  }

  splash(g = 0.4) {
    const e = this.e;
    const out = e.voice('effects', { gain: g, reverb: 0.1 });
    const t = e.now;
    e.burst(out, { kind: 'white', t, type: 'bandpass', freq: 1800, endFreq: 500, q: 0.6, attack: 0.005, dur: 0.45, peak: 0.25 });
    e.burst(out, { kind: 'pink', t, type: 'lowpass', freq: 600, attack: 0.01, dur: 0.3, peak: 0.2 });
  }

  plop(g = 0.25, pitch = 1) {
    const e = this.e;
    const out = e.voice('effects', { gain: g * 2, reverb: 0.1 });
    e.tone(out, { freq: 700 * pitch, endFreq: 240 * pitch, t: e.now, attack: 0.002, dur: 0.12, peak: 0.25 });
    e.burst(out, { kind: 'white', type: 'bandpass', freq: 2500, attack: 0.002, dur: 0.08, peak: 0.05 });
  }

  bump(strength) {
    const e = this.e;
    const out = e.voice('effects', { gain: clamp(strength, 0.2, 1) * 0.8, reverb: 0.05 });
    e.tone(out, { type: 'sine', freq: 95, endFreq: 60, attack: 0.003, dur: 0.25, peak: 0.4 });
    e.burst(out, { kind: 'brown', type: 'lowpass', freq: 500, attack: 0.003, dur: 0.2, peak: 0.3 });
    this.creak(0.12);
  }

  creak(g = 0.06) {
    const e = this.e;
    const out = e.voice('effects', { pan: Math.random() * 0.6 - 0.3, gain: g * 4, reverb: 0.05 });
    const f = e.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 500; f.Q.value = 8;
    f.connect(out);
    const base = 60 + Math.random() * 40;
    e.tone(f, { type: 'sawtooth', freq: base, endFreq: base * (0.8 + Math.random() * 0.5), t: e.now, attack: 0.05, dur: 0.3 + Math.random() * 0.4, peak: 0.12 });
  }

  thunder(distance, delay) {
    const e = this.e;
    const t = e.now + Math.min(delay, 6);
    const near = 1 - clamp(distance / 3000, 0, 0.85);
    const out = e.voice('effects', { gain: 0.6 * near, reverb: 0.4 });
    e.burst(out, { kind: 'brown', t, type: 'lowpass', freq: 280 + near * 400, endFreq: 90, attack: near > 0.7 ? 0.02 : 0.3, dur: 3.5 + Math.random() * 2, peak: 0.9 });
    e.burst(out, { kind: 'pink', t: t + 0.4, type: 'lowpass', freq: 200, attack: 0.5, dur: 3, peak: 0.4 });
    setTimeout(() => this.caption(near > 0.6 ? '[Thunder cracks overhead]' : '[Distant thunder rumbles]'), Math.min(delay, 6) * 1000);
  }

  coins() {
    const e = this.e;
    const out = e.voice('ui', { gain: 0.35, reverb: 0.1 });
    const t = e.now;
    for (let i = 0; i < 3; i++) e.tone(out, { freq: 2400 + i * 380 + Math.random() * 200, t: t + i * 0.06, attack: 0.001, dur: 0.18, peak: 0.07 });
  }

  click(g = 0.4, pitch = 1) {
    const e = this.e;
    const out = e.voice('ui', { gain: g, reverb: 0.05 });
    e.tone(out, { type: 'sine', freq: 880 * pitch, endFreq: 660 * pitch, attack: 0.002, dur: 0.07, peak: 0.1 });
  }

  chime(intervals, g = 0.08, kind = 'pluck') {
    const e = this.e;
    const out = e.voice('ui', { gain: 1, reverb: 0.4 });
    const base = midiToHz(this.music.ctx.root + 12);
    intervals.forEach((iv, k) => {
      const f = base * Math.pow(2, iv / 12);
      e.tone(out, { type: kind === 'bell' ? 'sine' : 'triangle', freq: f, t: e.now + k * 0.12, attack: 0.003, dur: kind === 'bell' ? 2.5 : 1, peak: g });
    });
  }

  rustle() {
    const e = this.e;
    const out = e.voice('effects', { gain: 0.4 });
    for (let i = 0; i < 3; i++) e.burst(out, { kind: 'white', t: e.now + i * 0.09, type: 'bandpass', freq: 3000 + Math.random() * 2000, q: 1, attack: 0.01, dur: 0.1, peak: 0.08 });
  }

  lantern(on) {
    const e = this.e;
    const out = e.voice('effects', { gain: 0.5 });
    if (on) {
      e.burst(out, { kind: 'white', type: 'highpass', freq: 2500, attack: 0.002, dur: 0.12, peak: 0.12 }); // match strike
      e.burst(out, { kind: 'pink', t: e.now + 0.1, type: 'lowpass', freq: 700, attack: 0.1, dur: 0.6, peak: 0.08 }); // flame catches
    } else e.burst(out, { kind: 'pink', type: 'bandpass', freq: 500, attack: 0.02, dur: 0.25, peak: 0.08 });
  }

  whoosh(g) {
    const e = this.e;
    const out = e.voice('effects', { gain: g, reverb: 0.4 });
    e.burst(out, { kind: 'pink', type: 'bandpass', freq: 300, endFreq: 1400, q: 0.8, attack: 0.4, dur: 1.2, peak: 0.3 });
  }

  shutter() {
    const e = this.e;
    const out = e.voice('ui', { gain: 0.5 });
    e.burst(out, { kind: 'white', type: 'bandpass', freq: 4000, q: 2, attack: 0.001, dur: 0.03, peak: 0.25 });
    e.burst(out, { kind: 'white', t: e.now + 0.07, type: 'bandpass', freq: 3000, q: 2, attack: 0.001, dur: 0.04, peak: 0.2 });
  }

  /** Debug/benchmark info. */
  stats() {
    return { state: this.e.ctx?.state ?? 'none', music: this.music.state, beds: Object.fromEntries(Object.entries(this.levels).map(([k, v]) => [k, Number(v.toFixed(3))])) };
  }
}
