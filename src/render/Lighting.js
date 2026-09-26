// Scene lighting driven by the sky palette: sun/moon directional light with a
// shadow frustum that follows the player (texel-snapped to avoid shimmering),
// hemisphere ambient, and a fixed pool of point lights for settlements
// (fixed count so shaders never recompile when lights come and go).
import * as THREE from 'three';
import { G } from './globalUniforms.js';

export class Lighting {
  constructor(scene, quality) {
    this.scene = scene;
    this.dir = new THREE.DirectionalLight(0xffffff, 3);
    this.dir.castShadow = true;
    this.dir.shadow.bias = -0.0004;
    this.dir.shadow.normalBias = 0.04;
    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.dir.target = this.target;
    scene.add(this.dir);
    this.hemi = new THREE.HemisphereLight(0xaaccff, 0x445533, 0.6);
    scene.add(this.hemi);
    this.pool = [];
    this.setQuality(quality);
    this._v = new THREE.Vector3();
  }

  setQuality(q) {
    const s = q.shadows;
    this.dir.castShadow = s.enabled;
    this.dir.shadow.mapSize.set(s.mapSize, s.mapSize);
    this.dir.shadow.map?.dispose();
    this.dir.shadow.map = null;
    const d = s.distance;
    const cam = this.dir.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = d * 6;
    cam.updateProjectionMatrix();
    this.shadowDist = d;
    // Point light pool (count fixed per quality level).
    for (const l of this.pool) this.scene.remove(l);
    this.pool = [];
    for (let i = 0; i < q.pointLights; i++) {
      const l = new THREE.PointLight(0xffb070, 0, 24, 1.8);
      l.castShadow = false;
      this.scene.add(l);
      this.pool.push(l);
    }
  }

  /**
   * @param palette evaluated sky palette
   * @param time TimeOfDay
   * @param focus scene-space Vector3 (player)
   */
  update(palette, time, focus, moonVisible = true) {
    const sd = time.sunDir, md = time.moonDir;
    const sunUp = time.sunElevation > -4;
    let dir, color, intensity;
    if (sunUp) {
      dir = sd;
      color = palette.sun;
      intensity = palette.sunI * Math.max(0, Math.min(1, (time.sunElevation + 4) / 6));
    } else {
      dir = md;
      const moonUp = time.moonElevation > 0;
      color = [0.55, 0.65, 0.95];
      intensity = moonUp && moonVisible ? 0.26 * (0.25 + 0.75 * time.moonLight) * Math.min(1, time.moonElevation / 10) * (1 - palette.overcast * 0.8) : 0;
    }
    this.dir.color.setRGB(color[0], color[1], color[2]);
    this.dir.intensity = intensity;
    // Shadow frustum follows the player, snapped to shadow texels.
    const d = this.shadowDist;
    const texel = (2 * d) / this.dir.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.target.position.set(fx, focus.y, fz);
    this.dir.position.set(fx + dir[0] * d * 3, focus.y + Math.max(0.05, dir[1]) * d * 3, fz + dir[2] * d * 3);
    this.target.updateMatrixWorld();
    this.dir.castShadow = this.dir.castShadow && intensity > 0.02;
    // Ambient (hemisphere).
    const k = palette.ambI;
    this.hemi.color.setRGB(palette.ambSky[0], palette.ambSky[1], palette.ambSky[2]);
    this.hemi.groundColor.setRGB(palette.ambGround[0], palette.ambGround[1], palette.ambGround[2]);
    this.hemi.intensity = k * 0.9;
    // Global uniforms for custom shaders.
    G.uSunDir.value.set(sd[0], sd[1], sd[2]);
    G.uSunColor.value.setRGB(palette.sun[0] * palette.sunI, palette.sun[1] * palette.sunI, palette.sun[2] * palette.sunI);
    G.uMoonDir.value.set(md[0], md[1], md[2]);
    const ml = (0.2 + 0.8 * time.moonLight) * (time.moonElevation > -2 ? 1 : 0) * time.nightFactor;
    G.uMoonColor.value.setRGB(0.5 * ml, 0.58 * ml, 0.75 * ml);
    G.uMoonPhase.value = time.moonPhase;
  }

  /** Assign the nearest light sources to the fixed pool. lights: [{x,y,z (scene), color, intensity}] */
  assignPoolLights(lights) {
    for (let i = 0; i < this.pool.length; i++) {
      const L = lights[i];
      const pl = this.pool[i];
      if (L) {
        pl.position.set(L.x, L.y, L.z);
        pl.color.copy(L.color);
        pl.intensity = L.intensity;
        pl.distance = L.range ?? 24;
      } else pl.intensity = 0;
    }
  }
}
