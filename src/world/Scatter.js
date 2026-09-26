// Vegetation / rock scatter (runs in generation workers). Contextual rules:
// each biome lists species with zones (water, shore, bank, land, any), cluster
// noise for natural groves and clearings, slope limits, and exclusion around
// settlements and landmarks. Transitions mix species of both biomes.
import { BIOMES } from './biomes.js';
import { RNG, hashInts, hashString } from '../core/rng.js';
import { hexToLinear, saturate, smoothstep } from '../core/math.js';

const TREE_IDS = new Set(['tree_broadleaf', 'tree_willow', 'tree_cherry', 'tree_maple', 'tree_birch', 'tree_pine', 'tree_pine_snow', 'tree_jungle', 'tree_palm', 'tree_cypress', 'tree_dead', 'tree_mangrove', 'bamboo']);

// Per-species colour variation palettes (multipliers over the model's vertex colours).
const TINT_PALETTES = {
  tree_maple: ['#ffffff', '#ffb89c', '#fff2a8', '#ffd0a0', '#ff9c8c'],
  tree_cherry: ['#ffffff', '#fff0f6', '#ffd8e8'],
  tree_birch: ['#ffffff', '#fff4c0'],
  flowers: ['#ffffff', '#ffd0e0', '#d0d8ff', '#fff0a0', '#ffc0a0'],
  bush_flower: ['#ffffff', '#ffd0e0', '#e0d0ff'],
  glow_plant: ['#ffffff', '#c0f0ff', '#e0c8ff'],
  mushroom_glow: ['#ffffff', '#c8ffe8', '#d8c8ff'],
};
const PALETTE_LIN = Object.fromEntries(Object.entries(TINT_PALETTES).map(([k, v]) => [k, v.map(hexToLinear)]));
const tintCache = new Map();
function tintLin(hex) {
  let t = tintCache.get(hex);
  if (!t) { t = hexToLinear(hex); tintCache.set(hex, t); }
  return t;
}
const offsetCache = new Map();
function speciesOffset(id) {
  let o = offsetCache.get(id);
  if (o === undefined) { o = (hashString(id) % 10000) * 0.731; offsetCache.set(id, o); }
  return o;
}

/** Cluster noise for a vegetation entry, in [-1, 1]. */
function clusterNoise(world, v, x, z) {
  const off = speciesOffset(v.id);
  return world.detailNoise.noise(x * v.cluster + off, z * v.cluster - off * 0.37);
}

/** 0..1 tree cover at a point (used to tint the forest floor and far terrain). */
export function forestFactor(world, x, z, smp) {
  const above = smp.height - smp.water;
  if (above < 0.5) return 0;
  let total = 0;
  for (const [bi, w] of [[smp.a, 1 - smp.bt], [smp.b, smp.bt]]) {
    if (w <= 0.01) continue;
    const B = BIOMES[bi];
    let best = 0;
    for (const v of B.vegetation) {
      if (!TREE_IDS.has(v.id) || v.zone === 'water') continue;
      const c = clusterNoise(world, v, x, z) - v.clusterMin;
      const f = saturate(c * 2.2) * saturate(v.density / 0.45);
      if (f > best) best = f;
    }
    total += best * w;
  }
  return total;
}

/**
 * Scatter vegetation for a square cell.
 * @param {object} opt { x0, z0, size, small, density, smallDensity }
 * @returns {{ species: Record<string, Float32Array>, count: number }}
 */
export function buildScatter(world, { x0, z0, size, small, density = 1, smallDensity = 1 }) {
  const rng = new RNG(hashInts(world.seed, Math.floor(x0), Math.floor(z0), small ? 1 : 0));
  const cx = x0 + size / 2, cz = z0 + size / 2;
  const bl = world.biomeAt(cx, cz);
  const u = world.macroU(cx, cz);
  const feats = world.featuresNearU(u, 1);
  const zones = [];
  for (const f of feats) {
    for (const zn of f.zones) {
      if (Math.abs(zn.x - cx) < size + zn.r1 && Math.abs(zn.z - cz) < size + zn.r1) zones.push(zn);
    }
  }
  const out = {};
  const smp = {};
  let total = 0;
  const pairs = [[bl.a, 1 - bl.t], [bl.b, bl.t]];
  // Starwater tributary override: include its species near the hidden river.
  const s0 = world.sample(cx, cz, smp);
  if (s0.a !== bl.a.index && s0.a !== bl.b.index) pairs.push([BIOMES[s0.a], 1 - s0.bt]);
  if (s0.b !== bl.a.index && s0.b !== bl.b.index) pairs.push([BIOMES[s0.b], s0.bt]);
  for (const [B, weight] of pairs) {
    if (weight < 0.02) continue;
    for (const v of B.vegetation) {
      if (!!v.small !== !!small) continue;
      const dens = v.density * (small ? smallDensity : density);
      const expected = dens * (size * size) / 100 * weight;
      let count = Math.floor(expected);
      if (rng.next() < expected - count) count++;
      if (count === 0) continue;
      const arr = [];
      const pal = PALETTE_LIN[v.id];
      const baseTint = v.tint ? tintLin(v.tint) : null;
      for (let k = 0; k < count; k++) {
        const x = x0 + rng.next() * size;
        const z = z0 + rng.next() * size;
        const r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
        if (clusterNoise(world, v, x, z) < v.clusterMin) continue;
        world.sample(x, z, smp);
        // Biome membership at the point (transition mixing).
        const wB = smp.a === B.index ? 1 - smp.bt : smp.b === B.index ? smp.bt : 0;
        if (r1 > wB * 1.15) continue;
        const above = smp.height - smp.water;
        const depth = -above;
        let y = smp.height;
        switch (v.zone) {
          case 'water':
            if (depth < 0.1 || depth > (v.id === 'reeds' ? 0.8 : 1.4) || smp.sea > 0.3) continue;
            if (v.id === 'lilypad') y = smp.water + 0.015;
            break;
          case 'shore':
            if (above < -0.25 || above > 1.3 || smp.edge > 16) continue;
            break;
          case 'bank':
            if (above < 0.35 || above > 7 || smp.edge > 45 || smp.edge < 1) continue;
            break;
          case 'land':
            if (above < 0.6) continue;
            break;
          case 'any':
          default:
            if (depth > (v.maxDepth ?? 0.25)) continue;
            break;
        }
        if (v.maxDepth !== undefined && depth > v.maxDepth) continue;
        if (smp.sea > 0.5 && v.zone !== 'water') continue;
        if (v.maxSlope !== undefined && v.maxSlope < 2) {
          const hx = world.heightAt(x + 1.2, z) - smp.height;
          const hz = world.heightAt(x, z + 1.2) - smp.height;
          const slope = Math.sqrt(hx * hx + hz * hz) / 1.2;
          if (slope > v.maxSlope) continue;
        }
        // Exclusion around settlements and landmarks.
        let blocked = false;
        for (const zn of zones) {
          const dd = Math.hypot(x - zn.x, z - zn.z);
          if (small) { if (dd < zn.r0 * 0.6 && r2 < 0.8) { blocked = true; break; } }
          else if (dd < zn.r1 * 0.95) { blocked = true; break; }
        }
        if (blocked) continue;
        const scale = v.scale[0] + (v.scale[1] - v.scale[0]) * r3;
        let tr = 1, tg = 1, tb = 1;
        if (pal) { const c = pal[Math.floor(r4 * pal.length) % pal.length]; tr = c[0]; tg = c[1]; tb = c[2]; }
        if (baseTint) { tr *= baseTint[0] * 1.6; tg *= baseTint[1] * 1.6; tb *= baseTint[2] * 1.6; }
        const bright = 0.86 + r2 * 0.28;
        arr.push(x - x0, y, z - z0, r4 * Math.PI * 2, scale, tr * bright, tg * bright, tb * bright);
      }
      if (arr.length) {
        const prev = out[v.id];
        if (prev) {
          const merged = new Float32Array(prev.length + arr.length);
          merged.set(prev); merged.set(arr, prev.length);
          out[v.id] = merged;
        } else out[v.id] = new Float32Array(arr);
        total += arr.length / 8;
      }
    }
  }
  return { species: out, count: total, x0, z0, size };
}

export { TREE_IDS };
