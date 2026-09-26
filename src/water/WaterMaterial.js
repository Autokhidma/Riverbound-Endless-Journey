// Water surface shader.
//  - flow-aligned waves shared with CPU buoyancy (Waves.js)
//  - two-phase flow-mapped normal detail, distance-faded
//  - Fresnel reflection: planar reflection (High+) or analytic sky (all tiers)
//  - sun / moon glitter paths, lantern + settlement light reflections
//  - depth-based colour & transparency, shoreline/rapids/wake foam
//  - interactive ripples (boat wake, oars, rain), procedural rain rings
//  - bioluminescent glow (Starwater, glow events)
import * as THREE from 'three';
import { G, FOG_GLSL, SKY_GLSL, NOISE_GLSL } from '../render/globalUniforms.js';
import { wavesGLSL } from './Waves.js';
import { getTextures } from '../render/ProceduralTextures.js';

export const MAX_POINT_LIGHTS = 4;

const vertex = (layers) => /* glsl */ `
attribute vec4 aRiver;   // s, t, depth, rapids
attribute vec3 aFlow;    // s-tangent xz, signed speed
attribute vec4 aWaterA;  // shallow rgb, absorption
attribute vec4 aWaterB;  // deep rgb, wave amplitude
uniform float uTime;
uniform float uWaveScale;
uniform float uDetailDist;
uniform mat4 uReflMatrix;
varying vec3 vWorld;
varying vec4 vRiver;
varying vec3 vFlow;
varying vec2 vSlope;
varying vec4 vReflCoord;
varying vec4 vWaterA;
varying vec3 vWaterB;
varying float vDist;
${wavesGLSL(layers)}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xyz - cameraPosition);
  float fade = 1.0 - smoothstep(uDetailDist * 0.6, uDetailDist * 1.6, dist);
  float amp = aWaterB.w * uWaveScale * (1.0 + aRiver.w * 3.0) * smoothstep(-0.1, 0.9, aRiver.z);
  vec3 w = rbWaves(aRiver.xy, uTime, amp * fade);
  wp.y += w.x;
  vec2 T = aFlow.xy;
  vec2 N = vec2(-T.y, T.x);
  vSlope = T * w.y + N * w.z;
  vWorld = wp.xyz;
  vRiver = aRiver;
  vFlow = aFlow;
  vWaterA = aWaterA;
  vWaterB = aWaterB.rgb;
  vDist = dist;
  vReflCoord = uReflMatrix * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uStarVis;
uniform float uNight;
uniform float uRain;
uniform vec3 uLanternPos;
uniform vec3 uLanternColor;
uniform sampler2D tNormal;
uniform sampler2D tFoam;
uniform sampler2D tReflection;
uniform float uPlanar;
uniform float uPlaneY;
uniform sampler2D tRipple;
uniform vec4 uRippleRect;
uniform float uRippleTexel;
uniform float uDetailDist;
uniform float uFoamAmount;
uniform vec3 uAmbientWater;
uniform vec4 uPL[${MAX_POINT_LIGHTS}];
uniform vec3 uPLC[${MAX_POINT_LIGHTS}];
uniform float uGlowWater;
uniform float uGlowEvent;
uniform float uCloudCover;
uniform float uMurk;
uniform mat3 uCelestial;
varying vec3 vWorld;
varying vec4 vRiver;
varying vec3 vFlow;
varying vec2 vSlope;
varying vec4 vReflCoord;
varying vec4 vWaterA;
varying vec3 vWaterB;
varying float vDist;

${FOG_GLSL}
${SKY_GLSL}
${NOISE_GLSL}

vec2 nrm(vec2 uv) { return texture2D(tNormal, uv).xy * 2.0 - 1.0; }

vec2 flowDetail(vec2 wp, vec2 flowVec, float scale, float speedMul) {
  float t = uTime * 0.22 * speedMul;
  float p0 = fract(t), p1 = fract(t + 0.5);
  float w0 = 1.0 - abs(2.0 * p0 - 1.0);
  vec2 uv = wp / scale;
  vec2 f = flowVec / scale * 4.5;
  vec2 a = nrm(uv - f * p0);
  vec2 b = nrm(uv - f * p1 + vec2(0.37, 0.61));
  return mix(b, a, w0);
}

#if RAIN_RINGS
vec2 rainRings(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    vec2 q = p * (1.6 + fl * 0.9) + fl * 3.7;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = rbHash12(cell + fl * 17.0);
    vec2 c = (vec2(rbHash12(cell + 3.1), rbHash12(cell + 7.7)) - 0.5) * 0.5;
    float phase = fract(t * (0.8 + h * 0.5) + h);
    vec2 d = f - c;
    float r = length(d);
    float rr = r - phase * 0.45;
    float ring = sin(rr * 55.0) * exp(-abs(rr) * 22.0) * (1.0 - phase);
    acc += (d / max(r, 1e-3)) * ring;
  }
  return acc;
}
#endif

#if STARS
vec3 reflStars(vec3 dir) {
  vec3 c = uCelestial * dir;
  vec3 a = abs(c);
  vec2 uv = a.x > a.y && a.x > a.z ? c.yz / a.x : (a.y > a.z ? c.xz / a.y : c.xy / a.z);
  vec2 g = uv * 70.0;
  vec2 cell = floor(g);
  float h = rbHash12(cell + (a.x > a.y ? 3.0 : 9.0));
  if (h < 0.9) return vec3(0.0);
  vec2 ctr = cell + 0.5 + (vec2(rbHash12(cell + 1.3), rbHash12(cell + 5.9)) - 0.5) * 0.6;
  float d = length(g - ctr);
  return vec3(0.9, 0.95, 1.0) * exp(-d * d * 30.0) * pow((h - 0.9) * 10.0, 4.0) * 1.2;
}
#endif

void main() {
  float depth = max(vRiver.z, 0.0);
  vec3 V = normalize(cameraPosition - vWorld);
  float detail = 1.0 - smoothstep(uDetailDist * 0.5, uDetailDist * 1.5, vDist);
  vec2 flowVec = vFlow.xy * vFlow.z;
  float rapids = vRiver.w;

  // ---- normal
  vec2 g = vSlope;
  vec2 d1 = flowDetail(vWorld.xz, flowVec, 8.0, 1.0);
#if QUALITY > 0
  vec2 d2 = flowDetail(vWorld.xz * 0.25 + 11.0, flowVec * 0.25, 8.0, 0.6);
#else
  vec2 d2 = vec2(0.0);
#endif
  float strength = (0.16 + rapids * 0.5 + uRain * 0.08) * detail + 0.03;
  g += (d1 * 0.65 + d2 * 0.45) * strength;
#if RIPPLES
  vec2 ruv = (vWorld.xz - uRippleRect.xy) / uRippleRect.z;
  float rippleH = 0.0;
  if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) {
    float hL = texture2D(tRipple, ruv - vec2(uRippleTexel, 0.0)).r;
    float hR = texture2D(tRipple, ruv + vec2(uRippleTexel, 0.0)).r;
    float hD = texture2D(tRipple, ruv - vec2(0.0, uRippleTexel)).r;
    float hU = texture2D(tRipple, ruv + vec2(0.0, uRippleTexel)).r;
    rippleH = texture2D(tRipple, ruv).r;
    float edgeFade = smoothstep(0.0, 0.1, min(min(ruv.x, ruv.y), min(1.0 - ruv.x, 1.0 - ruv.y)));
    g += vec2(hR - hL, hU - hD) * uRippleRect.w * edgeFade;
    rippleH *= edgeFade;
  }
#endif
#if RAIN_RINGS
  if (uRain > 0.01) g += rainRings(vWorld.xz, uTime) * uRain * 0.35 * detail;
#endif
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  // ---- fresnel + reflection
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  vec3 refl = rbSkyBase(R);
  refl *= 1.0 - uCloudCover * 0.35;
#if STARS
  refl += reflStars(normalize(R)) * uStarVis * (1.0 - uCloudCover);
#endif
#if PLANAR
  if (uPlanar > 0.0) {
    vec2 puv = vReflCoord.xy / vReflCoord.w + g * 0.35;
    vec3 planar = texture2D(tReflection, puv).rgb;
    float pw = uPlanar * (1.0 - smoothstep(0.4, 2.5, abs(vWorld.y - uPlaneY)));
    refl = mix(refl, planar, pw);
  }
#endif

  // ---- specular highlights: sun glitter, moon glade, lantern, settlement lights
  float sunUp = smoothstep(-0.05, 0.05, uSunDir.y);
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  vec3 spec = uSunColor * (pow(nh, 2400.0) * 45.0 + pow(nh, 380.0) * 0.9) * sunUp * (1.0 - uCloudCover * 0.8);
  vec3 Hm = normalize(uMoonDir + V);
  float nhm = max(dot(N, Hm), 0.0);
  spec += uMoonColor * (pow(nhm, 900.0) * 40.0 + pow(nhm, 90.0) * 1.8) * smoothstep(-0.02, 0.1, uMoonDir.y) * (1.0 - uCloudCover * 0.8);
  vec3 Ll = uLanternPos - vWorld;
  float dl = length(Ll);
  Ll /= max(dl, 1e-3);
  float lanternAtt = 0.6 / (1.0 + dl * dl * 0.12);
  float nhl = max(dot(N, normalize(Ll + V)), 0.0);
  spec += uLanternColor * lanternAtt * (pow(nhl, 500.0) * 6.0 + pow(nhl, 70.0) * 0.12);
  vec3 plDiffuse = vec3(0.0);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    vec3 L = uPL[i].xyz - vWorld;
    float dd = length(L);
    L /= max(dd, 1e-3);
    float att = uPL[i].w * 0.12 / (1.0 + dd * dd * 0.04);
    float nhp = max(dot(N, normalize(L + V)), 0.0);
    spec += uPLC[i] * att * (pow(nhp, 600.0) * 8.0 + pow(nhp, 90.0) * 0.12);
    plDiffuse += uPLC[i] * att * 0.03;
  }

  // ---- body colour (absorption by depth)
  float absorb = vWaterA.w * (1.0 + uMurk * 2.0);
  float thick = 1.0 - exp(-depth * absorb * 2.2);
  vec3 body = mix(vWaterA.rgb, vWaterB, thick);
  body = mix(body, vec3(0.28, 0.24, 0.18), uMurk * 0.35);
  float ambL = dot(uAmbientWater, vec3(0.2126, 0.7152, 0.0722));
  vec3 light = mix(uAmbientWater, vec3(ambL), 0.45) * 0.9 + uSunColor * max(uSunDir.y, 0.0) * 0.16 + uLanternColor * lanternAtt * 0.2 + plDiffuse;
  body *= light;
  // light passing through wave crests towards the viewer
  float sss = pow(max(dot(V, -uSunDir), 0.0), 4.0) * max(g.x + g.y, 0.0) * 2.0;
  body += vWaterA.rgb * uSunColor * sss * 0.15;

  vec3 color = mix(body, refl, F) + spec;
  float alpha = clamp(thick * 1.15 + F * 0.8, 0.0, 1.0);
  alpha = max(alpha, smoothstep(40.0, 260.0, vDist) * 0.94);
  alpha *= smoothstep(-0.02, 0.12, vRiver.z);

  // ---- foam
#if FOAM
  vec2 fuv = vWorld.xz / 2.0 - flowVec * uTime * 0.5;
  float fn = texture2D(tFoam, fuv).r;
  float fn2 = texture2D(tFoam, vWorld.xz / 16.0 - flowVec * uTime * 0.0625 + 0.3).g;
  float shoreWave = 0.45 + 0.25 * sin(uTime * 0.9 + vRiver.x * 0.21 + vRiver.y * 0.13);
  float shore = (1.0 - smoothstep(0.0, shoreWave, depth)) * smoothstep(-0.02, 0.05, vRiver.z);
  float foam = shore * smoothstep(0.35, 0.75, fn + 0.2) * 0.75;
  foam += rapids * smoothstep(0.35, 0.8, fn * 0.7 + fn2 * 0.5 + rapids * 0.25) * 1.2;
#if RIPPLES
  foam += smoothstep(0.08, 0.35, abs(rippleH)) * smoothstep(0.2, 0.6, fn + 0.3) * 0.8;
#endif
  foam = clamp(foam * uFoamAmount * detail, 0.0, 1.0);
  vec3 foamCol = (uAmbientWater * 1.6 + uSunColor * max(uSunDir.y, 0.0) * 0.55 + uLanternColor * lanternAtt * 0.5) * 0.95;
  color = mix(color, foamCol, foam);
  alpha = max(alpha, foam);
#endif

  // ---- bioluminescence
  float glow = (uGlowWater + uGlowEvent) * uNight;
  if (glow > 0.001) {
    float sp = pow(rbNoise2(vWorld.xz * 2.5 + vec2(uTime * 0.3, -uTime * 0.2)), 10.0);
    float stir = 0.0;
#if RIPPLES
    stir = smoothstep(0.02, 0.2, abs(rippleH)) * 2.0;
#endif
    vec3 gc = mix(vec3(0.1, 0.9, 1.0), vec3(0.55, 0.35, 1.0), rbNoise2(vWorld.xz * 0.1));
    color += gc * (sp * 1.5 + stir + 0.03) * glow;
  }

  color = rbApplyFog(color, vWorld);
  gl_FragColor = vec4(color, alpha);
}
`;

export function createWaterMaterial(quality) {
  const tex = getTextures();
  const wq = quality.water;
  const qLevel = wq.quality === 'low' ? 0 : wq.quality === 'medium' ? 1 : 2;
  const PL = [];
  const PLC = [];
  for (let i = 0; i < MAX_POINT_LIGHTS; i++) { PL.push(new THREE.Vector4(0, -1000, 0, 0)); PLC.push(new THREE.Color(0, 0, 0)); }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...G,
      tNormal: { value: tex.waterNormal },
      tFoam: { value: tex.foam },
      tReflection: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
      uPlanar: { value: 0 },
      uPlaneY: { value: 0 },
      tRipple: { value: null },
      uRippleRect: { value: new THREE.Vector4(0, 0, 64, 0) },
      uRippleTexel: { value: 1 / 256 },
      uWaveScale: { value: 1 },
      uDetailDist: { value: wq.detailDistance },
      uFoamAmount: { value: 1 },
      uAmbientWater: { value: new THREE.Color(0.3, 0.35, 0.4) },
      uPL: { value: PL },
      uPLC: { value: PLC },
      uGlowWater: { value: 0 },
      uGlowEvent: { value: 0 },
      uCloudCover: { value: 0 },
      uMurk: { value: 0 },
      uCelestial: { value: new THREE.Matrix3() },
    },
    defines: {
      QUALITY: qLevel,
      PLANAR: wq.planar ? 1 : 0,
      RIPPLES: wq.ripples ? 1 : 0,
      RAIN_RINGS: qLevel > 0 ? 1 : 0,
      FOAM: wq.foam ? 1 : 0,
      STARS: wq.stars ? 1 : 0,
    },
    vertexShader: vertex(wq.waveLayers),
    fragmentShader: fragment,
    transparent: true,
    depthWrite: true,
    fog: false,
  });
  return mat;
}
