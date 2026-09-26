// Data-driven riverside economy. Prices depend on the item's base value,
// where it comes from relative to the settlement (local goods are cheap,
// far-travelled goods are prized), local supply/demand (selling a lot of one
// thing lowers its price, recovering over time), fish size and your
// friendship with the settlement.
import { ITEMS, FISH, itemDef } from './GameState.js';
import { RESOURCES_BY_BIOME } from '../world/Features.js';
import { BIOME_BY_ID, biomeGraphDistances } from '../world/biomes.js';
import { RNG, hashString } from '../core/rng.js';

const DIST = biomeGraphDistances();
const ORIGIN = {};
for (const [biome, list] of Object.entries(RESOURCES_BY_BIOME)) for (const id of list) (ORIGIN[id] ??= []).push(biome);

/** Home biomes of an item or fish (empty = found everywhere). */
export function originBiomes(id) {
  if (FISH[id]) return FISH[id].biomes.includes('any') ? [] : FISH[id].biomes;
  return ORIGIN[id] ?? [];
}

/** 0.8 for local goods, up to ~1.45 for goods from far-away climates. */
export function locationFactor(id, settlementBiome) {
  const origins = originBiomes(id);
  if (!origins.length || !settlementBiome) return 1;
  if (origins.includes(settlementBiome)) return 0.8;
  let best = 99;
  for (const o of origins) best = Math.min(best, DIST[settlementBiome]?.[o] ?? 4);
  if (origins.includes('starwater')) best = 4;
  return Math.min(1.45, 0.9 + best * 0.14);
}

export function fishSizeFactor(id, size) {
  const f = FISH[id];
  if (!f || !size) return 1;
  const avg = (f.size[0] + f.size[1]) / 2;
  return Math.max(0.6, Math.min(1.8, Math.pow(size / avg, 1.2)));
}

export class Economy {
  constructor(state, time) {
    this.state = state;
    this.time = time; // TimeOfDay-like { totalDays }
  }

  settlementState(settlementId) {
    return (this.state.settlements[settlementId] ??= { supply: {}, stockDay: -1, stock: {}, visits: 0, friendship: 0 });
  }

  /** Decay supply (demand recovers) by elapsed in-game time. */
  recover(settlementId) {
    const s = this.settlementState(settlementId);
    const now = this.time?.totalDays ?? 0;
    const last = s.lastRecover ?? now;
    const elapsed = now - last;
    if (elapsed > 0) {
      for (const k of Object.keys(s.supply)) {
        s.supply[k] = Math.max(0, s.supply[k] - elapsed * 6);
        if (s.supply[k] === 0) delete s.supply[k];
      }
    }
    s.lastRecover = now;
  }

  sellPrice(id, settlement, meta = {}) {
    const def = itemDef(id);
    if (!def || def.category === 'quest' || def.unique) return 0;
    const s = this.settlementState(settlement.id);
    const base = def.value * (def.kind === 'fish' ? fishSizeFactor(id, meta.size) : 1);
    const loc = locationFactor(id, settlement.biome);
    const supply = s.supply[id] ?? 0;
    const demand = Math.max(0.45, 1 / (1 + supply * 0.09));
    const friend = 1 + Math.min(0.1, (s.friendship ?? 0) * 0.01);
    return Math.max(1, Math.round(base * loc * demand * friend));
  }

  buyPrice(id, settlement) {
    const def = itemDef(id);
    if (!def) return 0;
    const s = this.settlementState(settlement.id);
    const loc = locationFactor(id, settlement.biome);
    const friend = 1 - Math.min(0.1, (s.friendship ?? 0) * 0.01);
    return Math.max(1, Math.round(def.value * 1.3 * (0.6 + loc * 0.5) * friend));
  }

  /** Record a sale (raises local supply, lowering the next price). */
  recordSale(id, settlement, n = 1) {
    const s = this.settlementState(settlement.id);
    s.supply[id] = (s.supply[id] ?? 0) + n;
    s.friendship = Math.min(10, (s.friendship ?? 0) + 0.05 * n);
  }

  /** Trader stock for a settlement, restocked once per in-game day. */
  stock(settlement) {
    const s = this.settlementState(settlement.id);
    const day = Math.floor(this.time?.totalDays ?? 0);
    if (s.stockDay === day && s.stock) return s.stock;
    const rng = new RNG(hashString(`${settlement.id}:${day}`));
    const stock = { bait_worms: 20, river_tea: 4, honey_cake: 3 };
    if (rng.chance(0.7)) stock.glow_bait = 8;
    // Imports: a few goods from other climates.
    const biomes = Object.keys(RESOURCES_BY_BIOME).filter((b) => b !== settlement.biome && b !== 'starwater');
    for (let i = 0; i < 3; i++) {
      const b = rng.pick(biomes);
      const it = rng.pick(RESOURCES_BY_BIOME[b]);
      stock[it] = (stock[it] ?? 0) + rng.int(2, 5);
    }
    if (settlement.shipwright) {
      stock.driftwood = (stock.driftwood ?? 0) + 6;
      stock.pine_resin = (stock.pine_resin ?? 0) + 3;
      const paints = ['paint_teal', 'paint_rose', 'paint_moss', 'paint_night'];
      stock[rng.pick(paints)] = 1;
    }
    if (rng.chance(0.3)) stock.old_coin = 1;
    s.stock = stock;
    s.stockDay = day;
    return stock;
  }

  /** Is this item something the trader will buy? */
  buys(id) {
    const def = itemDef(id);
    return !!def && def.category !== 'quest' && !def.unique && def.value > 0;
  }
}

export { ITEMS, BIOME_BY_ID };
