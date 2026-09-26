// WorldGen: the deterministic, seed-driven description of the whole endless
// world. Runs identically on the main thread (gameplay queries) and inside the
// generation workers (meshes). Nothing here touches the GPU.
//
// Hierarchy:
//   macro   - main river macro direction, region/biome sequence (RegionSequencer)
//   region  - lakes, rapids, tributaries, islands, settlements, landmarks
//   local   - river bends, banks, cliffs, flatten zones, fishing spots
//   micro   - vegetation scatter (see Scatter.js) and rocks
import { Noise2D } from '../core/noise.js';
import { RNG, hashInts, subSeed, normalizeSeed } from '../core/rng.js';
import { clamp, saturate, smoothstep, smin, smax, lerp } from '../core/math.js';
import { BIOMES, BIOME_BY_ID, TERRAIN_KEYS, blendParams } from './biomes.js';
import { RegionSequencer } from './RegionSequencer.js';
import { MainRiver, Tributary, DS, S_MIN } from './River.js';
import { placeRegionFeatures, placeRegionHydro } from './Features.js';

const TRANS_S = 600; // biome transition length along the river
const TRANS_U = 460; // biome transition width in macro-projection space

export class WorldGen {
  static STARWATER = BIOME_BY_ID.starwater.water;

  constructor(seed) {
    this.seed = normalizeSeed(seed);
    this.noise = new Noise2D(subSeed(this.seed, 'terrain'));
    this.detailNoise = new Noise2D(subSeed(this.seed, 'detail'));
    this.seq = new RegionSequencer(this.seed);
    this.featureCache = new Map();
    this.hydroCache = new Map();
    this._hydroList = [];
    this._zoneList = [];
    this._tmBest = {}; this._trsBest = {};
    this._m = {}; this._rs = {}; this._tm = {}; this._trs = {}; this._tp = {}; this._bl = { a: null, b: null, t: 0, region: null };
    this._blS = { a: null, b: null, t: 0 };
    this._tmpSample = {};
    this.seaLevelCache = new Map();
    this.main = new MainRiver(this.seed, this.seq, (s) => this.biomeBlendAtS(s));
  }

  // ---------------------------------------------------------------- biomes
  biomeBlendAtS(s) {
    const seq = this.seq;
    const r = seq.atS(s);
    const out = this._blS;
    out.a = BIOME_BY_ID[r.biome]; out.b = out.a; out.t = 0;
    const half = TRANS_S / 2;
    if (r.index > 0 && s - r.sStart < half) {
      const prev = seq.get(r.index - 1);
      out.a = BIOME_BY_ID[prev.biome];
      out.b = BIOME_BY_ID[r.biome];
      out.t = smoothstep(-half, half, s - r.sStart);
    } else if (r.sEnd - s < half) {
      const next = seq.get(r.index + 1);
      out.a = BIOME_BY_ID[r.biome];
      out.b = BIOME_BY_ID[next.biome];
      out.t = smoothstep(-half, half, s - r.sEnd);
    }
    return out;
  }

  regionUStart(r) {
    if (r.uStart === undefined) {
      r.uStart = r.index === 0 ? -Infinity : this.main.uAtS(r.sStart);
    }
    return r.uStart;
  }

  regionAtU(u) {
    // Ensure regions/river cover u.
    this.main.ensureU(u + TRANS_U);
    const regs = this.seq.regions;
    // regions are generated in order during river integration
    let lo = 0, hi = regs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.regionUStart(regs[mid]) <= u) lo = mid; else hi = mid - 1;
    }
    return regs[lo];
  }

  biomeBlendAtU(u) {
    const r = this.regionAtU(u);
    const out = this._bl;
    out.region = r;
    out.a = BIOME_BY_ID[r.biome]; out.b = out.a; out.t = 0;
    const half = TRANS_U / 2;
    const u0 = this.regionUStart(r);
    if (r.index > 0 && u - u0 < half) {
      const prev = this.seq.get(r.index - 1);
      out.a = BIOME_BY_ID[prev.biome];
      out.b = BIOME_BY_ID[r.biome];
      out.t = smoothstep(-half, half, u - u0);
      out.region2 = prev;
    } else {
      const next = this.seq.get(r.index + 1);
      const u1 = this.regionUStart(next);
      if (u1 - u < half) {
        out.a = BIOME_BY_ID[r.biome];
        out.b = BIOME_BY_ID[next.biome];
        out.t = smoothstep(-half, half, u - u1);
        out.region2 = next;
      } else out.region2 = null;
    }
    return out;
  }

  /** Macro coordinate (with organic warp) used for biome lookup off-river. */
  macroU(x, z) {
    return x * this.main.dir0x + z * this.main.dir0z + this.noise.noise(x / 1100, z / 1100) * 260;
  }

  /** Dominant biome and blend at a world position. */
  biomeAt(x, z) {
    const bl = this.biomeBlendAtU(this.macroU(x, z));
    return { a: bl.a, b: bl.b, t: bl.t, region: bl.region, dominant: bl.t > 0.5 ? bl.b : bl.a };
  }

  regionAtS(s) {
    return this.seq.atS(s);
  }

  // --------------------------------------------------------------- features
  // Phase A ("hydro"): tributaries + islands. Depends only on the main river
  // and on earlier regions' tributaries, so it can be computed in any order.
  regionHydro(i) {
    if (i < 0) return null;
    let h = this.hydroCache.get(i);
    if (h) return h;
    const region = this.seq.get(i);
    this.main.ensureS(region.sEnd + 3500);
    h = placeRegionHydro(this, region);
    this.hydroCache.set(i, h);
    return h;
  }

  /** Phase A features of regions around macro coordinate u. */
  hydroNearU(u, span = 2) {
    const r = this.regionAtU(u);
    const list = [];
    for (let i = Math.max(0, r.index - span); i <= r.index + span; i++) list.push(this.regionHydro(i));
    return list;
  }

  // Phase B: settlements, landmarks, spots, zones. Uses raw terrain (phase A only).
  regionFeatures(i) {
    if (i < 0) return null;
    let f = this.featureCache.get(i);
    if (f) return f;
    const region = this.seq.get(i);
    const hydro = this.regionHydro(i);
    f = placeRegionFeatures(this, region, hydro);
    this.featureCache.set(i, f);
    return f;
  }

  /** Phase B features of regions around a macro coordinate (i-span .. i+span). */
  featuresNearU(u, span = 2) {
    const r = this.regionAtU(u);
    const list = [];
    for (let i = Math.max(0, r.index - span); i <= r.index + span; i++) list.push(this.regionFeatures(i));
    return list;
  }

  tributaryById(id) {
    const m = /^trib_(\d+)$/.exec(id);
    if (!m) return null;
    return this.regionHydro(Number(m[1]))?.tributary ?? null;
  }

  seaLevel(region) {
    let v = this.seaLevelCache.get(region.index);
    if (v === undefined) {
      v = this.main.sample(region.sStart, {}).wl;
      this.seaLevelCache.set(region.index, v);
    }
    return v;
  }

  // ---------------------------------------------------------------- terrain
  /** Valley/channel profile relative to a river's water level. */
  _profile(e, halfW, depth, hw, tp, cliffMask) {
    if (e < 0) {
      const shelf = Math.min(halfW, 5 + depth * 2.2 + halfW * 0.18);
      return hw - 0.35 - (depth - 0.35) * Math.pow(saturate(-e / shelf), 0.75);
    }
    let y = hw - 0.35 + e * tp.bankSlope;
    const cl = tp.cliffiness * cliffMask;
    if (cl > 0.001) {
      const cliffStart = 3 + 7 * (1 - tp.cliffiness);
      const cliffRun = 5 + 12 * (1 - tp.cliffiness);
      const cliffH = Math.max(tp.plateau, 28 + 30 * tp.cliffiness);
      y += cl * cliffH * smoothstep(cliffStart, cliffStart + cliffRun, e);
    }
    const vh = tp.valleyWidth * 0.5;
    if (e > vh) y += Math.pow(e - vh, 1.25) * 0.25;
    return y;
  }

  /**
   * Full terrain sample. raw=true skips flatten zones (used while placing features).
   * Returns out with: height, water, edge, riverKind, s, t, a, b, bt, cold, sea, cliff, tribId
   */
  sample(x, z, out = {}, raw = false) {
    const n = this.noise;
    const m = this.main.nearest(x, z, this._m);
    const rs = this.main.sample(m.s, this._rs);
    const u = this.macroU(x, z);
    const bl = this.biomeBlendAtU(u);
    let bA = bl.a, bB = bl.b, bT = bl.t;
    const region = bl.region;

    const hwMain = rs.wl;
    const halfMain = rs.w * 0.5;
    let eMain = m.dist - halfMain;
    // Behind the head of the main river (Willowmere's headwater falls) a cliff rises.
    let headwall = 0;
    if (m.fi <= 0.001) {
      const hx = Math.cos(rs.h), hz = Math.sin(rs.h);
      const back = -((x - this.main.arr.x[0]) * hx + (z - this.main.arr.z[0]) * hz);
      if (back > 0) {
        headwall = 42 * smoothstep(halfMain * 0.3, halfMain * 0.3 + 40, back);
      }
    }

    // --- tributaries (nearest wins for water level / colouring)
    let tribBest = null, eTrib = Infinity;
    const tm = this._tmBest, trs = this._trsBest;
    let starOverride = 0;
    const hydro = this.hydroNearU(u, 2);
    for (let hi = 0; hi < hydro.length; hi++) {
      const T = hydro[hi].tributary;
      if (!T || !T.nearBBox(x, z, 900)) continue;
      const tmm = T.nearest(x, z, this._tm);
      const ts = T.sample(tmm.s, this._trs);
      const e = tmm.dist - ts.w * 0.5;
      if (e < eTrib) {
        eTrib = e;
        tribBest = T;
        Object.assign(tm, tmm);
        Object.assign(trs, ts);
      }
    }
    if (tribBest) {
      if (tribBest.biomeOverride === 'starwater') {
        starOverride = smoothstep(220, 620, tm.s) * (1 - smoothstep(420, 900, Math.max(0, eTrib)));
      }
    }
    if (starOverride > 0.001) {
      // Blend towards the hidden biome.
      const sw = BIOME_BY_ID.starwater;
      if (bT < 0.5) { bB = sw; bT = starOverride; } else { bA = sw; bT = 1 - starOverride; }
    }
    const tp = blendParams(bA.terrain, bB.terrain, bT, TERRAIN_KEYS, this._tp);

    // --- land relief (absolute)
    const hills = (n.fbm(x / 520, z / 520, 4) * 0.5 + 0.5) * tp.hillAmp;
    const mtMask = smoothstep(tp.mountainStart * 0.5, tp.mountainStart + 900, Math.min(eMain, eTrib < Infinity ? eTrib + 150 : eMain));
    const ridge = n.ridged(x / 2300 + 40, z / 2300 - 13, 5);
    const mt = Math.pow(ridge, 1.6) * tp.mountainAmp * mtMask;
    // Land is relative to the highest nearby water so tributary valleys (which
    // climb towards their source) never leave water floating above the land.
    const tribLift = tribBest ? Math.max(0, trs.wl - hwMain) * (1 - smoothstep(250, 1000, eTrib)) : 0;
    const landBase = hwMain + tribLift;
    let land = landBase + tp.bankHeight + hills + mt + n.fbm(x / 70, z / 70, 3) * 1.6;
    if (tp.plateau > 0.5) {
      let pl = tp.plateau * (0.82 + 0.36 * (n.fbm(x / 800, z / 800, 3) * 0.5 + 0.5)) + hills * 0.3;
      if (tp.terraces > 0) {
        const step = 11;
        const q = pl / step;
        const fl = Math.floor(q);
        const fr = q - fl;
        const terr = (fl + smoothstep(0.7, 1.0, fr)) * step;
        pl = lerp(pl, terr, tp.terraces);
      }
      land = Math.max(land, landBase + pl * smoothstep(0, 0.6, tp.plateau / 95));
    }

    // --- river profiles
    const side = m.t >= 0 ? 1 : -1;
    const cliffMask = smoothstep(-0.15, 0.35, n.noise(m.s / 360, side * 7.3)) * (0.35 + 0.65 * smoothstep(0.6, 1.0, tp.cliffiness)) + (tp.cliffiness > 0.95 ? 0.65 : 0);
    let profMain = this._profile(eMain, halfMain, rs.dp, hwMain, tp, Math.min(1, cliffMask)) + headwall;
    const marginMain = 14 + rs.w * 0.12;
    let inside = 1 - smoothstep(marginMain - 6, marginMain, eMain);
    let floorLevel = hwMain + 0.3;

    // Rapids: rocks breaking the surface.
    if (rs.rp > 0.08 && eMain < 2) {
      const rk = this.detailNoise.noise(x / 4.5, z / 4.5) - 0.55;
      if (rk > 0) profMain = Math.max(profMain, hwMain - 0.9 + rk * 4.5 * rs.rp);
    }

    let hw = hwMain, edge = eMain, riverKind = 'main';
    let riverProf = profMain;
    if (tribBest) {
      const halfT = trs.w * 0.5;
      let pT = this._profile(eTrib, halfT, trs.dp, trs.wl, tp, Math.min(1, cliffMask));
      if (tm.s >= tribBest.length - 0.5 && tribBest.headwall > 0) {
        // The tributary's heading h points upstream (towards its source).
        const end = tribBest.endState;
        const fwd = (x - end.x) * Math.cos(end.h) + (z - end.z) * Math.sin(end.h);
        if (fwd > 0) pT += tribBest.headwall * smoothstep(halfT * 0.2, halfT * 0.2 + 16, fwd);
      }
      riverProf = smin(profMain, pT, 6);
      const marginT = 12 + trs.w * 0.12;
      inside = Math.max(inside, 1 - smoothstep(marginT - 6, marginT, eTrib));
      if (eTrib < 250) floorLevel = Math.max(floorLevel, trs.wl + 0.3);
      if (eTrib < eMain) {
        hw = trs.wl; edge = eTrib; riverKind = 'trib';
      }
    }

    let y = smin(land, riverProf, 5);
    let minAllowed = floorLevel - 80 * inside;

    // --- coast: the sea side of coastal regions drops to the sea floor
    let sea = 0;
    if (tp.coast > 0.01) {
      const cReg = (bl.region.biome === 'coast' || !bl.region2 || bl.region2.biome !== 'coast') ? bl.region : bl.region2;
      const coastSide = cReg.coastSide ?? 1;
      const seaLvl = this.seaLevel(cReg);
      if (side === coastSide && eMain > 0) {
        const barrier = 150 + 70 * n.noise(m.s / 700, 3.3);
        const inlet = smoothstep(0.25, 0.45, n.noise(m.s / 520, 8.1)) * (1 - smoothstep(barrier + 40, barrier + 90, eMain));
        const seaMask = smoothstep(barrier, barrier + 70, eMain) * tp.coast;
        const dune = hwMain + 0.6 + Math.max(0, n.fbm(x / 45, z / 45, 3)) * 2.2;
        let yc = Math.min(y, dune);
        yc = lerp(yc, seaLvl - 1.8, inlet * tp.coast);
        const floor = seaLvl - 3 - Math.min(22, (eMain - barrier) * 0.035) + Math.max(0, n.ridged(x / 260, z / 260, 3) - 0.62) * 40;
        y = lerp(lerp(y, yc, tp.coast), floor, seaMask);
        sea = Math.max(seaMask, inlet * tp.coast);
        minAllowed = lerp(minAllowed, -1e9, Math.min(1, sea * 3));
      }
    }

    // --- islands (bumps inside wide water)
    for (let hi = 0; hi < hydro.length; hi++) {
      for (const isl of hydro[hi].islands) {
        const dx = x - isl.x, dz = z - isl.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < isl.r * isl.r) {
          const k = 1 - Math.sqrt(d2) / isl.r;
          const bump = isl.base + isl.h * Math.pow(k, 0.7) + this.detailNoise.fbm(x / 20, z / 20, 2) * 0.8 * k;
          y = smax(y, bump, 1.5);
        }
      }
    }

    y = Math.max(y, minAllowed);

    // --- flatten/carve zones from settlements, landmarks, coves
    if (!raw) {
      const feats = this.featuresNearU(u, 1);
      for (const f of feats) {
        for (const zn of f.zones) {
          const dx = x - zn.x, dz = z - zn.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < zn.r1 * zn.r1) {
            const w = 1 - smoothstep(zn.r0, zn.r1, Math.sqrt(d2));
            if (zn.mode === 'carve') y = Math.min(y, lerp(y, zn.h, w));
            else if (zn.mode === 'raise') y = Math.max(y, lerp(y, zn.h, w));
            else y = lerp(y, zn.h, w);
          }
        }
      }
    }

    out.height = y;
    out.water = hw;
    out.edge = edge;
    out.riverKind = riverKind;
    out.tribId = tribBest ? tribBest.id : null;
    out.s = m.s;
    out.t = m.t;
    out.a = bA.index;
    out.b = bB.index;
    out.bt = bT;
    out.cold = 1 - lerp(bA.climate.temp, bB.climate.temp, bT);
    out.sea = sea;
    out.cliff = tp.cliffiness * Math.min(1, cliffMask);
    out.snowLine = tp.snowLine;
    out.coast = tp.coast;
    return out;
  }

  heightAt(x, z) {
    return this.sample(x, z, this._tmpSample).height;
  }

  /** Water surface level (without waves) at a position, or null if none nearby. */
  waterInfo(x, z, out = {}) {
    const smp = this.sample(x, z, this._tmpSample);
    out.level = smp.water;
    out.height = smp.height;
    out.depth = smp.water - smp.height;
    out.edge = smp.edge;
    out.riverKind = smp.riverKind;
    out.tribId = smp.tribId;
    out.s = smp.s;
    out.t = smp.t;
    out.sea = smp.sea;
    return out;
  }

  /** Current (flow) velocity vector of the water at a position. */
  flowAt(x, z, out = { x: 0, z: 0, speed: 0 }) {
    const m = this.main.nearest(x, z, this._m);
    const rs = this.main.sample(m.s, this._rs);
    let halfW = rs.w * 0.5;
    let e = m.dist;
    let speed = rs.fl;
    let h = rs.h;
    // Tributary wins if closer.
    const u = this.macroU(x, z);
    for (const f of this.featuresNearU(u, 2)) {
      const T = f.tributary;
      if (!T || !T.nearBBox(x, z, 200)) continue;
      const tmm = T.nearest(x, z, this._tm);
      const ts = T.sample(tmm.s, this._trs);
      if (tmm.dist - ts.w * 0.5 < e - halfW) {
        halfW = ts.w * 0.5; e = tmm.dist; speed = ts.fl; h = ts.h + Math.PI; // tributary flows toward junction
      }
    }
    const profile = 1 - 0.7 * Math.pow(saturate(e / Math.max(1, halfW)), 2);
    const sp = speed * Math.max(0, profile);
    out.x = Math.cos(h) * sp;
    out.z = Math.sin(h) * sp;
    out.speed = sp;
    return out;
  }

  /** Main-river frame at arc length s: position, heading, width etc. */
  riverAt(s, out = {}) {
    return this.main.sample(s, out);
  }

  /** Convert river coordinates (s, lateral t) to world x/z on the main river. */
  riverToWorld(s, t, out = {}) {
    const r = this.main.sample(s, {});
    out.x = r.x - Math.sin(r.h) * t;
    out.z = r.z + Math.cos(r.h) * t;
    out.h = r.h;
    out.water = r.wl;
    out.w = r.w;
    return out;
  }

  /** All features within radius of a world position (from nearby regions). */
  featuresNear(x, z, radius, kinds = null) {
    const res = [];
    const u = this.macroU(x, z);
    for (const f of this.featuresNearU(u, 2)) {
      for (const it of f.items) {
        if (kinds && !kinds.includes(it.kind)) continue;
        const d = Math.hypot(it.x - x, it.z - z);
        if (d <= radius + (it.radius || 0)) res.push(it);
      }
    }
    return res;
  }

  /** Iterate all features of regions 0..maxRegion (for maps, story lookups). */
  findFeature(predicate, maxRegion = 40) {
    for (let i = 0; i <= maxRegion; i++) {
      const f = this.regionFeatures(i);
      if (!f) continue;
      const it = f.items.find(predicate);
      if (it) return it;
    }
    return null;
  }

  describe() {
    return {
      seed: this.seed,
      theta0: this.main.theta0,
      regions: this.seq.regions.map((r) => ({ i: r.index, biome: r.biome, name: r.name, s: [r.sStart, r.sEnd], anchors: r.anchors })),
    };
  }
}

export { DS, S_MIN, TRANS_S, TRANS_U, BIOMES, Tributary, RNG, hashInts, subSeed, clamp };
