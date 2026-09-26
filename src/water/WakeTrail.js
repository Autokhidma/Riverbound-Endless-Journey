// Foam wake trail behind the boat: a ribbon of recent stern positions that
// widens into a V and fades with age. Works on every quality tier (the
// ripple simulation adds interactive waves on Medium+).
import * as THREE from 'three';
import { getTextures } from '../render/ProceduralTextures.js';
import { G } from '../render/globalUniforms.js';
import { noReflect } from '../render/layers.js';

const MAX = 90;
const LIFE = 14;

export class WakeTrail {
  constructor(parent) {
    this.points = [];
    this.timer = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 2 * 3);
    this.data = new Float32Array(MAX * 2 * 4); // side, age01, strength, dist
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...G, tFoam: { value: getTextures().foam }, uAmbientWater: { value: new THREE.Color(0.3, 0.35, 0.4) } },
      vertexShader: /* glsl */ `
        attribute vec4 aData;
        varying vec4 vData;
        varying vec3 vWorld;
        void main() {
          vData = aData;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFoam;
        uniform vec3 uAmbientWater;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform vec3 uLanternColor;
        uniform vec3 uLanternPos;
        uniform float uTime;
        varying vec4 vData;
        varying vec3 vWorld;
        void main() {
          float side = vData.x;          // -1..1 across the trail
          float age = vData.y;
          float edge = smoothstep(1.0, 0.55, abs(side));
          float center = smoothstep(0.0, 0.5, abs(side)) * 0.6 + 0.4;
          float f = texture2D(tFoam, vWorld.xz / 4.0 + vec2(age * 0.3, 0.0)).r;
          float f2 = texture2D(tFoam, vWorld.xz / 8.0 - vec2(0.0, age * 0.2)).g;
          float a = smoothstep(0.2 + age * 0.5, 0.75, f * 0.8 + f2 * 0.4) * edge * center * vData.z * (1.0 - age);
          float dl = length(uLanternPos - vWorld);
          vec3 col = uAmbientWater * 1.7 + uSunColor * max(uSunDir.y, 0.0) * 0.5 + uLanternColor / (1.0 + dl * dl * 0.09) * 0.6;
          gl_FragColor = vec4(col, a * 0.85);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    noReflect(this.mesh);
    parent.add(this.mesh);
    this.anchor = { x: 0, z: 0 };
  }

  /**
   * @param x,z stern absolute position; y water level; dirX/dirZ boat forward; speed m/s
   */
  update(dt, x, y, z, dirX, dirZ, speed) {
    for (const p of this.points) p.age += dt;
    while (this.points.length && this.points[0].age > LIFE) this.points.shift();
    this.timer -= dt;
    const last = this.points[this.points.length - 1];
    const moved = last ? Math.hypot(x - last.x, z - last.z) : 99;
    if ((this.timer <= 0 && moved > 0.6) || moved > 2.5) {
      this.timer = 0.18;
      this.points.push({ x, y, z, age: 0, dirX, dirZ, strength: Math.min(1, speed / 3.5) });
      if (this.points.length > MAX) this.points.shift();
    }
    // Head point follows the stern continuously.
    const pts = this.points;
    if (!pts.length) { this.geometry.setDrawRange(0, 0); return; }
    this.anchor.x = pts[pts.length - 1].x;
    this.anchor.z = pts[pts.length - 1].z;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[n - 1 - i]; // newest first
      const px = i === 0 ? x : p.x, pz = i === 0 ? z : p.z;
      const a = p.age / LIFE;
      const width = 0.7 + p.age * 1.1;
      const perpX = -p.dirZ, perpZ = p.dirX;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const vi = i * 2 + (sgn > 0 ? 1 : 0);
        this.pos[vi * 3] = px + perpX * width * sgn - this.anchor.x;
        this.pos[vi * 3 + 1] = p.y + 0.04;
        this.pos[vi * 3 + 2] = pz + perpZ * width * sgn - this.anchor.z;
        this.data[vi * 4] = sgn;
        this.data[vi * 4 + 1] = a;
        this.data[vi * 4 + 2] = p.strength;
        this.data[vi * 4 + 3] = i;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aData.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.mesh.position.set(this.anchor.x, 0, this.anchor.z);
  }

  clear() {
    this.points = [];
    this.geometry.setDrawRange(0, 0);
  }
}
