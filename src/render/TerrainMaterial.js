// Terrain material: vertex-coloured PBR with procedural detail, triplanar rock,
// wet shorelines (darker + glossier), snow and rain wetness.
import * as THREE from 'three';
import { getTextures } from './ProceduralTextures.js';
import { attachGlobals } from './globalUniforms.js';

export function createTerrainMaterial() {
  const tex = getTextures();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  mat.onBeforeCompile = (shader) => {
    attachGlobals(shader);
    shader.uniforms.tDetail = { value: tex.detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aMat;
varying vec4 vMat;
varying vec3 vTWorld;
varying vec3 vTNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vMat = aMat;
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tDetail;
uniform float uWetness;
uniform float uSnowCover;
varying vec4 vMat;
varying vec3 vTWorld;
varying vec3 vTNormal;
float rbWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// vertex colours are sRGB-encoded bytes: decode to linear
diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(2.2));
rbWet = vColor.a;
diffuseColor.a = 1.0;
vec2 wp = vTWorld.xz;
float camDist = length(vTWorld - cameraPosition);
float fade = 1.0 - smoothstep(150.0, 900.0, camDist);
vec4 dA = texture2D(tDetail, wp / 32.0);
vec4 dB = texture2D(tDetail, wp / 4.0);
float detail = (dA.r - 0.5) * 0.35 + (dB.g - 0.5) * 0.3 * fade + (dB.a - 0.5) * 0.12 * fade;
diffuseColor.rgb *= 1.0 + detail;
// triplanar rock strata
vec3 bw = abs(vTNormal); bw /= (bw.x + bw.y + bw.z + 1e-4);
float rx = texture2D(tDetail, vTWorld.zy * vec2(0.0625, 0.25)).b;
float ry = texture2D(tDetail, vTWorld.xz * 0.125).b;
float rz = texture2D(tDetail, vTWorld.xy * vec2(0.0625, 0.25)).b;
float rockTex = rx * bw.x + ry * bw.y + rz * bw.z;
diffuseColor.rgb *= mix(1.0, 0.62 + rockTex * 0.75, vMat.x);
// grass/flower speckle on open ground
diffuseColor.rgb *= mix(1.0, 0.9 + dB.b * 0.2, (1.0 - vMat.x) * (1.0 - vMat.y) * fade);
// snow: bright, slight blue in shadow
float snow = clamp(vMat.y + uSnowCover * smoothstep(0.55, 0.85, vTNormal.y) * (1.0 - rbWet), 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snow * (1.0 - vMat.y) );
// wetness: shore + rain darken albedo
float wet = clamp(max(rbWet, uWetness * 0.7) * (1.0 - snow), 0.0, 1.0);
diffuseColor.rgb *= 1.0 - wet * 0.45;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.28, wet);
roughnessFactor = mix(roughnessFactor, 0.55, snow);`);
  };
  mat.customProgramCacheKey = () => 'rb-terrain-v1';
  return mat;
}
