// Materials for instanced vegetation and rocks: wind sway + leaf flutter in
// the vertex shader (phase from instance position), fake subsurface
// translucency when back-lit by the sun, and night-time bioluminescence.
import * as THREE from 'three';
import { attachGlobals } from './globalUniforms.js';

const WIND_VERTEX = /* glsl */ `
#include <begin_vertex>
{
  vec3 ipos = vec3(0.0);
  mat3 im = mat3(1.0);
  #ifdef USE_INSTANCING
    ipos = instanceMatrix[3].xyz;
    im = mat3(instanceMatrix);
  #endif
  vec3 wroot = (modelMatrix * vec4(ipos, 1.0)).xyz;
  float phase = dot(wroot.xz, vec2(0.071, 0.113));
  float ws = uWind.z;
  vec2 wd = normalize(uWind.xy + vec2(1e-4));
  float sway = sin(uTime * 1.05 + phase) * 0.55 + sin(uTime * 2.2 + phase * 1.7) * 0.2;
  float gust = 0.5 + 0.5 * sin(uTime * 0.31 + phase * 0.23);
  float flex = aWind.x * aWind.x;
  vec3 disp = vec3(wd.x, 0.0, wd.y) * (sway * 0.35 + gust * ws * 0.8) * flex * (0.12 + ws * 0.55);
  disp += vec3(sin(uTime * 6.1 + position.x * 5.0 + phase), sin(uTime * 5.3 + position.z * 4.0) * 0.5, cos(uTime * 6.7 + position.y * 5.0)) * 0.018 * aWind.y * (0.35 + ws);
  // world-space displacement -> instance-local space
  float sc2 = max(dot(im[0], im[0]), 1e-4);
  transformed += (transpose(im) * disp) / sc2;
  vLeaf = aWind.y;
  vGlowMask = aWind.z;
  vFWorld = (modelMatrix * vec4(im * transformed + ipos, 1.0)).xyz;
}
`;

function patch(mat, { glow = false, translucency = 0.3, crystal = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    attachGlobals(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aWind;
uniform float uTime;
uniform vec3 uWind;
varying float vLeaf;
varying float vGlowMask;
varying vec3 vFWorld;`)
      .replace('#include <begin_vertex>', WIND_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSunColor;
uniform vec3 uSunDirF;
uniform float uGlow;
uniform float uTime;
uniform vec3 uLanternPos;
uniform vec3 uLanternColor;
varying float vLeaf;
varying float vGlowMask;
varying vec3 vFWorld;`)
      .replace('#include <fog_fragment>', `
{
  vec3 Vd = normalize(cameraPosition - vFWorld);
  float back = pow(max(dot(-Vd, uSunDir), 0.0), 3.0);
  gl_FragColor.rgb += diffuseColor.rgb * uSunColor * back * ${translucency.toFixed(2)} * (0.35 + vLeaf);
  float dl = length(uLanternPos - vFWorld);
  gl_FragColor.rgb += diffuseColor.rgb * uLanternColor * 0.35 / (1.0 + dl * dl * 0.12) * (0.4 + vLeaf);
  ${glow || crystal ? `float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + vFWorld.x * 0.7 + vFWorld.z * 0.5);
  gl_FragColor.rgb += diffuseColor.rgb * vGlowMask * (uGlow * ${crystal ? '2.2' : '3.2'} * pulse + ${crystal ? '0.15' : '0.02'});` : ''}
}
#include <fog_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('uniform vec3 uSunDirF;', '');
  };
  mat.customProgramCacheKey = () => `rb-foliage-${glow}-${crystal}-${translucency}`;
  return mat;
}

let mats = null;

export function getFoliageMaterials() {
  if (mats) return mats;
  mats = {
    foliage: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.5 }), { glow: true, translucency: 0.35 }),
    rock: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 }), { translucency: 0 }),
    crystal: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, envMapIntensity: 1.5 }), { crystal: true, translucency: 0.5 }),
  };
  return mats;
}
