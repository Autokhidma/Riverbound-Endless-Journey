// Custom post-processing chain tuned for cost:
//   scene (HDR half-float) -> [god rays] -> [bloom mip chain] -> [DOF]
//   -> composite (exposure, ACES, grading, vignette, grain, colour-blind aid)
//   -> [FXAA] -> screen
import * as THREE from 'three';

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function rt(w, h, type = THREE.HalfFloatType, opts = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...opts,
  });
}

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform vec2 uTexel; uniform float uThreshold; uniform bool uPrefilter;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 4.0;
  c += texture2D(tInput, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  c /= 8.0;
  if (uPrefilter) {
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
    c *= k;
    c = min(c, vec3(60.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uMix;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tInput, vUv + vec2(-2.0, 0.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2( 2.0, 0.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(0.0, -2.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(0.0,  2.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(-1.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2( 1.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2(-1.0,-1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2( 1.0,-1.0) * uTexel).rgb * 2.0;
  c /= 12.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c * uMix, 1.0);
}`;

const RAYS_MASK_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform vec2 uSun; uniform float uAspect; uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 d = vUv - uSun; d.x *= uAspect;
  float falloff = exp(-dot(d, d) * 3.0);
  float m = smoothstep(uThreshold, uThreshold * 3.0 + 0.2, l);
  gl_FragColor = vec4(c * m * falloff, 1.0);
}`;

const RAYS_BLUR_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform vec2 uSun; uniform float uStep; uniform float uDecay;
varying vec2 vUv;
void main() {
  vec2 dir = (uSun - vUv) * uStep;
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0, wsum = 0.0;
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  uv += dir * jitter;
  for (int i = 0; i < SAMPLES; i++) {
    acc += texture2D(tInput, uv).rgb * w;
    wsum += w;
    w *= uDecay;
    uv += dir;
  }
  gl_FragColor = vec4(acc / max(wsum, 1e-4), 1.0);
}`;

const DOF_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform sampler2D tDepth; uniform vec2 uTexel;
uniform float uFocus; uniform float uAperture; uniform float uNear; uniform float uFar;
varying vec2 vUv;
float viewZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float coc(vec2 uv) {
  float z = viewZ(texture2D(tDepth, uv).x);
  return clamp(abs(z - uFocus) / max(z, 0.1) * uAperture, 0.0, 1.0);
}
void main() {
  float c0 = coc(vUv);
  vec3 acc = texture2D(tInput, vUv).rgb;
  float wsum = 1.0;
  const float GA = 2.39996323;
  for (int i = 1; i < 28; i++) {
    float r = sqrt(float(i) / 28.0);
    float a = float(i) * GA;
    vec2 o = vec2(cos(a), sin(a)) * r * 14.0 * uTexel;
    vec2 uv = vUv + o * max(c0, 0.05);
    float ci = coc(uv);
    float w = smoothstep(0.0, 0.2, ci) * 0.8 + 0.2;
    acc += texture2D(tInput, uv).rgb * w;
    wsum += w;
  }
  vec3 blurred = acc / wsum;
  gl_FragColor = vec4(mix(texture2D(tInput, vUv).rgb, blurred, smoothstep(0.02, 0.25, c0)), 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays;
uniform float uExposure; uniform float uBloom; uniform vec3 uRaysColor; uniform float uRays;
uniform float uContrast; uniform float uSaturation; uniform vec3 uLift; uniform vec3 uGain; uniform float uTemperature;
uniform float uVignette; uniform float uGrain; uniform float uTime; uniform int uColorMode; uniform float uFade; uniform vec3 uFadeColor;
uniform bool uHasBloom; uniform bool uHasRays; uniform bool uOutputSRGB;
varying vec2 vUv;

vec3 aces(vec3 x) {
  // Narkowicz ACES filmic approximation
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uHasBloom) c += texture2D(tBloom, vUv).rgb * uBloom;
  if (uHasRays) c += texture2D(tRays, vUv).rgb * uRaysColor * uRays;
  c *= uExposure;
  // white balance (warm/cool)
  c *= vec3(1.0 + uTemperature * 0.1, 1.0, 1.0 - uTemperature * 0.1);
  c = aces(c);
  // grading in display-ish space
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c = c * uGain + uLift * (1.0 - c);
  c = clamp(c, 0.0, 1.0);
  // colour-vision assistance (simple daltonisation shifts)
  if (uColorMode == 1) { c = mat3(0.8, 0.2, 0.0, 0.258, 0.742, 0.0, 0.0, 0.142, 0.858) * c; }
  else if (uColorMode == 2) { c = mat3(0.567, 0.433, 0.0, 0.558, 0.442, 0.0, 0.0, 0.242, 0.758) * c; }
  else if (uColorMode == 3) { c = mat3(0.95, 0.05, 0.0, 0.0, 0.433, 0.567, 0.0, 0.475, 0.525) * c; }
  else if (uColorMode == 4) { c = (c - 0.5) * 1.25 + 0.5; }
  vec2 v = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(v, v) * 1.6);
  c = mix(c, uFadeColor, uFade);
  vec3 outc = uOutputSRGB ? toSRGB(clamp(c, 0.0, 1.0)) : c;
  outc += (hash(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain;
  gl_FragColor = vec4(outc, 1.0);
}`;

const FXAA_FRAG = /* glsl */ `
uniform sampler2D tInput; uniform vec2 uTexel;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 rgbNW = texture2D(tInput, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tInput, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tInput, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tInput, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  vec3 rgbM = texture2D(tInput, vUv).rgb;
  float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture2D(tInput, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tInput, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tInput, vUv + dir * -0.5).rgb + texture2D(tInput, vUv + dir * 0.5).rgb);
  float lB = luma(b);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    const mk = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
    this.downMat = mk(DOWN_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uPrefilter: { value: false } });
    this.upMat = mk(UP_FRAG, { tInput: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } });
    this.raysMaskMat = mk(RAYS_MASK_FRAG, { tInput: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uThreshold: { value: 0.8 } });
    this.raysBlurMat = null;
    this.dofMat = mk(DOF_FRAG, { tInput: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uFocus: { value: 10 }, uAperture: { value: 0.5 }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.compMat = mk(COMPOSITE_FRAG, {
      tScene: { value: null }, tBloom: { value: null }, tRays: { value: null },
      uExposure: { value: 1 }, uBloom: { value: 0.06 }, uRaysColor: { value: new THREE.Color(1, 0.9, 0.7) }, uRays: { value: 0 },
      uContrast: { value: 1.05 }, uSaturation: { value: 1.08 }, uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uTemperature: { value: 0 }, uVignette: { value: 0.35 }, uGrain: { value: 0.012 }, uTime: { value: 0 }, uColorMode: { value: 0 },
      uFade: { value: 0 }, uFadeColor: { value: new THREE.Color(0, 0, 0) }, uHasBloom: { value: false }, uHasRays: { value: false }, uOutputSRGB: { value: true },
    });
    this.fxaaMat = mk(FXAA_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.bloomRTs = [];
    this.upRTs = [];
    this.params = { exposure: 1, bloom: 0.06, contrast: 1.05, saturation: 1.08, temperature: 0, vignette: 0.35, grain: 0.012, colorMode: 0, fade: 0, lift: [0, 0, 0], gain: [1, 1, 1] };
    this.dof = { enabled: false, focus: 10, aperture: 0.6 };
    this.rays = { strength: 0, color: [1, 0.9, 0.7], sun: new THREE.Vector2(0.5, 0.5), visible: false };
  }

  configure(q, width, height) {
    this.q = q;
    this.width = width; this.height = height;
    for (const r of [...this.bloomRTs, ...this.upRTs]) r.dispose();
    this.bloomRTs = []; this.upRTs = [];
    if (q.bloom.enabled) {
      let w = width / 2, h = height / 2;
      for (let i = 0; i < q.bloom.levels; i++) {
        this.bloomRTs.push(rt(w, h));
        if (i < q.bloom.levels - 1) this.upRTs.push(rt(w, h));
        w /= 2; h /= 2;
        if (w < 8 || h < 8) break;
      }
      this.upRTs.length = Math.max(0, this.bloomRTs.length - 1);
    }
    this.raysRT?.[0]?.dispose(); this.raysRT?.[1]?.dispose();
    this.raysRT = null;
    if (q.godRays.enabled) {
      const s = q.godRays.scale;
      this.raysRT = [rt(width * s, height * s), rt(width * s, height * s)];
      this.raysBlurMat?.dispose();
      this.raysBlurMat = new THREE.ShaderMaterial({
        vertexShader: FS_VERT, fragmentShader: RAYS_BLUR_FRAG, depthTest: false, depthWrite: false,
        defines: { SAMPLES: Math.max(8, q.godRays.samples | 0) },
        uniforms: { tInput: { value: null }, uSun: { value: new THREE.Vector2() }, uStep: { value: 0.02 }, uDecay: { value: 0.96 } },
      });
    }
    this.dofRT?.dispose();
    this.dofRT = rt(width, height);
    this.ldrRT?.dispose();
    this.ldrRT = q.aa === 'fxaa' ? rt(width, height, THREE.UnsignedByteType) : null;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(sceneRT, { time = 0, camera = null, outputTarget = null } = {}) {
    const q = this.q;
    let input = sceneRT.texture;
    const p = this.params;

    // --- depth of field (photo mode)
    if (this.dof.enabled && q.dof && sceneRT.depthTexture && camera) {
      const u = this.dofMat.uniforms;
      u.tInput.value = input;
      u.tDepth.value = sceneRT.depthTexture;
      u.uTexel.value.set(1 / this.width, 1 / this.height);
      u.uFocus.value = this.dof.focus;
      u.uAperture.value = this.dof.aperture;
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      this.pass(this.dofMat, this.dofRT);
      input = this.dofRT.texture;
    }

    // --- god rays
    let raysTex = null;
    if (this.raysRT && this.rays.visible && this.rays.strength > 0.01) {
      const m = this.raysMaskMat.uniforms;
      m.tInput.value = input;
      m.uSun.value.copy(this.rays.sun);
      m.uAspect.value = this.width / this.height;
      m.uThreshold.value = 0.9;
      this.pass(this.raysMaskMat, this.raysRT[0]);
      const b = this.raysBlurMat.uniforms;
      b.tInput.value = this.raysRT[0].texture;
      b.uSun.value.copy(this.rays.sun);
      b.uStep.value = 0.9 / q.godRays.samples;
      b.uDecay.value = 0.965;
      this.pass(this.raysBlurMat, this.raysRT[1]);
      raysTex = this.raysRT[1].texture;
    }

    // --- bloom
    let bloomTex = null;
    if (this.bloomRTs.length) {
      let src = input;
      let sw = this.width, sh = this.height;
      for (let i = 0; i < this.bloomRTs.length; i++) {
        const u = this.downMat.uniforms;
        u.tInput.value = src;
        u.uTexel.value.set(1 / sw, 1 / sh);
        u.uPrefilter.value = i === 0;
        u.uThreshold.value = 1.0;
        this.pass(this.downMat, this.bloomRTs[i]);
        src = this.bloomRTs[i].texture;
        sw = this.bloomRTs[i].width; sh = this.bloomRTs[i].height;
      }
      let up = this.bloomRTs[this.bloomRTs.length - 1].texture;
      for (let i = this.bloomRTs.length - 2; i >= 0; i--) {
        const u = this.upMat.uniforms;
        u.tInput.value = up;
        u.tBase.value = this.bloomRTs[i].texture;
        u.uTexel.value.set(1 / this.bloomRTs[i + 1].width, 1 / this.bloomRTs[i + 1].height);
        u.uMix.value = 1;
        this.pass(this.upMat, this.upRTs[i]);
        up = this.upRTs[i].texture;
      }
      bloomTex = up;
    }

    // --- composite
    const c = this.compMat.uniforms;
    c.tScene.value = input;
    c.tBloom.value = bloomTex;
    c.uHasBloom.value = !!bloomTex;
    c.tRays.value = raysTex;
    c.uHasRays.value = !!raysTex;
    c.uRays.value = this.rays.strength;
    c.uRaysColor.value.fromArray(this.rays.color);
    c.uExposure.value = p.exposure;
    c.uBloom.value = p.bloom;
    c.uContrast.value = p.contrast;
    c.uSaturation.value = p.saturation;
    c.uTemperature.value = p.temperature;
    c.uVignette.value = p.vignette;
    c.uGrain.value = p.grain;
    c.uTime.value = time;
    c.uColorMode.value = p.colorMode;
    c.uFade.value = p.fade;
    c.uLift.value.fromArray(p.lift);
    c.uGain.value.fromArray(p.gain);
    c.uOutputSRGB.value = true;
    if (this.ldrRT) {
      this.pass(this.compMat, this.ldrRT);
      const f = this.fxaaMat.uniforms;
      f.tInput.value = this.ldrRT.texture;
      f.uTexel.value.set(1 / this.width, 1 / this.height);
      this.pass(this.fxaaMat, outputTarget);
    } else {
      this.pass(this.compMat, outputTarget);
    }
  }

  dispose() {
    for (const r of [...this.bloomRTs, ...this.upRTs, this.dofRT, this.ldrRT, ...(this.raysRT || [])]) r?.dispose();
  }
}
