// Region feature placement: tributaries and islands (hydro phase), then
// settlements, landmarks, fishing spots, resources and lore (site phase).
// Placement is contextual: settlements look for flat banks on accessible bends,
// waterfalls need high banks, arches need narrow water, and so on.
import { RNG, hashInts, hashString } from '../core/rng.js';
import { clamp, smoothstep, softClamp } from '../core/math.js';
import { BIOME_BY_ID } from './biomes.js';
import { Tributary, DS, S_MIN } from './River.js';
import landmarkData from '../data/landmarks.json' with { type: 'json' };

export const LANDMARKS = landmarkData.types;
const WORDS = landmarkData.words;

const TRIB_CHANCE = {
  spring: 0.35, jungle: 0.55, autumn: 0.4, misty: 0.6, crystal: 0.7, canyon: 0.45, monsoon: 0.5,
  swamp: 0.4, autumnMountain: 0.55, northern: 0.5, coast: 0.2, snow: 0.45,
};
const TRIB_END = {
  spring: ['lake', 'waterfall'], jungle: ['waterfall', 'waterfall', 'grotto'], autumn: ['lake', 'waterfall'],
  misty: ['waterfall', 'lake'], crystal: ['lake', 'lake', 'waterfall'], canyon: ['grotto', 'waterfall'],
  monsoon: ['waterfall', 'lake'], swamp: ['lake', 'grotto'], autumnMountain: ['waterfall', 'lake'],
  northern: ['lake', 'waterfall'], coast: ['lake'], snow: ['lake', 'waterfall'],
};

export const RESOURCES_BY_BIOME = {
  spring: ['wild_mint', 'blossom_sprig', 'reeds_bundle', 'driftwood'],
  jungle: ['orchid', 'vanilla_pod', 'river_clay', 'driftwood'],
  autumn: ['chestnuts', 'amber_resin', 'reeds_bundle', 'driftwood'],
  misty: ['mountain_herb', 'slate_flake', 'driftwood'],
  crystal: ['clear_quartz', 'blue_lichen', 'driftwood'],
  canyon: ['ochre_pigment', 'desert_sage', 'river_clay'],
  monsoon: ['bamboo_shoot', 'lotus_seed', 'river_clay'],
  swamp: ['bog_myrtle', 'glowcap', 'reeds_bundle'],
  autumnMountain: ['chestnuts', 'ember_moss', 'driftwood'],
  northern: ['cloudberries', 'pine_resin', 'driftwood'],
  coast: ['seashell', 'sea_glass', 'driftwood'],
  snow: ['frost_lichen', 'ice_crystal'],
  starwater: ['lumen_bloom', 'star_shard'],
};

// ---------------------------------------------------------------- hydro phase
export function placeRegionHydro(world, region) {
  const rng = new RNG(hashInts(region.seed, hashString('hydro')));
  const b = BIOME_BY_ID[region.biome];
  const hydro = { regionIndex: region.index, tributary: null, islands: [] };

  const forced = region.storyFeatures.find((f) => f.type === 'hiddenRiver');
  if (region.index > 0 && (forced || rng.chance(TRIB_CHANCE[b.id] ?? 0.3))) {
    hydro.tributary = makeTributary(world, region, rng, forced);
  }

  // Islands in wide water.
  const islandChance = b.river.islandChance;
  for (let s = region.sStart + 150; s < region.sEnd - 150; s += 70) {
    const r = world.main.sample(s, {});
    if (r.w < 55 || r.rp > 0.05) continue;
    if (hydro.tributary && Math.abs(s - hydro.tributary.junctionS) < 200) continue;
    const pChance = islandChance * (r.lk > 0.3 ? 0.35 : 0.1);
    if (!rng.chance(pChance)) continue;
    const side = rng.sign();
    const radius = clamp(r.w * rng.range(0.12, 0.22), 9, 55);
    const t = side * (r.w * 0.5 - radius - Math.max(16, r.w * 0.12) - rng.range(0, r.w * 0.1));
    if (Math.abs(t) < radius * 0.5) continue;
    const p = world.riverToWorld(s, t);
    if (hydro.islands.some((i) => Math.hypot(i.x - p.x, i.z - p.z) < i.r + radius + 20)) continue;
    hydro.islands.push({ x: p.x, z: p.z, r: radius, h: rng.range(1.2, 4.8), base: r.wl - r.dp * 0.7, s, t });
  }
  if (region.index === 0) {
    // A small island in Willowmere lake.
    const p = world.riverToWorld(-330, -55);
    hydro.islands.push({ x: p.x, z: p.z, r: 26, h: 3.2, base: 38, s: -330, t: -55, home: true });
  }
  return hydro;
}

function makeTributary(world, region, rng, forced) {
  const b = BIOME_BY_ID[region.biome];
  let js = region.sStart + region.length * rng.range(0.3, 0.7);
  // Avoid lakes and rapids at the junction.
  for (let tries = 0; tries < 8; tries++) {
    const bad = region.lakes.some((l) => Math.abs(js - l.sc) < l.halfLen + 150) || region.rapids.some((r) => js > r.s0 - 150 && js < r.s1 + 150);
    if (!bad) break;
    js = region.sStart + region.length * rng.range(0.2, 0.8);
  }
  const m = world.main.sample(js, {});
  let side = rng.sign();
  if (b.id === 'coast') side = -(region.coastSide ?? 1);
  const endType = forced ? 'starwater' : rng.pick(TRIB_END[b.id] ?? ['lake']);
  const targetLen = forced ? rng.range(2600, 3400) : rng.range(1300, 3400);
  const w0 = clamp(m.w * 0.5, 12, 28) * (forced ? 0.9 : 1);
  const normalX = -Math.sin(m.h), normalZ = Math.cos(m.h);
  let x = m.x + normalX * side * (m.w * 0.5 - 3);
  let z = m.z + normalZ * side * (m.w * 0.5 - 3);
  const theta0 = m.h + side * (Math.PI / 2 + rng.range(0.25, 0.55));
  let theta = theta0;
  const off = rng.range(0, 1000);
  const noise = world.noise;
  const pts = [];
  const neighbours = [world.regionHydro(region.index - 1)?.tributary, world.regionHydro(region.index - 2)?.tributary].filter(Boolean);
  let L = targetLen;
  const lakeHalfLen = rng.range(120, 220);
  const lakeHalfW = rng.range(70, 140) * (endType === 'starwater' ? 1.5 : 1);
  const tmp = {};
  for (let s = 0; s <= L + 1e-6; s += DS) {
    // Meandering heading, soft-clamped around the initial direction.
    const mean = 0.55 * noise.noise1(s / 320 + off, 12) + 0.22 * noise.noise1(s / 95 + off, 13);
    let desired = theta0 + softClamp(mean, 0.9);
    // Keep away from the main river and neighbouring tributaries.
    if (s > 120) {
      const nm = world.main.nearest(x, z, tmp);
      const mw = world.main.sample(nm.s, {}).w;
      const clearance = nm.dist - mw * 0.5 - w0 * 0.5;
      if (clearance < 140) {
        const px = world.main.sample(nm.s, {});
        const away = Math.atan2(z - px.z, x - px.x);
        const t = smoothstep(140, 60, clearance);
        desired = desired + angleLerp(desired, away, t);
        if (clearance < 50) { L = Math.max(300, s - 40); break; }
      }
      for (const T of neighbours) {
        if (!T.nearBBox(x, z, 250)) continue;
        const tn = T.nearest(x, z, tmp);
        if (tn.dist < 180) { L = Math.max(300, s - 60); break; }
      }
      if (L < targetLen && s >= L) break;
    }
    theta = desired;
    // Width tapers towards the source; lakes bulge at the end.
    let w = w0 * (1 - 0.35 * s / targetLen);
    let lk = 0;
    const hasLake = endType === 'lake' || endType === 'starwater';
    if (hasLake) {
      const d = (s - (L - lakeHalfLen)) / lakeHalfLen;
      if (d > -1) {
        const shape = Math.sqrt(Math.max(0, 1 - d * d));
        const lw = lakeHalfW * 2 * shape;
        if (lw > w) { w = lw; lk = smoothstep(0, 0.5, shape); }
      }
    } else {
      // round pool at the base of the waterfall / grotto
      const d = (s - (L - 40)) / 40;
      if (d > -1) w = Math.max(w, 30 * Math.sqrt(Math.max(0, 1 - d * d)));
    }
    const wl = m.wl - 0.02 + s * (endType === 'waterfall' ? 0.004 : 0.0028);
    pts.push({ x, z, h: theta, w, wl, fl: 0.55 * (1 - lk * 0.8), dp: 2.4 + lk * 2.5, rp: 0, u: 0, lk });
    x += Math.cos(theta) * DS;
    z += Math.sin(theta) * DS;
  }
  const def = {
    id: `trib_${region.index}`,
    regionIndex: region.index,
    junctionS: js,
    side,
    endType,
    biomeOverride: forced ? 'starwater' : null,
    headwall: endType === 'waterfall' ? rng.range(28, 48) : endType === 'grotto' ? rng.range(14, 22) : 0,
    hidden: !!forced,
    name: forced ? 'The Hidden River' : `${rng.pick(b.regionWords)} ${rng.pick(['Brook', 'Creek', 'Stream', 'Rill', 'Beck'])}`,
  };
  const T = new Tributary(def, pts);
  T.endState = T.sample(T.length, {});
  return T;
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d * t;
}

// ---------------------------------------------------------------- site phase
export function placeRegionFeatures(world, region, hydro) {
  const rng = new RNG(hashInts(region.seed, hashString('sites')));
  const b = BIOME_BY_ID[region.biome];
  const F = {
    regionIndex: region.index,
    biome: region.biome,
    tributary: hydro.tributary,
    islands: hydro.islands,
    items: [],
    zones: [],
    colliders: [],
  };
  const ctx = new SiteContext(world, region, hydro, rng, F);

  // Tributary as a discoverable feature.
  const T = hydro.tributary;
  if (T) {
    const j = T.sample(0, {});
    ctx.add({ kind: 'tributary', type: 'tributary', id: T.id, name: T.name, x: j.x, z: j.z, radius: 80, rarity: T.hidden ? 'story' : 'common', hidden: T.hidden, endType: T.endType });
    placeTributaryEnd(ctx, T);
  }

  // Story features first (they must exist).
  for (const sf of region.storyFeatures) placeStoryFeature(ctx, sf);

  // Regular settlement.
  if (!F.items.some((i) => i.kind === 'settlement') && region.index > 0 && rng.chance(b.settlement.chance)) {
    placeSettlement(ctx, {});
  }

  // Landmarks: common, rare, unique.
  const lm = b.landmarks;
  const commonCount = rng.int(2, 4);
  for (let k = 0; k < commonCount && lm.common.length; k++) placeLandmark(ctx, rng.pick(lm.common), 'common');
  if (lm.rare.length && rng.chance(0.35)) placeLandmark(ctx, rng.pick(lm.rare), 'rare');
  if (lm.unique.length && isUniqueRegion(world, region)) placeLandmark(ctx, lm.unique[0], 'unique');

  placeFishingSpots(ctx);
  placeResources(ctx);
  placeLore(ctx);
  return F;
}

/** A biome's unique landmark appears in exactly one of its regions per world. */
function isUniqueRegion(world, region) {
  const occ = world.seq.regions.slice(0, region.index + 1).filter((r) => r.biome === region.biome).length; // 1-based
  const target = 1 + (hashInts(world.seed, hashString(region.biome), 77) % 2); // 1st or 2nd visit
  return occ === target;
}

class SiteContext {
  constructor(world, region, hydro, rng, F) {
    this.world = world; this.region = region; this.hydro = hydro; this.rng = rng; this.F = F;
    this.b = BIOME_BY_ID[region.biome];
    this.tmp = {};
    this.counter = 0;
  }

  id(kind) {
    return `r${this.region.index}_${kind}_${this.counter++}`;
  }

  add(item) {
    if (!item.id) item.id = this.id(item.kind);
    item.region = this.region.index;
    item.biome = this.region.biome;
    this.F.items.push(item);
    return item;
  }

  raw(x, z) {
    return this.world.sample(x, z, this.tmp, true);
  }

  /** Point on a bank: e metres from the water's edge on side. */
  bankPoint(s, side, e) {
    const r = this.world.main.sample(s, {});
    const t = side * (r.w * 0.5 + e);
    return { x: r.x - Math.sin(r.h) * t, z: r.z + Math.cos(r.h) * t, river: r, s, side, e, angleToWater: Math.atan2(-Math.cos(r.h) * side, Math.sin(r.h) * side) };
  }

  randomS(margin = 280) {
    const r = this.region;
    return r.sStart + margin + this.rng.next() * Math.max(10, r.length - margin * 2);
  }

  isClear(x, z, radius) {
    for (const it of this.F.items) {
      if (it.kind === 'resource' || it.kind === 'fishingSpot' || it.kind === 'lore') continue;
      const need = radius + (it.footprint ?? 20);
      if ((it.x - x) ** 2 + (it.z - z) ** 2 < need * need) return false;
    }
    const T = this.hydro.tributary;
    if (T && T.nearBBox(x, z, radius + 40)) {
      const n = T.nearest(x, z, {});
      if (n.dist < radius + T.sample(n.s, {}).w * 0.5 + 12) return false;
    }
    for (const isl of this.hydro.islands) if (Math.hypot(isl.x - x, isl.z - z) < isl.r + radius) return false;
    return true;
  }

  flatness(x, z, r) {
    let min = Infinity, max = -Infinity;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const h = this.raw(x + Math.cos(a) * r, z + Math.sin(a) * r).height;
      min = Math.min(min, h); max = Math.max(max, h);
    }
    const c = this.raw(x, z).height;
    return { range: Math.max(max, c) - Math.min(min, c), center: c };
  }

  avoidS(s) {
    const r = this.region;
    if (r.rapids.some((p) => s > p.s0 - 80 && s < p.s1 + 80)) return true;
    const T = this.hydro.tributary;
    if (T && Math.abs(s - T.junctionS) < 140) return true;
    return false;
  }

  /** Find the best flat bank site. */
  findBankSite({ eMin = 8, eMax = 30, flat = 12, tries = 26, minAbove = 0.4, maxAbove = 14, preferSide = 0, sRange = null }) {
    let best = null;
    for (let k = 0; k < tries; k++) {
      const s = sRange ? sRange[0] + this.rng.next() * (sRange[1] - sRange[0]) : this.randomS();
      if (this.avoidS(s)) continue;
      let side = this.rng.sign();
      if (preferSide && this.rng.chance(0.8)) side = preferSide;
      const e = this.rng.range(eMin, eMax);
      const p = this.bankPoint(s, side, e);
      if (!this.isClear(p.x, p.z, flat + 6)) continue;
      const smp = this.raw(p.x, p.z);
      if (smp.sea > 0.2) continue;
      const above = smp.height - p.river.wl;
      if (above < minAbove || above > maxAbove) continue;
      const fl = this.flatness(p.x, p.z, flat);
      const score = fl.range + above * 0.08 + this.rng.next() * 1.5;
      if (!best || score < best.score) best = { ...p, score, height: smp.height, flat: fl };
    }
    return best;
  }

  /** Find a site where the bank rises steeply to at least minH above water. */
  findCliffSite({ minH = 12, tries = 24, maxDist = 80 }) {
    let best = null;
    for (let k = 0; k < tries; k++) {
      const s = this.randomS();
      if (this.avoidS(s)) continue;
      const side = this.rng.sign();
      const r = this.world.main.sample(s, {});
      let top = null;
      for (let e = 4; e <= maxDist; e += 4) {
        const p = this.bankPoint(s, side, e);
        const h = this.raw(p.x, p.z).height - r.wl;
        if (h >= minH) { top = { ...p, height: h + r.wl, rise: h, dist: e }; break; }
      }
      if (!top) continue;
      if (!this.isClear(top.x, top.z, 25)) continue;
      const score = top.dist - top.rise * 0.3 + this.rng.next() * 5;
      if (!best || score < best.score) best = { ...top, score, bottom: this.bankPoint(s, side, -1.5) };
    }
    return best;
  }

  /** Find a place in open water. */
  findWaterSite({ minW = 40, clearance = 16, tries = 24, preferLake = false }) {
    let best = null;
    for (let k = 0; k < tries; k++) {
      const s = this.randomS(200);
      if (this.avoidS(s)) continue;
      const r = this.world.main.sample(s, {});
      if (r.w < minW) continue;
      const maxT = r.w * 0.5 - clearance;
      if (maxT < 4) continue;
      const t = this.rng.range(-maxT, maxT);
      // keep a navigable channel: the object sits away from the centre line
      if (Math.abs(t) < Math.min(maxT, 14)) continue;
      const p = this.world.riverToWorld(s, t);
      if (!this.isClear(p.x, p.z, clearance)) continue;
      const score = -(r.w) * (preferLake ? 2 : 0.2) + this.rng.next() * 30;
      if (!best || score < best.score) best = { x: p.x, z: p.z, s, t, river: r, score };
    }
    return best;
  }

  /** Narrow place for spans (arches, bridges). */
  findSpanSite({ maxW = 60, tries = 30 }) {
    let best = null;
    for (let k = 0; k < tries; k++) {
      const s = this.randomS(300);
      if (this.avoidS(s)) continue;
      const r = this.world.main.sample(s, {});
      if (r.w > maxW || r.lk > 0.05) continue;
      const a = this.bankPoint(s, 1, 5), c = this.bankPoint(s, -1, 5);
      if (!this.isClear((a.x + c.x) / 2, (a.z + c.z) / 2, r.w * 0.5 + 10)) continue;
      const ha = this.raw(a.x, a.z).height, hc = this.raw(c.x, c.z).height;
      if (this.raw(a.x, a.z).sea > 0.1 || this.raw(c.x, c.z).sea > 0.1) continue;
      const score = r.w + Math.abs(ha - hc) * 2 + this.rng.next() * 10;
      if (!best || score < best.score) best = { s, river: r, a: { ...a, y: ha }, c: { ...c, y: hc }, score };
    }
    return best;
  }

  zone(x, z, r0, r1, h, mode = 'flatten') {
    this.F.zones.push({ x, z, r0, r1, h, mode });
  }

  name(type) {
    const def = LANDMARKS[type];
    const tmpl = this.rng.pick(def?.names ?? ['{w}']);
    const w = this.rng.chance(0.5) ? this.rng.pick(this.b.regionWords) : this.rng.pick(WORDS);
    return tmpl.replace('{w}', w);
  }
}

// ---------------------------------------------------------------- placements
function placeStoryFeature(ctx, sf) {
  switch (sf.type) {
    case 'settlement':
      placeSettlement(ctx, { role: sf.role, name: sf.name, shipwright: sf.shipwright, storyKey: sf.key, story: true });
      break;
    case 'headwaterFalls': {
      const w = ctx.world;
      const r0 = w.main.sample(S_MIN, {});
      const hx = Math.cos(r0.h), hz = Math.sin(r0.h);
      const topBack = r0.w * 0.3 + 48;
      const top = { x: r0.x - hx * topBack, z: r0.z - hz * topBack };
      const bottom = { x: r0.x - hx * (r0.w * 0.3 - 6), z: r0.z - hz * (r0.w * 0.3 - 6) };
      ctx.add({
        kind: 'landmark', type: 'headwaterFalls', name: sf.name, rarity: 'story', storyKey: sf.key,
        x: bottom.x, z: bottom.z, radius: LANDMARKS.headwaterFalls.radius, footprint: 40,
        waterfall: { top: { ...top, y: r0.wl + 40 }, bottom: { ...bottom, y: r0.wl }, width: 14, drop: 40 },
      });
      break;
    }
    case 'lampstone': {
      if (sf.onTributary) {
        placeOnTributary(ctx, 'lampstone', sf);
        break;
      }
      let site = null;
      if (sf.withWaterfall) {
        const cliff = ctx.findCliffSite({ minH: 14, tries: 40 });
        if (cliff) {
          const wf = addWaterfall(ctx, cliff, 'waterfall', 'common');
          site = ctx.bankPoint(cliff.s + 22, cliff.side, 5);
          void wf;
        }
      }
      if (!site) site = ctx.findBankSite({ eMin: 4, eMax: 10, flat: 7, tries: 40 });
      if (!site) site = ctx.bankPoint(ctx.randomS(), 1, 6);
      addLandmarkAt(ctx, 'lampstone', site, 'story', { name: sf.name, lamp: sf.lamp, storyKey: sf.key, shrine: sf.shrine });
      break;
    }
    case 'ruinedVillage': {
      const site = ctx.findBankSite({ eMin: 18, eMax: 36, flat: 30, tries: 40 }) ?? ctx.bankPoint(ctx.randomS(), 1, 24);
      addLandmarkAt(ctx, 'ruinedVillage', site, 'story', { name: sf.name, storyKey: sf.key, flat: 36 });
      break;
    }
    case 'lighthouse': {
      const region = ctx.region;
      const side = region.coastSide ?? 1;
      let site = null;
      for (let k = 0; k < 30 && !site; k++) {
        const s = ctx.randomS(400);
        const p = ctx.bankPoint(s, side, ctx.rng.range(50, 90));
        const smp = ctx.raw(p.x, p.z);
        if (smp.height > p.river.wl + 0.4 && ctx.isClear(p.x, p.z, 20)) site = p;
      }
      if (!site) site = ctx.bankPoint(ctx.randomS(), -side, 20);
      addLandmarkAt(ctx, 'lighthouse', site, 'story', { name: sf.name, lamp: sf.lamp, storyKey: sf.key });
      break;
    }
    case 'camp':
      placeOnTributary(ctx, 'camp', sf);
      break;
    case 'hiddenRiver':
      // The tributary itself is created in the hydro phase; mark the veil at its mouth.
      if (ctx.hydro.tributary) {
        const T = ctx.hydro.tributary;
        const j = T.sample(40, {});
        ctx.add({ kind: 'veil', type: 'veil', name: 'A curtain of hanging vines', x: j.x, z: j.z, radius: 40, width: j.w + 16, angle: j.h, storyKey: sf.key, tribId: T.id });
      }
      break;
    default:
      break;
  }
}

function placeOnTributary(ctx, type, sf) {
  const T = ctx.hydro.tributary;
  if (!T) return;
  const end = T.sample(T.length - 60, {});
  const side = type === 'camp' ? 1 : -1;
  const off = end.w * 0.5 + (type === 'camp' ? 18 : 8);
  const x = end.x - Math.sin(end.h) * off * side;
  const z = end.z + Math.cos(end.h) * off * side;
  const site = { x, z, s: -1, side, river: { wl: end.wl, h: end.h }, angleToWater: Math.atan2(-Math.cos(end.h) * side, Math.sin(end.h) * side) };
  addLandmarkAt(ctx, type, site, 'story', { name: sf.name, lamp: sf.lamp, storyKey: sf.key, tribId: T.id });
}

function placeTributaryEnd(ctx, T) {
  const end = T.endState;
  if (T.endType === 'lake' || T.endType === 'starwater') {
    const c = T.sample(Math.max(0, T.length - 150), {});
    const type = T.endType === 'starwater' ? 'starwaterLake' : 'hiddenLake';
    ctx.add({ kind: 'landmark', type, name: type === 'starwaterLake' ? 'Starwater' : ctx.name('hiddenLake'), rarity: T.hidden ? 'story' : 'rare', x: c.x, z: c.z, radius: LANDMARKS[type].radius, footprint: 5, tribId: T.id, water: c.wl });
  } else if (T.endType === 'waterfall') {
    const hx = Math.cos(end.h), hz = Math.sin(end.h);
    const halfT = end.w * 0.5;
    const top = { x: end.x + hx * (halfT * 0.2 + 18), z: end.z + hz * (halfT * 0.2 + 18), y: end.wl + T.headwall };
    const bottom = { x: end.x + hx * (halfT * 0.2 - 2), z: end.z + hz * (halfT * 0.2 - 2), y: end.wl };
    ctx.add({ kind: 'landmark', type: 'giantWaterfall', name: ctx.name('giantWaterfall'), rarity: 'rare', x: bottom.x, z: bottom.z, radius: 220, footprint: 20, tribId: T.id, waterfall: { top, bottom, width: 10 + T.headwall * 0.2, drop: T.headwall } });
  } else if (T.endType === 'grotto') {
    const hx = Math.cos(end.h), hz = Math.sin(end.h);
    ctx.add({ kind: 'landmark', type: 'cave', name: ctx.name('cave'), rarity: 'rare', x: end.x + hx * 8, z: end.z + hz * 8, radius: 90, footprint: 14, angle: end.h + Math.PI, water: end.wl, tribId: T.id, grotto: true });
  }
}

function placeSettlement(ctx, { role = null, name = null, shipwright = false, storyKey = null, story = false }) {
  const b = ctx.b;
  const R = ctx.rng.range(34, 52);
  const coastSide = ctx.region.coastSide ?? 1;
  let site;
  if (role === 'home') {
    // Willowmere sits on the lake shore near the outlet.
    site = ctx.bankPoint(-120, 1, R * 0.55 + 10);
    site.height = ctx.raw(site.x, site.z).height;
  } else {
    site = ctx.findBankSite({ eMin: R * 0.55 + 6, eMax: R * 0.55 + 16, flat: R * 0.7, tries: story ? 40 : 26, maxAbove: 10, preferSide: b.id === 'coast' ? -coastSide : 0 });
    if (!site && story) site = ctx.bankPoint(ctx.randomS(), b.id === 'coast' ? -coastSide : 1, R * 0.55 + 8);
  }
  if (!site) return null;
  const wl = site.river.wl;
  const plateau = wl + 1.3;
  ctx.zone(site.x, site.z, R * 0.75, R * 1.3, plateau);
  // Landing at the bank near the dock.
  const bank = ctx.bankPoint(site.s, site.side, 5);
  ctx.zone(bank.x, bank.z, 5, 11, wl + 0.9);
  const dockBase = ctx.bankPoint(site.s, site.side, 1.5);
  const dockLen = clamp(site.river.w * 0.18, 8, 14);
  const dockAngle = site.angleToWater; // points from land into water
  const dx = Math.cos(dockAngle), dz = Math.sin(dockAngle);
  const dockEnd = { x: dockBase.x + dx * dockLen, z: dockBase.z + dz * dockLen };
  const flowX = Math.cos(site.river.h), flowZ = Math.sin(site.river.h);
  const moor = { x: dockEnd.x + flowX * 3.2 - dx * 2, z: dockEnd.z + flowZ * 3.2 - dz * 2 };
  const nm = name ?? (role === 'home' ? 'Willowmere' : ctx.rng.pick(b.settlement.names));
  const it = ctx.add({
    kind: 'settlement', type: 'settlement', name: nm, style: b.settlement.style, role, storyKey, shipwright: shipwright || ctx.rng.chance(0.35),
    x: site.x, z: site.z, y: plateau, radius: R + 60, footprint: R, R, s: site.s, side: site.side, water: wl,
    dock: { x: dockBase.x, z: dockBase.z, angle: dockAngle, length: dockLen, end: dockEnd, y: wl + 0.55 }, moor,
    seed: hashInts(ctx.region.seed, hashString(nm)), rarity: story ? 'story' : 'common',
  });
  // Dock collider (oriented box).
  ctx.F.colliders.push({ type: 'box', x: (dockBase.x + dockEnd.x) / 2, z: (dockBase.z + dockEnd.z) / 2, hl: dockLen / 2 + 0.5, hw: 1.3, angle: dockAngle, owner: it.id });
  // A fishing spot near every settlement.
  const fs = ctx.world.riverToWorld(site.s + 40, site.side * site.river.w * 0.2);
  ctx.add({ kind: 'fishingSpot', x: fs.x, z: fs.z, s: site.s + 40, radius: 12, quality: 0.8, habitat: 'river' });
  return it;
}

function placeLandmark(ctx, type, rarity) {
  const def = LANDMARKS[type];
  if (!def) return null;
  switch (def.placement) {
    case 'cliff': {
      const site = ctx.findCliffSite({ minH: def.minH ?? 12, maxDist: type === 'giantWaterfall' ? 140 : 90 });
      if (!site) return null;
      if (type === 'paintedWall' || type === 'skyStair') {
        return addLandmarkAt(ctx, type, site, rarity, { cliff: { top: { x: site.x, z: site.z, y: site.height }, bottom: site.bottom, rise: site.rise } });
      }
      return addWaterfall(ctx, site, type, rarity);
    }
    case 'bank': {
      const [eMin, eMax] = def.e ?? [10, 30];
      const site = ctx.findBankSite({ eMin, eMax, flat: def.flat ?? 10 });
      if (!site) return null;
      return addLandmarkAt(ctx, type, site, rarity, {});
    }
    case 'water': {
      const site = ctx.findWaterSite({ minW: def.minW ?? 40, clearance: type === 'floatingIsland' ? 30 : 14, preferLake: type === 'mirrorLake' || type === 'floatingIsland' });
      if (!site) return null;
      const it = ctx.add({ kind: 'landmark', type, name: ctx.name(type), rarity, x: site.x, z: site.z, s: site.s, t: site.t, radius: def.radius, footprint: 20, water: site.river.wl, seed: ctx.rng.nextU32() });
      if (type === 'rockPillars' || type === 'drownedBell') ctx.F.colliders.push({ type: 'circle', x: site.x, z: site.z, r: type === 'drownedBell' ? 5 : 7, owner: it.id });
      return it;
    }
    case 'sea': {
      const side = ctx.region.coastSide ?? 1;
      const s = ctx.randomS(300);
      const p = ctx.bankPoint(s, side, ctx.rng.range(320, 520));
      const it = ctx.add({ kind: 'landmark', type, name: ctx.name(type), rarity, x: p.x, z: p.z, s, radius: def.radius, footprint: 30, water: ctx.world.seaLevel(ctx.region), seed: ctx.rng.nextU32() });
      ctx.F.colliders.push({ type: 'circle', x: p.x, z: p.z, r: 16, owner: it.id });
      return it;
    }
    case 'shore': {
      const s = ctx.randomS();
      if (ctx.avoidS(s)) return null;
      const side = ctx.rng.sign();
      const p = ctx.bankPoint(s, side, -3);
      if (!ctx.isClear(p.x, p.z, 10)) return null;
      return ctx.add({ kind: 'landmark', type, name: ctx.name(type), rarity, x: p.x, z: p.z, s, side, radius: def.radius, footprint: 10, angle: p.river.h + ctx.rng.range(-0.6, 0.6), water: p.river.wl, seed: ctx.rng.nextU32() });
    }
    case 'span': {
      const site = ctx.findSpanSite({ maxW: def.maxW ?? 60 });
      if (!site) return null;
      const mid = { x: (site.a.x + site.c.x) / 2, z: (site.a.z + site.c.z) / 2 };
      const it = ctx.add({ kind: 'landmark', type, name: ctx.name(type), rarity, x: mid.x, z: mid.z, s: site.s, radius: def.radius, footprint: site.river.w * 0.5 + 10, a: site.a, c: site.c, water: site.river.wl, seed: ctx.rng.nextU32() });
      ctx.zone(site.a.x, site.a.z, 5, 10, Math.max(site.a.y, site.river.wl + 1.5), 'raise');
      ctx.zone(site.c.x, site.c.z, 5, 10, Math.max(site.c.y, site.river.wl + 1.5), 'raise');
      return it;
    }
    case 'cove': {
      const site = ctx.findCliffSite({ minH: def.minH ?? 7, maxDist: 30 });
      if (!site) return null;
      const cove = ctx.bankPoint(site.s, site.side, 5);
      ctx.zone(cove.x, cove.z, 5, 10, site.river.wl - 1.6, 'carve');
      return ctx.add({ kind: 'landmark', type, name: ctx.name(type), rarity, x: cove.x, z: cove.z, s: site.s, side: site.side, radius: def.radius, footprint: 14, angle: cove.angleToWater + Math.PI, water: site.river.wl, seed: ctx.rng.nextU32() });
    }
    default:
      return null;
  }
}

function addWaterfall(ctx, site, type, rarity) {
  const def = LANDMARKS[type];
  const wl = site.river.wl;
  const width = type === 'giantWaterfall' ? ctx.rng.range(10, 18) : ctx.rng.range(3.5, 7);
  const top = { x: site.x, z: site.z, y: site.height };
  const bottom = { x: site.bottom.x, z: site.bottom.z, y: wl };
  const it = ctx.add({
    kind: 'landmark', type, name: ctx.name(type), rarity, x: bottom.x, z: bottom.z, s: site.s, side: site.side,
    radius: def.radius, footprint: 20, waterfall: { top, bottom, width, drop: top.y - wl, frozen: type === 'icefall' }, seed: ctx.rng.nextU32(),
  });
  return it;
}

function addLandmarkAt(ctx, type, site, rarity, extra) {
  const def = LANDMARKS[type];
  const flat = extra.flat ?? def.flat ?? 8;
  const wl = site.river.wl;
  let y = site.height ?? ctx.raw(site.x, site.z).height;
  y = Math.max(y, wl + 0.8);
  if (!['paintedWall', 'skyStair'].includes(type)) ctx.zone(site.x, site.z, flat * 0.7, flat * 1.3, y);
  const it = ctx.add({
    kind: 'landmark', type, name: extra.name ?? ctx.name(type), rarity, x: site.x, z: site.z, y, s: site.s, side: site.side,
    radius: def.radius, footprint: flat, angle: site.angleToWater ?? 0, water: wl, seed: ctx.rng.nextU32(), ...extra,
  });
  if (['lampstone', 'lighthouse', 'watchtower', 'emberSpire', 'frozenGiant'].includes(type) && site.e !== undefined && site.e < 10) {
    ctx.F.colliders.push({ type: 'circle', x: site.x, z: site.z, r: 2.5, owner: it.id });
  }
  return it;
}

function placeFishingSpots(ctx) {
  const count = ctx.rng.int(5, 8);
  const T = ctx.hydro.tributary;
  for (let k = 0; k < count; k++) {
    const s = ctx.randomS(120);
    const r = ctx.world.main.sample(s, {});
    const t = ctx.rng.range(-0.3, 0.3) * r.w;
    const p = ctx.world.riverToWorld(s, t);
    let habitat = 'river';
    if (r.lk > 0.4) habitat = 'lake';
    else if (r.rp > 0.2) habitat = 'rapids';
    else if (T && Math.abs(s - T.junctionS) < 120) habitat = 'confluence';
    else if (r.dp > 4.2) habitat = 'deep';
    if (ctx.b.id === 'coast' && ctx.rng.chance(0.4)) habitat = 'sea';
    ctx.add({ kind: 'fishingSpot', x: p.x, z: p.z, s, radius: ctx.rng.range(9, 15), quality: ctx.rng.range(0.7, 1.5), habitat });
  }
  if (T) {
    // A confluence spot and one at the tributary end.
    const j = T.sample(Math.min(T.length, 60), {});
    ctx.add({ kind: 'fishingSpot', x: j.x, z: j.z, s: T.junctionS, radius: 12, quality: 1.3, habitat: 'confluence' });
    const e = T.sample(Math.max(0, T.length - 120), {});
    ctx.add({ kind: 'fishingSpot', x: e.x, z: e.z, radius: 16, quality: 1.6, habitat: T.endType === 'starwater' ? 'starwater' : T.endType === 'lake' ? 'lake' : 'pool', tribId: T.id });
  }
}

function placeResources(ctx) {
  const list = RESOURCES_BY_BIOME[ctx.b.id] ?? ['driftwood'];
  const count = ctx.rng.int(9, 15);
  for (let k = 0; k < count; k++) {
    const s = ctx.randomS(100);
    const side = ctx.rng.sign();
    const p = ctx.bankPoint(s, side, ctx.rng.range(0.8, 4.5));
    const smp = ctx.raw(p.x, p.z);
    if (smp.sea > 0.2 || smp.height < p.river.wl - 0.2) continue;
    const item = ctx.rng.pick(list);
    ctx.add({ kind: 'resource', item, x: p.x, z: p.z, s, radius: 3 });
  }
  const T = ctx.hydro.tributary;
  if (T) {
    const lst = T.endType === 'starwater' ? RESOURCES_BY_BIOME.starwater : list;
    for (let k = 0; k < 4; k++) {
      const ts = ctx.rng.range(200, T.length - 50);
      const r = T.sample(ts, {});
      const side = ctx.rng.sign();
      const off = r.w * 0.5 + ctx.rng.range(1, 4);
      ctx.add({ kind: 'resource', item: ctx.rng.pick(lst), x: r.x - Math.sin(r.h) * off * side, z: r.z + Math.cos(r.h) * off * side, radius: 3, tribId: T.id });
    }
  }
}

function placeLore(ctx) {
  // Carved stones with fragments of river lore near landmarks.
  const landmarks = ctx.F.items.filter((i) => i.kind === 'landmark' && i.rarity !== 'story');
  if (landmarks.length && ctx.rng.chance(0.6)) {
    const lm = ctx.rng.pick(landmarks);
    ctx.add({ kind: 'lore', type: 'carving', x: lm.x + ctx.rng.range(-6, 6), z: lm.z + ctx.rng.range(-6, 6), radius: 4, loreSeed: ctx.rng.nextU32(), near: lm.id });
  }
  if (ctx.rng.chance(0.45)) {
    const s = ctx.randomS(150);
    const p = ctx.bankPoint(s, ctx.rng.sign(), -2.5);
    ctx.add({ kind: 'lore', type: 'bottle', x: p.x, z: p.z, s, radius: 3, loreSeed: ctx.rng.nextU32() });
  }
}

export { smoothstep };
