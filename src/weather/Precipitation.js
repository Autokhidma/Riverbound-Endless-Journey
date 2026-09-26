// GPU rain and snow: particles live in a box around the camera and are
// animated entirely in the vertex shader (no per-frame CPU work). Counts
// scale with the particle quality setting.
import * as THREE from 'three';
import { G } from '../render/globalUniforms.js';
import { noReflect } from '../render/layers.js';

const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime; uniform float uIntensity; uniform vec3 uWind; uniform vec3 uCamPos; uniform float uBox; uniform float uSnow;
varying float vAlpha; varying float vSnow;
void main() {
  float speed = mix(9.0, 1.2, uSnow);
  float h = uBox;
  vec3 p = aSeed * uBox;
  p.y = mod(aSeed.y * h - uTime * speed * (0.8 + aSeed.x * 0.4), h);
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * (h - p.y) / speed * 0.35;
  if (uSnow > 0.5) drift += vec3(sin(uTime * 0.9 + aSeed.z * 20.0), 0.0, cos(uTime * 0.7 + aSeed.x * 20.0)) * 0.6;
  vec3 local = vec3(p.x - uBox * 0.5, p.y - h * 0.35, p.z - uBox * 0.5) + drift;
  // wrap around the camera so particles are always near it
  vec3 wp = uCamPos + vec3(mod(local.x - uCamPos.x, uBox) - uBox * 0.5, local.y, mod(local.z - uCamPos.z, uBox) - uBox * 0.5);
  // streak: stretch along the fall direction (two vertices per drop)
  float isTail = mod(float(gl_VertexID), 2.0);
  vec3 dir = normalize(vec3(uWind.x * 0.12, -1.0, uWind.y * 0.12));
  wp += dir * isTail * mix(0.55, 0.04, uSnow);
  float visible = step(fract(aSeed.x * 7.13 + aSeed.z * 3.1), uIntensity);
  vAlpha = visible * (1.0 - isTail * 0.8);
  vSnow = uSnow;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(1.0, 4.5, uSnow) * 12.0 / max(1.0, -mv.z) + 1.0;
}`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uFogColor; uniform float uNight; uniform vec3 uSunColor; uniform vec3 uLanternColor;
varying float vAlpha; varying float vSnow;
void main() {
  if (vAlpha < 0.01) discard;
  vec3 c = mix(uFogColor * 1.1 + vec3(0.15), vec3(0.95), vSnow) * (1.0 - uNight * 0.75) + uLanternColor * 0.1;
  gl_FragColor = vec4(c, vAlpha * mix(0.35, 0.9, vSnow));
}`;

export class Precipitation {
  constructor(game) {
    this.game = game;
    this.mesh = null;
    this.maxCount = 0;
  }

  setQuality(q) {
    const count = Math.round(9000 * (q.particles ?? 1));
    if (count === this.maxCount && this.mesh) return;
    this.maxCount = count;
    if (this.mesh) { this.game.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const sx = Math.random(), sy = Math.random(), sz = Math.random();
      for (let k = 0; k < 2; k++) { seed.set([sx, sy, sz], (i * 2 + k) * 3); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...G, uIntensity: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uBox: { value: 40 }, uSnow: { value: 0 } },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    noReflect(this.lines);
    this.mesh = this.lines;
    this.mesh.visible = false;
    this.game.scene.add(this.mesh);
  }

  update(dt, game, rain, snow) {
    if (!this.mesh) this.setQuality(game.quality);
    const intensity = Math.max(rain, snow);
    this.mesh.visible = intensity > 0.02 && game.cameraRig.mode !== 'photo' || (intensity > 0.02 && game.photoRain !== false);
    const u = this.material.uniforms;
    u.uIntensity.value = Math.min(1, intensity * 1.05);
    u.uSnow.value = snow > rain ? 1 : 0;
    u.uCamPos.value.copy(game.camera3.position);
    u.uBox.value = snow > rain ? 32 : 36;
  }
}
