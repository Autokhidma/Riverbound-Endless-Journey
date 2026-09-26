// Render pipeline: WebGL2 renderer, HDR scene target, pre-passes (water
// reflection, ripples), environment lighting capture, post FX and dynamic
// resolution.
import * as THREE from 'three';
import { PostFX } from './PostFX.js';
import { installAtmosphereChunks } from './globalUniforms.js';
import { DynamicResolution } from './DynamicResolution.js';
import { LAYERS } from './layers.js';

export class RenderPipeline {
  constructor(canvas, quality) {
    installAtmosphereChunks();
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.LinearSRGBColorSpace; // composite pass does sRGB encoding
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.autoUpdate = true;
    r.info.autoReset = false;
    this.gl = r.getContext();
    this.gpuInfo = this.detectGPU();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xffffff, 1, 2); // enables USE_FOG; our chunks ignore these values
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 5000);
    this.camera.layers.enable(LAYERS.NO_REFLECT);
    this.post = new PostFX(r);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envTarget = null;
    this.envTimer = 0;
    this.prePasses = [];
    this.dynamicRes = new DynamicResolution();
    this.scale = 1;
    this.frame = 0;
    this.lastStats = { drawCalls: 0, triangles: 0, points: 0, lines: 0 };
    this.timer = this.createGpuTimer();
    this.setQuality(quality);
  }

  detectGPU() {
    const gl = this.gl;
    let renderer = 'unknown', vendor = 'unknown';
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
      } else renderer = gl.getParameter(gl.RENDERER);
    } catch { /* ignore */ }
    return {
      renderer, vendor,
      cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      hardwareRayTracing: false,
    };
  }

  createGpuTimer() {
    const gl = this.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    return { ext, queries: [], lastMs: 0 };
  }

  beginGpuTimer() {
    const t = this.timer;
    if (!t) return;
    const gl = this.gl;
    // Collect finished queries.
    while (t.queries.length) {
      const q = t.queries[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(t.ext.GPU_DISJOINT_EXT);
      if (!available) break;
      if (!disjoint) t.lastMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
      t.queries.shift();
    }
    if (t.queries.length > 3) return;
    const q = gl.createQuery();
    gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
    t.active = q;
  }

  endGpuTimer() {
    const t = this.timer;
    if (!t || !t.active) return;
    this.gl.endQuery(t.ext.TIME_ELAPSED_EXT);
    t.queries.push(t.active);
    t.active = null;
  }

  get gpuMs() {
    return this.timer ? this.timer.lastMs : null;
  }

  setQuality(q) {
    this.q = q;
    const r = this.renderer;
    r.shadowMap.enabled = q.shadows.enabled;
    r.shadowMap.type = q.shadows.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.camera.far = q.cameraFar;
    this.camera.updateProjectionMatrix();
    this.dynamicRes.configure(q);
    this.scale = q.dynamicRes ? q.maxScale : q.renderScale;
    this.resize(true);
  }

  resize(force = false) {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatioCap);
    if (!force && w === this.cssW && h === this.cssH && pr === this.pr) return;
    this.cssW = w; this.cssH = h; this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.allocateTargets();
  }

  allocateTargets() {
    const w = Math.max(64, Math.round(this.cssW * this.pr * this.scale));
    const h = Math.max(64, Math.round(this.cssH * this.pr * this.scale));
    this.width = w; this.height = h;
    this.sceneRT?.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture,
      samples: this.q.msaa || 0,
    });
    this.post.configure(this.q, w, h);
  }

  /** Change internal resolution scale (dynamic resolution). */
  setScale(s) {
    s = Math.round(s * 20) / 20;
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.allocateTargets();
  }

  /** Re-capture the sky into the IBL environment map. */
  updateEnvironment(envScene, force = false, dt = 0) {
    this.envTimer -= dt;
    if (!force && this.envTimer > 0) return;
    this.envTimer = this.q.envUpdateSeconds;
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(envScene, 0, 0.1, 100, { size: 128 });
    this.scene.environment = this.envTarget.texture;
    old?.dispose();
  }

  render(time, frameMs) {
    const r = this.renderer;
    r.info.reset();
    this.beginGpuTimer();
    for (const p of this.prePasses) p(r, this.camera, this.scene);
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.post.render(this.sceneRT, { time, camera: this.camera, outputTarget: null });
    this.endGpuTimer();
    this.lastStats.drawCalls = r.info.render.calls;
    this.lastStats.triangles = r.info.render.triangles;
    this.lastStats.points = r.info.render.points;
    this.frame++;
    if (this.q.dynamicRes && frameMs !== undefined) {
      const s = this.dynamicRes.update(frameMs, this.gpuMs, this.scale);
      if (s !== null) this.setScale(s);
    }
  }

  /** Capture the current frame as a PNG data URL (renders one extra frame). */
  capture(time, { width, height, type = 'image/png', quality = 0.92 } = {}) {
    const r = this.renderer;
    const w = width ?? this.cssW * this.pr;
    const h = height ?? this.cssH * this.pr;
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType });
    for (const p of this.prePasses) p(r, this.camera, this.scene);
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.post.render(this.sceneRT, { time, camera: this.camera, outputTarget: target });
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, buf);
    target.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    // flip vertically
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL(type, quality);
  }

  stats() {
    const info = this.renderer.info;
    return {
      ...this.lastStats,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      scale: this.scale,
      width: this.width,
      height: this.height,
      gpuMs: this.gpuMs,
    };
  }
}
