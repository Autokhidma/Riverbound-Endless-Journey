// Generates the endless, coherent sequence of biome regions along the main
// river. Regions follow a climate adjacency graph (no jungle -> glacier jumps)
// and the main-story anchors are guaranteed to appear, in order, within their
// required region ranges for every seed.
import { RNG, hashInts, subSeed } from '../core/rng.js';
import { BIOME_BY_ID, PUBLIC_BIOMES, biomeGraphDistances } from './biomes.js';
import storyPlan from '../data/storyPlan.json' with { type: 'json' };

export const HOME_REGION_START = -600; // s where the home lake begins (river head)
const HOME_REGION_LENGTH = 1900;

export class RegionSequencer {
  constructor(seed, { anchors = storyPlan.anchors } = {}) {
    this.seed = seed;
    this.anchors = anchors;
    this.regions = [];
    this.dist = biomeGraphDistances();
    this.memo = new Map();
    this.anchorRegion = {}; // anchor id -> region index
  }

  /** Can anchors k.. be satisfied starting with biome b at region i? */
  feasible(b, i, k) {
    const anchors = this.anchors;
    if (k >= anchors.length) return true;
    const key = `${b}|${i}|${k}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const A = anchors[k];
    let ok = false;
    if (i > A.regions[1]) ok = false;
    else {
      // Option 1: place anchor k here.
      if (i >= A.regions[0] && A.biomes.includes(b)) {
        if (k + 1 >= anchors.length) ok = true;
        else ok = this.anyNext(b, i, k + 1);
      }
      // Option 2: skip.
      if (!ok && i < A.regions[1]) ok = this.anyNext(b, i, k);
    }
    this.memo.set(key, ok);
    return ok;
  }

  anyNext(b, i, k) {
    for (const n of BIOME_BY_ID[b].neighbors) {
      if (!BIOME_BY_ID[n] || BIOME_BY_ID[n].hidden) continue;
      if (this.feasible(n, i + 1, k)) return true;
    }
    return false;
  }

  /** Index of the first anchor not yet placed. */
  nextAnchorIndex() {
    for (let k = 0; k < this.anchors.length; k++) if (this.anchorRegion[this.anchors[k].id] === undefined) return k;
    return this.anchors.length;
  }

  get(i) {
    while (this.regions.length <= i) this.generateNext();
    return this.regions[i];
  }

  /** Region containing river distance s (generates as needed). */
  atS(s) {
    if (s < HOME_REGION_START) return this.get(0);
    let i = 0;
    // Ensure generated up to s.
    while (this.regions.length === 0 || this.regions[this.regions.length - 1].sEnd <= s) this.generateNext();
    let lo = 0, hi = this.regions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.regions[mid].sStart <= s) lo = mid; else hi = mid - 1;
    }
    i = lo;
    return this.regions[i];
  }

  generateNext() {
    const i = this.regions.length;
    const rng = new RNG(hashInts(subSeed(this.seed, 'region'), i));
    let biomeId;
    let anchorsHere = [];
    const k = this.nextAnchorIndex();

    if (i === 0) {
      biomeId = this.anchors[0]?.biomes[0] ?? 'spring';
      if (this.anchors[0]) anchorsHere.push(this.anchors[0]);
    } else {
      const prev = this.regions[i - 1];
      const recent = this.regions.slice(Math.max(0, i - 3), i).map((r) => r.biome);
      const candidates = BIOME_BY_ID[prev.biome].neighbors.filter((n) => BIOME_BY_ID[n] && !BIOME_BY_ID[n].hidden);
      const feasibleCands = candidates.filter((c) => this.feasible(c, i, k));
      const pool = feasibleCands.length ? feasibleCands : candidates;
      const A = this.anchors[k];
      biomeId = rng.weighted(pool, (c) => {
        let w = 1;
        if (recent.includes(c)) w *= 0.25;
        // The coast is the late reveal of the journey; keep it rare early on.
        if (c === 'coast' && i < 9 && !(A && A.biomes.includes('coast') && i >= A.regions[0])) w *= 0.04;
        if (A && i >= A.regions[0] && A.biomes.includes(c)) w *= 6;
        // Gentle climate continuity: prefer small climate jumps.
        const ca = BIOME_BY_ID[c].climate, cb = BIOME_BY_ID[prev.biome].climate;
        const jump = Math.abs(ca.temp - cb.temp) + Math.abs(ca.elev - cb.elev) + Math.abs(ca.moist - cb.moist) * 0.5;
        w *= 1.4 - Math.min(1, jump);
        return w;
      });
      // Decide whether anchor k (and possibly consecutive ones sharing a range) lands here.
      if (A && i >= A.regions[0] && i <= A.regions[1] && A.biomes.includes(biomeId)) {
        const skipFeasible = i < A.regions[1] && this.feasibleAfterSkip(biomeId, i, k);
        const placeFeasible = k + 1 >= this.anchors.length || this.anyNext(biomeId, i, k + 1);
        if (placeFeasible && (!skipFeasible || rng.chance(0.7))) anchorsHere.push(A);
      }
    }

    for (const A of anchorsHere) this.anchorRegion[A.id] = i;

    const sStart = i === 0 ? HOME_REGION_START : this.regions[i - 1].sEnd;
    const length = i === 0 ? HOME_REGION_LENGTH : Math.round(rng.range(1900, 3200));
    const b = BIOME_BY_ID[biomeId];
    const region = {
      index: i,
      biome: biomeId,
      sStart,
      sEnd: sStart + length,
      length,
      seed: hashInts(this.seed, 7919, i),
      name: this.makeName(b, rng, i),
      anchors: anchorsHere.map((a) => a.id),
      storyFeatures: anchorsHere.flatMap((a) => a.features.map((f) => ({ ...f, anchor: a.id, chapter: a.chapter }))),
      lakes: [],
      rapids: [],
      coastSide: rng.sign(),
    };
    this.planRiverFeatures(region, b, rng);
    this.regions.push(region);
    return region;
  }

  feasibleAfterSkip(b, i, k) {
    return this.anyNext(b, i, k);
  }

  makeName(b, rng, i) {
    if (i === 0) return 'Willowmere Water';
    const word = rng.pick(b.regionWords);
    const kinds = ['Reach', 'Run', 'Bend', 'Narrows', 'Water', 'Stretch', 'Flow', 'Meanders', 'Passage'];
    const kind = rng.pick(kinds);
    return `The ${word} ${kind}`;
  }

  /** Lakes and rapids are decided per region before the river is integrated. */
  planRiverFeatures(region, b, rng) {
    const r = b.river;
    const margin = 350;
    const usable = region.length - margin * 2;
    if (region.index === 0) {
      // The home lake, Willowmere, at the head of the river.
      region.lakes.push({ sc: -300, halfLen: 300, halfWidth: 150, home: true });
      return;
    }
    // Lakes
    const lakeCount = rng.chance(r.lakeChance) ? (rng.chance(r.lakeChance * 0.5) ? 2 : 1) : 0;
    for (let n = 0; n < lakeCount; n++) {
      const halfLen = rng.range(160, 420);
      const sc = region.sStart + margin + halfLen + rng.next() * Math.max(0, usable - halfLen * 2);
      if (region.lakes.some((l) => Math.abs(l.sc - sc) < l.halfLen + halfLen + 150)) continue;
      region.lakes.push({ sc, halfLen, halfWidth: rng.range(90, 230) * (b.id === 'crystal' ? 1.2 : 1) });
    }
    // Rapids
    const rapidsCount = rng.chance(r.rapidsChance) ? rng.int(1, 2) : 0;
    for (let n = 0; n < rapidsCount; n++) {
      const len = rng.range(110, 240);
      const s0 = region.sStart + margin + rng.next() * Math.max(0, usable - len);
      if (region.lakes.some((l) => s0 + len > l.sc - l.halfLen - 120 && s0 < l.sc + l.halfLen + 120)) continue;
      if (region.rapids.some((p) => Math.abs(p.s0 - s0) < 400)) continue;
      region.rapids.push({ s0, s1: s0 + len, drop: rng.range(1.2, 3.2), intensity: rng.range(0.55, 1.0) });
    }
  }

  static biomeList() {
    return PUBLIC_BIOMES.map((b) => b.id);
  }
}
