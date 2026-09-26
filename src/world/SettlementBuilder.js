// Procedural riverside settlements. Layout comes from the settlement seed:
// houses on the flattened plateau facing the river, a dock with lanterns,
// a trader's stall, an optional shipwright, lit windows at night, chimney
// smoke, and spots where NPCs stand, sit or work.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';
import { hexToLinear } from '../core/math.js';
import { G, attachGlobals } from '../render/globalUniforms.js';
import { landmarkMaterials } from './LandmarkBuilder.js';

const C = (h) => hexToLinear(h);

const STYLES = {
  cottage: { wall: ['#e8dcc0', '#efe4cc', '#e0d0b0'], roof: ['#8a6a3a', '#a0503a', '#9a7a4a'], trim: '#5a4430', stilts: 0, roofH: 1.9, flat: false },
  stilt: { wall: ['#8a6a48', '#7a5e40', '#96764e'], roof: ['#9a8a4a', '#8a7a40'], trim: '#5a4430', stilts: 1.6, roofH: 2.2, flat: false },
  stone: { wall: ['#9a968c', '#8e8a80', '#a8a498'], roof: ['#4a5058', '#3e444c'], trim: '#5a5048', stilts: 0, roofH: 2.2, flat: false },
  adobe: { wall: ['#d0a070', '#c89868', '#d8ae80'], roof: ['#b08858'], trim: '#6a4a30', stilts: 0, roofH: 0, flat: true },
  timber: { wall: ['#7a5a3a', '#6a4e32', '#86643e'], roof: ['#3a3a38', '#4a3a30'], trim: '#3a2a1e', stilts: 0, roofH: 2.6, flat: false },
  coastal: { wall: ['#f0ece4', '#f4f0e8', '#e8e4dc'], roof: ['#c0603a', '#b85a36'], trim: '#3a6a9a', stilts: 0.4, roofH: 1.6, flat: false },
};

function colorize(g, color, jitter = 0.05, seed = 1) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const rng = new RNG(seed);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rng.next() - 0.5) * jitter * 2;
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = color[0] * j; col[(i + k) * 3 + 1] = color[1] * j; col[(i + k) * 3 + 2] = color[2] * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, x, y, z, seg = 6) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y + h / 2, z);
function roofGeo(w, d, h, overhang = 0.4) {
  const W = w / 2 + overhang, D = d / 2 + overhang;
  const pos = [-W, 0, -D, W, 0, -D, 0, h, -D, -W, 0, D, W, 0, D, 0, h, D];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
  return g;
}

let windowMat = null;
function getWindowMaterial() {
  if (windowMat) return windowMat;
  windowMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.3, emissive: 0xffb060, emissiveIntensity: 0 });
  windowMat.onBeforeCompile = (sh) => {
    attachGlobals(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.62, 0.3) * smoothstep(0.15, 0.6, uNight) * 2.2;');
  };
  return windowMat;
}

/** Build a house geometry set (walls/roof in merged lists, windows separately). */
function house(style, rng, x, z, rot, parts, windows, smokePoints) {
  const S = STYLES[style];
  const w = 4 + rng.next() * 2.5, d = 3.5 + rng.next() * 2, h = 2.6 + rng.next() * 0.8;
  const stilts = S.stilts;
  const local = [];
  const wall = C(rng.pick(S.wall)), roof = C(rng.pick(S.roof)), trim = C(S.trim);
  local.push(colorize(box(w, h, d, 0, stilts + h / 2, 0), wall, 0.04, rng.nextU32()));
  if (stilts > 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) local.push(colorize(cyl(0.14, stilts + 0.1, sx * (w / 2 - 0.3), -0.1, sz * (d / 2 - 0.3)), trim, 0.05, 1));
    local.push(colorize(box(w + 1.2, 0.18, d + 1.2, 0, stilts - 0.05, 0), trim, 0.05, 2));
  }
  if (S.flat) {
    local.push(colorize(box(w + 0.3, 0.3, d + 0.3, 0, stilts + h + 0.15, 0), roof, 0.05, 3));
    local.push(colorize(box(w + 0.3, 0.4, 0.2, 0, stilts + h + 0.5, d / 2 + 0.05), roof, 0.05, 4));
  } else {
    const r = roofGeo(w, d, S.roofH);
    r.translate(0, stilts + h, 0);
    local.push(colorize(r, roof, 0.06, rng.nextU32()));
  }
  // timber trim / door
  local.push(colorize(box(0.95, 1.8, 0.08, 0, stilts + 0.9, d / 2 + 0.04), trim, 0.05, 5));
  if (style === 'cottage' || style === 'timber') {
    local.push(colorize(box(w + 0.05, 0.12, 0.08, 0, stilts + h - 0.1, d / 2 + 0.03), trim, 0.05, 6));
  }
  // chimney
  if (!S.flat && rng.chance(0.7)) {
    local.push(colorize(box(0.5, 1.6, 0.5, w * 0.25, stilts + h + S.roofH * 0.4, -d * 0.15), C('#7a7068'), 0.08, 7));
    smokePoints.push(new THREE.Vector3(w * 0.25, stilts + h + S.roofH * 0.4 + 0.9, -d * 0.15).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(x, 0, z)));
  }
  // windows (emissive at night)
  const wl = [];
  wl.push(box(0.7, 0.7, 0.06, -w * 0.28, stilts + h * 0.55, d / 2 + 0.03));
  wl.push(box(0.7, 0.7, 0.06, w * 0.28, stilts + h * 0.55, d / 2 + 0.03));
  if (rng.chance(0.6)) wl.push(box(0.06, 0.7, 0.7, w / 2 + 0.03, stilts + h * 0.55, 0));
  const place = (g) => { g.rotateY(rot); g.translate(x, 0, z); return g; };
  for (const g of local) parts.push(place(g));
  for (const g of wl) windows.push(place(g.toNonIndexed()));
  return { w, d, h, stilts };
}

/**
 * @param it settlement feature
 * @param ctx { world, quality }
 */
export function buildSettlement(it, ctx) {
  const rng = new RNG(it.seed ?? 1);
  const M = landmarkMaterials();
  const group = new THREE.Group();
  group.name = `settlement ${it.name}`;
  const parts = [], windows = [], woodParts = [], smokePoints = [];
  const plateau = it.y;
  const toWater = it.dock.angle;
  const away = toWater + Math.PI;
  const R = it.R ?? 40;
  const houses = [];
  const count = it.role === 'home' ? 6 : 4 + rng.int(0, 4);
  let tries = 0;
  while (houses.length < count && tries++ < 80) {
    const ang = away + (rng.next() - 0.5) * Math.PI * 1.25;
    const r = R * (0.3 + rng.next() * 0.45);
    const hx = it.x + Math.cos(ang) * r, hz = it.z + Math.sin(ang) * r;
    if (houses.some((h) => Math.hypot(h.x - hx, h.z - hz) < 9)) continue;
    // keep clear of the dock landing
    if (Math.hypot(hx - it.dock.x, hz - it.dock.z) < 12) continue;
    const face = Math.atan2(it.dock.z - hz, it.dock.x - hx); // face towards the dock
    const rot = -face + Math.PI / 2;
    const info = house(it.style, rng, hx - it.x, hz - it.z, rot, parts, windows, smokePoints);
    houses.push({ x: hx, z: hz, rot, ...info });
  }
  const housesMesh = new THREE.Mesh(mergeGeometries(parts), M.stone);
  housesMesh.castShadow = true; housesMesh.receiveShadow = true;
  group.add(housesMesh);
  if (windows.length) group.add(new THREE.Mesh(mergeGeometries(windows), getWindowMaterial()));

  // Dock: planks on posts reaching into the river (local coords relative to it.x/z).
  const dx = Math.cos(toWater), dz = Math.sin(toWater);
  const px = -dz, pz = dx;
  const dockY = it.dock.y - plateau;
  const L = it.dock.length + 3;
  const wood = C('#8a6a48'), dark = C('#5a4430');
  const bx = it.dock.x - it.x - dx * 3, bz = it.dock.z - it.z - dz * 3;
  for (let i = 0; i < L / 0.5; i++) {
    const t = i * 0.5;
    const plank = box(0.45, 0.08, 2.2, 0, 0, 0);
    plank.rotateY(-toWater);
    plank.translate(bx + dx * t, dockY, bz + dz * t);
    woodParts.push(colorize(plank, wood, 0.12, i));
  }
  for (let i = 0; i <= Math.floor(L / 3); i++) {
    for (const s of [-1, 1]) {
      const post = cyl(0.12, 3.2, bx + dx * i * 3 + px * s * 1.05, dockY - 2.9, bz + dz * i * 3 + pz * s * 1.05);
      woodParts.push(colorize(post, dark, 0.08, i));
    }
  }
  // lantern posts at the end of the dock
  const lights = [];
  const endX = bx + dx * L, endZ = bz + dz * L;
  for (const s of [-1, 1]) {
    const lx = endX + px * s * 1.0 - dx * 0.4, lz = endZ + pz * s * 1.0 - dz * 0.4;
    woodParts.push(colorize(cyl(0.06, 2.3, lx, dockY, lz), dark, 0.05, 3));
    lights.push({ x: it.x + lx, y: plateau + dockY + 2.4, z: it.z + lz, color: new THREE.Color(1.0, 0.62, 0.3), intensity: 1.4, range: 18 });
  }
  // trader's stall near the dock base
  const sx = bx - dx * 6 + px * 5, sz = bz - dz * 6 + pz * 5;
  const stall = [
    box(2.6, 0.9, 1.1, 0, 0.45, 0), box(0.1, 2.3, 0.1, -1.2, 1.15, -0.5), box(0.1, 2.3, 0.1, 1.2, 1.15, -0.5),
    box(0.1, 2.3, 0.1, -1.2, 1.15, 0.5), box(0.1, 2.3, 0.1, 1.2, 1.15, 0.5),
  ];
  for (const g of stall) { g.rotateY(-toWater + Math.PI / 2); g.translate(sx, 0, sz); woodParts.push(colorize(g, wood, 0.1, 9)); }
  const awning = box(3.0, 0.08, 1.8, 0, 2.3, 0);
  awning.rotateY(-toWater + Math.PI / 2); awning.translate(sx, 0, sz);
  parts.length = 0;
  const awningColors = ['#c0573f', '#3f7f8a', '#d9913a', '#6a8a3a'];
  const awMesh = new THREE.Mesh(colorize(awning, C(rng.pick(awningColors)), 0.05, 11), M.stone);
  awMesh.castShadow = true;
  group.add(awMesh);
  // crates / baskets of goods
  for (let i = 0; i < 4; i++) {
    const c = box(0.5, 0.4, 0.5, sx + px * (i - 1.5) * 0.7 + dx * 1.2, 0.2, sz + pz * (i - 1.5) * 0.7 + dz * 1.2);
    woodParts.push(colorize(c, C(i % 2 ? '#9a7a4a' : '#7a5a3a'), 0.1, i + 20));
  }
  lights.push({ x: it.x + sx, y: plateau + 2.0, z: it.z + sz, color: new THREE.Color(1.0, 0.65, 0.35), intensity: 1.1, range: 14 });
  // shipwright: a boat on trestles
  if (it.shipwright) {
    const wx = bx - dx * 5 - px * 7, wz = bz - dz * 5 - pz * 7;
    const hull = new THREE.CylinderGeometry(0.8, 0.8, 4, 10, 1, true, 0, Math.PI);
    hull.rotateZ(Math.PI / 2); hull.rotateX(Math.PI);
    hull.rotateY(-toWater); hull.translate(wx, 1.4, wz);
    woodParts.push(colorize(hull, C('#a07850'), 0.1, 31));
    for (const s of [-1, 1]) woodParts.push(colorize(box(0.2, 1.2, 1.4, wx + dx * s * 1.3, 0.6, wz + dz * s * 1.3), dark, 0.1, 32));
    woodParts.push(colorize(box(1.6, 0.9, 0.7, wx + px * 2.2, 0.45, wz + pz * 2.2), wood, 0.1, 33));
  }
  // string lights between the dock and stall at night
  const woodMesh = new THREE.Mesh(mergeGeometries(woodParts), M.wood);
  woodMesh.castShadow = true; woodMesh.receiveShadow = true;
  group.add(woodMesh);
  // glowing lantern bulbs
  const bulbGeo = new THREE.SphereGeometry(0.14, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.05, 0.38) });
  for (const L2 of lights) {
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    b.position.set(L2.x - it.x, L2.y - plateau, L2.z - it.z);
    group.add(b);
  }
  group.userData.bulbMat = bulbMat;
  // chimney smoke
  if (smokePoints.length) {
    const count = smokePoints.length * 8;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = smokePoints[i % smokePoints.length];
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...G },
      vertexShader: /* glsl */ `attribute float aSeed; uniform float uTime; uniform vec3 uWind; varying float vA;
        void main() { float t = fract(uTime * 0.07 + aSeed); vec3 p = position; p.y += t * 9.0; p.xz += uWind.xy * t * 4.0 * (0.5 + uWind.z) + vec2(sin(t * 6.0 + aSeed * 9.0), cos(t * 5.0 + aSeed * 7.0)) * t * 0.8;
        vA = (1.0 - t) * smoothstep(0.0, 0.1, t); vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (1.5 + t * 5.0) * 260.0 / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 uFogColor; uniform float uNight; varying float vA;
        void main() { float d = 1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - 0.5)); vec3 c = mix(vec3(0.75), uFogColor, 0.5) * (1.0 - uNight * 0.8); gl_FragColor = vec4(c, d * vA * 0.3); }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    group.add(pts);
  }
  // NPC spots: trader, fisher on the dock, idle villagers near houses.
  const spots = [{ role: 'trader', x: it.x + sx + dx * 1.0, z: it.z + sz + dz * 1.0, angle: toWater + Math.PI, pose: 'stand' }];
  spots.push({ role: 'fisher', x: it.x + endX - dx * 1.2 + px * 0.6, z: it.z + endZ - dz * 1.2 + pz * 0.6, angle: toWater, pose: 'sit', y: plateau + dockY + 0.1 });
  if (it.shipwright) spots.push({ role: 'shipwright', x: it.x + bx - dx * 5 - px * 5, z: it.z + bz - dz * 5 - pz * 5, angle: toWater, pose: 'stand' });
  for (let i = 0; i < Math.min(houses.length, 3); i++) {
    const h = houses[i];
    spots.push({ role: i === 0 ? 'elder' : 'villager', x: h.x + Math.cos(toWater) * (h.d / 2 + 1.5), z: h.z + Math.sin(toWater) * (h.d / 2 + 1.5), angle: toWater, pose: 'stand' });
  }
  group.userData.npcSpots = spots;
  group.userData.lights = lights;
  group.userData.houses = houses;
  group.position.set(it.x, plateau, it.z);
  group.userData.update = () => {
    const k = G.uNight.value;
    bulbMat.color.setRGB(0.3 + 1.7 * k, 0.2 + 0.85 * k, 0.1 + 0.28 * k); // stays amber after tonemapping
  };
  return group;
}
