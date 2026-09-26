// Procedural landmark meshes. Each builder returns a THREE.Group positioned
// in absolute world coordinates (to be added under worldRoot), with optional
// update(dt, ctx) for animation and a list of emitters (lights, mist, sound).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { Noise2D } from '../core/noise.js';
import { hexToLinear, lerp } from '../core/math.js';
import { G, attachGlobals } from '../render/globalUniforms.js';
import { getTextures } from '../render/ProceduralTextures.js';
import { speciesGeometry } from './Species.js';
import { getFoliageMaterials } from '../render/FoliageMaterials.js';
import { noReflect } from '../render/layers.js';

const noise = new Noise2D(777);
const C = (h) => hexToLinear(h);

function colorize(g, color, jitter = 0.08, seed = 1, aoH = null) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const rng = new RNG(seed);
  const p = g.attributes.position;
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rng.next() - 0.5) * jitter * 2;
    for (let k = 0; k < 3; k++) {
      const v = i + k;
      let ao = 1;
      if (aoH) ao = 0.65 + 0.35 * Math.min(1, Math.max(0, (p.getY(v) - aoH[0]) / (aoH[1] - aoH[0])));
      col[v * 3] = color[0] * j * ao; col[v * 3 + 1] = color[1] * j * ao; col[v * 3 + 2] = color[2] * j * ao;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const mergeAll = (list) => mergeGeometries(list.filter(Boolean), false);

function rockGeo(r, detail, seed, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const d = noise.noise(v.x * 1.3 / r + seed, v.z * 1.3 / r + v.y * 0.9 / r) * 0.28 + noise.noise(v.x * 4 / r, v.y * 4 / r + seed) * 0.08;
    v.multiplyScalar(1 + d);
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  return g;
}

function box(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(r1, r2, h, x, y, z, seg = 8) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
function prismRoof(w, d, h, x, y, z, ry = 0, overhang = 0.3) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const pos = [-W, 0, -D, W, 0, -D, 0, h, -D, -W, 0, D, W, 0, D, 0, h, D];
  const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

let sharedMats = null;
export function landmarkMaterials() {
  if (sharedMats) return sharedMats;
  const tex = getTextures();
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: tex.wood });
  wood.map.colorSpace = THREE.NoColorSpace;
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0 });
  glow.onBeforeCompile = (sh) => {
    attachGlobals(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform float uTime;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * (0.15 + uGlow * 2.5) * (0.85 + 0.15 * sin(uTime * 1.7));');
  };
  const water = createWaterfallMaterial();
  sharedMats = { stone, wood, glow, water, foliage: getFoliageMaterials() };
  return sharedMats;
}

function createWaterfallMaterial(frozen = false) {
  const tex = getTextures();
  const m = new THREE.ShaderMaterial({
    uniforms: { ...G, tFoam: { value: tex.foam }, uFrozen: { value: frozen ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      varying vec2 vUv; varying float vT; varying vec3 vW;
      void main() { vUv = uv; vT = aT; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFoam; uniform float uTime; uniform float uFrozen;
      uniform vec3 uSunColor; uniform vec3 uSunDir; uniform vec3 uFogColor; uniform float uNight; uniform vec3 uLanternColor; uniform vec3 uLanternPos;
      varying vec2 vUv; varying float vT; varying vec3 vW;
      void main() {
        float speed = uFrozen > 0.5 ? 0.0 : 1.0;
        float f1 = texture2D(tFoam, vec2(vUv.x * 2.0, vUv.y * 3.0 - uTime * 1.4 * speed)).r;
        float f2 = texture2D(tFoam, vec2(vUv.x * 3.7 + 0.3, vUv.y * 5.0 - uTime * 2.1 * speed)).g;
        float streak = smoothstep(0.25, 0.8, f1 * 0.7 + f2 * 0.6);
        float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        vec3 amb = mix(uFogColor * 0.9, vec3(0.9), 0.35) * (1.0 - uNight * 0.85);
        vec3 lit = amb + uSunColor * max(uSunDir.y, 0.0) * 0.35;
        vec3 water = mix(vec3(0.55, 0.7, 0.75), vec3(0.95, 0.98, 1.0), streak) * lit;
        if (uFrozen > 0.5) water = mix(vec3(0.62, 0.8, 0.9), vec3(0.95, 0.98, 1.0), f1) * (lit + 0.2);
        float dl = length(uLanternPos - vW);
        water += uLanternColor * 0.4 / (1.0 + dl * dl * 0.05);
        float a = edge * (0.55 + streak * 0.45) * (uFrozen > 0.5 ? 0.95 : 1.0);
        a *= smoothstep(1.0, 0.92, vT) + 0.0;
        gl_FragColor = vec4(water, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return m;
}

/** Soft billboard particles for mist / steam / spray. */
function mistSprites(count, radius, height, color = [1, 1, 1], opacity = 0.35) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * height; pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { ...G, uColor: { value: new THREE.Color(...color) }, uOpacity: { value: opacity }, uHeight: { value: height }, uSize: { value: radius * 0.9 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uHeight; uniform float uSize;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = fract(uTime * 0.08 * (0.6 + aSeed) + aSeed);
        p.y = mod(position.y + t * uHeight, uHeight);
        p.x += sin(uTime * 0.3 + aSeed * 20.0) * 0.8;
        vA = sin(p.y / uHeight * 3.14159);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.6 + aSeed) * 300.0 / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform vec3 uFogColor; uniform float uNight; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = 1.0 - smoothstep(0.1, 0.5, length(c));
        vec3 col = mix(uColor, uFogColor, 0.4) * (1.0 - uNight * 0.8);
        gl_FragColor = vec4(col, d * uOpacity * vA);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  noReflect(pts);
  return pts;
}

// ---------------------------------------------------------------- builders

function waterfall(it, ctx) {
  const wf = it.waterfall;
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const top = wf.top, bot = wf.bottom;
  const N = 26;
  const dx = bot.x - top.x, dz = bot.z - top.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len, pz = dx / len;
  const pos = [], uv = [], tArr = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ease = 1 - (1 - t) * (1 - t); // horizontal ease-out (falls away from the lip)
    const x = top.x + dx * ease, z = top.z + dz * ease;
    let y = lerp(top.y, bot.y, t * t);
    const gh = ctx.world.heightAt(x, z) + 0.35;
    if (y < gh) y = gh;
    if (i === N) y = bot.y;
    const w = wf.width * (0.8 + t * 0.5);
    for (const s of [-0.5, 0.5]) {
      pos.push(x + px * w * s - it.x, y, z + pz * w * s - it.z);
      uv.push(s + 0.5, t * (wf.drop / 6));
      tArr.push(t);
    }
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(tArr, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = wf.frozen ? createWaterfallMaterial(true) : M.water;
  const sheet = new THREE.Mesh(geo, mat);
  sheet.renderOrder = 6;
  g.add(sheet);
  // Rocks at the lip and around the plunge pool.
  const rocks = [];
  const rng = new RNG(it.seed ?? 1);
  for (let i = 0; i < 6; i++) {
    const r = rockGeo(0.8 + rng.next() * 1.4, 1, i + (it.seed ?? 0) % 7, 1, 0.7, 1);
    const a = rng.next() * Math.PI * 2;
    r.translate(bot.x - it.x + Math.cos(a) * wf.width * 0.8, bot.y - 0.3, bot.z - it.z + Math.sin(a) * wf.width * 0.8);
    rocks.push(colorize(r, C('#7a7870'), 0.1, i));
  }
  for (let i = 0; i < 3; i++) {
    const r = rockGeo(0.9 + rng.next(), 1, i + 3, 1, 0.6, 1);
    r.translate(top.x - it.x + px * (i - 1) * wf.width * 0.7, top.y - 0.4, top.z - it.z + pz * (i - 1) * wf.width * 0.7);
    rocks.push(colorize(r, C('#6e6c66'), 0.1, i + 10));
  }
  const rm = new THREE.Mesh(mergeAll(rocks), M.stone);
  rm.castShadow = true; rm.receiveShadow = true;
  g.add(rm);
  // Mist at the base.
  if (!wf.frozen) {
    const mist = mistSprites(Math.round(22 * (ctx.quality?.particles ?? 1)) + 6, wf.width * 0.9, Math.min(14, wf.drop * 0.5 + 3), [0.95, 0.97, 1], 0.28);
    mist.position.set(bot.x - it.x, bot.y, bot.z - it.z);
    g.add(mist);
  }
  g.userData.emitters = { mistDrop: { x: bot.x, z: bot.z, strength: Math.min(1.5, wf.width * 0.12) }, sound: { type: 'waterfall', x: bot.x, y: bot.y, z: bot.z, volume: Math.min(1, wf.width / 10) } };
  return g;
}

function bigTree(it, ctx, { leaf = '#4f7f33', leaf2 = '#6a9a3e', bark = '#5b4331', scale = 1, glow = false } = {}) {
  const M = landmarkMaterials();
  const rng = new RNG(it.seed ?? 5);
  const g = new THREE.Group();
  const H = 26 * scale;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(1.2 * scale, 2.2 * scale, H * 0.7, 10, 6, true);
  trunk.translate(0, H * 0.35, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / H;
    const tw = noise.noise(p.getX(i) * 0.6, p.getZ(i) * 0.6 + y * 4) * 0.35 * scale;
    p.setX(i, p.getX(i) * (1 + tw) + Math.sin(y * 3) * 0.6 * scale);
    p.setZ(i, p.getZ(i) * (1 + tw));
  }
  parts.push(colorize(trunk, C(bark), 0.1, 1, [0, H * 0.7]));
  // roots
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.next() * 0.3;
    const r = new THREE.CylinderGeometry(0.2 * scale, 0.7 * scale, 5 * scale, 6);
    r.rotateZ(Math.PI / 2 - 0.35);
    r.translate(2.2 * scale, 0.9 * scale, 0);
    r.rotateY(a);
    parts.push(colorize(r, C(bark), 0.1, i + 3));
  }
  // branches
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.next();
    const b = new THREE.CylinderGeometry(0.25 * scale, 0.6 * scale, 8 * scale, 6);
    b.rotateZ(-0.9);
    b.translate(3 * scale, H * 0.62, 0);
    b.rotateY(a);
    parts.push(colorize(b, C(bark), 0.1, i + 9));
  }
  const trunkMesh = new THREE.Mesh(mergeAll(parts), M.stone);
  trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
  g.add(trunkMesh);
  const canopy = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rng.next();
    const d = i === 0 ? 0 : (5 + rng.next() * 3) * scale;
    const r = (4.5 + rng.next() * 2.5) * scale;
    const blob = new THREE.IcosahedronGeometry(r, 1);
    const bp = blob.attributes.position;
    for (let k = 0; k < bp.count; k++) {
      const v = new THREE.Vector3(bp.getX(k), bp.getY(k), bp.getZ(k));
      v.multiplyScalar(1 + noise.noise(v.x * 0.4 + i, v.z * 0.4 + v.y * 0.3) * 0.25);
      bp.setXYZ(k, v.x, v.y * 0.7, v.z);
    }
    blob.translate(Math.cos(a) * d, H * (0.78 + rng.next() * 0.15), Math.sin(a) * d);
    const geo = colorize(blob, C(i % 2 ? leaf : leaf2), 0.12, i);
    const n = geo.attributes.position.count;
    const wind = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { wind[k * 3] = 0.25; wind[k * 3 + 1] = 0.4; wind[k * 3 + 2] = glow ? 0.8 : 0; }
    geo.setAttribute('aWind', new THREE.BufferAttribute(wind, 3));
    geo.deleteAttribute('uv');
    canopy.push(geo);
  }
  const cm = new THREE.Mesh(mergeAll(canopy), M.foliage.foliage);
  cm.castShadow = true; cm.receiveShadow = true;
  g.add(cm);
  return g;
}

function ruins(it, ctx, { big = false } = {}) {
  const M = landmarkMaterials();
  const rng = new RNG(it.seed ?? 9);
  const g = new THREE.Group();
  const parts = [];
  const stone = C(ctx.biome?.id === 'canyon' ? '#b88a64' : '#9a968a');
  const moss = C('#5a6e44');
  const n = big ? 14 : 6;
  const R = big ? 22 : 8;
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2, r = rng.next() * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const kind = rng.next();
    if (kind < 0.4) {
      const h = 2 + rng.next() * 4;
      parts.push(colorize(cyl(0.45, 0.5, h, x, 0, z, 10), stone, 0.1, i));
      parts.push(colorize(box(1.3, 0.35, 1.3, x, h, z), stone, 0.1, i + 1));
    } else if (kind < 0.8) {
      const w = 3 + rng.next() * 5, h = 1 + rng.next() * 3;
      const wall = box(w, h, 0.7, x, h / 2, z, rng.next() * Math.PI);
      parts.push(colorize(wall, rng.next() < 0.3 ? moss : stone, 0.12, i));
    } else {
      const r2 = rockGeo(0.8, 0, i, 1.2, 0.5, 0.9);
      r2.translate(x, 0.2, z);
      parts.push(colorize(r2, stone, 0.1, i));
    }
  }
  if (big) {
    // An empty lamp post and a collapsed arch.
    parts.push(colorize(cyl(0.12, 0.15, 5, 4, 0, -4, 6), C('#3a3530'), 0.05, 3));
    const arch = new THREE.TorusGeometry(3, 0.5, 6, 12, Math.PI);
    arch.translate(-6, 0, 6);
    parts.push(colorize(arch, stone, 0.1, 5));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

function cabin(it, ctx, { mill = false } = {}) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const wood = C('#7a5a3a'), roof = C('#5a4a3a'), stone = C('#8a8478');
  const parts = [
    colorize(box(4, 2.6, 3.4, 0, 1.3, 0), wood, 0.1, 1),
    colorize(prismRoof(4, 3.4, 1.6, 0, 2.6, 0), roof, 0.1, 2),
    colorize(box(0.9, 1.7, 0.1, 0, 0.85, 1.71), C('#4a3526'), 0.05, 3),
    colorize(cyl(0.3, 0.35, 2.2, 1.3, 2.4, -0.8, 6), stone, 0.1, 4),
  ];
  const m = new THREE.Mesh(mergeAll(parts), M.wood);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -(it.angle ?? 0) + Math.PI / 2;
  g.add(m);
  if (mill) {
    const wheel = new THREE.Group();
    const wp = [colorize(cyl(1.8, 1.8, 0.3, 0, -0.15, 0, 16), C('#5a4430'), 0.1, 1)];
    for (let i = 0; i < 10; i++) {
      const b = box(0.15, 1.1, 0.7, 0, 1.55, 0);
      b.rotateX(0);
      b.rotateZ((i / 10) * Math.PI * 2);
      wp.push(colorize(b, C('#6a5038'), 0.1, i));
    }
    const wg = mergeAll(wp);
    wg.rotateX(Math.PI / 2);
    const wm = new THREE.Mesh(wg, M.wood);
    wm.castShadow = true;
    wheel.add(wm);
    const a = it.angle ?? 0;
    wheel.position.set(Math.cos(a) * 3.2, 1.2, Math.sin(a) * 3.2);
    wheel.rotation.y = -a;
    g.add(wheel);
    g.userData.update = (dt) => { wm.rotation.z -= dt * 0.6; };
  }
  return g;
}

function lampstone(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const stone = C(ctx.biome?.id === 'snow' ? '#b8bcc2' : '#8f8a80');
  const parts = [
    colorize(box(2.2, 0.5, 2.2, 0, 0.25, 0), stone, 0.08, 1),
    colorize(cyl(0.45, 0.7, 4.2, 0, 0.5, 0, 4), stone, 0.08, 2),
    colorize(box(1.1, 0.25, 1.1, 0, 4.7, 0), stone, 0.08, 3),
  ];
  // carved star marks
  for (let i = 0; i < 7; i++) {
    const s = box(0.08, 0.08, 0.02, Math.cos(i) * 0.3, 1.2 + i * 0.45, 0.62 - i * 0.02);
    parts.push(colorize(s, C('#d8c8a0'), 0, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -(it.angle ?? 0);
  g.add(m);
  // Lantern cage on top.
  const cage = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    cage.push(colorize(cyl(0.03, 0.03, 0.9, Math.cos(a) * 0.35, 4.95, Math.sin(a) * 0.35, 4), C('#3a3632'), 0, i));
  }
  cage.push(colorize(new THREE.ConeGeometry(0.55, 0.45, 4).translate(0, 6.05, 0), C('#3a3632'), 0, 9));
  const cm = new THREE.Mesh(mergeAll(cage), M.stone);
  g.add(cm);
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.85, 1.0) });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), flameMat);
  flame.position.y = 5.4;
  flame.visible = false;
  g.add(flame);
  g.userData.lamp = { flame, flameMat, lit: false, color: new THREE.Color(0.55, 0.8, 1.0) };
  g.userData.setLit = (lit) => {
    g.userData.lamp.lit = lit;
    flame.visible = lit;
  };
  g.userData.update = (dt, t) => {
    if (flame.visible) {
      const k = 2.5 + Math.sin(t * 3) * 0.3 + Math.sin(t * 7.3) * 0.2;
      flameMat.color.setRGB(0.55 * k, 0.8 * k, 1.0 * k);
    }
  };
  g.userData.lightPoint = { x: it.x, y: (it.y ?? 0) + 5.4, z: it.z, color: new THREE.Color(0.55, 0.8, 1.0), intensity: 0, when: () => g.userData.lamp.lit };
  return g;
}

function lighthouse(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const white = C('#ece8de'), red = C('#b8483a'), dark = C('#3a3632');
  const parts = [
    colorize(cyl(3.4, 3.8, 2, 0, 0, 0, 12), C('#8a8478'), 0.08, 1),
    colorize(cyl(1.8, 2.8, 22, 0, 2, 0, 16), white, 0.05, 2),
    colorize(cyl(1.82, 2.35, 3, 0, 11, 0, 16), red, 0.05, 3),
    colorize(cyl(2.6, 2.6, 0.4, 0, 24, 0, 16), dark, 0.05, 4),
    colorize(cyl(1.6, 1.6, 2.6, 0, 24.4, 0, 12), C('#cfd8dc'), 0.05, 5),
    colorize(new THREE.ConeGeometry(1.9, 1.8, 12).translate(0, 27.9, 0), red, 0.05, 6),
  ];
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.2, 0.2) });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), lampMat);
  lamp.position.y = 25.7;
  g.add(lamp);
  g.userData.setLit = (lit) => { g.userData.lit = lit; };
  g.userData.update = (dt, t) => {
    const lit = g.userData.lit;
    const k = lit ? 6 + Math.sin(t * 2) * 1 : 0.2;
    lampMat.color.setRGB(1.0 * k, 0.85 * k, 0.6 * k);
  };
  g.userData.lightPoint = { x: it.x, y: (it.y ?? 0) + 25.7, z: it.z, color: new THREE.Color(1, 0.85, 0.6), intensity: 0, range: 60, when: () => g.userData.lit };
  return g;
}

function rockPillars(it, ctx, { sea = false } = {}) {
  const M = landmarkMaterials();
  const rng = new RNG(it.seed ?? 3);
  const g = new THREE.Group();
  const parts = [];
  const col = C(ctx.biome?.id === 'canyon' ? '#b0603a' : ctx.biome?.id === 'crystal' ? '#cfcac0' : '#7a766e');
  const n = sea ? 4 : 3;
  for (let i = 0; i < n; i++) {
    const h = (sea ? 22 : 12) + rng.next() * (sea ? 18 : 14);
    const r = (sea ? 5 : 2.5) + rng.next() * 2;
    const geo = new THREE.CylinderGeometry(r * 0.6, r, h, 9, 8);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const d = 1 + noise.noise(p.getX(k) * 0.3 + i * 3, p.getZ(k) * 0.3 + y * 0.15) * 0.25;
      p.setX(k, p.getX(k) * d); p.setZ(k, p.getZ(k) * d);
    }
    const a = rng.next() * Math.PI * 2, d = i === 0 ? 0 : 5 + rng.next() * (sea ? 14 : 6);
    geo.translate(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d);
    parts.push(colorize(geo, col, 0.1, i, [-3, h]));
    // grassy cap
    const cap = rockGeo(r * 0.7, 1, i, 1, 0.3, 1);
    cap.translate(Math.cos(a) * d, h - 3 + 0.2, Math.sin(a) * d);
    parts.push(colorize(cap, C('#5a7a3a'), 0.1, i + 20));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.position.y = (it.water ?? 0) - (it.y ?? it.water ?? 0);
  g.add(m);
  return g;
}

function arch(it, ctx, { bridge = false, grand = false } = {}) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const a = it.a, c = it.c;
  const span = Math.hypot(c.x - a.x, c.z - a.z);
  const ang = Math.atan2(c.z - a.z, c.x - a.x);
  const water = it.water ?? 0;
  const rise = bridge ? Math.max(9, span * 0.25) : Math.max(14, span * 0.45) * (grand ? 1.4 : 1);
  const thick = bridge ? 1.6 : 3.5 * (grand ? 1.3 : 1);
  const N = 24;
  const pos = [], idx = [];
  const prof = 10;
  const ring = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = -span / 2 + t * span;
    const y = Math.sin(t * Math.PI) * rise;
    const tangent = new THREE.Vector2(span, Math.cos(t * Math.PI) * Math.PI * rise).normalize();
    ring.push({ x, y, tx: tangent.x, ty: tangent.y });
  }
  for (let i = 0; i <= N; i++) {
    const r = ring[i];
    for (let k = 0; k < prof; k++) {
      const th = (k / prof) * Math.PI * 2;
      const nx = -r.ty, ny = r.tx;
      const w = thick * (bridge ? 1 : 1 + 0.35 * noise.noise(i * 0.4, k * 0.7));
      const lx = r.x + nx * Math.cos(th) * w * 0.5;
      const ly = r.y + ny * Math.cos(th) * w * 0.5;
      const lz = Math.sin(th) * (bridge ? 2.4 : w * 0.9);
      pos.push(lx, ly, lz);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < prof; k++) {
    const a0 = i * prof + k, a1 = i * prof + (k + 1) % prof, b0 = a0 + prof, b1 = a1 + prof;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const col = C(bridge ? '#8a867c' : ctx.biome?.id === 'canyon' ? '#b0603a' : '#7a766e');
  const parts = [colorize(geo, col, 0.1, 1)];
  if (bridge) {
    parts.push(colorize(box(span * 0.9, 0.3, 3.2, 0, rise + 0.9, 0), col, 0.08, 2));
    parts.push(colorize(box(span * 0.9, 0.7, 0.25, 0, rise + 1.35, 1.5), col, 0.08, 3));
    parts.push(colorize(box(span * 0.9, 0.7, 0.25, 0, rise + 1.35, -1.5), col, 0.08, 4));
  }
  if (grand) {
    // Two carved giants holding the lintel (stylised, original).
    for (const s of [-1, 1]) {
      parts.push(colorize(box(4, rise * 0.9, 4, s * span * 0.45, rise * 0.45 - 2, 0), col, 0.08, 7));
      parts.push(colorize(new THREE.SphereGeometry(2.4, 10, 8).translate(s * span * 0.45, rise * 0.95, 0), col, 0.08, 8));
    }
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -ang;
  g.add(m);
  g.position.y = water - 0.5 - (it.y ?? water);
  return g;
}

function floatingIsland(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const rock = rockGeo(9, 2, (it.seed ?? 1) % 10, 1.2, 1.6, 1.1);
  const p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) * 0.15);
  const parts = [colorize(rock, C('#7a7064'), 0.12, 1, [-14, 2])];
  const top = new THREE.CylinderGeometry(9.5, 9.8, 1.2, 14);
  top.translate(0, 1.4, 0);
  parts.push(colorize(top, C('#5a8a3a'), 0.1, 2));
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  const island = new THREE.Group();
  island.add(m);
  // trees on top
  const tg = speciesGeometry('tree_broadleaf', 1);
  const trees = new THREE.InstancedMesh(tg, M.foliage.foliage, 5);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    mm.compose(new THREE.Vector3(Math.cos(a) * 5, 1.8, Math.sin(a) * 5), new THREE.Quaternion(), new THREE.Vector3(0.9, 0.9, 0.9));
    trees.setMatrixAt(i, mm);
  }
  trees.castShadow = true;
  island.add(trees);
  // thin waterfall off the edge
  const wf = waterfall({ x: 0, z: 0, seed: 3, waterfall: { top: { x: 9, z: 0, y: 1.6 }, bottom: { x: 12, z: 0, y: -26 }, width: 1.6, drop: 28 } }, { world: { heightAt: () => -999 }, quality: ctx.quality });
  island.add(wf);
  const baseY = 28 + ((it.seed ?? 0) % 10);
  island.position.y = baseY;
  g.add(island);
  g.position.y = (it.water ?? 0) - (it.y ?? it.water ?? 0);
  g.userData.update = (dt, t) => {
    island.position.y = baseY + Math.sin(t * 0.25) * 0.8;
    island.rotation.y += dt * 0.01;
  };
  return g;
}

function shrine(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const stone = C('#8e8a80'), roof = C('#6a4a3a'), cloth = C('#c0573f');
  const parts = [
    colorize(box(2.4, 0.4, 2.4, 0, 0.2, 0), stone, 0.08, 1),
    colorize(box(1.6, 1.4, 1.2, 0, 1.1, 0), stone, 0.08, 2),
    colorize(prismRoof(1.8, 1.4, 0.8, 0, 1.8, 0, 0, 0.35), roof, 0.08, 3),
    colorize(box(0.6, 0.05, 0.4, 0, 0.9, 0.62), cloth, 0.05, 4),
  ];
  for (let i = 0; i < 5; i++) parts.push(colorize(rockGeo(0.12, 0, i, 1, 0.8, 1).translate(-0.9 + i * 0.4, 0.45, 1.0), C('#b8b4aa'), 0.1, i));
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -(it.angle ?? 0) - Math.PI / 2;
  g.add(m);
  return g;
}

function tower(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const stone = C('#8a857a');
  const parts = [colorize(cyl(2.4, 2.8, 14, 0, 0, 0, 10), stone, 0.1, 1, [0, 14])];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (i % 2) parts.push(colorize(box(0.9, 1.2, 0.8, Math.cos(a) * 2.2, 14.6, Math.sin(a) * 2.2, -a), stone, 0.1, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

function balancedRocks(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const parts = [];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const r = 2.4 - i * 0.45;
    const geo = rockGeo(r, 1, i, 1.2, 0.75, 1);
    geo.translate((i % 2 ? 0.4 : -0.3), y + r * 0.7, 0);
    y += r * 1.35;
    parts.push(colorize(geo, C('#9a8a78'), 0.1, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

function hotSpring(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const x = Math.cos(a) * 3.5, z = Math.sin(a) * 3.5;
    for (let k = 0; k < 7; k++) {
      const b = (k / 7) * Math.PI * 2;
      parts.push(colorize(rockGeo(0.5, 0, k + i, 1, 0.6, 1).translate(x + Math.cos(b) * 2, 0.2, z + Math.sin(b) * 2), C('#9a8e80'), 0.1, k));
    }
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.receiveShadow = true;
  g.add(m);
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x5ac0c8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.9, 16), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(Math.cos(a) * 3.5, 0.28, Math.sin(a) * 3.5);
    g.add(pool);
  }
  const steam = mistSprites(Math.round(18 * (ctx.quality?.particles ?? 1)) + 4, 5, 7, [1, 1, 1], 0.3);
  g.add(steam);
  return g;
}

function crystalCluster(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const geo = speciesGeometry('crystal', 1);
  const inst = new THREE.InstancedMesh(geo, M.foliage.crystal, 7);
  const rng = new RNG(it.seed ?? 4);
  const mm = new THREE.Matrix4();
  for (let i = 0; i < 7; i++) {
    const a = rng.next() * Math.PI * 2, r = i === 0 ? 0 : 2 + rng.next() * 3;
    const s = i === 0 ? 4.5 : 1.5 + rng.next() * 2;
    mm.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng.next() - 0.5) * 0.4, rng.next() * 6, (rng.next() - 0.5) * 0.4)), new THREE.Vector3(s, s, s));
    inst.setMatrixAt(i, mm);
    inst.setColorAt(i, new THREE.Color(ctx.biome?.id === 'starwater' ? 0.7 : 0.8, 0.9, 1));
  }
  inst.castShadow = true;
  g.add(inst);
  return g;
}

function grove(it, ctx, { color = '#6ad0c8', color2 = '#9a8ae8', count = 8 } = {}) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const geo = speciesGeometry('tree_broadleaf', 1);
  const inst = new THREE.InstancedMesh(geo, M.foliage.foliage, count);
  const glowGeo = speciesGeometry('glow_plant', 1);
  const glowInst = new THREE.InstancedMesh(glowGeo, M.foliage.foliage, 30);
  const rng = new RNG(it.seed ?? 7);
  const mm = new THREE.Matrix4();
  const c1 = new THREE.Color().fromArray(C(color)), c2 = new THREE.Color().fromArray(C(color2));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.next() * 0.3, r = 8 + rng.next() * 5;
    const s = 1.1 + rng.next() * 0.5;
    mm.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * 6), new THREE.Vector3(s, s, s));
    inst.setMatrixAt(i, mm);
    inst.setColorAt(i, (i % 2 ? c1 : c2).clone().multiplyScalar(2.2));
  }
  for (let i = 0; i < 30; i++) {
    const a = rng.next() * Math.PI * 2, r = rng.next() * 12;
    mm.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(1.2, 1.2, 1.2));
    glowInst.setMatrixAt(i, mm);
  }
  inst.castShadow = true;
  g.add(inst, glowInst);
  return g;
}

function wreck(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const wood = C('#5e5040'), dark = C('#3e3428');
  const parts = [];
  const hull = new THREE.CylinderGeometry(1.6, 1.6, 9, 12, 1, true, 0, Math.PI);
  hull.rotateZ(Math.PI / 2);
  hull.rotateX(Math.PI);
  parts.push(colorize(hull, wood, 0.15, 1));
  for (let i = 0; i < 6; i++) parts.push(colorize(box(0.15, 1.8, 0.15, -3.5 + i * 1.4, 0.6, 1.3), dark, 0.1, i));
  parts.push(colorize(cyl(0.12, 0.15, 5, 0.5, 0, 0, 6).rotateZ(0.5), dark, 0.1, 9));
  const m = new THREE.Mesh(mergeAll(parts), M.wood);
  m.castShadow = true;
  m.rotation.set(0.25, -(it.angle ?? 0), 0.35);
  g.add(m);
  g.position.y = (it.water ?? 0) - 0.6 - (it.y ?? it.water ?? 0);
  return g;
}

function bellTower(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const stone = C('#6e6a60');
  const parts = [
    colorize(box(4, 14, 4, 0, 4, 0), stone, 0.1, 1, [-3, 11]),
    colorize(prismRoof(4.2, 4.2, 2.5, 0, 11, 0, 0, 0.3), C('#4a3a30'), 0.1, 2),
  ];
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true;
  g.add(m);
  const bell = new THREE.Mesh(colorize(new THREE.CylinderGeometry(0.6, 1.1, 1.4, 12).translate(0, 9.5, 0), C('#8a6a3a'), 0.05, 3), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.35 }));
  g.add(bell);
  g.userData.update = (dt, t) => { bell.rotation.z = Math.sin(t * 0.8) * 0.05; };
  g.position.y = (it.water ?? 0) - 3 - (it.y ?? it.water ?? 0);
  return g;
}

function cave(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const dome = new THREE.SphereGeometry(9, 18, 12, 0, Math.PI * 1.35, 0, Math.PI / 2);
  const p = dome.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    v.multiplyScalar(1 + noise.noise(v.x * 0.25 + 3, v.z * 0.25 + v.y * 0.2) * 0.22);
    p.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  dome.rotateY(Math.PI * 0.18);
  const col = C(ctx.biome?.id === 'canyon' ? '#a0583a' : '#6e6a62');
  const m = new THREE.Mesh(colorize(dome, col, 0.12, 1, [0, 7]), M.stone);
  m.material = M.stone.clone();
  m.material.side = THREE.DoubleSide;
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -(it.angle ?? 0) + Math.PI;
  g.add(m);
  // glowing crystals & fungi inside
  const cry = new THREE.InstancedMesh(speciesGeometry('crystal', 1), M.foliage.crystal, 5);
  const mush = new THREE.InstancedMesh(speciesGeometry('mushroom_glow', 1), M.foliage.foliage, 8);
  const mm = new THREE.Matrix4();
  const rng = new RNG(it.seed ?? 2);
  for (let i = 0; i < 5; i++) { mm.compose(new THREE.Vector3((rng.next() - 0.5) * 10, 0.2, (rng.next() - 0.5) * 10), new THREE.Quaternion(), new THREE.Vector3(1.5, 1.5, 1.5)); cry.setMatrixAt(i, mm); }
  for (let i = 0; i < 8; i++) { mm.compose(new THREE.Vector3((rng.next() - 0.5) * 12, 0.3, (rng.next() - 0.5) * 12), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2)); mush.setMatrixAt(i, mm); }
  g.add(cry, mush);
  g.position.y = (it.water ?? 0) - 1 - (it.y ?? it.water ?? 0);
  return g;
}

function camp(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const parts = [
    colorize(prismRoof(2.4, 3, 1.8, 0, 0, 0, 0, 0.1), C('#b8a07a'), 0.1, 1),
    colorize(box(0.6, 0.5, 0.5, 2.2, 0.25, 1), C('#6a5038'), 0.1, 2),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(colorize(rockGeo(0.18, 0, i, 1, 0.7, 1).translate(-2.4 + Math.cos(a) * 0.7, 0.1, 1.5 + Math.sin(a) * 0.7), C('#6a6660'), 0.1, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.wood);
  m.castShadow = true;
  m.rotation.y = -(it.angle ?? 0);
  g.add(m);
  return g;
}

function standingStones(it, { count = 9, radius = 9, color = '#8a8a8a', snow = false } = {}) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const h = 3.5 + (i % 3) * 0.8;
    const s = box(1.1, h, 0.7, Math.cos(a) * radius, h / 2, Math.sin(a) * radius, -a);
    parts.push(colorize(s, C(color), 0.1, i, [0, h]));
    if (snow) parts.push(colorize(box(1.15, 0.2, 0.75, Math.cos(a) * radius, h + 0.05, Math.sin(a) * radius, -a), C('#f2f6fa'), 0.02, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

function frozenGiant(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const stone = C('#9aa0a8'), snow = C('#f2f6fa');
  const parts = [
    colorize(box(14, 10, 10, 0, 5, 0), stone, 0.08, 1),                      // lap/seat
    colorize(cyl(4.5, 6, 16, 0, 9, -2, 10), stone, 0.08, 2),                  // torso
    colorize(new THREE.SphereGeometry(4, 12, 10).translate(0, 29, -2), stone, 0.08, 3), // head
    colorize(cyl(1.8, 1.8, 11, -6.5, 12, 1, 8).rotateX(0.9), stone, 0.08, 4), // arms reaching
    colorize(cyl(1.8, 1.8, 11, 6.5, 12, 1, 8).rotateX(0.9), stone, 0.08, 5),
    colorize(new THREE.SphereGeometry(3.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI).translate(0, 12, 7), stone, 0.08, 6), // cupped hands
    colorize(new THREE.SphereGeometry(4.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3).translate(0, 29.3, -2), snow, 0.02, 7),
    colorize(box(14.2, 0.6, 10.2, 0, 10.1, 0), snow, 0.02, 8),
  ];
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true; m.receiveShadow = true;
  m.rotation.y = -(it.angle ?? 0) + Math.PI / 2;
  g.add(m);
  return g;
}

function spire(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.6, 5, 48, 9, 12);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const d = 1 + noise.noise(p.getX(i) * 0.3, p.getY(i) * 0.1) * 0.25;
    p.setX(i, p.getX(i) * d); p.setZ(i, p.getZ(i) * d);
  }
  geo.translate(0, 24, 0);
  const m = new THREE.Mesh(colorize(geo, C('#7a5a48'), 0.1, 1, [0, 48]), M.stone);
  m.castShadow = true;
  g.add(m);
  const tip = new THREE.Mesh(colorize(new THREE.OctahedronGeometry(1.2).translate(0, 48.5, 0), C('#ff9a4a'), 0, 1), M.glow);
  g.add(tip);
  return g;
}

function pagoda(it) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const parts = [colorize(box(7, 0.6, 7, 0, 0.3, 0), C('#8a8478'), 0.08, 1)];
  for (let i = 0; i < 4; i++) {
    const s = 5 - i * 1.1;
    parts.push(colorize(box(s * 0.7, 2.2, s * 0.7, 0, 1.7 + i * 2.8, 0), C('#9a4a3a'), 0.08, i));
    parts.push(colorize(new THREE.ConeGeometry(s * 0.95, 1.2, 4).rotateY(Math.PI / 4).translate(0, 3.3 + i * 2.8, 0), C('#3a4a44'), 0.08, i + 5));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.castShadow = true;
  m.rotation.y = -(it.angle ?? 0);
  g.add(m);
  return g;
}

function paintedWall(it, ctx) {
  const g = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const c2 = canvas.getContext('2d');
  c2.fillStyle = 'rgba(0,0,0,0)';
  c2.fillRect(0, 0, 512, 256);
  c2.strokeStyle = 'rgba(250,240,220,0.9)'; c2.fillStyle = 'rgba(250,240,220,0.9)'; c2.lineWidth = 4;
  // a river circling the sky, boats and stars (original motif)
  c2.beginPath(); c2.arc(256, 128, 90, 0, Math.PI * 2); c2.stroke();
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; c2.beginPath(); c2.arc(256 + Math.cos(a) * 90, 128 + Math.sin(a) * 90, 7, 0, Math.PI * 2); c2.fill(); }
  for (let i = 0; i < 3; i++) { c2.beginPath(); c2.moveTo(80 + i * 140, 220); c2.quadraticCurveTo(110 + i * 140, 240, 140 + i * 140, 220); c2.stroke(); }
  for (let i = 0; i < 20; i++) c2.fillRect(Math.random() * 512, Math.random() * 90, 3, 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, emissive: 0xffe0b0, emissiveMap: tex, emissiveIntensity: 0.2 });
  const cl = it.cliff;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), mat);
  plane.position.set(cl.bottom.x - it.x, (cl.bottom.y ?? it.water) + 8, cl.bottom.z - it.z);
  plane.lookAt(new THREE.Vector3(cl.bottom.x - it.x - (cl.top.x - cl.bottom.x), plane.position.y, cl.bottom.z - it.z - (cl.top.z - cl.bottom.z)));
  plane.userData.mat = mat;
  g.add(plane);
  g.userData.update = () => { mat.emissiveIntensity = 0.1 + G.uGlow.value * 1.2; };
  void ctx;
  return g;
}

function stair(it, ctx) {
  const M = landmarkMaterials();
  const g = new THREE.Group();
  const cl = it.cliff;
  const parts = [];
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = lerp(cl.bottom.x, cl.top.x, t) - it.x, z = lerp(cl.bottom.z, cl.top.z, t) - it.z;
    const y = ctx.world.heightAt(x + it.x, z + it.z) + 0.1;
    const ang = Math.atan2(cl.top.z - cl.bottom.z, cl.top.x - cl.bottom.x);
    parts.push(colorize(box(1.2, 0.35, 2.4, x, y - (it.y ?? 0), z, -ang), C('#9a968c'), 0.08, i));
  }
  const m = new THREE.Mesh(mergeAll(parts), M.stone);
  m.receiveShadow = true;
  g.add(m);
  const top = shrine({ ...it, angle: 0 }, ctx);
  top.position.set(cl.top.x - it.x, cl.top.y - (it.y ?? 0), cl.top.z - it.z);
  g.add(top);
  return g;
}

function veil(it) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a6a4a, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x2a9a8a, emissiveIntensity: 0, transparent: true, opacity: 1 });
  const parts = [];
  const n = 40;
  const w = it.width;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) - 0.5) * w;
    const h = 5 + Math.random() * 3;
    const s = new THREE.PlaneGeometry(0.5, h, 1, 3);
    s.translate(x, 6 - h / 2 + 0.5, (Math.random() - 0.5) * 0.6);
    parts.push(s);
  }
  const top = new THREE.BoxGeometry(w, 0.6, 0.6);
  top.translate(0, 6.3, 0);
  parts.push(top);
  const m = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), mat);
  m.rotation.y = -(it.angle ?? 0) + Math.PI / 2;
  g.add(m);
  g.userData.veil = { mat, open: false, t: 0 };
  g.userData.update = (dt) => {
    const v = g.userData.veil;
    v.t = Math.min(1, Math.max(0, v.t + (v.open ? dt * 0.4 : -dt)));
    mat.opacity = 1 - v.t;
    m.visible = v.t < 0.99;
    mat.emissiveIntensity = G.uGlow.value * 0.8;
    m.scale.y = 1 - v.t * 0.6;
  };
  return g;
}

const BUILDERS = {
  waterfall, giantWaterfall: waterfall, icefall: waterfall, headwaterFalls: waterfall,
  ancientTree: (it, ctx) => bigTree(it, ctx),
  giantBlossom: (it, ctx) => bigTree(it, ctx, { leaf: '#f4b3c8', leaf2: '#f9d0dc', bark: '#4a3430', scale: 1.15 }),
  goldenGrove: (it, ctx) => grove(it, ctx, { color: '#e8b43a', color2: '#f0c860', count: 9 }),
  templeOfRoots: (it, ctx) => { const g = ruins(it, ctx, { big: true }); g.add(bigTree({ ...it, seed: 99 }, ctx, { scale: 0.9 })); return g; },
  ruins: (it, ctx) => ruins(it, ctx),
  ruinedVillage: (it, ctx) => ruins(it, ctx, { big: true }),
  cabin: (it, ctx) => cabin(it, ctx),
  mill: (it, ctx) => cabin(it, ctx, { mill: true }),
  shrine, skyStair: stair,
  lampstone, lighthouse,
  watchtower: tower, balancedRocks, hotSpring, crystalCluster,
  glowGrove: (it, ctx) => grove(it, ctx),
  paintedWall, rainTemple: pagoda, emberSpire: spire,
  auroraStones: (it) => standingStones(it, { count: 11, radius: 10, color: '#8a8e96' }),
  frozenGiant,
  rockPillars: (it, ctx) => rockPillars(it, ctx),
  seaStacks: (it, ctx) => rockPillars(it, ctx, { sea: true }),
  wreck, drownedBell: bellTower, floatingIsland,
  mirrorLake: (it, ctx) => rockPillars({ ...it, seed: 5 }, ctx),
  naturalArch: (it, ctx) => arch(it, ctx),
  bridge: (it, ctx) => arch(it, ctx, { bridge: true }),
  tidalGate: (it, ctx) => arch(it, ctx, { grand: true }),
  cave, camp, veil,
};

/** Build the mesh group for a landmark feature (or null for marker-only types). */
export function buildLandmark(it, ctx) {
  const b = BUILDERS[it.type];
  if (!b) return null;
  const g = b(it, ctx);
  if (!g) return null;
  g.position.x += it.x;
  g.position.z += it.z;
  const baseY = it.y ?? (it.water !== undefined ? it.water : ctx.world.heightAt(it.x, it.z));
  if (['waterfall', 'giantWaterfall', 'icefall', 'headwaterFalls', 'veil'].includes(it.type)) {
    g.position.y += it.type === 'veil' ? (ctx.world.waterInfo(it.x, it.z, {}).level) : 0;
  } else g.position.y += baseY;
  g.name = `landmark ${it.type} ${it.name ?? ''}`;
  return g;
}
