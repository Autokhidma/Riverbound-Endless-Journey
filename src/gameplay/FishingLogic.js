// Fishing rules (pure logic): which species can bite where and when, bite
// timing, and the relaxed "keep the fish in the zone" reeling minigame.
import fishData from '../data/fish.json' with { type: 'json' };

export const SPECIES = fishData.species;
export const RARITY_WEIGHTS = fishData.rarityWeights;
export const JUNK = fishData.junk;

/** Map a time of day to fishing time tags. */
export function timeTags(hours, sunElevation) {
  const tags = new Set(['any']);
  if (sunElevation > 4) tags.add('day');
  if (sunElevation < -4) tags.add('night');
  if (hours < 12 && sunElevation > -8 && sunElevation < 14) tags.add('dawn');
  if (hours >= 12 && sunElevation > -8 && sunElevation < 14) tags.add('dusk');
  if (sunElevation > -10 && sunElevation < 6) tags.add('twilight');
  return tags;
}

export function weatherTag(weather) {
  if (!weather) return 'clear';
  if ((weather.storm ?? 0) > 0.5) return 'storm';
  if ((weather.snow ?? 0) > 0.2) return 'snow';
  if ((weather.rain ?? 0) > 0.15) return 'rain';
  if ((weather.fog ?? 0) > 0.3 || (weather.mist ?? 0) > 0.6) return 'fog';
  if ((weather.cloud ?? 0) < 0.5) return 'clear';
  return 'cloudy';
}

/**
 * Candidate species and weights for a context.
 * @param ctx { biomes: [ids], habitat, hours, sunElevation, weather, rodTier, bait, spotQuality, event }
 */
export function candidates(ctx) {
  const tags = timeTags(ctx.hours, ctx.sunElevation);
  const wtag = weatherTag(ctx.weather);
  const rareBonus = (1 + (ctx.rodTier ?? 0) * 0.35) * (ctx.bait?.rareBonus ?? 1) * (ctx.event?.rareBonus ?? 1) * (0.7 + (ctx.spotQuality ?? 1) * 0.3);
  const out = [];
  for (const f of SPECIES) {
    const biomeOk = f.biomes.includes('any') || f.biomes.some((b) => ctx.biomes.includes(b));
    if (!biomeOk) continue;
    if (!tags.has(f.time)) continue;
    const weatherOk = f.weather === 'any' || f.weather === wtag || (f.weather === 'clear' && wtag === 'cloudy' && f.rarity === 'common');
    if (!weatherOk) continue;
    if (f.habitats.length && !f.habitats.includes(ctx.habitat) && !(ctx.habitat === 'deep' && f.habitats.includes('lake'))) continue;
    let w = RARITY_WEIGHTS[f.rarity] ?? 1;
    if (f.rarity === 'rare') w *= rareBonus;
    if (f.rarity === 'legendary') w *= rareBonus * rareBonus * ((ctx.rodTier ?? 0) >= 3 ? 2 : 1);
    if (f.biomes.includes('any') && f.rarity === 'common') w *= 0.6; // generic minnows less dominant
    if (ctx.event?.legendary === f.id) w *= 40;
    out.push({ species: f, weight: w });
  }
  return out;
}

/** Pick a catch (species or junk) using an RNG with next(). */
export function rollCatch(rng, ctx) {
  for (const j of JUNK) if (rng.next() < j.chance * (ctx.spotQuality ? 1 / ctx.spotQuality : 1)) return { junk: j.id };
  const list = candidates(ctx);
  if (!list.length) return { junk: 'old_boot' };
  let total = 0;
  for (const c of list) total += c.weight;
  let r = rng.next() * total;
  let pick = list[list.length - 1].species;
  for (const c of list) { r -= c.weight; if (r <= 0) { pick = c.species; break; } }
  const t = rng.next();
  const size = Math.round((pick.size[0] + (pick.size[1] - pick.size[0]) * Math.pow(t, 1.6)) * 10) / 10;
  return { species: pick, size };
}

/** Seconds until a bite. */
export function biteDelay(rng, ctx) {
  const speed = (1 + (ctx.rodTier ?? 0) * 0.2) * (ctx.bait?.biteSpeed ?? 1) * (ctx.event?.biteSpeed ?? 1) * (0.6 + (ctx.spotQuality ?? 0.6) * 0.5);
  const mean = 9 / speed;
  return 2 + -Math.log(1 - rng.next() * 0.98) * mean;
}

/**
 * Reeling minigame state. The zone (player's catch window) rises while the
 * button is held and sinks otherwise; the fish wanders. Progress fills while
 * the fish is inside the zone and drains slowly outside it.
 */
export class ReelGame {
  constructor(rng, { difficulty = 0.3, rodTier = 0, relaxed = false } = {}) {
    this.rng = rng;
    this.difficulty = difficulty;
    this.zoneSize = Math.max(0.2, 0.36 - difficulty * 0.14 + rodTier * 0.025 + (relaxed ? 0.12 : 0));
    this.zone = 0.3; // bottom of zone (0..1)
    this.zoneVel = 0;
    this.fish = 0.5;
    this.fishTarget = 0.5;
    this.fishTimer = 0;
    this.progress = 0.3;
    this.time = 0;
    this.outside = 0;
    this.done = null; // 'caught' | 'escaped'
    this.relaxed = relaxed;
  }

  get fishInZone() {
    return this.fish >= this.zone && this.fish <= this.zone + this.zoneSize;
  }

  update(dt, holding) {
    if (this.done) return this.done;
    this.time += dt;
    // Zone physics.
    this.zoneVel += (holding ? 1.9 : -1.6) * dt;
    this.zoneVel *= Math.pow(0.08, dt);
    this.zone += this.zoneVel * dt;
    if (this.zone < 0) { this.zone = 0; this.zoneVel = Math.max(0, this.zoneVel) * -0.3; }
    if (this.zone > 1 - this.zoneSize) { this.zone = 1 - this.zoneSize; this.zoneVel = Math.min(0, this.zoneVel) * -0.3; }
    // Fish behaviour: picks new targets; harder fish move faster and more often.
    this.fishTimer -= dt;
    if (this.fishTimer <= 0) {
      this.fishTimer = (1.4 - this.difficulty) * (0.5 + this.rng.next());
      const jump = 0.15 + this.difficulty * 0.55;
      this.fishTarget = Math.min(0.97, Math.max(0.03, this.fish + (this.rng.next() - 0.5) * 2 * jump));
    }
    const speed = 0.8 + this.difficulty * 2.2;
    this.fish += (this.fishTarget - this.fish) * Math.min(1, dt * speed);
    // Progress.
    if (this.fishInZone) { this.progress += dt * (this.relaxed ? 0.34 : 0.26); this.outside = 0; }
    else { this.progress -= dt * (this.relaxed ? 0.07 : 0.12) * (0.6 + this.difficulty); this.outside += dt; }
    if (this.progress >= 1) this.done = 'caught';
    else if (this.progress <= 0) this.done = 'escaped';
    return this.done;
  }
}
