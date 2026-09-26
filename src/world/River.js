// River centre-lines: the endless main river and finite tributaries.
// The main river is integrated incrementally along its arc length s. Its
// heading is soft-clamped around a macro direction so the river never loops
// back on itself; this makes the projection u = p . dir0 strictly increasing
// with s, which gives O(log n) nearest-point queries at any distance.
import { Noise2D } from '../core/noise.js';
import { subSeed } from '../core/rng.js';
import { softClamp, smoothstep, clamp } from '../core/math.js';
import { RIVER_KEYS, blendParams } from './biomes.js';
import { HOME_REGION_START } from './RegionSequencer.js';

export const DS = 8; // metres between river control points
export const S_MIN = HOME_REGION_START;
const FIELDS = ['x', 'z', 'h', 'w', 'wl', 'fl', 'dp', 'rp', 'u', 'lk'];

class Growable {
  constructor(cap = 4096) {
    this.len = 0;
    for (const f of FIELDS) this[f] = new Float64Array(cap);
    this.cap = cap;
  }
  grow() {
    const cap = this.cap * 2;
    for (const f of FIELDS) {
      const a = new Float64Array(cap);
      a.set(this[f]);
      this[f] = a;
    }
    this.cap = cap;
  }
  push(vals) {
    if (this.len >= this.cap) this.grow();
    const i = this.len++;
    for (const f of FIELDS) this[f][i] = vals[f];
    return i;
  }
}

/** Shared sampling of a polyline river at fractional index. */
function sampleArrays(arr, fi, out) {
  const n = arr.len;
  if (fi <= 0) fi = 0;
  if (fi >= n - 1) fi = n - 1.000001;
  const i = Math.floor(fi);
  const f = fi - i;
  for (const k of FIELDS) out[k] = arr[k][i] + (arr[k][i + 1] - arr[k][i]) * f;
  // heading interpolated through angle difference
  let dh = arr.h[i + 1] - arr.h[i];
  if (dh > Math.PI) dh -= Math.PI * 2;
  if (dh < -Math.PI) dh += Math.PI * 2;
  out.h = arr.h[i] + dh * f;
  return out;
}

export class MainRiver {
  constructor(seed, sequencer, biomeBlendAtS) {
    this.seed = seed;
    this.seq = sequencer;
    this.blendAtS = biomeBlendAtS; // (s) => { a, b, t }
    this.noise = new Noise2D(subSeed(seed, 'river'));
    this.arr = new Growable(8192);
    const n = this.noise;
    // Macro direction: roughly west-south-west so sunsets often sit ahead.
    this.theta0 = Math.PI - 0.3 + n.noise1(0.37, 9) * 0.35;
    this.dir0x = Math.cos(this.theta0);
    this.dir0z = Math.sin(this.theta0);
    this.phase = 0;
    this._p = {};
    this._first();
  }

  _first() {
    const s = S_MIN;
    this._state = { x: 0, z: 0, wl: 40 };
    this._integrate(s, true);
  }

  get sMax() {
    return S_MIN + (this.arr.len - 1) * DS;
  }

  get uMax() {
    return this.arr.u[this.arr.len - 1];
  }

  ensureS(s) {
    while (this.sMax < s) this._integrate(this.sMax + DS, false);
  }

  ensureU(u) {
    while (this.uMax < u) this._integrate(this.sMax + DS, false);
  }

  _riverFeatures(s) {
    const region = this.seq.atS(s);
    let lakeW = 0, lk = 0, rp = 0, rpDrop = 0;
    for (const L of region.lakes) {
      const d = (s - L.sc) / L.halfLen;
      if (d > -1 && d < 1) {
        const shape = Math.sqrt(1 - d * d);
        const w = L.halfWidth * 2 * shape;
        if (w > lakeW) { lakeW = w; lk = smoothstep(0, 0.5, shape); }
      }
    }
    for (const R of region.rapids) {
      const f = smoothstep(R.s0 - 40, R.s0 + 30, s) * (1 - smoothstep(R.s1 - 30, R.s1 + 40, s));
      if (f > 0) {
        rp = Math.max(rp, f * R.intensity);
        rpDrop += f * R.drop / (R.s1 - R.s0);
      }
    }
    return { lakeW, lk, rp, rpDrop };
  }

  _integrate(s, first) {
    const n = this.noise;
    const blend = this.blendAtS(s);
    const p = blendParams(blend.a.river, blend.b.river, blend.t, RIVER_KEYS, this._p);
    const feat = this._riverFeatures(s);
    let baseW = p.width * (1 + p.widthVar * n.noise1(s / 700, 1));
    baseW *= smoothstep(S_MIN - 10, S_MIN + 380, s) * 0.85 + 0.15; // river head narrows into the lake
    const w = Math.max(baseW * (1 - 0.3 * feat.rp), feat.lakeW);
    const depth = p.depth * (1 + 0.6 * feat.lk) * (1 - 0.45 * feat.rp);
    const flow = p.flow * clamp(Math.sqrt(p.width / Math.max(w, 1)), 0.25, 1.2) + feat.rp * 2.2;

    const lambda = Math.max(p.meanderScale * Math.max(baseW, 18), 380);
    if (!first) this.phase += DS / lambda;
    const ph = this.phase;
    const fadeIn = smoothstep(S_MIN + 500, S_MIN + 1400, s);
    const meander = p.meanderAmp * (0.75 * Math.sin(Math.PI * 2 * ph + 1.7 * n.noise1(ph * 0.35, 2)) + 0.35 * n.noise1(ph * 1.7 + 11, 3));
    const macro = 0.6 * n.noise1(s / 9000, 4) + 0.3 * n.noise1(s / 3100 + 7, 5);
    const heading = this.theta0 + softClamp(macro + meander * fadeIn * (1 - 0.7 * feat.lk), 1.3);

    const st = this._state;
    if (!first) {
      const prevH = this.arr.h[this.arr.len - 1];
      const hm = (heading + prevH) * 0.5;
      st.x += Math.cos(hm) * DS;
      st.z += Math.sin(hm) * DS;
      st.wl -= DS * (0.00035 + feat.rpDrop);
    }
    this.arr.push({
      x: st.x, z: st.z, h: heading, w, wl: st.wl, fl: flow, dp: depth, rp: feat.rp,
      u: st.x * this.dir0x + st.z * this.dir0z, lk: feat.lk,
    });
  }

  /** Interpolated river state at arc length s. */
  sample(s, out = {}) {
    if (s > this.sMax - DS) this.ensureS(s + DS * 4);
    const fi = (s - S_MIN) / DS;
    sampleArrays(this.arr, fi, out);
    out.s = s;
    return out;
  }

  uAtS(s) {
    return this.sample(s, {}).u;
  }

  /** Arc length s where projection u is reached (monotonic inverse). */
  sAtU(u) {
    this.ensureU(u + 50);
    const a = this.arr;
    let lo = 0, hi = a.len - 1;
    if (u <= a.u[0]) return S_MIN;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a.u[mid] < u) lo = mid; else hi = mid;
    }
    const f = (u - a.u[lo]) / Math.max(1e-9, a.u[hi] - a.u[lo]);
    return S_MIN + (lo + f) * DS;
  }

  _indexAtU(u) {
    const a = this.arr;
    let lo = 0, hi = a.len - 1;
    if (u <= a.u[0]) return 0;
    if (u >= a.u[hi]) return hi;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a.u[mid] < u) lo = mid; else hi = mid;
    }
    return lo;
  }

  /**
   * Nearest point on the centre-line.
   * out: { s, t (signed lateral offset), dist, i }
   */
  nearest(x, z, out = {}) {
    const up = x * this.dir0x + z * this.dir0z;
    this.ensureU(up + 1200);
    const a = this.arr;
    const i0 = this._indexAtU(up);
    let best = i0;
    let bestD2 = (a.x[i0] - x) ** 2 + (a.z[i0] - z) ** 2;
    const d0 = Math.sqrt(bestD2);
    const iLo = this._indexAtU(up - d0 - DS);
    const iHi = Math.min(a.len - 1, this._indexAtU(up + d0 + DS) + 1);
    const span = iHi - iLo;
    const stride = Math.max(1, Math.floor(span / 40));
    for (let i = iLo; i <= iHi; i += stride) {
      const d2 = (a.x[i] - x) ** 2 + (a.z[i] - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    if (stride > 1) {
      const lo = Math.max(0, best - stride), hi = Math.min(a.len - 1, best + stride);
      for (let i = lo; i <= hi; i++) {
        const d2 = (a.x[i] - x) ** 2 + (a.z[i] - z) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
    }
    return projectOnPolyline(a, best, x, z, S_MIN, out);
  }
}

/** Refine nearest index to an exact projection on neighbouring segments. */
function projectOnPolyline(a, best, x, z, s0, out) {
  let bestD2 = Infinity, bestFi = best, bestT = 0;
  for (let j = Math.max(0, best - 1); j <= Math.min(a.len - 2, best); j++) {
    const ax = a.x[j], az = a.z[j];
    const bx = a.x[j + 1] - ax, bz = a.z[j + 1] - az;
    const len2 = bx * bx + bz * bz;
    let f = len2 > 0 ? ((x - ax) * bx + (z - az) * bz) / len2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const px = ax + bx * f, pz = az + bz * f;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestFi = j + f;
      const len = Math.sqrt(len2) || 1;
      // signed lateral offset: + is to the left of flow direction (normal = (-tz, tx))
      bestT = ((x - px) * (-bz / len) + (z - pz) * (bx / len));
    }
  }
  if (a.len === 1) {
    bestD2 = (x - a.x[0]) ** 2 + (z - a.z[0]) ** 2;
    bestFi = 0;
  }
  const dist = Math.sqrt(bestD2);
  // Beyond the ends of the polyline the distance is radial; keep the sign.
  out.fi = bestFi;
  out.s = s0 + bestFi * DS;
  out.dist = dist;
  out.t = bestT === 0 ? dist : Math.sign(bestT) * dist;
  out.i = best;
  return out;
}

/**
 * A finite tributary. Generated from its junction with the main river going
 * upstream (towards its source), so its "s" is distance from the junction.
 */
export class Tributary {
  constructor(def, points) {
    Object.assign(this, def); // id, regionIndex, junctionS, side, endType, biomeOverride...
    const a = new Growable(Math.max(16, points.length));
    for (const p of points) a.push(p);
    this.arr = a;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < a.len; i++) {
      minX = Math.min(minX, a.x[i]); maxX = Math.max(maxX, a.x[i]);
      minZ = Math.min(minZ, a.z[i]); maxZ = Math.max(maxZ, a.z[i]);
    }
    this.bbox = { minX, minZ, maxX, maxZ };
    this.length = (a.len - 1) * DS;
  }

  get sMax() {
    return this.length;
  }

  sample(s, out = {}) {
    sampleArrays(this.arr, s / DS, out);
    out.s = s;
    return out;
  }

  nearBBox(x, z, pad) {
    const b = this.bbox;
    return x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
  }

  nearest(x, z, out = {}) {
    const a = this.arr;
    let best = 0, bestD2 = Infinity;
    const stride = 4;
    for (let i = 0; i < a.len; i += stride) {
      const d2 = (a.x[i] - x) ** 2 + (a.z[i] - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    const lo = Math.max(0, best - stride), hi = Math.min(a.len - 1, best + stride);
    for (let i = lo; i <= hi; i++) {
      const d2 = (a.x[i] - x) ** 2 + (a.z[i] - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return projectOnPolyline(a, best, x, z, 0, out);
  }
}
