// Procedural vegetation & rock models. Every species is built from simple
// primitives with vertex colours and a per-vertex wind attribute
// (aWind: x = sway weight, y = flutter weight, z = glow mask), in two levels
// of detail. All designs are original.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { Noise2D } from '../core/noise.js';
import { hexToLinear } from '../core/math.js';

const noise = new Noise2D(4242);
const C = (hex) => hexToLinear(hex);

/** Attach colour + wind attributes to a geometry. */
function finish(g, color, { sway = 0, flutter = 0, glow = 0, swayByHeight = null, shade = 0.25, jitter = 0.06, seed = 1 } = {}) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  g.computeVertexNormals();
  const p = g.attributes.position;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const wind = new Float32Array(n * 3);
  const rng = new RNG(seed);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
  // Per-face colour jitter for a painterly look; darker underneath (fake AO).
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rng.next() - 0.5) * jitter * 2;
    for (let k = 0; k < 3; k++) {
      const v = i + k;
      const y = p.getY(v);
      const h = maxY > minY ? (y - minY) / (maxY - minY) : 1;
      const ao = 1 - shade + shade * h;
      col[v * 3] = color[0] * j * ao; col[v * 3 + 1] = color[1] * j * ao; col[v * 3 + 2] = color[2] * j * ao;
      const sw = swayByHeight ? Math.max(0, (y - swayByHeight[0]) / (swayByHeight[1] - swayByHeight[0])) : sway;
      wind[v * 3] = Math.min(1, sw); wind[v * 3 + 1] = flutter; wind[v * 3 + 2] = glow;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWind', new THREE.BufferAttribute(wind, 3));
  return g;
}

function merge(list) {
  return mergeGeometries(list.filter(Boolean), false);
}

function displace(g, amount, freq = 1.5, seed = 0) {
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const len = v.length() || 1;
    const d = noise.noise(v.x * freq + seed, v.z * freq - seed + v.y * freq * 0.7) * amount;
    v.multiplyScalar(1 + d / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

function trunk(h, r0, r1, seg = 6, bend = 0, lean = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 4, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(y * Math.PI) * bend + y * y * lean);
  }
  return g;
}

function blob(r, detail, x, y, z, sx = 1, sy = 1, sz = 1, disp = 0.18, seed = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  displace(g, r * disp, 1.8 / r, seed);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function cone(r, h, seg, y, x = 0, z = 0) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false);
  g.translate(x, y + h / 2, z);
  return g;
}

/** A bent strip (leaf, frond, blade). length along +x from origin, curling down. */
function strip(len, width, segs, droop, twist = 0, taper = true) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = (taper ? Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.9 + 0.1 : 1) * width * 0.5;
    const x = t * len;
    const y = -droop * t * t * len;
    pos.push(x, y, -w, x, y + twist * t, w);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  g.scale(s, s, s);
  g.rotateZ(rz); g.rotateX(rx); g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// ------------------------------------------------------------------ species
const BUILDERS = {
  tree_broadleaf(lod, rng) {
    const H = 5.5;
    const bark = C('#5b4331'), leaf = C('#4f7f33'), leaf2 = C('#6a9a3e');
    const parts = [finish(trunk(H * 0.62, 0.28, 0.16, lod ? 7 : 5, 0.15), bark, { swayByHeight: [0, H * 1.2], shade: 0.4 })];
    const n = lod ? 5 : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next();
      const r = lod ? 1.5 + rng.next() * 0.6 : 2.6;
      const d = lod && i > 0 ? 1.1 : 0;
      parts.push(finish(blob(r, lod ? 1 : 0, Math.cos(a) * d, H * 0.72 + rng.next() * 0.8 + (lod ? 0 : 0.3), Math.sin(a) * d, 1, 0.8, 1, 0.22, i), i % 2 ? leaf : leaf2, { swayByHeight: [0, H * 1.2], flutter: 0.6, shade: 0.45, seed: i + 3 }));
    }
    return merge(parts);
  },
  tree_willow(lod, rng) {
    const H = 5;
    const bark = C('#5a4a36'), leaf = C('#7fa04a');
    const parts = [finish(trunk(H * 0.6, 0.3, 0.2, 6, 0.3), bark, { swayByHeight: [0, H * 1.2], shade: 0.4 })];
    parts.push(finish(blob(2.3, lod ? 1 : 0, 0, H * 0.78, 0, 1.1, 0.6, 1.1, 0.2, 3), leaf, { swayByHeight: [0, H], flutter: 0.5, shade: 0.4 }));
    if (lod) {
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const s = strip(2.4 + rng.next(), 0.35, 4, 0, 0, true);
        s.rotateZ(-Math.PI / 2 + 0.1);
        place(s, { x: Math.cos(a) * 1.9, y: H * 0.85, z: Math.sin(a) * 1.9, ry: -a });
        parts.push(finish(s, leaf, { sway: 1, flutter: 0.8, shade: 0.3, seed: i }));
      }
    }
    return merge(parts);
  },
  tree_cherry(lod, rng) {
    const H = 4.6;
    const bark = C('#4a3430'), pink = C('#f2b3c6'), pink2 = C('#f8d2dd');
    const parts = [finish(trunk(H * 0.55, 0.22, 0.12, lod ? 6 : 5, 0.25, 0.2), bark, { swayByHeight: [0, H * 1.2], shade: 0.4 })];
    const n = lod ? 6 : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next();
      const d = lod && i > 0 ? 1.3 : 0;
      parts.push(finish(blob(lod ? 1.3 : 2.4, lod ? 1 : 0, Math.cos(a) * d + 0.2, H * 0.7 + rng.next() * 0.7, Math.sin(a) * d, 1, 0.75, 1, 0.25, i), i % 2 ? pink : pink2, { swayByHeight: [0, H * 1.2], flutter: 0.7, shade: 0.35, seed: i + 7 }));
    }
    return merge(parts);
  },
  tree_maple(lod, rng) {
    const H = 5.8;
    const bark = C('#4d3a2c'), c1 = C('#d8742a'), c2 = C('#c5452b'), c3 = C('#e2a53a');
    const parts = [finish(trunk(H * 0.6, 0.26, 0.14, lod ? 7 : 5, 0.12), bark, { swayByHeight: [0, H * 1.2], shade: 0.4 })];
    const n = lod ? 6 : 1;
    const cols = [c1, c2, c3];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.next();
      const d = lod && i > 0 ? 1.2 : 0;
      parts.push(finish(blob(lod ? 1.45 : 2.7, lod ? 1 : 0, Math.cos(a) * d, H * 0.74 + rng.next() * 0.8, Math.sin(a) * d, 1, 0.85, 1, 0.24, i), cols[i % 3], { swayByHeight: [0, H * 1.2], flutter: 0.6, shade: 0.4, seed: i + 11 }));
    }
    return merge(parts);
  },
  tree_birch(lod, rng) {
    const H = 7;
    const bark = C('#e8e4da'), leaf = C('#9ab44a');
    const parts = [finish(trunk(H * 0.8, 0.14, 0.07, 6, 0.2), bark, { swayByHeight: [0, H], shade: 0.15, jitter: 0.25 })];
    const n = lod ? 4 : 1;
    for (let i = 0; i < n; i++) {
      parts.push(finish(blob(lod ? 1.0 : 1.6, lod ? 1 : 0, (rng.next() - 0.5) * 0.8, H * 0.62 + i * 0.7, (rng.next() - 0.5) * 0.8, 1, 1.3, 1, 0.25, i), leaf, { swayByHeight: [0, H], flutter: 0.9, shade: 0.35, seed: i + 5 }));
    }
    return merge(parts);
  },
  tree_pine(lod, rng, snow = false) {
    const H = 9;
    const bark = C('#4a3526'), needle = C('#2f5a3a'), needle2 = C('#3c6a45'), white = C('#eef3f8');
    const parts = [finish(trunk(H * 0.35, 0.22, 0.14, 5), bark, { swayByHeight: [0, H * 1.2], shade: 0.4 })];
    const tiers = lod ? 5 : 2;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const r = (1 - t * 0.75) * 2.1;
      const h = H * (lod ? 0.32 : 0.55);
      const y = H * 0.18 + t * H * 0.62;
      const g = cone(r, h, lod ? 8 : 6, y);
      if (lod) displace(g, 0.08, 2, i);
      parts.push(finish(g, i % 2 ? needle : needle2, { swayByHeight: [0, H * 1.1], flutter: 0.15, shade: 0.5, seed: i + 17 }));
      if (snow) {
        const sg = cone(r * 0.86, h * 0.45, lod ? 8 : 6, y + h * 0.55);
        parts.push(finish(sg, white, { swayByHeight: [0, H * 1.1], shade: 0.1, seed: i }));
      }
    }
    void rng;
    return merge(parts);
  },
  tree_pine_snow(lod, rng) {
    return BUILDERS.tree_pine(lod, rng, true);
  },
  tree_jungle(lod, rng) {
    const H = 13;
    const bark = C('#6a5a44'), leaf = C('#2f6a2a'), leaf2 = C('#3f7f30'), vine = C('#3a6a2a');
    const parts = [finish(trunk(H * 0.78, 0.45, 0.25, lod ? 7 : 5, 0.3), bark, { swayByHeight: [0, H * 1.3], shade: 0.45 })];
    if (lod) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const b = new THREE.BoxGeometry(1.2, 1.6, 0.12);
        b.translate(0.6, 0.8, 0);
        b.rotateY(a);
        parts.push(finish(b, bark, { shade: 0.5 }));
      }
    }
    const layers = lod ? 3 : 1;
    for (let i = 0; i < layers; i++) {
      const y = H * 0.78 + i * 1.3;
      const r = (lod ? 3.2 : 4.2) - i * 0.6;
      parts.push(finish(blob(r, lod ? 1 : 0, (rng.next() - 0.5), y, (rng.next() - 0.5), 1.3, 0.38, 1.3, 0.25, i), i % 2 ? leaf : leaf2, { swayByHeight: [0, H * 1.3], flutter: 0.4, shade: 0.5, seed: i + 23 }));
    }
    if (lod) {
      for (let i = 0; i < 6; i++) {
        const s = strip(4 + rng.next() * 3, 0.12, 3, 0, 0, false);
        s.rotateZ(-Math.PI / 2);
        const a = rng.next() * Math.PI * 2;
        place(s, { x: Math.cos(a) * 2.6, y: H * 0.8, z: Math.sin(a) * 2.6 });
        parts.push(finish(s, vine, { sway: 1, flutter: 0.4 }));
      }
    }
    return merge(parts);
  },
  tree_palm(lod, rng) {
    const H = 7.5;
    const bark = C('#8a6a48'), frond = C('#4f8a34'), frond2 = C('#6a9a3a');
    const parts = [finish(trunk(H, 0.2, 0.13, lod ? 6 : 4, 0, 1.2), bark, { swayByHeight: [0, H], shade: 0.3, jitter: 0.12 })];
    const n = lod ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = strip(2.8 + rng.next() * 0.6, 0.65, lod ? 5 : 2, 0.35, 0.1);
      place(s, { x: 1.2, y: H, z: 0, ry: -a, rz: 0.25 });
      parts.push(finish(s, i % 2 ? frond : frond2, { sway: 1, flutter: 0.9, shade: 0.2, seed: i }));
    }
    return merge(parts);
  },
  tree_cypress(lod, rng) {
    const H = 11;
    const bark = C('#5a4c3c'), leaf = C('#4a5f34'), moss = C('#8a9a78');
    const parts = [finish(trunk(H * 0.75, 0.75, 0.22, lod ? 8 : 5, 0.2), bark, { swayByHeight: [0, H * 1.3], shade: 0.5 })];
    parts.push(finish(blob(2.4, lod ? 1 : 0, 0, H * 0.82, 0, 1.2, 0.55, 1.2, 0.3, 4), leaf, { swayByHeight: [0, H * 1.2], flutter: 0.3, shade: 0.4 }));
    parts.push(finish(blob(1.8, lod ? 1 : 0, 0.8, H * 0.65, -0.6, 1.2, 0.5, 1.2, 0.3, 5), leaf, { swayByHeight: [0, H * 1.2], flutter: 0.3, shade: 0.4 }));
    if (lod) {
      for (let i = 0; i < 12; i++) {
        const s = strip(1.4 + rng.next() * 1.4, 0.25, 3, 0, 0, true);
        s.rotateZ(-Math.PI / 2);
        const a = rng.next() * Math.PI * 2;
        place(s, { x: Math.cos(a) * 1.6, y: H * 0.72, z: Math.sin(a) * 1.6 });
        parts.push(finish(s, moss, { sway: 1, flutter: 0.6 }));
      }
    }
    return merge(parts);
  },
  tree_dead(lod, rng) {
    const H = 7;
    const bark = C('#6e6558');
    const parts = [finish(trunk(H, 0.3, 0.08, 5, 0.3), bark, { swayByHeight: [0, H * 1.4], shade: 0.4 })];
    const n = lod ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const b = trunk(2.2 + rng.next() * 1.5, 0.1, 0.03, 4);
      place(b, { y: H * (0.45 + i * 0.1), ry: rng.next() * Math.PI * 2, rz: 0.7 + rng.next() * 0.4 });
      parts.push(finish(b, bark, { swayByHeight: [0, H * 1.3] }));
    }
    return merge(parts);
  },
  tree_mangrove(lod, rng) {
    const H = 5;
    const bark = C('#5e5040'), leaf = C('#3e6e34');
    const parts = [];
    const roots = lod ? 7 : 3;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * Math.PI * 2;
      const t = new THREE.TorusGeometry(1.1, 0.08, 4, 8, Math.PI * 0.7);
      t.rotateZ(Math.PI * 0.15);
      place(t, { x: Math.cos(a) * 0.6, y: 0, z: Math.sin(a) * 0.6, ry: -a });
      parts.push(finish(t, bark, { shade: 0.3 }));
    }
    parts.push(finish(trunk(H * 0.5, 0.2, 0.15, 5), bark, { swayByHeight: [0, H * 1.3], shade: 0.3 }));
    parts.push(finish(blob(2.4, lod ? 1 : 0, 0, H * 0.75, 0, 1.2, 0.6, 1.2, 0.25, 9), leaf, { swayByHeight: [0, H * 1.2], flutter: 0.5, shade: 0.4 }));
    void rng;
    return merge(parts);
  },
  bamboo(lod, rng) {
    const green = C('#8aa83a'), green2 = C('#a8b84a'), leaf = C('#6a9a34');
    const parts = [];
    const n = lod ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const h = 7 + rng.next() * 4;
      const x = (rng.next() - 0.5) * 1.2, z = (rng.next() - 0.5) * 1.2;
      const c = trunk(h, 0.07, 0.05, lod ? 5 : 3, 0, (rng.next() - 0.5) * 0.8);
      c.translate(x, 0, z);
      parts.push(finish(c, i % 2 ? green : green2, { swayByHeight: [0, h], shade: 0.2, jitter: 0.15 }));
      if (lod) {
        for (let k = 0; k < 3; k++) {
          const s = strip(1.0, 0.18, 2, 0.4);
          place(s, { x, y: h * (0.7 + k * 0.1), z, ry: rng.next() * Math.PI * 2, rz: 0.3 });
          parts.push(finish(s, leaf, { sway: 1, flutter: 1 }));
        }
      }
    }
    return merge(parts);
  },
  bush(lod, rng) {
    const c = C('#4a7a32'), c2 = C('#5a8a3a');
    const parts = [];
    const n = lod ? 3 : 1;
    for (let i = 0; i < n; i++) parts.push(finish(blob(0.75 + rng.next() * 0.3, lod ? 1 : 0, (rng.next() - 0.5) * 0.9, 0.55, (rng.next() - 0.5) * 0.9, 1, 0.8, 1, 0.25, i), i % 2 ? c : c2, { swayByHeight: [0, 1.6], flutter: 0.6, shade: 0.5, seed: i }));
    return merge(parts);
  },
  bush_flower(lod, rng) {
    const c = C('#4f8034'), f = C('#f0c8e0'), f2 = C('#ffffff');
    const parts = [finish(blob(0.8, lod ? 1 : 0, 0, 0.55, 0, 1.1, 0.75, 1.1, 0.25, 2), c, { swayByHeight: [0, 1.5], flutter: 0.6, shade: 0.5 })];
    if (lod) for (let i = 0; i < 9; i++) {
      const a = rng.next() * Math.PI * 2, r = 0.7 + rng.next() * 0.2;
      parts.push(finish(blob(0.1, 0, Math.cos(a) * r, 0.6 + rng.next() * 0.4, Math.sin(a) * r, 1, 1, 1, 0), i % 3 ? f : f2, { sway: 0.8, flutter: 0.8, shade: 0 }));
    }
    return merge(parts);
  },
  fern(lod, rng) {
    const c = C('#4e8a34'), c2 = C('#5f9a3c');
    const parts = [];
    const n = lod ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const s = strip(0.9 + rng.next() * 0.4, 0.28, lod ? 4 : 2, 0.6, 0.05);
      place(s, { y: 0.1, ry: (i / n) * Math.PI * 2 + rng.next() * 0.3, rz: 0.6 + rng.next() * 0.3 });
      parts.push(finish(s, i % 2 ? c : c2, { swayByHeight: [0, 1], flutter: 0.8, shade: 0.4 }));
    }
    return merge(parts);
  },
  reeds(lod, rng) {
    const c = C('#7f9a4a'), c2 = C('#9aa85a'), head = C('#6a4a2e');
    const parts = [];
    const n = lod ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const h = 1.3 + rng.next() * 0.9;
      const s = strip(h, 0.11, 3, 0.12, 0, true);
      place(s, { x: (rng.next() - 0.5) * 0.5, z: (rng.next() - 0.5) * 0.5, rz: Math.PI / 2 - (rng.next() - 0.5) * 0.3, ry: rng.next() * Math.PI });
      parts.push(finish(s, i % 2 ? c : c2, { swayByHeight: [0, 2], flutter: 0.3, shade: 0.4 }));
      if (lod && i % 3 === 0) {
        const hd = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 5);
        hd.translate((rng.next() - 0.5) * 0.3, h * 0.92, (rng.next() - 0.5) * 0.3);
        parts.push(finish(hd, head, { sway: 0.9, shade: 0.1 }));
      }
    }
    return merge(parts);
  },
  grass(lod, rng) {
    const c = C('#6a9a3a'), c2 = C('#86ab48'), c3 = C('#9ab656');
    const parts = [];
    const n = lod ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const h = 0.3 + rng.next() * 0.45;
      const s = strip(h, 0.1, 2, 0.3, 0, true);
      const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * 0.6;
      place(s, { x: Math.cos(a) * r, z: Math.sin(a) * r, rz: Math.PI / 2 - (rng.next() - 0.5) * 0.6, ry: rng.next() * Math.PI });
      parts.push(finish(s, [c, c2, c3][i % 3], { swayByHeight: [0, 0.8], flutter: 0.4, shade: 0.6, seed: i }));
    }
    return merge(parts);
  },
  flowers(lod, rng) {
    const stem = C('#5a8a34');
    const heads = [C('#f2d24a'), C('#e87aa0'), C('#8aa0f0'), C('#ffffff'), C('#f08a4a')];
    const parts = [];
    const n = lod ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const h = 0.25 + rng.next() * 0.3;
      const x = (rng.next() - 0.5) * 0.5, z = (rng.next() - 0.5) * 0.5;
      const s = new THREE.CylinderGeometry(0.008, 0.01, h, 3);
      s.translate(x, h / 2, z);
      parts.push(finish(s, stem, { swayByHeight: [0, 0.6] }));
      parts.push(finish(blob(0.05, 0, x, h, z, 1, 0.5, 1, 0), heads[Math.floor(rng.next() * heads.length)], { swayByHeight: [0, 0.6], flutter: 0.6, shade: 0 }));
    }
    return merge(parts);
  },
  lilypad(lod, rng) {
    const pad = C('#3f7a34'), flower = C('#f6d6e6');
    const parts = [];
    const n = lod ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const r = 0.25 + rng.next() * 0.2;
      const g = new THREE.CircleGeometry(r, lod ? 10 : 6, 0.3, Math.PI * 2 - 0.3);
      g.rotateX(-Math.PI / 2);
      g.translate((rng.next() - 0.5) * 0.9, 0.0, (rng.next() - 0.5) * 0.9);
      parts.push(finish(g, pad, { sway: 0.1, shade: 0 }));
    }
    if (lod && rng.chance(0.5)) parts.push(finish(blob(0.08, 0, 0.1, 0.05, 0.1, 1, 0.6, 1, 0.2), flower, { shade: 0 }));
    return merge(parts);
  },
  mushroom_glow(lod, rng) {
    const stem = C('#d8d0c0'), cap = C('#5ac8c0'), cap2 = C('#9a7ae0');
    const parts = [];
    const n = lod ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const h = 0.12 + rng.next() * 0.25;
      const x = (rng.next() - 0.5) * 0.4, z = (rng.next() - 0.5) * 0.4;
      const s = new THREE.CylinderGeometry(0.025, 0.035, h, 5);
      s.translate(x, h / 2, z);
      parts.push(finish(s, stem, { shade: 0.3, glow: 0.2 }));
      const c = new THREE.SphereGeometry(0.08 + rng.next() * 0.06, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      c.scale(1, 0.6, 1);
      c.translate(x, h, z);
      parts.push(finish(c, i % 2 ? cap : cap2, { shade: 0, glow: 1 }));
    }
    return merge(parts);
  },
  glow_plant(lod, rng) {
    const leaf = C('#2a5a5a'), tip = C('#7af0e0');
    const parts = [];
    const n = lod ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const s = strip(0.6 + rng.next() * 0.3, 0.12, 3, 0.2);
      place(s, { ry: (i / n) * Math.PI * 2, rz: 1.0 });
      parts.push(finish(s, leaf, { swayByHeight: [0, 0.8], flutter: 0.6, shade: 0.4, glow: 0.35 }));
      const b = blob(0.045, 0, 0, 0, 0, 1, 1, 1, 0);
      const a = (i / n) * Math.PI * 2;
      b.translate(Math.cos(a) * 0.2, 0.62, -Math.sin(a) * 0.2);
      parts.push(finish(b, tip, { sway: 0.8, shade: 0, glow: 1 }));
    }
    return merge(parts);
  },
  rock_boulder(lod, rng) {
    const c = C('#8a8780');
    const g = blob(1, lod ? 2 : 1, 0, 0.45, 0, 1.2, 0.8, 1, 0.35, rng.next() * 10);
    return finish(g, c, { shade: 0.35, jitter: 0.08 });
  },
  rock_small(lod, rng) {
    const c = C('#8d8a82');
    const parts = [];
    for (let i = 0; i < (lod ? 3 : 1); i++) parts.push(finish(blob(0.25 + rng.next() * 0.2, lod ? 1 : 0, (rng.next() - 0.5) * 0.8, 0.1, (rng.next() - 0.5) * 0.8, 1.2, 0.7, 1, 0.3, i), c, { shade: 0.35 }));
    return merge(parts);
  },
  rock_flat(lod, rng) {
    const c = C('#a8a49a');
    return finish(blob(0.9, lod ? 1 : 0, 0, 0.1, 0, 1.3, 0.3, 1, 0.3, rng.next() * 10), c, { shade: 0.3 });
  },
  crystal(lod, rng) {
    const c = C('#bfe4ff');
    const parts = [];
    const n = lod ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const h = 0.8 + rng.next() * 1.6;
      const g = new THREE.CylinderGeometry(0.0, 0.18 + rng.next() * 0.12, h, 6);
      g.translate(0, h / 2, 0);
      place(g, { x: (rng.next() - 0.5) * 0.7, z: (rng.next() - 0.5) * 0.7, rx: (rng.next() - 0.5) * 0.6, rz: (rng.next() - 0.5) * 0.6 });
      parts.push(finish(g, c, { shade: 0.2, glow: 0.6, jitter: 0.15 }));
    }
    return merge(parts);
  },
  shrub_dry(lod, rng) {
    const c = C('#8a7a4a'), leaf = C('#8a9a5a');
    const parts = [];
    for (let i = 0; i < (lod ? 7 : 3); i++) {
      const b = trunk(0.9 + rng.next() * 0.5, 0.03, 0.01, 3);
      place(b, { ry: rng.next() * Math.PI * 2, rz: 0.2 + rng.next() * 0.6 });
      parts.push(finish(b, c, { swayByHeight: [0, 1.5] }));
    }
    parts.push(finish(blob(0.55, 0, 0, 0.6, 0, 1.2, 0.6, 1.2, 0.4, 3), leaf, { swayByHeight: [0, 1.4], flutter: 0.4, shade: 0.5 }));
    return merge(parts);
  },
  cactus(lod, rng) {
    const c = C('#6a8a5a'), c2 = C('#7a9a62');
    const parts = [];
    const n = lod ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const h = 0.7 + rng.next() * 0.6;
      const g = new THREE.ConeGeometry(0.1, h, 4);
      g.translate(0, h / 2, 0);
      place(g, { ry: (i / n) * Math.PI * 2, rz: 0.35 + rng.next() * 0.4 });
      parts.push(finish(g, i % 2 ? c : c2, { swayByHeight: [0, 2], shade: 0.4 }));
    }
    return merge(parts);
  },
  driftwood(lod, rng) {
    const c = C('#a8977e');
    const g = trunk(2.6, 0.16, 0.1, lod ? 6 : 4, 0.2);
    g.rotateZ(Math.PI / 2);
    g.translate(1.2, 0.1, 0);
    void rng;
    return finish(g, c, { shade: 0.3, jitter: 0.1 });
  },
};

export const SPECIES_IDS = Object.keys(BUILDERS);

/** Material category per species. */
export const SPECIES_MATERIAL = {
  rock_boulder: 'rock', rock_small: 'rock', rock_flat: 'rock', driftwood: 'rock',
  crystal: 'crystal', mushroom_glow: 'foliage', glow_plant: 'foliage',
};

/** Species that are tall enough to cast shadows / use far LOD. */
export const TALL = new Set(['tree_broadleaf', 'tree_willow', 'tree_cherry', 'tree_maple', 'tree_birch', 'tree_pine', 'tree_pine_snow', 'tree_jungle', 'tree_palm', 'tree_cypress', 'tree_dead', 'tree_mangrove', 'bamboo']);

const cache = new Map();

/** Get (and cache) the geometry of a species at LOD 1 (near) or 0 (far). */
export function speciesGeometry(id, lod) {
  const key = `${id}:${lod}`;
  let g = cache.get(key);
  if (!g) {
    const b = BUILDERS[id];
    if (!b) throw new Error(`unknown species ${id}`);
    g = b(lod, new RNG(id.length * 131 + 7));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    cache.set(key, g);
  }
  return g;
}
