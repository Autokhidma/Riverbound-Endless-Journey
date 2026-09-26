// Wildlife with lightweight AI, pooled around the player and driven by biome
// weights and time of day:
//   birds (flocks), herons (wade, take off when approached), butterflies (day),
//   fireflies (night, GPU points), jumping fish (fishing cues), frogs (dusk/night),
//   deer (drink at the banks, flee), and floaters on the water (petals, leaves,
//   ice, lumen motes).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, attachGlobals } from '../render/globalUniforms.js';
import { noReflect } from '../render/layers.js';
import { hexToLinear, clamp, lerp, angleDiff } from '../core/math.js';
import { paint } from '../boat/BoatModel.js';

const C = (h) => hexToLinear(h);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export const SPECIES_INFO = {
  songbird: { name: 'River Swift', desc: 'Small quick birds that skim the water for insects at dusk.' },
  heron: { name: 'Grey Heron', desc: 'Patient wader of the shallows. Lifts off with slow, heavy wingbeats.' },
  butterfly: { name: 'Meadow Butterfly', desc: 'Drifts from flower to flower on warm, still days.' },
  firefly: { name: 'Firefly', desc: 'Tiny lanterns of the riverbank night.' },
  fish: { name: 'Leaping Fish', desc: 'A splash and a ring of ripples: a good place to cast a line.' },
  frog: { name: 'Reed Frog', desc: 'Sings from the lily pads after dark.' },
  deer: { name: 'River Deer', desc: 'Comes down to drink at dawn and dusk. Easily startled.' },
};

function birdGeometry() {
  // body + two wings (wing vertices marked with aWing for flapping)
  const body = new THREE.ConeGeometry(0.08, 0.45, 5).rotateZ(-Math.PI / 2);
  const wing = (s) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0, 0, -0.1, 0, 0, -0.02, 0, 0.55 * s], 3));
    g.setIndex(s > 0 ? [0, 1, 2] : [0, 2, 1]);
    g.computeVertexNormals();
    return g;
  };
  const parts = [paint(body, C('#3a3a40')), paint(wing(1), C('#4a4a52')), paint(wing(-1), C('#4a4a52'))];
  const clean = parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
  const geo = mergeGeometries(clean);
  const p = geo.attributes.position;
  const wingW = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) wingW[i] = Math.abs(p.getZ(i)) / 0.55;
  geo.setAttribute('aWing', new THREE.BufferAttribute(wingW, 1));
  return geo;
}

function heronGeometry() {
  const grey = C('#8a8e96'), dark = C('#3a3c44'), beak = C('#c8a040');
  const parts = [
    paint(new THREE.SphereGeometry(0.28, 8, 6).scale(1.5, 0.8, 0.8).translate(0, 1.0, 0), grey),
    paint(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 5).rotateZ(-0.5).translate(0.3, 1.35, 0), grey),
    paint(new THREE.SphereGeometry(0.09, 6, 5).translate(0.46, 1.62, 0), grey),
    paint(new THREE.ConeGeometry(0.03, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.66, 1.6, 0), beak),
    paint(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).translate(-0.05, 0.4, 0.08), dark),
    paint(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).translate(-0.05, 0.4, -0.08), dark),
    paint(new THREE.BoxGeometry(0.6, 0.05, 0.5).translate(-0.1, 1.08, 0.3), dark),
    paint(new THREE.BoxGeometry(0.6, 0.05, 0.5).translate(-0.1, 1.08, -0.3), dark),
  ];
  return mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
}

function deerGeometry() {
  const fur = C('#8a5e3a'), light = C('#d8c0a0'), dark = C('#3a2a1e');
  const parts = [
    paint(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8).rotateZ(Math.PI / 2).translate(0, 1.0, 0), fur),
    paint(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 6).rotateZ(-0.7).translate(0.55, 1.3, 0), fur),
    paint(new THREE.SphereGeometry(0.14, 8, 6).scale(1.4, 1, 0.9).translate(0.8, 1.55, 0), fur),
    paint(new THREE.SphereGeometry(0.06, 6, 5).translate(-0.55, 1.15, 0), light),
  ];
  for (const [x, z] of [[0.35, 0.14], [0.35, -0.14], [-0.35, 0.14], [-0.35, -0.14]]) parts.push(paint(new THREE.CylinderGeometry(0.04, 0.035, 0.8, 5).translate(x, 0.4, z), dark));
  for (const z of [0.07, -0.07]) parts.push(paint(new THREE.CylinderGeometry(0.012, 0.02, 0.35, 4).rotateZ(0.3).translate(0.75, 1.8, z), dark));
  return mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
}

function frogGeometry() {
  const green = C('#5a8a3a');
  const parts = [paint(new THREE.SphereGeometry(0.07, 7, 5).scale(1.3, 0.7, 1), green), paint(new THREE.SphereGeometry(0.02, 5, 4).translate(0.06, 0.04, 0.03), C('#1a1a1a')), paint(new THREE.SphereGeometry(0.02, 5, 4).translate(0.06, 0.04, -0.03), C('#1a1a1a'))];
  return mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
}

function flapMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    attachGlobals(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWing;\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = instanceMatrix[3].x * 1.3 + instanceMatrix[3].z * 0.7;
      #endif
      transformed.y += sin(uTime * 14.0 + ph) * aWing * 0.35;`);
  };
  m.customProgramCacheKey = () => 'rb-flap';
  return m;
}

export class Wildlife {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    game.scene.add(this.group);
    this.birdMat = flapMaterial();
    this.stdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.birds = new THREE.InstancedMesh(birdGeometry(), this.birdMat, 60);
    this.birds.count = 0;
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
    this.herons = new THREE.InstancedMesh(heronGeometry(), this.stdMat, 6);
    this.herons.count = 0; this.herons.castShadow = true; this.herons.frustumCulled = false;
    this.group.add(this.herons);
    this.deer = new THREE.InstancedMesh(deerGeometry(), this.stdMat, 6);
    this.deer.count = 0; this.deer.castShadow = true; this.deer.frustumCulled = false;
    this.group.add(this.deer);
    this.frogs = new THREE.InstancedMesh(frogGeometry(), this.stdMat, 20);
    this.frogs.count = 0; this.frogs.frustumCulled = false;
    this.group.add(this.frogs);
    this.flocks = [];
    this.heronList = [];
    this.deerList = [];
    this.frogList = [];
    this.jumps = [];
    this.fishMesh = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 5).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.5, roughness: 0.3 }));
    this.fishMesh.visible = false;
    this.group.add(this.fishMesh);
    this.createFireflies();
    this.createButterflies();
    this.createFloaters();
    this.spawnTimer = 0;
    this.jumpTimer = 4;
    this.spotted = new Set();
  }

  onWorldDispose() {
    this.flocks = []; this.heronList = []; this.deerList = []; this.frogList = []; this.jumps = [];
  }

  setQuality(q) {
    this.density = q.wildlife ?? 1;
  }

  createFireflies() {
    const n = 420;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random(); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.fireflyMat = new THREE.ShaderMaterial({
      uniforms: { ...G, uCount: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uGround: { value: 0 }, uRadius: { value: 55 }, uColor: { value: new THREE.Color(1.0, 0.95, 0.45) } },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uRadius; uniform float uCount; uniform float uGround;
        varying float vA;
        void main() {
          float idx = float(gl_VertexID);
          vec3 base = vec3((aSeed.x - 0.5) * 2.0 * uRadius, 0.0, (aSeed.z - 0.5) * 2.0 * uRadius);
          vec3 anchor = vec3(floor((uCenter.x - base.x) / (uRadius * 2.0) + 0.5) * uRadius * 2.0 + base.x, 0.0, floor((uCenter.z - base.z) / (uRadius * 2.0) + 0.5) * uRadius * 2.0 + base.z);
          vec3 p = anchor + vec3(sin(uTime * 0.3 + aSeed.y * 40.0) * 2.0, uGround + 0.4 + aSeed.y * 2.5 + sin(uTime * 0.7 + aSeed.x * 30.0) * 0.5, cos(uTime * 0.25 + aSeed.z * 40.0) * 2.0);
          float blink = pow(max(0.0, sin(uTime * (0.8 + aSeed.x) + aSeed.y * 60.0)), 3.0);
          vA = blink * step(idx, uCount) * (1.0 - smoothstep(uRadius * 0.6, uRadius, length(p.xz - uCenter.xz)));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 150.0 / max(1.0, -mv.z) + 2.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5); float g = exp(-d * d * 22.0) + exp(-d * d * 120.0) * 2.0; if (vA * g < 0.01) discard; gl_FragColor = vec4(uColor * 2.5 * g, vA * min(1.0, g)); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.fireflies = new THREE.Points(g, this.fireflyMat);
    this.fireflies.frustumCulled = false;
    noReflect(this.fireflies);
    this.group.add(this.fireflies);
  }

  createButterflies() {
    const n = 40;
    const geo = new THREE.PlaneGeometry(0.16, 0.1);
    geo.translate(0.08, 0, 0);
    const wingR = geo.clone(), wingL = geo.clone().rotateY(Math.PI);
    const merged = mergeGeometries([wingR, wingL]);
    const wing = new Float32Array(merged.attributes.position.count).fill(1);
    merged.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
    this.butterflyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.butterflyMat.onBeforeCompile = (sh) => {
      attachGlobals(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = 0.0;
        #ifdef USE_INSTANCING
          ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
        #endif
        float a = sin(uTime * 18.0 + ph) * 1.1;
        float s = sign(position.x);
        transformed = vec3(position.x * cos(a), abs(position.x) * sin(a), position.z);`);
    };
    this.butterflies = new THREE.InstancedMesh(merged, this.butterflyMat, n);
    this.butterflies.count = 0;
    this.butterflies.frustumCulled = false;
    this.bflies = [];
    for (let i = 0; i < n; i++) this.bflies.push({ x: 0, y: 0, z: 0, vx: 0, vz: 0, t: Math.random() * 10, color: new THREE.Color().setHSL(Math.random(), 0.7, 0.6) });
    for (let i = 0; i < n; i++) this.butterflies.setColorAt(i, this.bflies[i].color);
    this.group.add(this.butterflies);
  }

  createFloaters() {
    const n = 160;
    const geo = new THREE.PlaneGeometry(0.12, 0.08).rotateX(-Math.PI / 2);
    this.floatMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x000000 });
    this.floaters = new THREE.InstancedMesh(geo, this.floatMat, n);
    this.floaters.count = 0;
    this.floaters.frustumCulled = false;
    this.floatList = [];
    for (let i = 0; i < n; i++) this.floatList.push({ x: 0, z: 0, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.3, alive: false, scale: 0.8 + Math.random() * 0.8 });
    this.group.add(this.floaters);
    this.floaterKind = null;
  }

  update(dt, game) {
    const p = game.player();
    const time = game.time;
    const bl = game.world.biomeAt(p.x, p.z);
    const wl = (k) => lerp(bl.a.wildlife[k] ?? 0, bl.b.wildlife[k] ?? 0, bl.t) * (this.density ?? 1);
    const day = 1 - time.nightFactor;
    const o = game.origin;
    this.group.position.set(-o.x, 0, -o.z); // absolute coords inside
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      this.spawnAround(game, p, wl, day);
    }
    this.updateBirds(dt, game, p, day);
    this.updateHerons(dt, game, p);
    this.updateDeer(dt, game, p);
    this.updateFrogs(dt, game, p, wl);
    this.updateButterflies(dt, game, p, wl('butterflies') * day * (1 - game.weather.rain));
    this.updateFireflies(dt, game, p, wl('fireflies') * time.nightFactor * (1 - game.weather.rain) * (1 - game.weather.snow));
    this.updateFish(dt, game, p, wl('fish'));
    this.updateFloaters(dt, game, p, bl);
  }

  noteSpotted(game, species) {
    if (this.spotted.has(species)) return;
    this.spotted.add(species);
    game.events.emit('wildlife:spotted', { species });
  }

  spawnAround(game, p, wl, day) {
    const world = game.world;
    // Bird flocks.
    const maxFlocks = Math.round(3 * Math.min(1.5, wl('birds')));
    while (this.flocks.length < maxFlocks && day > 0.2) {
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 180;
      const cx = p.x + Math.cos(a) * r, cz = p.z + Math.sin(a) * r;
      const n = 4 + Math.floor(Math.random() * 8);
      const flock = { cx, cz, y: world.heightAt(cx, cz) + 25 + Math.random() * 25, heading: Math.random() * 6, radius: 30 + Math.random() * 40, speed: 7 + Math.random() * 4, birds: [], life: 60 + Math.random() * 60 };
      for (let i = 0; i < n; i++) flock.birds.push({ off: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8), ph: Math.random() * 6 });
      this.flocks.push(flock);
    }
    if (day < 0.2) this.flocks.length = Math.min(this.flocks.length, 1);
    this.flocks = this.flocks.filter((f) => f.life > 0 && Math.hypot(f.cx - p.x, f.cz - p.z) < 500);
    // Herons in the shallows ahead.
    if (this.heronList.length < Math.round(2 * wl('herons')) && day > 0.1) {
      const s = game.boat.physics.s + (Math.random() < 0.7 ? 1 : -1) * (60 + Math.random() * 140);
      const r = world.main.sample(s, {});
      const side = Math.random() < 0.5 ? -1 : 1;
      const t = side * (r.w * 0.5 - 1.5);
      const pos = world.riverToWorld(s, t);
      const w = world.waterInfo(pos.x, pos.z, {});
      if (w.depth > -0.2 && w.depth < 0.6) this.heronList.push({ x: pos.x, z: pos.z, y: Math.max(w.height, w.level - 0.3), heading: r.h + side * 1.2, state: 'wade', t: 0, vy: 0 });
    }
    this.heronList = this.heronList.filter((h) => Math.hypot(h.x - p.x, h.z - p.z) < 400 && h.y < 200);
    // Deer drinking at the banks at dawn/dusk.
    const hour = game.time.hours;
    const twilightish = (hour > 5 && hour < 9) || (hour > 16.5 && hour < 20.5);
    if (this.deerList.length < Math.round((twilightish ? 2 : 0.6) * wl('deer'))) {
      const s = game.boat.physics.s + (60 + Math.random() * 160);
      const r = world.main.sample(s, {});
      const side = Math.random() < 0.5 ? -1 : 1;
      const pos = world.riverToWorld(s, side * (r.w * 0.5 + 2.5));
      const h = world.heightAt(pos.x, pos.z);
      if (h > r.wl && h < r.wl + 2.5) this.deerList.push({ x: pos.x, z: pos.z, y: h, heading: r.h + side * Math.PI / 2 + Math.PI, state: 'drink', t: 0, speed: 0 });
    }
    this.deerList = this.deerList.filter((d) => Math.hypot(d.x - p.x, d.z - p.z) < 350);
  }

  updateBirds(dt, game, p, day) {
    let n = 0;
    for (const f of this.flocks) {
      f.life -= dt;
      f.heading += dt * f.speed / f.radius;
      const cx = f.cx + Math.cos(f.heading) * f.radius, cz = f.cz + Math.sin(f.heading) * f.radius;
      const dir = f.heading + Math.PI / 2;
      for (const b of f.birds) {
        if (n >= 60) break;
        const bx = cx + b.off.x + Math.sin(game.elapsed * 0.8 + b.ph) * 1.5, by = f.y + b.off.y + Math.sin(game.elapsed * 1.3 + b.ph) * 0.8, bz = cz + b.off.z;
        _q.setFromEuler(_e.set(0, -dir, Math.sin(game.elapsed + b.ph) * 0.1));
        _m.compose(_p.set(bx, by, bz), _q, _s.set(1.4, 1.4, 1.4));
        this.birds.setMatrixAt(n++, _m);
      }
      if (Math.hypot(cx - p.x, cz - p.z) < 90) this.noteSpotted(game, 'songbird');
    }
    this.birds.count = n;
    this.birds.instanceMatrix.needsUpdate = true;
    void day;
  }

  updateHerons(dt, game, p) {
    let n = 0;
    for (const h of this.heronList) {
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (h.state === 'wade') {
        h.t += dt;
        if (d < 26) { h.state = 'fly'; h.t = 0; game.events.emit('wildlife:flee', { species: 'heron', x: h.x, z: h.z }); }
        if (d < 60) this.noteSpotted(game, 'heron');
      } else {
        h.t += dt;
        h.vy = Math.min(3.5, h.vy + dt * 2.5);
        h.y += h.vy * dt;
        h.x += Math.cos(h.heading) * dt * 7;
        h.z += Math.sin(h.heading) * dt * 7;
      }
      const bob = h.state === 'wade' ? Math.sin(h.t * 0.7) * 0.05 : 0;
      _q.setFromEuler(_e.set(0, -h.heading, 0));
      _m.compose(_p.set(h.x, h.y + bob, h.z), _q, _s.set(1, 1, 1));
      this.herons.setMatrixAt(n++, _m);
      if (n >= 6) break;
    }
    this.herons.count = n;
    this.herons.instanceMatrix.needsUpdate = true;
  }

  updateDeer(dt, game, p) {
    let n = 0;
    for (const d of this.deerList) {
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      if (d.state === 'drink') {
        d.t += dt;
        if (dist < 35) { d.state = 'flee'; d.speed = 0; }
        if (dist < 80) this.noteSpotted(game, 'deer');
      } else {
        d.speed = Math.min(9, d.speed + dt * 6);
        const away = Math.atan2(d.z - p.z, d.x - p.x);
        d.heading += angleDiff(d.heading, away) * Math.min(1, dt * 3);
        d.x += Math.cos(d.heading) * d.speed * dt;
        d.z += Math.sin(d.heading) * d.speed * dt;
        d.y = game.world.heightAt(d.x, d.z);
      }
      const lower = d.state === 'drink' ? 0.35 + Math.sin(d.t * 0.5) * 0.1 : 0;
      const gallop = d.state === 'flee' ? Math.abs(Math.sin(game.elapsed * 9)) * 0.25 : 0;
      _q.setFromEuler(_e.set(0, -d.heading, -lower));
      _m.compose(_p.set(d.x, d.y + gallop, d.z), _q, _s.set(1, 1, 1));
      this.deer.setMatrixAt(n++, _m);
      if (n >= 6) break;
    }
    this.deer.count = n;
    this.deer.instanceMatrix.needsUpdate = true;
  }

  updateFrogs(dt, game, p, wl) {
    const want = Math.min(this.frogs.instanceMatrix.count, Math.round(10 * wl('frogs') * clamp(game.time.nightFactor * 1.5 + (game.time.phase === 'sunset' ? 0.5 : 0), 0, 1)));
    const world = game.world;
    while (this.frogList.length < want) {
      const s = game.boat.physics.s + (Math.random() - 0.3) * 120;
      const r = world.main.sample(s, {});
      const side = Math.random() < 0.5 ? -1 : 1;
      const pos = world.riverToWorld(s, side * (r.w * 0.5 + (Math.random() - 0.5) * 3));
      const h = world.heightAt(pos.x, pos.z);
      this.frogList.push({ x: pos.x, z: pos.z, y: Math.max(h, r.wl) + 0.03, heading: Math.random() * 6, t: Math.random() * 10 });
    }
    while (this.frogList.length > want) this.frogList.pop();
    let n = 0;
    for (const f of this.frogList) {
      f.t += dt;
      if (Math.hypot(f.x - p.x, f.z - p.z) > 200) { f.x = 1e9; continue; }
      if (Math.random() < dt * 0.05) game.events.emit('wildlife:croak', { x: f.x, y: f.y, z: f.z });
      const puff = 1 + Math.max(0, Math.sin(f.t * 5)) * 0.1;
      _q.setFromEuler(_e.set(0, -f.heading, 0));
      _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(1.4, 1.4 * puff, 1.4));
      this.frogs.setMatrixAt(n++, _m);
      if (Math.hypot(f.x - p.x, f.z - p.z) < 15) this.noteSpotted(game, 'frog');
    }
    this.frogList = this.frogList.filter((f) => f.x < 1e8);
    this.frogs.count = n;
    this.frogs.instanceMatrix.needsUpdate = true;
  }

  updateButterflies(dt, game, p, amount) {
    const n = Math.round(this.bflies.length * clamp(amount, 0, 1) * 0.7);
    for (let i = 0; i < n; i++) {
      const b = this.bflies[i];
      if (!b.init || Math.hypot(b.x - p.x, b.z - p.z) > 45) {
        const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 30;
        b.x = p.x + Math.cos(a) * r; b.z = p.z + Math.sin(a) * r;
        const info = game.world.waterInfo(b.x, b.z, {});
        b.y = Math.max(info.height, info.level) + 0.6 + Math.random() * 1.5;
        b.init = true;
      }
      b.t += dt;
      b.vx += (Math.random() - 0.5) * dt * 6; b.vz += (Math.random() - 0.5) * dt * 6;
      b.vx *= 0.97; b.vz *= 0.97;
      b.x += b.vx * dt; b.z += b.vz * dt;
      b.y += Math.sin(b.t * 3) * dt * 0.4;
      _q.setFromEuler(_e.set(0, Math.atan2(b.vx, b.vz), 0));
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(1, 1, 1));
      this.butterflies.setMatrixAt(i, _m);
    }
    this.butterflies.count = n;
    this.butterflies.instanceMatrix.needsUpdate = true;
    if (n > 3) this.noteSpotted(game, 'butterfly');
  }

  updateFireflies(dt, game, p, amount) {
    const u = this.fireflyMat.uniforms;
    const count = Math.round(420 * clamp(amount, 0, 1.5) * 0.6 * (game.quality.particles ?? 1));
    u.uCount.value = count;
    u.uCenter.value.set(p.x, 0, p.z);
    u.uGround.value = game.boat.physics.waterLevel;
    this.fireflies.visible = count > 0;
    if (count > 20) this.noteSpotted(game, 'firefly');
  }

  updateFish(dt, game, p, amount) {
    this.jumpTimer -= dt * (0.5 + amount);
    if (this.jumpTimer <= 0) {
      this.jumpTimer = 6 + Math.random() * 14;
      // Jump near a fishing spot if one is close, otherwise near the boat.
      const spots = game.world.featuresNear(p.x, p.z, 120, ['fishingSpot']);
      let x, z;
      if (spots.length && Math.random() < 0.8) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        x = s.x + (Math.random() - 0.5) * s.radius; z = s.z + (Math.random() - 0.5) * s.radius;
      } else {
        const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 40;
        x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
      }
      const w = game.world.waterInfo(x, z, {});
      if (w.depth > 0.8) this.jumps.push({ x, z, y: w.level, t: 0, heading: Math.random() * 6 });
    }
    let active = null;
    for (const j of this.jumps) {
      j.t += dt;
      if (j.t < 0.9) active = j;
      if (j.t > 0.05 && !j.splashed) { j.splashed = true; game.water?.splash(j.x, j.z, 0.35, 0.8); game.events.emit('wildlife:jump', { x: j.x, y: j.y, z: j.z }); }
      if (j.t > 0.8 && !j.splashed2) { j.splashed2 = true; game.water?.splash(j.x + Math.cos(j.heading) * 0.9, j.z + Math.sin(j.heading) * 0.9, 0.3, 0.6); }
      if (Math.hypot(j.x - p.x, j.z - p.z) < 40) this.noteSpotted(game, 'fish');
    }
    this.jumps = this.jumps.filter((j) => j.t < 2);
    if (active) {
      const k = active.t / 0.9;
      this.fishMesh.visible = true;
      this.fishMesh.position.set(active.x + Math.cos(active.heading) * k, active.y + Math.sin(k * Math.PI) * 0.6, active.z + Math.sin(active.heading) * k);
      this.fishMesh.rotation.set(0, -active.heading, Math.cos(k * Math.PI) * 1.2);
    } else this.fishMesh.visible = false;
  }

  updateFloaters(dt, game, p, bl) {
    const kind = (bl.t > 0.5 ? bl.b : bl.a).floaters;
    const colors = { petals: 0xf6c0d0, leaves_autumn: 0xd8742a, leaves_green: 0x6a9a3a, ice: 0xe8f4ff, lumen: 0x7af0e0 };
    if (kind !== this.floaterKind) {
      this.floaterKind = kind;
      if (kind) {
        this.floatMat.color.set(colors[kind] ?? 0xffffff);
        this.floatMat.emissive.set(kind === 'lumen' ? 0x3ab0a0 : 0x000000);
      }
      for (const f of this.floatList) f.alive = false;
    }
    if (!kind) { this.floaters.count = 0; return; }
    const flow = { x: 0, z: 0, speed: 0 };
    let n = 0;
    const want = Math.min(this.floatList.length, Math.round(this.floatList.length * (this.density ?? 1) * (kind === 'ice' ? 0.4 : 0.8)));
    for (let i = 0; i < want; i++) {
      const f = this.floatList[i];
      if (!f.alive || Math.hypot(f.x - p.x, f.z - p.z) > 70) {
        const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 60;
        f.x = p.x + Math.cos(a) * r; f.z = p.z + Math.sin(a) * r;
        f.alive = game.world.waterInfo(f.x, f.z, {}).depth > 0.3;
        if (!f.alive) continue;
      }
      game.world.flowAt(f.x, f.z, flow);
      f.x += flow.x * dt; f.z += flow.z * dt;
      f.rot += f.spin * dt;
      const lvl = game.boat.physics.waterLevel;
      _q.setFromEuler(_e.set(0, f.rot, 0));
      _m.compose(_p.set(f.x, lvl + 0.03, f.z), _q, _s.set(f.scale * (kind === 'ice' ? 4 : 1), 1, f.scale * (kind === 'ice' ? 3 : 1)));
      this.floaters.setMatrixAt(n++, _m);
    }
    this.floaters.count = n;
    this.floaters.instanceMatrix.needsUpdate = true;
  }

  /** Visible wildlife near a world position (for photo mode subject detection). */
  visibleSpecies(camera, origin) {
    const out = [];
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const test = (x, y, z, species, maxD = 60) => {
      const v = new THREE.Vector3(x - origin.x, y, z - origin.z);
      if (frustum.containsPoint(v) && v.distanceTo(camera.position) < maxD) out.push(species);
    };
    for (const h of this.heronList) test(h.x, h.y + 1, h.z, 'heron', 80);
    for (const d of this.deerList) test(d.x, d.y + 1, d.z, 'deer', 90);
    for (const f of this.flocks) test(f.cx, f.y, f.cz, 'songbird', 150);
    for (const f of this.frogList) test(f.x, f.y, f.z, 'frog', 20);
    if (this.fireflies.visible && this.fireflyMat.uniforms.uCount.value > 30) out.push('firefly');
    if (this.butterflies.count > 3) out.push('butterfly');
    for (const j of this.jumps) test(j.x, j.y, j.z, 'fish', 50);
    return [...new Set(out)];
  }
}
