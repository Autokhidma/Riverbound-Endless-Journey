// Runtime-generated textures (no external image assets): tileable detail noise,
// water normal map, foam, wood planks, canvas cloth. All tile seamlessly so
// they stay continuous under the 2048 m floating-origin shifts.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

/** Periodic value noise on a size x size torus. */
function periodicNoise(size, period, rng) {
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, fy = (y / size) * period;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const x0 = ix % period, x1 = (ix + 1) % period, y0 = iy % period, y1 = (iy + 1) % period;
      const a = lat[y0 * period + x0], b = lat[y0 * period + x1], c = lat[y1 * period + x0], d = lat[y1 * period + x1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

function fbmPeriodic(size, basePeriod, octaves, rng, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(size, period, rng);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= gain; period *= 2;
    if (period > size) break;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Tileable Worley (cellular) noise: distance to nearest feature point. */
function worleyPeriodic(size, cells, rng) {
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rng.next()) / cells, (j + rng.next()) / cells]);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / size, py = y / size;
      const ci = Math.floor(px * cells), cj = Math.floor(py * cells);
      let d1 = 9, d2 = 9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
          const p = pts[jj * cells + ii];
          let dx = p[0] - px, dy = p[1] - py;
          dx -= Math.round(dx); dy -= Math.round(dy);
          const d = Math.sqrt(dx * dx + dy * dy) * cells;
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      out[y * size + x] = Math.min(1, d2 - d1);
    }
  }
  return out;
}

function dataTexture(data, size, { repeat = true, mip = true, format = THREE.RGBAFormat, colorSpace = THREE.NoColorSpace } = {}) {
  const tex = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mip;
  tex.anisotropy = 4;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

let cache = null;

export function getTextures() {
  if (cache) return cache;
  const rng = new RNG(1337);
  cache = {
    detail: makeDetail(rng),
    waterNormal: makeWaterNormal(rng),
    foam: makeFoam(rng),
    wood: makeWood(rng),
    canvas: makeCanvasCloth(rng),
  };
  return cache;
}

function makeDetail(rng) {
  const S = 256;
  const a = fbmPeriodic(S, 4, 5, rng);
  const b = fbmPeriodic(S, 16, 3, rng);
  const c = worleyPeriodic(S, 12, rng);
  const d = fbmPeriodic(S, 64, 2, rng);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = a[i] * 255;
    data[i * 4 + 1] = b[i] * 255;
    data[i * 4 + 2] = Math.min(255, (c[i] * 0.7 + a[i] * 0.3) * 255);
    data[i * 4 + 3] = d[i] * 255;
  }
  return dataTexture(data, S);
}

function makeWaterNormal(rng) {
  const S = 256;
  const h = fbmPeriodic(S, 8, 5, rng, 0.55);
  const h2 = fbmPeriodic(S, 4, 3, rng, 0.5);
  const H = new Float32Array(S * S);
  for (let i = 0; i < H.length; i++) H[i] = h[i] * 0.7 + h2[i] * 0.3;
  const data = new Uint8Array(S * S * 4);
  const strength = 6.0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = H[y * S + ((x - 1 + S) % S)], r = H[y * S + ((x + 1) % S)];
      const u = H[((y - 1 + S) % S) * S + x], d = H[((y + 1) % S) * S + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * S + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = H[y * S + x] * 255;
    }
  }
  return dataTexture(data, S);
}

function makeFoam(rng) {
  const S = 256;
  const c = worleyPeriodic(S, 10, rng);
  const c2 = worleyPeriodic(S, 22, rng);
  const n = fbmPeriodic(S, 8, 4, rng);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const cell = Math.max(0, 1 - c[i] * 3.2);
    const cell2 = Math.max(0, 1 - c2[i] * 3.5);
    const v = Math.min(1, (cell * 0.65 + cell2 * 0.5) * (0.5 + n[i]));
    data[i * 4] = v * 255;
    data[i * 4 + 1] = n[i] * 255;
    data[i * 4 + 2] = cell2 * 255;
    data[i * 4 + 3] = 255;
  }
  return dataTexture(data, S);
}

function makeWood(rng) {
  const S = 256;
  const grain = fbmPeriodic(S, 4, 4, rng);
  const fine = fbmPeriodic(S, 32, 3, rng);
  const data = new Uint8Array(S * S * 4);
  const planks = 8;
  for (let y = 0; y < S; y++) {
    const plank = Math.floor((y / S) * planks);
    const plankShade = 0.85 + ((plank * 7919) % 13) / 13 * 0.25;
    const inPlank = ((y / S) * planks) % 1;
    const seam = inPlank < 0.04 || inPlank > 0.96 ? 0.55 : 1;
    for (let x = 0; x < S; x++) {
      const g = grain[((y * 3) % S) * S + x];
      const rings = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 3 + g * 12 + plank);
      const v = (0.72 + rings * 0.16 + fine[y * S + x] * 0.18) * plankShade * seam;
      const i = (y * S + x) * 4;
      data[i] = Math.min(255, v * 255);
      data[i + 1] = Math.min(255, v * 255);
      data[i + 2] = Math.min(255, v * 255);
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, S);
}

function makeCanvasCloth(rng) {
  const S = 128;
  const n = fbmPeriodic(S, 8, 3, rng);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const weave = 0.9 + 0.1 * ((x % 2) ^ (y % 2));
      const v = (0.82 + n[y * S + x] * 0.18) * weave;
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, v * 255);
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, S);
}
