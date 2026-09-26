// Builds terrain quadtree node meshes (runs inside generation workers).
// Output is plain typed arrays so it can be transferred without copying.
import { BIOMES } from './biomes.js';
import { saturate, smoothstep, lerp } from '../core/math.js';
import { forestFactor } from './Scatter.js';

const tmpSample = {};

function toSRGB8(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Terrain colour + material weights for one vertex. */
export function terrainShade(world, smp, x, z, ny, out) {
  const A = BIOMES[smp.a], B = BIOMES[smp.b], t = smp.bt;
  const ca = A.colors, cb = B.colors;
  const n = world.detailNoise;
  const above = smp.height - smp.water;
  const slope = 1 - ny;
  const mix3 = (k, o) => { o[0] = lerp(ca[k][0], cb[k][0], t); o[1] = lerp(ca[k][1], cb[k][1], t); o[2] = lerp(ca[k][2], cb[k][2], t); return o; };
  const g1 = mix3('grass', out.c1 ??= [0, 0, 0]);
  const g2 = mix3('grass2', out.c2 ??= [0, 0, 0]);
  const vn = n.noise(x / 37, z / 37) * 0.6 + n.noise(x / 9, z / 9) * 0.4;
  const col = out.col ??= [0, 0, 0];
  const gm = saturate(vn * 0.5 + 0.5);
  for (let i = 0; i < 3; i++) col[i] = lerp(g1[i], g2[i], gm);

  // Forest floor under tree cover.
  const forest = forestFactor(world, x, z, smp);
  if (forest > 0) {
    const fl = mix3('floor', out.c3 ??= [0, 0, 0]);
    const w = forest * 0.75;
    for (let i = 0; i < 3; i++) col[i] = lerp(col[i], fl[i], w);
  }
  // Shore: sand or mud near the water line.
  const wetCoast = smp.coast;
  const shoreW = (1 - smoothstep(0.4, 1.6 + wetCoast * 1.2, above)) * (1 - smoothstep(10, 26, smp.edge));
  let sand = 0;
  if (shoreW > 0 || above < 0) {
    const muddy = (A.id === 'swamp' || A.id === 'jungle' || A.id === 'monsoon') ? 1 - t : 0;
    const muddyB = (B.id === 'swamp' || B.id === 'jungle' || B.id === 'monsoon') ? t : 0;
    const mudW = saturate(muddy + muddyB);
    const sd = mix3('sand', out.c4 ??= [0, 0, 0]);
    const md = mix3('mud', out.c5 ??= [0, 0, 0]);
    const sh = [lerp(sd[0], md[0], mudW), lerp(sd[1], md[1], mudW), lerp(sd[2], md[2], mudW)];
    const w = above < 0 ? 1 : shoreW;
    for (let i = 0; i < 3; i++) col[i] = lerp(col[i], sh[i], w);
    sand = w * (1 - mudW);
  }
  // Riverbed darkens with depth.
  if (above < 0) {
    const d = saturate(-above / 4);
    for (let i = 0; i < 3; i++) col[i] *= 1 - d * 0.45;
  }
  // Rock on steep slopes and cliffs.
  const rockW = saturate(smoothstep(0.28, 0.5, slope) + smp.cliff * smoothstep(0.15, 0.35, slope));
  if (rockW > 0) {
    const r1 = mix3('rock', out.c6 ??= [0, 0, 0]);
    const r2 = mix3('rock2', out.c7 ??= [0, 0, 0]);
    const rn = saturate(n.noise(x / 14, z / 14 + above * 0.05) * 0.5 + 0.5);
    for (let i = 0; i < 3; i++) col[i] = lerp(col[i], lerp(r1[i], r2[i], rn), rockW);
  }
  // Snow: biome snow line plus high-altitude caps in cold climates.
  let snow = 0;
  const snowLine = smp.snowLine > 0 ? smp.snowLine : 1e9;
  const capLine = lerp(520, 170, saturate((smp.cold - 0.4) / 0.6));
  snow = Math.max(smoothstep(snowLine, snowLine + 6, above + vn * 3), smoothstep(capLine, capLine + 60, above + vn * 25));
  snow *= 1 - smoothstep(0.55, 0.85, slope);
  if (snow > 0) {
    const sc = mix3('snow', out.c8 ??= [0, 0, 0]);
    for (let i = 0; i < 3; i++) col[i] = lerp(col[i], sc[i], snow);
  }
  out.rock = rockW;
  out.snow = snow;
  out.sand = sand;
  out.wet = saturate(1 - smoothstep(-0.1, 0.9, above)) * (1 - smoothstep(8, 20, smp.edge));
  out.forest = forest;
  return out;
}

/**
 * Build one terrain node.
 * @returns {{positions, normals, colors, mats, minY, maxY, x0, z0, size, res}}
 */
export function buildTerrainNode(world, { x0, z0, size, res }) {
  const d = size / res;
  const N = res + 1;
  const B = res + 3; // with 1-sample border for normals
  const H = new Float64Array(B * B);
  // Per-vertex sample fields (interior only) so each vertex is sampled once.
  const NN = N * N;
  const fA = new Uint8Array(NN), fB = new Uint8Array(NN);
  const fBt = new Float32Array(NN), fWater = new Float32Array(NN), fEdge = new Float32Array(NN);
  const fCliff = new Float32Array(NN), fCold = new Float32Array(NN), fSnow = new Float32Array(NN), fCoast = new Float32Array(NN);
  for (let j = 0; j < B; j++) {
    for (let i = 0; i < B; i++) {
      const x = x0 + (i - 1) * d, z = z0 + (j - 1) * d;
      const interior = i >= 1 && j >= 1 && i <= N && j <= N;
      if (interior) {
        const smp = world.sample(x, z, tmpSample);
        H[j * B + i] = smp.height;
        const v = (j - 1) * N + (i - 1);
        fA[v] = smp.a; fB[v] = smp.b; fBt[v] = smp.bt; fWater[v] = smp.water; fEdge[v] = smp.edge;
        fCliff[v] = smp.cliff; fCold[v] = smp.cold; fSnow[v] = smp.snowLine || 0; fCoast[v] = smp.coast || 0;
      } else {
        H[j * B + i] = world.heightAt(x, z);
      }
    }
  }
  const skirtCount = 4 * N;
  const vCount = NN + skirtCount;
  const positions = new Float32Array(vCount * 3);
  const normals = new Int8Array(vCount * 3);
  const colors = new Uint8Array(vCount * 4);
  const mats = new Uint8Array(vCount * 4);
  let minY = Infinity, maxY = -Infinity;
  const shade = {};
  const smp = {};
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const bi = (j + 1) * B + (i + 1);
      const y = H[bi];
      const x = x0 + i * d, z = z0 + j * d;
      const v = j * N + i;
      positions[v * 3] = i * d;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = j * d;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const dx = (H[bi + 1] - H[bi - 1]) / (2 * d);
      const dz = (H[bi + B] - H[bi - B]) / (2 * d);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      const nx = -dx * inv, ny = inv, nz = -dz * inv;
      normals[v * 3] = Math.round(nx * 127);
      normals[v * 3 + 1] = Math.round(ny * 127);
      normals[v * 3 + 2] = Math.round(nz * 127);
      smp.height = y; smp.a = fA[v]; smp.b = fB[v]; smp.bt = fBt[v]; smp.water = fWater[v]; smp.edge = fEdge[v];
      smp.cliff = fCliff[v]; smp.cold = fCold[v]; smp.snowLine = fSnow[v]; smp.coast = fCoast[v];
      terrainShade(world, smp, x, z, ny, shade);
      // Distant nodes: forests read as darker canopy mass.
      if (size >= 512 && shade.forest > 0) {
        const A = BIOMES[smp.a], Bb = BIOMES[smp.b];
        for (let c = 0; c < 3; c++) shade.col[c] = lerp(shade.col[c], lerp(A.colors.far[c], Bb.colors.far[c], smp.bt) * 0.75, shade.forest * 0.7);
      }
      colors[v * 4] = toSRGB8(shade.col[0]);
      colors[v * 4 + 1] = toSRGB8(shade.col[1]);
      colors[v * 4 + 2] = toSRGB8(shade.col[2]);
      colors[v * 4 + 3] = Math.round(shade.wet * 255);
      mats[v * 4] = Math.round(shade.rock * 255);
      mats[v * 4 + 1] = Math.round(shade.snow * 255);
      mats[v * 4 + 2] = Math.round(shade.sand * 255);
      mats[v * 4 + 3] = Math.round(shade.forest * 255);
    }
  }
  // Skirts hide cracks between LOD levels.
  const skirtDepth = Math.max(2, size / 24);
  let s = NN;
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i); // z = 0
  for (let i = 0; i < N; i++) edges.push(res * N + i); // z = res
  for (let j = 0; j < N; j++) edges.push(j * N); // x = 0
  for (let j = 0; j < N; j++) edges.push(j * N + res); // x = res
  for (const v of edges) {
    positions[s * 3] = positions[v * 3];
    positions[s * 3 + 1] = positions[v * 3 + 1] - skirtDepth;
    positions[s * 3 + 2] = positions[v * 3 + 2];
    normals[s * 3] = normals[v * 3]; normals[s * 3 + 1] = normals[v * 3 + 1]; normals[s * 3 + 2] = normals[v * 3 + 2];
    for (let c = 0; c < 4; c++) { colors[s * 4 + c] = colors[v * 4 + c]; mats[s * 4 + c] = mats[v * 4 + c]; }
    s++;
  }
  return { positions, normals, colors, mats, minY: minY - skirtDepth, maxY, x0, z0, size, res };
}

/** Index buffer for a node resolution (grid + skirts). Built once per res on the main thread. */
export function buildTerrainIndices(res) {
  const N = res + 1;
  const idx = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      // alternate diagonals to reduce directional artefacts
      if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
    }
  }
  const base = N * N;
  const edge = (e, i) => base + e * N + i;
  for (let i = 0; i < res; i++) {
    // z = 0 edge (outward -z)
    idx.push(i, i + 1, edge(0, i), i + 1, edge(0, i + 1), edge(0, i));
    // z = res edge (outward +z)
    const r0 = res * N + i, r1 = r0 + 1;
    idx.push(r0, edge(1, i), r1, r1, edge(1, i), edge(1, i + 1));
    // x = 0 edge (outward -x)
    const c0 = i * N, c1 = (i + 1) * N;
    idx.push(c0, edge(2, i), c1, c1, edge(2, i), edge(2, i + 1));
    // x = res edge (outward +x)
    const d0 = i * N + res, d1 = (i + 1) * N + res;
    idx.push(d0, d1, edge(3, i), d1, edge(3, i + 1), edge(3, i));
  }
  return new Uint32Array(idx);
}
