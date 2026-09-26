// Procedural model of the Wren, the player's small wooden boat.
// Local axes: +X forward (bow), +Y up, +Z port/left. Waterline at y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTextures } from '../render/ProceduralTextures.js';
import { hexToLinear, smoothstep, lerp } from '../core/math.js';

const L = 4.2;
const B = 0.74; // half beam

function halfBeam(u) {
  if (u < 0.45) return B * lerp(0.62, 1, smoothstep(0, 0.45, u));
  const k = (u - 0.45) / 0.55;
  return B * Math.pow(Math.cos(k * Math.PI / 2), 0.75);
}
function sheer(u) { return 0.36 + 0.2 * u * u * u + 0.07 * (1 - u) * (1 - u); }
function keelDepth(u) { return 0.1 + 0.24 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.6; }

function sectionPoint(u, v, side, inset = 0) {
  const b = Math.max(0.001, halfBeam(u) - inset);
  const d = Math.max(0.02, keelDepth(u) - inset * 0.8);
  const s = sheer(u);
  const y = -d + (s + d) * Math.pow(v, 1.5);
  const z = b * Math.pow(Math.sin(v * Math.PI / 2), 0.65) * side;
  return [(u - 0.5) * L, y, z];
}

function colorAt(v, outer, stripe, paint, bottom, wood) {
  if (!outer) return wood;
  if (v > 0.8 && v < 0.88) return stripe;
  if (v > 0.33) return paint;
  return bottom;
}

function buildHull(colors) {
  const NS = 36, NV = 12;
  const pos = [], col = [], uv = [], idx = [];
  const addSurface = (outer, side) => {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const p = sectionPoint(u, v, side, outer ? 0 : 0.035);
        pos.push(...p);
        const c = colorAt(v, outer, colors.stripe, colors.paint, colors.bottom, colors.wood);
        col.push(...c);
        uv.push(u * 3, v);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
        const flip = (side > 0) !== outer;
        if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    }
  };
  addSurface(true, 1); addSurface(true, -1); addSurface(false, 1); addSurface(false, -1);
  // Gunwale cap strip (outer to inner along the top edge), both sides.
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const u = i / NS;
      const o = sectionPoint(u, 1, side, 0), n = sectionPoint(u, 1, side, 0.035);
      pos.push(o[0], o[1] + 0.035, o[2], n[0], n[1] + 0.035, n[2]);
      col.push(...colors.rail, ...colors.rail);
      uv.push(u * 3, 0, u * 3, 0.1);
    }
    for (let i = 0; i < NS; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  // Transom panel at the stern (u = 0).
  const tb = pos.length / 3;
  const center = sectionPoint(0, 0.5, 1, 0);
  pos.push((0 - 0.5) * L - 0.001, 0.05, 0);
  col.push(...colors.paint); uv.push(0.5, 0.5);
  for (let j = 0; j <= NV; j++) {
    const p = sectionPoint(0, j / NV, 1, 0);
    pos.push(p[0] - 0.001, p[1], p[2]); col.push(...colors.paint); uv.push(0, j / NV);
  }
  for (let j = 0; j <= NV; j++) {
    const p = sectionPoint(0, j / NV, -1, 0);
    pos.push(p[0] - 0.001, p[1], p[2]); col.push(...colors.paint); uv.push(1, j / NV);
  }
  for (let j = 0; j < NV; j++) {
    idx.push(tb, tb + 1 + j + 1, tb + 1 + j);
    idx.push(tb, tb + NV + 2 + j, tb + NV + 2 + j + 1);
  }
  void center;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, x, y, z, color, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  paint(g, color);
  return g;
}

function cyl(r1, r2, h, x, y, z, color, seg = 8, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  paint(g, color);
  return g;
}

export function paint(g, color) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function merge(list) {
  const clean = list.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) ng.deleteAttribute(k);
    if (!ng.attributes.normal) ng.computeVertexNormals();
    return ng;
  });
  return mergeGeometries(clean, false);
}

/** Top-down outline polygon of the hull at gunwale level (for the water occluder). */
function occluderGeometry() {
  const shape = new THREE.Shape();
  const NS = 24;
  const pts = [];
  for (let i = 0; i <= NS; i++) { const u = i / NS; pts.push([(u - 0.5) * L, halfBeam(u) * 0.97]); }
  for (let i = NS; i >= 0; i--) { const u = i / NS; pts.push([(u - 0.5) * L, -halfBeam(u) * 0.97]); }
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) shape.lineTo(p[0], p[1]);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2); // shape (x, y) -> (x, 0, y)
  g.translate(0, 0.36, 0);
  return g;
}

export class BoatModel {
  constructor() {
    const tex = getTextures();
    this.group = new THREE.Group();
    this.group.name = 'Wren';
    this.hullGroup = new THREE.Group(); // pitched/rolled by physics
    this.group.add(this.hullGroup);
    this.colors = {
      paint: hexToLinear('#2f6f73'), stripe: hexToLinear('#eadfc4'), bottom: hexToLinear('#7a3428'),
      wood: hexToLinear('#b5875a'), rail: hexToLinear('#8a5a34'), dark: hexToLinear('#4a3322'), brass: hexToLinear('#c9a255'),
      canvas: hexToLinear('#d9cdb0'), rope: hexToLinear('#b8a07a'), red: hexToLinear('#b8483a'),
    };
    this.woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.wood, roughness: 0.78, metalness: 0.0 });
    this.woodMat.map.colorSpace = THREE.NoColorSpace;
    this.hull = new THREE.Mesh(buildHull(this.colors), this.woodMat);
    this.hull.castShadow = true;
    this.hull.receiveShadow = true;
    this.hullGroup.add(this.hull);

    // Interior: floorboards, ribs, thwarts, stem post.
    const c = this.colors;
    const parts = [];
    parts.push(box(2.9, 0.035, 0.7, 0.05, -0.16, 0, c.wood));
    for (let i = 0; i < 7; i++) {
      const u = 0.12 + i * 0.12;
      const x = (u - 0.5) * L;
      const b = halfBeam(u) - 0.05;
      for (const side of [1, -1]) {
        const p0 = sectionPoint(u, 0.25, side, 0.04), p1 = sectionPoint(u, 0.95, side, 0.04);
        const len = Math.hypot(p1[1] - p0[1], p1[2] - p0[2]);
        const g = new THREE.BoxGeometry(0.035, len, 0.04);
        g.rotateX(Math.atan2(p1[2] - p0[2], p1[1] - p0[1]) * -1);
        g.translate(x, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
        paint(g, c.rail);
        parts.push(g);
      }
      void b;
    }
    this.seatX = 0.0;
    for (const [u, w] of [[0.33, 0.3], [0.6, 0.26], [0.82, 0.22]]) {
      const x = (u - 0.5) * L;
      parts.push(box(w, 0.04, halfBeam(u) * 2 - 0.1, x, 0.14, 0, c.wood));
    }
    // stem post at the bow and a small foredeck
    parts.push(cyl(0.04, 0.05, 0.55, L * 0.5 - 0.02, 0.35, 0, c.rail, 6, 0, -0.35));
    parts.push(box(0.5, 0.03, 0.34, L * 0.5 - 0.42, 0.44, 0, c.wood));
    // oarlocks
    this.oarlockX = -0.05;
    for (const side of [1, -1]) {
      const z = (halfBeam(0.49) - 0.02) * side;
      parts.push(cyl(0.02, 0.02, 0.1, this.oarlockX, 0.47, z, c.brass, 6));
    }
    // lantern post at the stern
    this.lanternPostX = -L * 0.5 + 0.28;
    parts.push(cyl(0.03, 0.035, 1.35, this.lanternPostX, 0.9, 0, c.rail, 6));
    const arm = new THREE.TorusGeometry(0.18, 0.018, 5, 10, Math.PI * 0.6);
    arm.rotateY(Math.PI / 2);
    arm.rotateX(0);
    arm.translate(this.lanternPostX, 1.45, 0.0);
    paint(arm, c.dark);
    parts.push(arm);
    // rod holder + a coil of rope + bow bumper
    parts.push(cyl(0.025, 0.025, 0.4, -0.9, 0.45, -0.5, c.dark, 6, 0.4));
    const rope = new THREE.TorusGeometry(0.1, 0.03, 5, 12);
    rope.rotateX(Math.PI / 2); rope.translate(1.2, -0.1, 0.15); paint(rope, c.rope);
    parts.push(rope);
    this.interior = new THREE.Mesh(merge(parts), this.woodMat);
    this.interior.castShadow = true;
    this.interior.receiveShadow = true;
    this.hullGroup.add(this.interior);

    // Oars (pivot at oarlocks).
    this.oars = [];
    const oarGeo = merge([
      cyl(0.022, 0.022, 2.1, 0.3, 0, 0, c.wood, 6, 0, Math.PI / 2),
      box(0.42, 0.012, 0.14, 1.2, 0, 0, c.paint),
      cyl(0.026, 0.026, 0.25, -0.62, 0, 0, c.dark, 6, 0, Math.PI / 2),
    ]);
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(this.oarlockX, 0.5, (halfBeam(0.49) - 0.02) * side);
      const oar = new THREE.Mesh(oarGeo, this.woodMat);
      oar.castShadow = true;
      // Oar local +X points outboard from the lock; the grip is 0.62 m inboard.
      const holder = new THREE.Group();
      holder.add(oar);
      holder.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      pivot.add(holder);
      this.hullGroup.add(pivot);
      this.oars.push({ side, pivot, holder, oar });
    }

    // Lantern.
    this.lantern = new THREE.Group();
    this.lantern.position.set(this.lanternPostX + 0.28, 1.45, 0);
    this.lanternSwing = new THREE.Group();
    this.lantern.add(this.lanternSwing);
    const frame = merge([
      cyl(0.075, 0.09, 0.03, 0, -0.1, 0, c.brass, 8),
      cyl(0.06, 0.09, 0.07, 0, 0.13, 0, c.brass, 8),
      cyl(0.008, 0.008, 0.2, 0.065, 0.015, 0, c.brass, 4),
      cyl(0.008, 0.008, 0.2, -0.065, 0.015, 0, c.brass, 4),
      cyl(0.008, 0.008, 0.2, 0, 0.015, 0.065, c.brass, 4),
      cyl(0.008, 0.008, 0.2, 0, 0.015, -0.065, c.brass, 4),
      (() => { const t = new THREE.TorusGeometry(0.04, 0.008, 4, 10); t.translate(0, 0.2, 0); return paint(t, c.brass); })(),
    ]);
    this.brassMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.35 });
    const frameMesh = new THREE.Mesh(frame, this.brassMat);
    frameMesh.castShadow = true;
    frameMesh.position.y = -0.22;
    this.lanternSwing.add(frameMesh);
    this.glassMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: new THREE.Color(1.0, 0.62, 0.28), emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.85 });
    this.glass = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.17, 10), this.glassMat);
    this.glass.position.y = -0.2;
    this.lanternSwing.add(this.glass);
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.5, 1.6) }));
    this.flame.position.y = -0.21;
    this.flame.scale.y = 1.7;
    this.lanternSwing.add(this.flame);
    this.light = new THREE.PointLight(0xffb060, 0, 22, 1.6);
    this.light.position.y = -0.2;
    this.light.castShadow = false;
    this.lanternSwing.add(this.light);
    this.hullGroup.add(this.lantern);

    // Pennant flag at the bow post.
    this.flagMat = new THREE.MeshStandardMaterial({ color: 0xc8503c, roughness: 0.8, side: THREE.DoubleSide });
    this.flagMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFlagTime = this.flagTime = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlagTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float f = max(0.0, position.x);
        transformed.z += sin(uFlagTime * 7.0 - f * 9.0) * 0.05 * f * 3.0;
        transformed.y += sin(uFlagTime * 5.0 - f * 7.0) * 0.015 * f;`);
    };
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, 0, -0.09, 0, 0.42, 0, 0, 0.21, 0.045, 0, 0.21, -0.045, 0], 3));
    flagGeo.setIndex([0, 1, 3, 3, 1, 4, 3, 4, 2]);
    flagGeo.computeVertexNormals();
    this.flag = new THREE.Mesh(flagGeo, this.flagMat);
    this.flag.position.set(L * 0.5 + 0.1, 0.62, 0);
    this.flag.rotation.y = Math.PI;
    this.hullGroup.add(this.flag);

    // Water occluder: keeps the river surface out of the hull interior.
    this.occluder = new THREE.Mesh(occluderGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide }));
    this.occluder.renderOrder = 0.5;
    this.hullGroup.add(this.occluder);

    // Upgrade visuals (toggled by the progression system).
    this.upgradeParts = {};
    this.buildUpgrades();
    this.oarPhase = 0;
    this.time = 0;
  }

  buildUpgrades() {
    const c = this.colors;
    const canvasMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: getTextures().canvas, roughness: 0.95, side: THREE.DoubleSide });
    // Awning (comfort): canvas arc over the stern half.
    const aw = new THREE.CylinderGeometry(0.78, 0.78, 1.25, 12, 1, true, -Math.PI / 2, Math.PI);
    aw.rotateZ(Math.PI / 2);
    aw.rotateX(Math.PI / 2);
    aw.scale(1, 0.55, 1);
    aw.translate(-0.95, 0.72, 0);
    paint(aw, c.canvas);
    const hoops = merge([
      (() => { const t = new THREE.TorusGeometry(0.78, 0.015, 4, 16, Math.PI); t.scale(1, 0.55, 1); t.rotateY(Math.PI / 2); t.translate(-0.35, 0.72, 0); return paint(t, c.rail); })(),
      (() => { const t = new THREE.TorusGeometry(0.78, 0.015, 4, 16, Math.PI); t.scale(1, 0.55, 1); t.rotateY(Math.PI / 2); t.translate(-1.55, 0.72, 0); return paint(t, c.rail); })(),
    ]);
    const awning = new THREE.Group();
    const awMesh = new THREE.Mesh(aw, canvasMat); awMesh.castShadow = true;
    awning.add(awMesh, new THREE.Mesh(hoops, this.woodMat));
    awning.visible = false;
    this.hullGroup.add(awning);
    this.upgradeParts.awning = awning;
    // Storage crates & baskets.
    const crates = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const crate = new THREE.Mesh(merge([box(0.32, 0.26, 0.36, 0, 0, 0, c.wood), box(0.34, 0.03, 0.38, 0, 0.12, 0, c.rail)]), this.woodMat);
      crate.castShadow = true;
      g.add(crate);
      g.position.set(-1.35 + i * 0.05, -0.02, (i - 1) * 0.36);
      g.rotation.y = (i - 1) * 0.15;
      g.visible = false;
      this.hullGroup.add(g);
      crates.push(g);
    }
    this.upgradeParts.crates = crates;
    // Mast and sail.
    const sail = new THREE.Group();
    const mast = new THREE.Mesh(cyl(0.035, 0.045, 3.2, 1.15, 1.6, 0, c.rail, 6), this.woodMat);
    mast.castShadow = true;
    const sg = new THREE.BufferGeometry();
    const sp = [], si = [];
    const R = 8, C = 6;
    for (let j = 0; j <= R; j++) for (let i = 0; i <= C; i++) { const u = i / C, v = j / R; sp.push(1.12 - u * 1.9 * (1 - v * 0.8), 0.4 + v * 2.8, 0); }
    for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) { const a = j * (C + 1) + i; si.push(a, a + 1, a + C + 1, a + 1, a + C + 2, a + C + 1); }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    paint(sg, c.canvas);
    this.sailMesh = new THREE.Mesh(sg, canvasMat);
    this.sailMesh.castShadow = true;
    this.sailBase = sp.slice();
    sail.add(mast, this.sailMesh);
    sail.visible = false;
    this.hullGroup.add(sail);
    this.upgradeParts.sail = sail;
    // Clockwork paddle wheel at the stern.
    const wheel = new THREE.Group();
    const wparts = [cyl(0.36, 0.36, 0.05, 0, 0, 0, c.dark, 12, Math.PI / 2)];
    for (let i = 0; i < 6; i++) {
      const g = box(0.06, 0.3, 0.32, 0, 0.3, 0, c.wood);
      g.rotateZ((i / 6) * Math.PI * 2);
      wparts.push(g);
    }
    this.wheelMesh = new THREE.Mesh(merge(wparts), this.woodMat);
    this.wheelMesh.castShadow = true;
    wheel.add(this.wheelMesh);
    wheel.position.set(-L * 0.5 - 0.3, 0.12, 0);
    const housing = new THREE.Mesh(merge([box(0.8, 0.05, 0.42, -L * 0.5 - 0.3, 0.52, 0, c.paint), box(0.25, 0.3, 0.3, -L * 0.5 + 0.05, 0.3, 0, c.brass)]), this.brassMat);
    const wheelGroup = new THREE.Group();
    wheelGroup.add(wheel, housing);
    wheelGroup.visible = false;
    this.hullGroup.add(wheelGroup);
    this.wheel = wheel;
    this.upgradeParts.paddlewheel = wheelGroup;
    // Figurehead (cosmetic): a carved heron head.
    const fig = new THREE.Mesh(merge([
      cyl(0.03, 0.05, 0.35, 0, 0, 0, c.stripe, 6, 0, -0.9),
      (() => { const g = new THREE.SphereGeometry(0.07, 8, 6); g.translate(0.16, 0.12, 0); return paint(g, c.stripe); })(),
      (() => { const g = new THREE.ConeGeometry(0.025, 0.2, 6); g.rotateZ(-Math.PI / 2); g.translate(0.3, 0.1, 0); return paint(g, c.brass); })(),
    ]), this.woodMat);
    fig.position.set(L * 0.5 + 0.02, 0.6, 0);
    fig.visible = false;
    this.hullGroup.add(fig);
    this.upgradeParts.figurehead = fig;
  }

  /** Apply the player's upgrade state to visuals. */
  applyUpgrades(state) {
    const storage = state.storage ?? 0;
    this.upgradeParts.crates.forEach((c, i) => { c.visible = storage > i; });
    this.upgradeParts.awning.visible = (state.comfort ?? 0) >= 1;
    this.upgradeParts.sail.visible = state.propulsion === 'sail' || state.propulsion === 'paddlewheel';
    this.upgradeParts.paddlewheel.visible = state.propulsion === 'paddlewheel';
    this.upgradeParts.figurehead.visible = !!state.figurehead;
    for (const o of this.oars) o.pivot.visible = state.propulsion !== 'paddlewheel' || state.rowing;
    if (state.paint) {
      const col = hexToLinear(state.paint);
      const g = this.hull.geometry;
      const c = g.attributes.color;
      for (let i = 0; i < c.count; i++) {
        const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
        const p = this.colors.paint;
        if (Math.abs(r - p[0]) < 0.002 && Math.abs(gg - p[1]) < 0.002 && Math.abs(b - p[2]) < 0.002) c.setXYZ(i, col[0], col[1], col[2]);
      }
      this.colors.paint = col;
      c.needsUpdate = true;
    }
    const lanternTier = state.lantern ?? 0;
    this.lanternRange = [18, 26, 34][lanternTier] ?? 18;
    this.lanternPower = [1.0, 1.35, 1.7][lanternTier] ?? 1;
    this.glassMat.color.set(lanternTier >= 2 ? 0xc8f0ff : 0xffd9a0);
    this.lanternTint = lanternTier >= 2 ? [0.75, 0.9, 1.0] : [1.0, 0.62, 0.3];
  }

  /**
   * @param s { dt, stroke (0..1), rowing, throttle, pitch, roll, yawRate, speed, lanternOn, lanternLevel, wind, propulsion }
   */
  update(s) {
    this.time += s.dt;
    this.hullGroup.rotation.set(s.roll, 0, s.pitch, 'YXZ');
    // Oars: sweep during the stroke; blade dips in the drive phase.
    const ph = s.stroke;
    const rowing = s.rowing;
    for (const o of this.oars) {
      let sweep, lift;
      if (rowing) {
        // drive: blade moves aft (handles pushed forward), recovery: blade forward in the air
        const drive = ph < 0.5;
        const k = drive ? ph / 0.5 : (ph - 0.5) / 0.5;
        sweep = drive ? lerp(0.5, -0.45, easeSine(k)) : lerp(-0.45, 0.5, easeSine(k));
        lift = drive ? -0.44 : -0.2 + Math.sin(k * Math.PI) * 0.1;
        sweep += s.steerBias * 0.25 * o.side;
      } else {
        // resting: oars trailing alongside, blades on the water
        sweep = -0.95;
        lift = -0.34 + Math.sin(this.time * 0.7 + o.side) * 0.01;
      }
      o.pivot.rotation.set(-lift * o.side, sweep * o.side, 0, 'YXZ');
      o.sweep = sweep; o.lift = lift;
    }
    // Lantern swings like a pendulum driven by boat motion.
    this.swingVel = (this.swingVel ?? 0) + (-(this.swing ?? 0) * 18 - (this.swingVel ?? 0) * 1.6 - s.rollVel * 3 - s.yawRate * s.speed * 0.4) * s.dt;
    this.swing = (this.swing ?? 0) + this.swingVel * s.dt;
    this.swingVel2 = (this.swingVel2 ?? 0) + (-(this.swing2 ?? 0) * 18 - (this.swingVel2 ?? 0) * 1.6 - s.pitchVel * 3 + (s.accel ?? 0) * 0.3) * s.dt;
    this.swing2 = (this.swing2 ?? 0) + this.swingVel2 * s.dt;
    this.lanternSwing.rotation.set(this.swing, 0, this.swing2);
    // Flame flicker and light.
    const flicker = 0.92 + Math.sin(this.time * 17) * 0.03 + Math.sin(this.time * 31.7) * 0.025 + Math.sin(this.time * 5.3) * 0.03;
    const on = s.lanternLevel ?? 0;
    const tint = this.lanternTint ?? [1, 0.62, 0.3];
    this.light.intensity = on * 5.5 * flicker * (this.lanternPower ?? 1);
    this.light.distance = this.lanternRange ?? 18;
    this.light.color.setRGB(tint[0], tint[1], tint[2]);
    this.glassMat.emissiveIntensity = on * 1.5 * flicker;
    this.glassMat.emissive.setRGB(tint[0], tint[1], tint[2]);
    this.flame.visible = on > 0.05;
    this.flame.scale.set(1, 1.6 + Math.sin(this.time * 23) * 0.2, 1);
    if (this.flagTime) this.flagTime.value = this.time * (0.6 + Math.min(1.5, s.speed * 0.2 + (s.windStrength ?? 0)));
    this.flag.rotation.y = Math.PI + Math.sin(this.time * 0.8) * 0.2;
    // Paddle wheel.
    if (this.upgradeParts.paddlewheel.visible) this.wheel.rotation.z -= s.dt * s.speed * 2.2;
    // Sail billow.
    if (this.upgradeParts.sail.visible) {
      const p = this.sailMesh.geometry.attributes.position;
      const billow = 0.15 + Math.min(0.5, s.windStrength ?? 0) * 0.5;
      for (let i = 0; i < p.count; i++) {
        const x = this.sailBase[i * 3], y = this.sailBase[i * 3 + 1];
        const u = (1.12 - x) / 1.9, v = (y - 0.4) / 2.8;
        p.setZ(i, Math.sin(Math.min(1, u) * Math.PI) * (1 - v * 0.4) * billow * (1 + Math.sin(this.time * 2 + v * 3) * 0.08));
      }
      p.needsUpdate = true;
      this.sailMesh.geometry.computeVertexNormals();
    }
  }

  /** World-space position of an oar blade tip (for splashes). */
  oarTipWorld(o, out = new THREE.Vector3()) {
    out.set(1.38, 0, 0);
    return o.oar.localToWorld(out);
  }

  /** Handle position (local to hullGroup) for the rower's hands. */
  handleLocal(o, out = new THREE.Vector3()) {
    out.set(-0.62, 0, 0);
    o.oar.localToWorld(out);
    return this.hullGroup.worldToLocal(out);
  }
}

function easeSine(t) { return 0.5 - 0.5 * Math.cos(t * Math.PI); }

export const BOAT_DIMENSIONS = { length: L, halfBeam: B, seatHeight: 0.16, rowerX: (0.33 - 0.5) * L };
