// Global shader uniforms shared by reference across every material, plus the
// custom atmospheric fog that replaces three.js's built-in fog chunks.
import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonColor: { value: new THREE.Color(0.2, 0.25, 0.35) },
  uMoonPhase: { value: 0 },
  uSkyZenith: { value: new THREE.Color() },
  uSkyHorizon: { value: new THREE.Color() },
  uSkySunward: { value: new THREE.Color() },
  uSkyGlow: { value: new THREE.Color() },
  uSkyAnti: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uFogSunColor: { value: new THREE.Color() },
  uFogDensity: { value: 0.0004 },
  uFogHeightDensity: { value: 0.004 },
  uFogHeightFalloff: { value: 0.045 },
  uFogBaseHeight: { value: 0 },
  uNight: { value: 0 },
  uStarVis: { value: 0 },
  uWind: { value: new THREE.Vector3(1, 0, 0.3) }, // xy direction, z strength
  uRain: { value: 0 },
  uWetness: { value: 0 },
  uSnowCover: { value: 0 },
  uGlow: { value: 0 }, // bioluminescence strength (night)
  uLanternPos: { value: new THREE.Vector3() },
  uLanternColor: { value: new THREE.Color(0, 0, 0) },
};

/** Attach the shared uniforms to a compiled shader (by reference). */
export function attachGlobals(shader) {
  for (const [k, v] of Object.entries(G)) shader.uniforms[k] = v;
}

export const FOG_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform float uFogHeightDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseHeight;

// Distance haze + exponential height fog (analytic integral along the view ray)
// with in-scattering towards the sun.
vec3 rbApplyFog(vec3 color, vec3 worldPos) {
  vec3 camToP = worldPos - cameraPosition;
  float dist = length(camToP);
  vec3 dir = camToP / max(dist, 1e-4);
  float b = uFogHeightFalloff;
  float h0 = cameraPosition.y - uFogBaseHeight;
  float dy = camToP.y;
  float heightFog = uFogHeightDensity * exp(-b * max(h0, -20.0));
  float integral = abs(dy) > 0.05 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
  float amount = (uFogDensity + heightFog * integral) * dist;
  float f = 1.0 - exp(-amount);
  float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 fogCol = mix(uFogColor, uFogSunColor, sunAmt);
  return mix(color, fogCol, clamp(f, 0.0, 1.0));
}
`;

let installed = false;

/** Replace three.js fog chunks with the Riverbound atmosphere (idempotent). */
export function installAtmosphereChunks() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  #ifdef RB_SPRITE
    vFogWorldPos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #else
    vec4 rbFogWP = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      rbFogWP = instanceMatrix * rbFogWP;
    #endif
    vFogWorldPos = (modelMatrix * rbFogWP).xyz;
  #endif
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
  ${FOG_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = rbApplyFog(gl_FragColor.rgb, vFogWorldPos);
#endif`;
  // Every built-in material gets the shared uniforms.
  const original = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    attachGlobals(shader);
    if (this.isSpriteMaterial) shader.vertexShader = `#define RB_SPRITE\n${shader.vertexShader}`;
    if (original && original !== onBeforeCompile) original.call(this, shader, renderer);
  };
}

/** GLSL: analytic sky radiance used by the sky dome, water reflections and env capture. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkySunward;
uniform vec3 uSkyGlow;
uniform vec3 uSkyAnti;

vec3 rbSkyBase(vec3 dir) {
  float y = dir.y;
  float hb = pow(1.0 - clamp(y, 0.0, 1.0), 4.0);
  vec2 sunH = normalize(uSunDir.xz + vec2(1e-5));
  vec2 dirH = normalize(dir.xz + vec2(1e-5));
  float az = dot(dirH, sunH) * 0.5 + 0.5;
  vec3 horizon = mix(uSkyAnti, uSkyHorizon, smoothstep(0.0, 0.55, az));
  horizon = mix(horizon, uSkySunward, pow(az, 4.0) * (1.0 - smoothstep(0.0, 0.5, y)));
  vec3 col = mix(uSkyZenith, horizon, hb);
  // Belt of Venus: a faint pink band above the anti-solar horizon at twilight.
  float belt = exp(-pow((y - 0.08) / 0.07, 2.0)) * (1.0 - az) * smoothstep(-0.25, 0.02, uSunDir.y) * (1.0 - smoothstep(0.02, 0.2, uSunDir.y));
  col += uSkyAnti * belt * 0.5;
  // Below the horizon fade to haze.
  col = mix(col, uFogColor * 0.85, smoothstep(0.0, -0.18, y));
  // Sun glow (Mie-like forward scattering).
  float cosT = max(dot(dir, uSunDir), 0.0);
  float glow = pow(cosT, 5.0) * 0.28 + pow(cosT, 40.0) * 0.55 + pow(cosT, 400.0) * 1.2;
  col += uSkyGlow * glow * (0.35 + 0.65 * hb) * smoothstep(-0.2, 0.02, uSunDir.y);
  return col;
}
`;

export const NOISE_GLSL = /* glsl */ `
float rbHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float rbHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 rbHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float rbNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = rbHash12(i), b = rbHash12(i + vec2(1.0, 0.0));
  float c = rbHash12(i + vec2(0.0, 1.0)), d = rbHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float rbNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = rbHash13(i), n100 = rbHash13(i + vec3(1,0,0));
  float n010 = rbHash13(i + vec3(0,1,0)), n110 = rbHash13(i + vec3(1,1,0));
  float n001 = rbHash13(i + vec3(0,0,1)), n101 = rbHash13(i + vec3(1,0,1));
  float n011 = rbHash13(i + vec3(0,1,1)), n111 = rbHash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
`;
