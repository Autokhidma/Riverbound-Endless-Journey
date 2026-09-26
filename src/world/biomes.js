// Biome registry: loads the data-driven biome table and pre-processes it for
// fast numeric blending during terrain generation.
import biomeData from '../data/biomes.json' with { type: 'json' };
import { hexToLinear } from '../core/math.js';

export const BIOMES = biomeData.biomes.map((b, index) => {
  const colors = {};
  for (const [k, v] of Object.entries(b.colors)) colors[k] = hexToLinear(v);
  const water = { ...b.water, shallowLin: hexToLinear(b.water.shallow), deepLin: hexToLinear(b.water.deep) };
  const atmosphere = { ...b.atmosphere, fogTintLin: hexToLinear(b.atmosphere.fogTint), skyTintLin: hexToLinear(b.atmosphere.skyTint) };
  return { ...b, index, colors, water, atmosphere };
});

export const BIOME_BY_ID = Object.fromEntries(BIOMES.map((b) => [b.id, b]));
export const BIOME_IDS = BIOMES.map((b) => b.id);
export const PUBLIC_BIOMES = BIOMES.filter((b) => !b.hidden);

export function biome(id) {
  const b = BIOME_BY_ID[id];
  if (!b) throw new Error(`Unknown biome "${id}"`);
  return b;
}

/** Numeric river/terrain parameters that are linearly blended between biomes. */
export const RIVER_KEYS = ['width', 'widthVar', 'depth', 'flow', 'meanderAmp', 'meanderScale'];
export const TERRAIN_KEYS = [
  'bankHeight', 'bankSlope', 'valleyWidth', 'hillAmp', 'mountainAmp', 'mountainStart',
  'cliffiness', 'terraces', 'plateau', 'coast', 'snowLine',
];

/** Blend numeric fields of two biome sub-objects. */
export function blendParams(a, b, t, keys, out = {}) {
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    out[k] = va + (vb - va) * t;
  }
  return out;
}

/** Breadth-first distances in the biome adjacency graph (hidden biomes excluded). */
export function biomeGraphDistances() {
  const ids = PUBLIC_BIOMES.map((b) => b.id);
  const dist = {};
  for (const src of ids) {
    const d = { [src]: 0 };
    const queue = [src];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of BIOME_BY_ID[cur].neighbors) {
        if (d[n] === undefined && BIOME_BY_ID[n] && !BIOME_BY_ID[n].hidden) {
          d[n] = d[cur] + 1;
          queue.push(n);
        }
      }
    }
    dist[src] = d;
  }
  return dist;
}
