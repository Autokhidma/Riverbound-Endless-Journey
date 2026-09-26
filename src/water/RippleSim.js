// GPU ripple simulation (2D wave equation) in a window that follows the boat.
// The moving hull, oar strokes, the fishing bobber, jumping fish and rain
// drops disturb it; the water shader reads it for wake normals and foam.
import * as THREE from 'three';

const MAX_DROPS = 12;

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */ `
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform vec2 uShift;
uniform vec4 uDrops[${MAX_DROPS}];
uniform vec4 uBoat;       // uv.xy, heading, strength
uniform vec2 uBoatSize;   // half length, half width (uv)
uniform float uDamping;
varying vec2 vUv;
float h(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(tPrev, uv).r;
}
void main() {
  vec2 uv = vUv + uShift * uTexel;
  vec4 c = texture2D(tPrev, uv);
  float cur = h(uv);
  float prev = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : c.g;
  float n = (h(uv - vec2(uTexel.x, 0.0)) + h(uv + vec2(uTexel.x, 0.0)) + h(uv - vec2(0.0, uTexel.y)) + h(uv + vec2(0.0, uTexel.y))) * 0.5 - prev;
  n *= uDamping;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 d = uDrops[i];
    if (d.w == 0.0) continue;
    float dd = length(vUv - d.xy) / d.z;
    if (dd < 1.0) n -= d.w * (1.0 - dd * dd);
  }
  if (uBoat.w != 0.0) {
    vec2 p = vUv - uBoat.xy;
    float cs = cos(-uBoat.z), sn = sin(-uBoat.z);
    p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    float e = length(p / uBoatSize);
    n -= uBoat.w * smoothstep(1.0, 0.5, e) * 0.35;
  }
  gl_FragColor = vec4(clamp(n, -2.0, 2.0), cur, 0.0, 1.0);
}`;

export class RippleSim {
  constructor(res = 256, size = 64) {
    this.res = res;
    this.size = size;
    this.texel = size / res;
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.a = new THREE.WebGLRenderTarget(res, res, opts);
    this.b = new THREE.WebGLRenderTarget(res, res, opts);
    const drops = [];
    for (let i = 0; i < MAX_DROPS; i++) drops.push(new THREE.Vector4());
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tPrev: { value: null }, uTexel: { value: new THREE.Vector2(1 / res, 1 / res) }, uShift: { value: new THREE.Vector2() },
        uDrops: { value: drops }, uBoat: { value: new THREE.Vector4() }, uBoatSize: { value: new THREE.Vector2() }, uDamping: { value: 0.986 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.originX = null; // absolute world origin of the window (texel-aligned)
    this.originZ = null;
    this.pendingDrops = [];
    this.acc = 0;
    this.boat = null;
    this.cleared = false;
  }

  get texture() {
    return this.a.texture;
  }

  /** Queue a disturbance at absolute world x/z. */
  drop(x, z, radius, strength) {
    this.pendingDrops.push({ x, z, radius, strength });
    if (this.pendingDrops.length > 64) this.pendingDrops.shift();
  }

  setBoat(x, z, heading, length, width, strength) {
    this.boat = { x, z, heading, length, width, strength };
  }

  /** Advance at a fixed 60 Hz step around absolute center (cx, cz). */
  update(renderer, dt, cx, cz) {
    if (!this.cleared) {
      for (const t of [this.a, this.b]) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false); }
      this.cleared = true;
    }
    this.acc = Math.min(this.acc + dt, 3 / 60);
    const step = 1 / 60;
    while (this.acc >= step) {
      this.acc -= step;
      const t = this.texel;
      const ox = Math.floor((cx - this.size / 2) / t) * t;
      const oz = Math.floor((cz - this.size / 2) / t) * t;
      const u = this.mat.uniforms;
      if (this.originX === null) { this.originX = ox; this.originZ = oz; }
      u.uShift.value.set(Math.round((ox - this.originX) / t), Math.round((oz - this.originZ) / t));
      this.originX = ox; this.originZ = oz;
      // Drops (consumed on this step).
      const drops = u.uDrops.value;
      for (let i = 0; i < drops.length; i++) {
        const d = this.pendingDrops.shift();
        if (d) drops[i].set((d.x - ox) / this.size, (d.z - oz) / this.size, d.radius / this.size, d.strength);
        else drops[i].set(0, 0, 0, 0);
      }
      if (this.boat) {
        const b = this.boat;
        // uv space: u along +x, v along +z. heading angle measured in x/z plane.
        u.uBoat.value.set((b.x - ox) / this.size, (b.z - oz) / this.size, b.heading, b.strength);
        u.uBoatSize.value.set(b.length * 0.5 / this.size, b.width * 0.5 / this.size);
      } else u.uBoat.value.w = 0;
      u.tPrev.value = this.a.texture;
      renderer.setRenderTarget(this.b);
      renderer.render(this.scene, this.cam);
      const tmp = this.a; this.a = this.b; this.b = tmp;
    }
  }

  /** Scene-space rectangle for the water shader: (x0, z0, size, strength). */
  rect(origin, out) {
    out.set((this.originX ?? 0) - origin.x, (this.originZ ?? 0) - origin.z, this.size, 3.5);
    return out;
  }

  dispose() {
    this.a.dispose(); this.b.dispose(); this.mat.dispose();
  }
}
