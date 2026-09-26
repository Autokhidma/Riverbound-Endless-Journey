// Procedural sky dome: atmosphere gradient, sun, phased moon, two star layers,
// Milky Way with dust lanes, nebula tint, clouds, shooting stars and aurora.
// Everything is analytic/procedural (no textures), with quality defines.
import * as THREE from 'three';
import { G, FOG_GLSL, SKY_GLSL, NOISE_GLSL } from '../render/globalUniforms.js';

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uStarVis;
uniform float uNight;
uniform mat3 uCelestial;      // world -> celestial
uniform float uCloudCover;
uniform float uCloudDensity;
uniform vec2 uCloudOffset;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uMeteorA;        // start dir, progress
uniform vec4 uMeteorB;        // end dir, brightness
uniform float uAurora;
uniform float uSunSize;
uniform float uMoonSize;
uniform float uMilkyWay;
varying vec3 vDir;

${FOG_GLSL}
${SKY_GLSL}
${NOISE_GLSL}

float fbm2(vec2 p, const int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * rbNoise2(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
float fbm3(vec3 p, const int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * rbNoise3(p);
    p = p * 2.07 + vec3(5.3, 1.7, 9.1);
    a *= 0.5;
  }
  return s;
}

// One layer of procedural stars on a cube-face grid of the celestial sphere.
vec3 starLayer(vec3 c, float cells, float density, float seed) {
  vec3 a = abs(c);
  vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = c.yz / a.x; face = c.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = c.xz / a.y; face = c.y > 0.0 ? 2.0 : 3.0; }
  else { uv = c.xy / a.z; face = c.z > 0.0 ? 4.0 : 5.0; }
  vec2 g = uv * cells;
  vec2 cell = floor(g);
  vec3 h = rbHash33(vec3(cell, face * 7.0 + seed));
  if (h.z > density) return vec3(0.0);
  vec2 center = cell + 0.2 + 0.6 * h.xy;
  float d = length(g - center);
  float px = max(fwidth(g.x), fwidth(g.y));
  float sigma = max(px * 0.55, 0.02);
  float b = pow(fract(h.z * 91.7), 9.0) * 2.2 + 0.03;
  float star = exp(-d * d / (2.0 * sigma * sigma)) * b * (0.035 / sigma);
  float temp = fract(h.x * 17.3 + h.y * 3.1);
  vec3 col = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.85, 0.65), temp);
  col = mix(col, vec3(1.0), 0.4);
  float tw = 0.78 + 0.22 * sin(uTime * (2.0 + 5.0 * h.y) + h.x * 40.0);
  return col * star * tw;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = rbSkyBase(dir);
  float above = smoothstep(-0.02, 0.03, dir.y);

  // ---- Night sky
#ifndef ENV
  if (uStarVis > 0.001) {
    vec3 c = uCelestial * dir;
    vec3 stars = vec3(0.0);
    vec3 gpole = normalize(vec3(0.32, 0.55, 0.77));
    vec3 gcenter = normalize(cross(gpole, vec3(0.0, 0.0, 1.0)));
    float lat = dot(c, gpole);
    float band = exp(-lat * lat / (0.23 * 0.23));
    float core = pow(max(dot(c, gcenter), 0.0), 3.0);
    stars += starLayer(c, 64.0, 0.09, 1.0) * 1.2;
#if STAR_LAYERS > 1
    stars += starLayer(c, 200.0, 0.03 + band * 0.22, 2.0) * 0.35;
#endif
#if MILKY_WAY
    float mwN = fbm3(c * 3.5 + vec3(3.0), MW_OCTAVES);
    float mwF = fbm3(c * 11.0, MW_OCTAVES - 1);
    float lane = smoothstep(0.35, 0.75, fbm3(c * 7.0 + vec3(11.0), MW_OCTAVES - 1)) * exp(-lat * lat / (0.07 * 0.07));
    float mw = band * (0.55 + 0.9 * mwN * mwF) * (1.0 - 0.8 * lane) * (0.55 + 1.3 * core);
    vec3 mwCol = mix(vec3(0.42, 0.5, 0.78), vec3(1.0, 0.82, 0.62), core * 0.8 + mwF * 0.2);
    stars += mwCol * mw * 0.11 * uMilkyWay;
#if NEBULA
    float neb = smoothstep(0.52, 0.8, fbm3(c * 2.2 + vec3(40.0), 4));
    stars += mix(vec3(0.5, 0.15, 0.4), vec3(0.1, 0.35, 0.45), fbm3(c * 3.0, 3)) * neb * 0.035 * (0.4 + band);
#endif
#endif
    // Horizon extinction.
    stars *= smoothstep(0.0, 0.25, dir.y) * 0.85 + 0.15 * smoothstep(0.0, 0.05, dir.y);
    col += stars * uStarVis * above;

    // Shooting star
    if (uMeteorB.w > 0.0) {
      vec3 head = normalize(mix(uMeteorA.xyz, uMeteorB.xyz, uMeteorA.w));
      vec3 tail = normalize(mix(uMeteorA.xyz, uMeteorB.xyz, max(0.0, uMeteorA.w - 0.22)));
      vec3 seg = head - tail;
      float t = clamp(dot(dir - tail, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
      float d = length(dir - (tail + seg * t));
      float streak = exp(-d * d / (2.0 * 0.0012 * 0.0012)) * t * t;
      col += vec3(0.9, 0.95, 1.0) * streak * uMeteorB.w * 2.5 * above;
    }
  }

  // ---- Aurora (northern skies)
#if AURORA
  if (uAurora > 0.001 && dir.y > 0.02) {
    float az = atan(dir.x, -dir.z);
    float h = dir.y;
    float curtain = fbm2(vec2(az * 2.5 + uTime * 0.02, uTime * 0.03), 3);
    float rays = pow(rbNoise2(vec2(az * 40.0, uTime * 0.15)), 2.0);
    float north = smoothstep(0.2, -0.6, dir.z);
    float vert = smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.18 + curtain * 0.35, 0.55 + curtain * 0.3, h));
    float a = vert * north * (0.35 + 0.65 * curtain) * (0.6 + 0.4 * rays);
    vec3 aCol = mix(vec3(0.1, 0.9, 0.45), vec3(0.55, 0.2, 0.8), smoothstep(0.12, 0.45, h));
    col += aCol * a * uAurora * 0.45 * uNight;
  }
#endif
#endif

  // ---- Moon
  float moonR = uMoonSize;
  float md = dot(dir, uMoonDir);
  if (md > 0.99) {
    vec3 T = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 B = cross(T, uMoonDir);
    vec2 p = vec2(dot(dir, T), dot(dir, B)) / moonR;
    float r2 = dot(p, p);
    if (r2 < 1.0) {
      vec3 n = T * p.x + B * p.y - uMoonDir * sqrt(1.0 - r2);
      // n faces the viewer; the hemisphere facing the sun is lit, which yields
      // the correct phase from the actual sun/moon geometry.
      float lit = smoothstep(-0.06, 0.08, dot(n, uSunDir));
      float maria = 0.75 - 0.3 * smoothstep(0.45, 0.7, fbm2(p * 2.2 + 3.0, 4)) - 0.1 * rbNoise2(p * 14.0);
      float limb = 0.75 + 0.25 * sqrt(1.0 - r2);
      vec3 moonCol = vec3(1.0, 0.97, 0.9) * maria * limb * (lit * 1.6 + 0.012);
      float edge = smoothstep(1.0, 0.97, r2);
      col = mix(col, moonCol * (1.0 + uNight * 0.5), edge * above);
    }
  }
  float moonHalo = pow(max(md, 0.0), 900.0) * 0.25 + pow(max(md, 0.0), 60.0) * 0.04;
  col += uMoonColor * moonHalo * 6.0 * above;

  // ---- Sun disc
  float sd = dot(dir, uSunDir);
  float sunR = uSunSize;
  float sunDisc = smoothstep(cos(sunR), cos(sunR * 0.8), sd);
  vec3 sunCol = uSunColor * 26.0 * sunDisc * above;

  // ---- Clouds
#if CLOUDS
  float cloudA = 0.0;
  vec3 cloudCol = vec3(0.0);
  if (dir.y > 0.0 && uCloudCover > 0.01) {
    vec2 cp = dir.xz / (dir.y + 0.09) * 0.9 + uCloudOffset;
    float n = fbm2(cp, CLOUD_OCTAVES);
    float n2 = fbm2(cp * 3.1 + vec2(uTime * 0.004), 3);
    float thresh = 1.0 - uCloudCover;
    float d = smoothstep(thresh * 0.8, thresh * 0.8 + 0.28, n * 0.85 + n2 * 0.25);
    float horizonFade = smoothstep(0.0, 0.12, dir.y);
    cloudA = d * horizonFade * uCloudDensity;
    float toward = pow(max(sd, 0.0), 5.0);
    float thick = smoothstep(0.3, 1.0, d);
    vec3 lit = mix(uCloudLit, uCloudShade, thick * 0.75);
    lit += uSkyGlow * toward * (1.0 - thick) * 0.9;          // silver lining
    lit += uMoonColor * pow(max(md, 0.0), 8.0) * 0.6 * uNight;
    cloudCol = mix(lit, rbSkyBase(dir), 0.25 * (1.0 - horizonFade));
  }
  col = mix(col + sunCol, cloudCol, cloudA);
#else
  col += sunCol;
#endif

  // Fog and mist wash out the sky towards the horizon.
  float fogK = 1.0 - exp(-(uFogDensity * 2500.0 + uFogHeightDensity * 120.0) * pow(1.0 - max(dir.y, 0.0), 3.0));
  col = mix(col, uFogColor, clamp(fogK, 0.0, 0.97));
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSkyMaterial(quality, { env = false } = {}) {
  const q = quality.sky;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      uCelestial: { value: new THREE.Matrix3() },
      uCloudCover: { value: 0.3 },
      uCloudDensity: { value: 0.9 },
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uCloudShade: { value: new THREE.Color(0.6, 0.6, 0.7) },
      uMeteorA: { value: new THREE.Vector4() },
      uMeteorB: { value: new THREE.Vector4() },
      uAurora: { value: 0 },
      uSunSize: { value: 0.0125 },
      uMoonSize: { value: 0.022 },
      uMilkyWay: { value: 1 },
    },
    defines: {
      STAR_LAYERS: q.starLayers ?? 2,
      MILKY_WAY: q.milkyWay ? 1 : 0,
      MW_OCTAVES: Math.max(2, Math.min(5, (q.cloudOctaves ?? 4))),
      NEBULA: q.nebula ? 1 : 0,
      AURORA: q.aurora ? 1 : 0,
      CLOUDS: q.clouds ? 1 : 0,
      CLOUD_OCTAVES: q.cloudOctaves ?? 4,
      ...(env ? { ENV: 1 } : {}),
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  return mat;
}

export class SkyDome {
  constructor(quality) {
    this.material = createSkyMaterial(quality);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'SkyDome';
    // A copy used for environment (IBL) capture: no stars, no clouds detail.
    this.envMaterial = createSkyMaterial(quality, { env: true });
    this.envMesh = new THREE.Mesh(this.mesh.geometry, this.envMaterial);
    this.envMesh.frustumCulled = false;
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envMesh);
    this.meteor = null;
    this.meteorTimer = 8;
  }

  setQuality(quality) {
    const old = this.material;
    this.material = createSkyMaterial(quality);
    this.mesh.material = this.material;
    old.dispose();
    const oldEnv = this.envMaterial;
    this.envMaterial = createSkyMaterial(quality, { env: true });
    this.envMesh.material = this.envMaterial;
    oldEnv.dispose();
  }

  /** Per-frame update from time/weather state. */
  update(dt, { celestialMatrix, cloudCover, cloudDensity, cloudOffset, cloudLit, cloudShade, aurora, night, meteorRate = 1, milkyWay = 1 }) {
    for (const m of [this.material, this.envMaterial]) {
      const u = m.uniforms;
      u.uCelestial.value.fromArray(celestialMatrix).transpose(); // world -> celestial
      u.uCloudCover.value = cloudCover;
      u.uCloudDensity.value = cloudDensity;
      u.uCloudOffset.value.copy(cloudOffset);
      u.uCloudLit.value.fromArray(cloudLit);
      u.uCloudShade.value.fromArray(cloudShade);
      u.uAurora.value = aurora;
      u.uMilkyWay.value = milkyWay;
    }
    // Shooting stars: occasional streaks at night.
    const u = this.material.uniforms;
    if (this.meteor) {
      this.meteor.t += dt / this.meteor.duration;
      const fade = Math.sin(Math.min(1, this.meteor.t) * Math.PI);
      u.uMeteorA.value.w = this.meteor.t;
      u.uMeteorB.value.w = this.meteor.t < 1 ? fade * this.meteor.bright : 0;
      if (this.meteor.t >= 1.15) this.meteor = null;
    } else {
      u.uMeteorB.value.w = 0;
      if (night > 0.6) {
        this.meteorTimer -= dt * meteorRate;
        if (this.meteorTimer <= 0) {
          this.spawnMeteor();
          this.meteorTimer = 12 + Math.random() * 40;
        }
      }
    }
  }

  spawnMeteor() {
    const a = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(20 + Math.random() * 45), Math.random() * Math.PI * 2);
    const b = a.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.12 - Math.random() * 0.2, (Math.random() - 0.5) * 0.5)).normalize();
    const u = this.material.uniforms;
    u.uMeteorA.value.set(a.x, a.y, a.z, 0);
    u.uMeteorB.value.set(b.x, b.y, b.z, 0);
    this.meteor = { t: 0, duration: 0.7 + Math.random() * 0.6, bright: 0.6 + Math.random() * 0.8 };
  }
}
