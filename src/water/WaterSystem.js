// WaterSystem: streams water ribbons for the main river and nearby
// tributaries, owns the water materials and drives reflections, ripples and
// the wake trail each frame.
import * as THREE from 'three';
import { createWaterMaterial, MAX_POINT_LIGHTS } from './WaterMaterial.js';
import { PlanarReflection } from './PlanarReflection.js';
import { RippleSim } from './RippleSim.js';
import { WakeTrail } from './WakeTrail.js';
import { G } from '../render/globalUniforms.js';
import { noReflect } from '../render/layers.js';

const SEG = 192;

export class WaterSystem {
  constructor({ world, pool, root, pipeline, quality }) {
    this.world = world;
    this.pool = pool;
    this.root = root;
    this.pipeline = pipeline;
    this.segments = new Map();
    this.frame = 0;
    this.stats = { segments: 0, pending: 0 };
    this.wake = new WakeTrail(root);
    this.setQuality(quality);
  }

  setQuality(q) {
    this.q = q;
    const old = this.materials;
    this.material = createWaterMaterial(q);
    this.starMaterial = this.material.clone();
    for (const [k, v] of Object.entries(G)) this.starMaterial.uniforms[k] = v; // keep shared globals shared
    this.starMaterial.uniforms.uGlowWater.value = 1;
    this.materials = [this.material, this.starMaterial];
    for (const seg of this.segments.values()) if (seg.mesh) seg.mesh.material = seg.star ? this.starMaterial : this.material;
    old?.forEach((m) => m.dispose());
    this.reflection?.dispose();
    this.reflection = new PlanarReflection(q.water.planar ? q.water.planarScale : 0);
    this.ripples?.dispose();
    this.ripples = q.water.ripples ? new RippleSim(q.water.rippleRes, q.water.rippleRes >= 256 ? 64 : 48) : null;
    this.viewDistance = q.viewDistance;
  }

  /** Pre-pass hook (runs before the main render each frame). */
  prePass(renderer, camera, scene, planeY) {
    if (this.reflection.enabled) {
      this.reflection.resize(this.pipeline.width, this.pipeline.height);
      // Hide water surfaces during the reflection render.
      const ok = this.reflection.render(renderer, camera, scene, planeY);
      for (const m of this.materials) {
        m.uniforms.uPlanar.value = ok ? 1 : 0;
        m.uniforms.tReflection.value = this.reflection.rt?.texture ?? null;
        m.uniforms.uReflMatrix.value.copy(this.reflection.textureMatrix);
        m.uniforms.uPlaneY.value = planeY;
      }
    }
  }

  segmentKey(river, k, lod) {
    return `${river}|${k}|${lod}`;
  }

  /**
   * Stream ribbons around the camera (absolute position) given the main-river
   * arc length near the player.
   */
  updateStreaming(cam, playerS) {
    this.frame++;
    const need = new Set();
    const vd = this.viewDistance;
    const nearDist = 520;
    const tmp = {};
    // Main river: scan along s around the player.
    const k0 = Math.floor((playerS - vd * 1.7) / SEG), k1 = Math.floor((playerS + vd * 1.7) / SEG);
    for (let k = k0; k <= k1; k++) {
      const s0 = k * SEG, s1 = s0 + SEG;
      if (s1 < -600) continue;
      const smid = Math.max(-600, (s0 + s1) / 2);
      const r = this.world.main.sample(smid, tmp);
      const d = Math.hypot(r.x - cam.x, r.z - cam.z) - SEG * 0.5 - r.w * 0.5;
      if (d > vd) continue;
      const lod = d < nearDist ? 0 : 1;
      need.add(this.request('main', k, lod, Math.max(-600, s0), s1, d));
    }
    // Tributaries near the camera.
    const u = this.world.macroU(cam.x, cam.z);
    for (const h of this.world.hydroNearU(u, 2)) {
      const T = h.tributary;
      if (!T || !T.nearBBox(cam.x, cam.z, vd)) continue;
      const nk = Math.ceil(T.length / SEG);
      for (let k = 0; k < nk; k++) {
        const s0 = k * SEG, s1 = Math.min(T.length, s0 + SEG);
        const r = T.sample((s0 + s1) / 2, tmp);
        const d = Math.hypot(r.x - cam.x, r.z - cam.z) - SEG * 0.5;
        if (d > vd * 0.8) continue;
        const lod = d < nearDist ? 0 : 1;
        need.add(this.request(T.id, k, lod, s0, s1, d));
      }
    }
    // Swap in new LODs only when ready; dispose stale.
    for (const [key, seg] of this.segments) {
      if (need.has(key)) continue;
      const replacement = [...need].some((nk) => nk.startsWith(`${seg.river}|${seg.k}|`) && this.segments.get(nk)?.mesh);
      const lodPending = [...need].some((nk) => nk.startsWith(`${seg.river}|${seg.k}|`));
      if (lodPending && !replacement && seg.mesh) { seg.mesh.visible = true; continue; }
      this.disposeSegment(key, seg);
    }
    for (const key of need) {
      const seg = this.segments.get(key);
      if (seg?.mesh) seg.mesh.visible = true;
    }
    this.pool.prune((k) => !k.startsWith('w:') || need.has(k.slice(2)));
    this.stats.segments = [...this.segments.values()].filter((s) => s.mesh).length;
    this.stats.pending = [...this.segments.values()].filter((s) => !s.mesh).length;
  }

  request(river, k, lod, s0, s1, dist) {
    const key = this.segmentKey(river, k, lod);
    if (this.segments.has(key)) return key;
    const seg = { key, river, k, lod, mesh: null, star: false };
    this.segments.set(key, seg);
    const params = { river, s0, s1, step: lod === 0 ? 4 : 10, lateral: lod === 0 ? 16 : 8 };
    this.pool.request('water', params, dist / 400 - (lod === 0 ? 1 : 0), `w:${key}`).then((data) => {
      if (!data || this.segments.get(key) !== seg) { if (this.segments.get(key) === seg && !seg.mesh) this.segments.delete(key); return; }
      this.createMesh(seg, data);
    }).catch((e) => { console.error('[water] segment failed', e); this.segments.delete(key); });
    return key;
  }

  createMesh(seg, data) {
    if (!data.indices.length) { seg.mesh = new THREE.Object3D(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('aRiver', new THREE.BufferAttribute(data.river4, 4));
    g.setAttribute('aFlow', new THREE.BufferAttribute(data.flow, 3));
    g.setAttribute('aWaterA', new THREE.BufferAttribute(data.waterA, 4));
    g.setAttribute('aWaterB', new THREE.BufferAttribute(data.waterB, 4));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const b = data.bounds;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(b.minX, b.minY - 1, b.minZ), new THREE.Vector3(b.maxX, b.maxY + 1, b.maxZ));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    seg.star = !!data.starwater;
    const mesh = new THREE.Mesh(g, seg.star ? this.starMaterial : this.material);
    mesh.position.set(data.origin.x, data.origin.y, data.origin.z);
    mesh.renderOrder = seg.river === 'main' ? 1 : 2;
    mesh.name = `water ${seg.key}`;
    noReflect(mesh);
    this.root.add(mesh);
    seg.mesh = mesh;
  }

  disposeSegment(key, seg) {
    if (seg.mesh) {
      this.root.remove(seg.mesh);
      seg.mesh.geometry?.dispose();
    }
    this.segments.delete(key);
  }

  /**
   * Per-frame uniforms.
   * @param ctx { dt, time, origin, boat, weather, palette, lights, celestial, glowEvent }
   */
  update(ctx) {
    const { dt, origin, boat, weather, palette } = ctx;
    for (const m of this.materials) {
      const u = m.uniforms;
      u.uWaveScale.value = 1 + (weather.wind ?? 0) * 1.6 + (weather.storm ?? 0) * 3;
      u.uAmbientWater.value.setRGB(palette.ambSky[0] * palette.ambI, palette.ambSky[1] * palette.ambI, palette.ambSky[2] * palette.ambI);
      u.uCloudCover.value = weather.cloud ?? 0;
      u.uMurk.value = weather.murk ?? 0;
      u.uGlowEvent.value = ctx.glowEvent ?? 0;
      if (ctx.celestial) u.uCelestial.value.fromArray(ctx.celestial).transpose();
      const pl = u.uPL.value, plc = u.uPLC.value;
      for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
        const L = ctx.lights?.[i];
        if (L) { pl[i].set(L.x - origin.x, L.y, L.z - origin.z, L.intensity); plc[i].copy(L.color); }
        else { pl[i].set(0, -1e4, 0, 0); plc[i].setRGB(0, 0, 0); }
      }
    }
    this.wake.material.uniforms.uAmbientWater.value.copy(this.material.uniforms.uAmbientWater.value);
    // Wake trail and ripples follow the boat.
    if (boat) {
      const speed = boat.speed;
      this.wake.update(dt, boat.sternX, boat.waterY, boat.sternZ, boat.dirX, boat.dirZ, speed);
      if (this.ripples) {
        this.ripples.setBoat(boat.x, boat.z, boat.heading, 3.6, 1.3, Math.min(1.2, speed * 0.22 + Math.abs(boat.heaveVel) * 0.5));
        for (const m of this.materials) {
          m.uniforms.tRipple.value = this.ripples.texture;
          this.ripples.rect(origin, m.uniforms.uRippleRect.value);
          m.uniforms.uRippleTexel.value = 1 / this.ripples.res;
        }
      }
    }
    if (this.ripples && boat) this.ripples.update(this.pipeline.renderer, dt, boat.x, boat.z);
    // Rain drops on the ripple sim.
    if (this.ripples && (weather.rain ?? 0) > 0.05 && boat) {
      const n = Math.floor(weather.rain * 6);
      for (let i = 0; i < n; i++) {
        this.ripples.drop(boat.x + (Math.random() - 0.5) * this.ripples.size, boat.z + (Math.random() - 0.5) * this.ripples.size, 0.25, 0.25 * weather.rain);
      }
    }
  }

  splash(x, z, radius = 0.4, strength = 0.8) {
    this.ripples?.drop(x, z, radius, strength);
  }

  dispose() {
    for (const [k, s] of this.segments) this.disposeSegment(k, s);
    this.reflection?.dispose();
    this.ripples?.dispose();
  }
}
