// Dynamic weather: biome-weighted, coherent state transitions with smooth
// parameter blending, wind that wanders, wetness/snow accumulation, lightning
// and thunder. Writes into game.weather which the sky, fog, water, foliage,
// boat and audio read.
import weatherData from '../data/weather.json' with { type: 'json' };
import { RNG } from '../core/rng.js';
import { lerp, clamp, smoothstep } from '../core/math.js';
import { Precipitation } from './Precipitation.js';

export const WEATHER_TYPES = weatherData.types;
const KEYS = ['cloud', 'rain', 'snow', 'fog', 'mist', 'wind', 'storm', 'haze'];

export class WeatherSystem {
  constructor(game) {
    this.game = game;
    this.rng = new RNG((Date.now() & 0xffff) + 1);
    this.current = 'clear';
    this.target = 'clear';
    this.blend = 1;
    this.transitionTime = 90;
    this.timer = 240;
    this.params = Object.fromEntries(KEYS.map((k) => [k, WEATHER_TYPES.clear[k]]));
    this.from = { ...this.params };
    this.windAngle = 0.4;
    this.flash = 0;
    this.lightningTimer = 5;
    this.override = null; // photo mode / console
    this.precip = new Precipitation(game);
  }

  init(game) {
    game.weather.type = this.current;
  }

  setQuality(q) {
    this.precip.setQuality(q);
  }

  /** Immediately (or smoothly) switch to a weather type. */
  set(type, { instant = false, hold = 300 } = {}) {
    if (!WEATHER_TYPES[type]) return false;
    this.from = { ...this.params };
    this.current = this.target;
    this.target = type;
    this.blend = instant ? 1 : 0;
    this.transitionTime = instant ? 0.001 : 45;
    this.timer = hold;
    if (instant) for (const k of KEYS) this.params[k] = WEATHER_TYPES[type][k];
    return true;
  }

  chooseNext() {
    const game = this.game;
    const p = game.player();
    const bl = game.world.biomeAt(p.x, p.z);
    const wa = bl.a.weather, wb = bl.b.weather;
    const cold = 1 - lerp(bl.a.climate.temp, bl.b.climate.temp, bl.t);
    const cands = WEATHER_TYPES[this.target].next;
    const hour = game.time.hours;
    const dawn = hour > 4.5 && hour < 8.5;
    return this.rng.weighted(cands, (c) => {
      let w = lerp(wa[c] ?? 0, wb[c] ?? 0, bl.t);
      if (c === 'snow' && cold < 0.55) w = 0;
      if ((c === 'lightRain' || c === 'heavyRain' || c === 'storm') && cold > 0.85) w *= 0.1;
      if ((c === 'mist' || c === 'fog') && dawn) w *= 3;
      if (c === this.target) w *= 0.6;
      return w;
    });
  }

  update(dt, game) {
    const w = game.weather;
    if (!this.override) {
      this.timer -= dt;
      if (this.blend >= 1 && this.timer <= 0) {
        const next = this.chooseNext();
        this.from = { ...this.params };
        this.current = this.target;
        this.target = next;
        this.blend = 0;
        this.transitionTime = 60 + this.rng.next() * 60;
        this.timer = 180 + this.rng.next() * 420;
        game.events.emit('weather:change', { from: this.current, to: next });
      }
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.transitionTime);
    const T = WEATHER_TYPES[this.target];
    const k = smoothstep(0, 1, this.blend);
    for (const key of KEYS) this.params[key] = lerp(this.from[key], T[key], k);
    const P = this.override ? { ...this.params, ...this.override } : this.params;
    // Cold biomes turn rain into snow.
    const pl = game.player();
    const bl = game.world.biomeAt(pl.x, pl.z);
    const cold = 1 - lerp(bl.a.climate.temp, bl.b.climate.temp, bl.t);
    let rain = P.rain, snow = P.snow;
    if (cold > 0.8) { snow = Math.max(snow, rain); rain *= 0.1; }
    if (cold < 0.45) { rain = Math.max(rain, snow * 0.8); snow = 0; }
    // Wind wanders slowly.
    this.windAngle += (Math.sin(game.elapsed * 0.013) * 0.02 + (this.rng.next() - 0.5) * 0.01) * dt;
    const windSpeed = 0.5 + P.wind * 6;
    w.wind = P.wind;
    w.windX = Math.cos(this.windAngle) * windSpeed;
    w.windZ = Math.sin(this.windAngle) * windSpeed;
    w.cloud = P.cloud;
    w.rain = rain;
    w.snow = snow;
    w.fog = P.fog;
    w.mist = P.mist;
    w.storm = P.storm;
    w.haze = P.haze;
    w.type = this.target;
    w.label = WEATHER_TYPES[this.target].label;
    // Accumulation: wetness while raining, murky water after heavy rain, snow cover.
    w.wetness = clamp((w.wetness ?? 0) + (rain > 0.05 ? rain * dt * 0.02 : -dt * 0.004), 0, 1);
    w.murk = clamp((w.murk ?? 0) + (rain > 0.6 ? dt * 0.003 : -dt * 0.001), 0, 0.6);
    w.snowCover = clamp((w.snowCover ?? 0) + (snow > 0.1 ? snow * dt * 0.01 : -dt * 0.003 * (1 - cold)), 0, cold > 0.6 ? 1 : 0.3);
    // Lightning.
    const lightningRate = (this.override?.lightning ?? T.lightning) * k;
    this.flash = Math.max(0, this.flash - dt * 4);
    if (lightningRate > 0) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + this.rng.next() * 18 / Math.max(0.05, lightningRate * 10);
        const reduce = game.settings.get('accessibility.reduceFlashing');
        this.flash = reduce ? 0.25 : 1;
        const distance = 300 + this.rng.next() * 2500;
        game.events.emit('weather:lightning', { distance, delay: distance / 343 });
      }
    }
    w.flash = this.flash;
    this.precip.update(dt, game, rain, snow);
  }

  lateUpdate(dt, game) {
    // Lightning brightens the scene briefly.
    if (this.flash > 0.01) {
      const f = this.flash * this.flash;
      game.pipeline.post.params.exposure *= 1 + f * 1.8;
      game.lighting.hemi.intensity += f * 2.5;
    }
  }

  serialize() {
    return { current: this.current, target: this.target, blend: this.blend, timer: this.timer, params: this.params, windAngle: this.windAngle };
  }

  restore(d) {
    if (!d) return;
    this.current = d.current ?? 'clear';
    this.target = d.target ?? 'clear';
    this.blend = d.blend ?? 1;
    this.timer = d.timer ?? 200;
    if (d.params) Object.assign(this.params, d.params);
    this.from = { ...this.params };
    this.windAngle = d.windAngle ?? 0.4;
  }
}
