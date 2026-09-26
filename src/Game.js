// Game: orchestrates the systems. It owns the frame loop, the floating origin
// and the order in which systems update; the systems own their own logic.
import * as THREE from 'three';
import { EventBus } from './core/events.js';
import { Input } from './core/Input.js';
import { lerp, clamp, smoothstep } from './core/math.js';
import { RenderPipeline } from './render/Renderer.js';
import { resolveQuality } from './render/QualityPresets.js';
import { G } from './render/globalUniforms.js';
import { Lighting } from './render/Lighting.js';
import { createTerrainMaterial } from './render/TerrainMaterial.js';
import { WorldGen } from './world/WorldGen.js';
import { WorkerPool } from './world/WorkerPool.js';
import { TerrainStreamer } from './world/TerrainStreamer.js';
import { WaterSystem } from './water/WaterSystem.js';
import { VegetationStreamer } from './world/VegetationStreamer.js';
import { SkyDome } from './sky/SkyDome.js';
import { TimeOfDay } from './sky/TimeOfDay.js';
import { evaluatePalette } from './sky/SkyPalette.js';
import { PlayerBoat } from './boat/PlayerBoat.js';
import { CharacterModel } from './character/CharacterModel.js';
import { CharacterAnimator } from './character/CharacterAnimator.js';
import { CameraRig, CAMERA_LABELS } from './camera/CameraRig.js';
import { RiverPilot } from './boat/RiverPilot.js';
import { BIOMES } from './world/biomes.js';

const ORIGIN_STEP = 2048;

export class Game {
  constructor({ canvas, settings, storage, hooks = {} }) {
    this.canvas = canvas;
    this.settings = settings;
    this.storage = storage;
    this.hooks = hooks;
    this.events = new EventBus();
    this.systems = [];
    this.running = false;
    this.paused = false;
    this.elapsed = 0;
    this.frame = 0;
    this.origin = { x: 0, z: 0 };
    this.frameTimes = [];
    this.cpu = { update: 0, render: 0 };
    this.state = 'boot';
    this.onFoot = false;
  }

  /** Build the renderer and world for a seed. */
  async init({ seed = 'RIVERBOUND', quality } = {}) {
    this.quality = quality ?? resolveQuality(this.settings.get('graphics'));
    this.pipeline = new RenderPipeline(this.canvas, this.quality);
    this.scene = this.pipeline.scene;
    this.camera3 = this.pipeline.camera;
    this.worldRoot = new THREE.Group();
    this.worldRoot.name = 'worldRoot';
    this.scene.add(this.worldRoot);
    this.input = new Input(this.canvas, this.settings);
    this.time = new TimeOfDay({ hours: 16.6, dayLengthMinutes: this.settings.get('gameplay.dayLengthMinutes') });
    this.sky = new SkyDome(this.quality);
    this.scene.add(this.sky.mesh);
    this.lighting = new Lighting(this.scene, this.quality);
    this.terrainMaterial = createTerrainMaterial();
    this.weather = { cloud: 0.25, rain: 0, fog: 0, storm: 0, wind: 0.25, windX: 1.2, windZ: 0.4, murk: 0, snow: 0, haze: 0, mist: 0, cloudOffset: new THREE.Vector2() };
    this.palette = {};
    this.cameraRig = new CameraRig(this.camera3, this.settings);
    this.camera = this.cameraRig;
    this.pipeline.prePasses.push((r, cam, scene) => this.water?.prePass(r, cam, scene, this.planeY ?? 0));
    this.pilot = new RiverPilot(this);
    await this.loadWorld(seed);
    window.addEventListener('resize', () => this.pipeline.resize());
    return this;
  }

  async loadWorld(seed) {
    this.disposeWorld();
    this.seed = seed;
    this.world = new WorldGen(seed);
    const cores = navigator.hardwareConcurrency || 4;
    this.pool = new WorkerPool(this.world.seed, { count: Math.max(1, Math.min(3, cores - 1)), useWorkers: this.hooks.useWorkers !== false });
    this.terrain = new TerrainStreamer(this.worldRoot, this.pool, this.terrainMaterial, this.quality);
    this.water = new WaterSystem({ world: this.world, pool: this.pool, root: this.worldRoot, pipeline: this.pipeline, quality: this.quality });
    this.vegetation = new VegetationStreamer(this.worldRoot, this.pool, this.quality);
    this.boat = new PlayerBoat(this);
    this.characterModel = new CharacterModel();
    this.character = { model: this.characterModel, anim: new CharacterAnimator(this.characterModel) };
    this.boat.seatCharacter(this.character);
    const home = this.world.findFeature((i) => i.storyKey === 'home', 1);
    const start = home?.moor ?? this.world.riverToWorld(60, 0);
    const r = this.world.main.nearest(start.x, start.z, {});
    const heading = this.world.main.sample(r.s, {}).h;
    this.setOrigin(start.x, start.z);
    this.boat.placeAt(start.x, start.z, heading);
    for (const s of this.systems) s.onWorld?.(this);
    this.events.emit('world:loaded', { seed: this.world.seed });
  }

  disposeWorld() {
    this.pool?.dispose();
    this.terrain?.dispose();
    this.water?.dispose();
    this.vegetation?.dispose();
    if (this.boat) this.worldRoot.remove(this.boat.model.group);
    for (const s of this.systems) s.onWorldDispose?.(this);
  }

  addSystem(sys) {
    this.systems.push(sys);
    sys.init?.(this);
    if (this.world) sys.onWorld?.(this);
    return sys;
  }

  setQuality(q) {
    this.quality = q;
    this.pipeline.setQuality(q);
    this.lighting.setQuality(q);
    this.sky.setQuality(q);
    this.terrain.setQuality(q);
    this.water.setQuality(q);
    this.vegetation.setQuality(q);
    for (const s of this.systems) s.setQuality?.(q);
    this.pipeline.updateEnvironment(this.sky.envScene, true);
  }

  /** Re-resolve the quality config from the graphics settings and apply it. */
  applyGraphics() {
    this.setQuality(resolveQuality(this.settings.get('graphics')));
  }

  setFullscreen(on) {
    if (window.riverboundNative?.setFullscreen) { window.riverboundNative.setFullscreen(on); return; }
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else if (!on && document.fullscreenElement) document.exitFullscreen?.();
    } catch (e) { /* not allowed without a user gesture */ }
  }

  // ---------------------------------------------------------------- origin
  setOrigin(x, z) {
    const ox = Math.round(x / ORIGIN_STEP) * ORIGIN_STEP;
    const oz = Math.round(z / ORIGIN_STEP) * ORIGIN_STEP;
    const dx = ox - this.origin.x, dz = oz - this.origin.z;
    this.origin.x = ox; this.origin.z = oz;
    this.worldRoot.position.set(-ox, 0, -oz);
    this.worldRoot.updateMatrixWorld(true);
    if (dx || dz) {
      this.cameraRig?.shift(dx, dz);
      this.events.emit('origin:shift', { dx, dz });
    }
  }

  checkOrigin() {
    const p = this.player();
    if (Math.abs(p.x - this.origin.x) > ORIGIN_STEP * 0.5 || Math.abs(p.z - this.origin.z) > ORIGIN_STEP * 0.5) this.setOrigin(p.x, p.z);
  }

  toScene(x, y, z, out = new THREE.Vector3()) {
    return out.set(x - this.origin.x, y, z - this.origin.z);
  }

  /** Player absolute position (boat or on foot). */
  player() {
    if (this.onFoot && this.walker) return this.walker.pos;
    const p = this.boat.physics;
    return { x: p.x, y: p.y, z: p.z };
  }

  collidersNear(x, z, r) {
    const res = [];
    const u = this.world.macroU(x, z);
    for (const f of this.world.featuresNearU(u, 1)) {
      for (const c of f.colliders) {
        const reach = r + (c.r ?? c.hl ?? 5) + 2;
        if (Math.abs(c.x - x) < reach && Math.abs(c.z - z) < reach) res.push(c);
      }
    }
    for (const s of this.systems) if (s.colliders) res.push(...s.colliders(x, z, r));
    return res;
  }

  // ------------------------------------------------------------------ loop
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dtMs = now - this.last;
      this.last = now;
      this.step(Math.min(0.1, dtMs / 1000), dtMs);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** One frame: update + render. Public so tests can step deterministically. */
  step(dt, frameMs = dt * 1000, { render = true } = {}) {
    const t0 = performance.now();
    this.update(dt);
    const t1 = performance.now();
    if (render) this.render(frameMs);
    const t2 = performance.now();
    this.cpu.update = this.cpu.update * 0.9 + (t1 - t0) * 0.1;
    this.cpu.render = this.cpu.render * 0.9 + (t2 - t1) * 0.1;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.frame++;
  }

  update(dt) {
    const input = this.input;
    input.poll();
    const gameplay = !this.paused && this.state === 'playing' && input.enabled;
    const simDt = this.paused || this.timeFrozen ? 0 : dt;
    this.elapsed += simDt;
    G.uTime.value = this.elapsed;

    // Global actions.
    if (gameplay && this.cameraRig.mode !== 'photo') {
      if (input.pressed('camera')) {
        const mode = this.cameraRig.cycle();
        this.events.emit('toast', { text: CAMERA_LABELS[mode], kind: 'camera' });
      }
      if (input.pressed('cruise') && !this.onFoot) {
        const on = this.pilot.toggle();
        this.events.emit('toast', { text: on ? 'Cruising - the river carries you' : 'Cruise off', kind: 'camera' });
      }
      if (input.pressed('lantern')) {
        this.boat.lanternOn = !this.boat.lanternOn;
        this.events.emit('lantern', { on: this.boat.lanternOn });
      }
    }

    this.time.update(simDt);
    for (const s of this.systems) if (s.preUpdate) s.preUpdate(simDt, this);

    // Player control.
    let control = { throttle: 0, steer: 0, hurry: false, brake: false };
    if (gameplay && !this.onFoot && !this.controlLocked && this.cameraRig.mode !== 'photo') {
      const mv = input.move();
      control = { throttle: mv.throttle, steer: mv.steer, hurry: input.down('hurry'), brake: input.down('brake') };
    }
    if (!this.onFoot) control = this.pilot.control(control);
    if (this.autopilot) control = this.autopilot(control, this);
    this.boat.update(simDt, control);
    for (const s of this.systems) if (s.update) s.update(simDt, this);

    // Streaming.
    const cam = this.camera3.position;
    const camAbs = { x: cam.x + this.origin.x, y: cam.y, z: cam.z + this.origin.z };
    const ground = this.world.heightAt(camAbs.x, camAbs.z);
    this.terrain.update(camAbs, ground);
    const p = this.boat.physics;
    this.water.updateStreaming(camAbs, p.s);
    this.vegetation.update(camAbs);
    this.checkOrigin();

    // Visual sync.
    this.boat.syncVisuals(simDt);
    this.updateCharacter(simDt);
    this.updateAtmosphere(dt);

    // Camera.
    const look = gameplay || this.cameraRig.mode === 'photo' ? input.look(dt) : { x: 0, y: 0, active: false };
    const zoom = gameplay ? input.zoom() : 0;
    const headPos = this.characterModel.joints.head.getWorldPosition(new THREE.Vector3());
    headPos.y += 0.12;
    const target = this.onFoot && this.walker ? this.toScene(this.walker.pos.x, this.walker.pos.y, this.walker.pos.z) : this.toScene(p.x, p.y, p.z);
    const photoMove = { x: 0, y: 0, z: 0 };
    if (this.cameraRig.mode === 'photo' && !this.paused && !this.ui?.modalOpen) {
      if (input.keyDown('KeyW')) photoMove.z += 1;
      if (input.keyDown('KeyS')) photoMove.z -= 1;
      if (input.keyDown('KeyD')) photoMove.x += 1;
      if (input.keyDown('KeyA')) photoMove.x -= 1;
      if (input.keyDown('KeyE') || input.keyDown('Space')) photoMove.y += 1;
      if (input.keyDown('KeyQ') || input.keyDown('ControlLeft')) photoMove.y -= 1;
      if (input.pad) { photoMove.x += input.padAxis(0); photoMove.z -= input.padAxis(1); }
    }
    this.cameraRig.update(dt, {
      target, heading: this.onFoot && this.walker ? this.walker.heading : p.heading, headPos, look, zoom,
      speed: this.onFoot ? 0 : p.speed, waterY: p.waterLevel,
      groundAt: (x, z) => this.world.heightAt(x + this.origin.x, z + this.origin.z),
      sunDir: G.uSunDir.value, move: photoMove, fast: input.down('hurry'),
      rollPitch: { roll: p.roll, pitch: p.pitch }, rapids: p.rapids, onFoot: this.onFoot,
    });
    this.characterModel.setFirstPerson(this.cameraRig.mode === 'first' && (this.cameraRig.trans.t > 0.5));
    this.planeY = p.waterLevel;

    // Water uniforms (wake, ripples, lights).
    this.water.update({
      dt: simDt, time: this.elapsed, origin: this.origin, boat: this.onFoot ? null : this.boat.wakeInfo(), weather: this.weather,
      palette: this.palette, lights: this.worldLights ?? [], celestial: this.time.starMatrix, glowEvent: this.glowEvent ?? 0,
    });
    for (const s of this.systems) if (s.lateUpdate) s.lateUpdate(simDt, this);
    input.endFrame();
  }

  updateCharacter(dt) {
    const anim = this.character.anim;
    if (this.onFoot) return; // walker drives animation
    const p = this.boat.physics;
    if (this.characterAction) {
      anim.setState(this.characterAction.state, this.characterAction.params);
      anim.setHandTargets(null, null, 0);
    } else if (this.boat.rowing) {
      anim.setState('row', { stroke: p.stroke, lookYaw: undefined });
      const h = this.boat.handTargets();
      anim.setHandTargets(h.L, h.R, 1);
    } else {
      anim.setState('sit', {});
      anim.setHandTargets(null, null, 0);
    }
    anim.update(dt);
  }

  /** Sky, fog, lights and post parameters from time, biome and weather. */
  updateAtmosphere(dt) {
    const p = this.player();
    const bl = this.world.biomeAt(p.x, p.z);
    const A = bl.a.atmosphere, B = bl.b.atmosphere, t = bl.t;
    const atmosphere = {
      skyTintLin: A.skyTintLin.map((v, i) => lerp(v, B.skyTintLin[i], t)),
      fogTintLin: A.fogTintLin.map((v, i) => lerp(v, B.fogTintLin[i], t)),
      sunset: lerp(A.sunset, B.sunset, t),
      stars: lerp(A.stars, B.stars, t),
    };
    this.currentBiome = t > 0.5 ? bl.b : bl.a;
    this.biomeBlend = bl;
    const w = this.weather;
    const pal = evaluatePalette({ sunElevation: this.time.sunElevation, isMorning: this.time.isMorning, atmosphere, weather: w }, this.palette);
    G.uSkyZenith.value.fromArray(pal.zenith);
    G.uSkyHorizon.value.fromArray(pal.horizon);
    G.uSkySunward.value.fromArray(pal.sunward);
    G.uSkyGlow.value.fromArray(pal.glow);
    G.uSkyAnti.value.fromArray(pal.anti);
    G.uFogColor.value.fromArray(pal.fog);
    G.uFogSunColor.value.setRGB(lerp(pal.fog[0], pal.glow[0], 0.55), lerp(pal.fog[1], pal.glow[1], 0.55), lerp(pal.fog[2], pal.glow[2], 0.55));
    const night = this.time.nightFactor;
    G.uNight.value = night;
    G.uStarVis.value = pal.stars * night;
    // Fog: biome haze + mist, stronger in the morning and with weather.
    const fogBase = lerp(A.fog, B.fog, t);
    const mist = lerp(A.mist, B.mist, t);
    const morning = this.time.isMorning ? smoothstep(-8, 2, this.time.sunElevation) * (1 - smoothstep(10, 25, this.time.sunElevation)) : 0;
    G.uFogDensity.value = fogBase * (0.55 + w.fog * 9 + w.rain * 1.8 + w.storm * 2 + (w.haze ?? 0) * 1.6) * (this.fogScale ?? 1);
    G.uFogHeightDensity.value = (0.0012 + mist * 0.0035 * (0.3 + morning * 1.6 + w.mist * 1.5) + w.fog * 0.02 + w.mist * 0.003) * (this.fogScale ?? 1);
    G.uFogHeightFalloff.value = 0.06;
    G.uFogBaseHeight.value = this.boat.physics.waterLevel;
    G.uRain.value = w.rain;
    G.uWetness.value = Math.min(1, (w.wetness ?? w.rain));
    G.uSnowCover.value = w.snowCover ?? 0;
    G.uGlow.value = night;
    G.uWind.value.set(w.windX ?? 1, w.windZ ?? 0, w.wind ?? 0.2);
    // Lantern uniforms for water and foliage.
    const lamp = this.boat.model.light;
    const lp = lamp.getWorldPosition(new THREE.Vector3());
    G.uLanternPos.value.copy(lp);
    const li = this.boat.lanternLevel * (this.boat.model.lanternPower ?? 1);
    const tint = this.boat.model.lanternTint ?? [1, 0.62, 0.3];
    G.uLanternColor.value.setRGB(tint[0] * li * 1.6, tint[1] * li * 1.6, tint[2] * li * 1.6);
    // Sky dome.
    w.cloudOffset.x += (w.windX ?? 1) * dt * 0.0012;
    w.cloudOffset.y += (w.windZ ?? 0) * dt * 0.0012;
    this.sky.update(dt, {
      celestialMatrix: this.time.starMatrix, cloudCover: clamp(w.cloud, 0, 1), cloudDensity: 0.95, cloudOffset: w.cloudOffset,
      cloudLit: pal.cloudLit, cloudShade: pal.cloudShade, aurora: this.aurora ?? 0, night, meteorRate: this.meteorRate ?? 1,
    });
    this.sky.mesh.position.copy(this.camera3.position);
    this.lighting.update(pal, this.time, this.toScene(p.x, p.y, p.z));
    // Post: exposure adapts at night so darkness stays readable but moody.
    const post = this.pipeline.post;
    const pp = post.params;
    if (!this.photoGrade) {
      pp.exposure = lerp(1.0, 1.65, night) * (1 + (w.cloud > 0.6 ? 0.15 : 0));
      pp.saturation = lerp(1.08, 0.72, night) * (1 - w.storm * 0.2);
      pp.contrast = 1.05;
      pp.temperature = lerp(0, -0.25, night) + (pal.sunward[0] > pal.sunward[2] * 1.5 && this.time.sunElevation < 12 ? 0.08 : 0);
      pp.vignette = 0.32;
      pp.bloom = lerp(0.05, 0.1, night);
    }
    pp.colorMode = { normal: 0, deuteranopia: 1, protanopia: 2, tritanopia: 3, highContrast: 4 }[this.settings.get('accessibility.colorMode')] ?? 0;
    // God rays: sun on screen, low in the sky, with some haze.
    const sunScreen = new THREE.Vector3().copy(G.uSunDir.value).multiplyScalar(1000).add(this.camera3.position).project(this.camera3);
    const inFront = sunScreen.z < 1 && Math.abs(sunScreen.x) < 1.4 && Math.abs(sunScreen.y) < 1.4;
    post.rays.visible = inFront && this.time.sunElevation > -2;
    post.rays.sun.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
    const lowSun = 1 - smoothstep(10, 45, this.time.sunElevation);
    post.rays.strength = (0.35 + lowSun * 0.6 + (fogBase * 400 + mist * 0.3) * 0.5) * (1 - w.cloud * 0.6) * (this.settings.get('accessibility.reduceFlashing') ? 0.6 : 1);
    post.rays.color = [pal.glow[0], pal.glow[1] * 0.95, pal.glow[2] * 0.85];
    // Environment lighting capture (timed).
    this.pipeline.updateEnvironment(this.sky.envScene, false, dt);
    this.scene.environmentIntensity = lerp(0.9, 0.35, night);
  }

  render(frameMs) {
    this.pipeline.render(this.elapsed, frameMs);
  }

  /** Stats for the performance overlay / benchmarks. */
  stats() {
    const ft = this.frameTimes;
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    const sorted = [...ft].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? avg;
    const mem = performance.memory ? { usedMB: performance.memory.usedJSHeapSize / 1048576, totalMB: performance.memory.totalJSHeapSize / 1048576 } : null;
    return {
      fps: 1000 / Math.max(1, avg), frameMs: avg, p99Ms: p99, cpuUpdateMs: this.cpu.update, cpuRenderMs: this.cpu.render,
      render: this.pipeline.stats(), terrain: { ...this.terrain.stats }, water: { ...this.water.stats }, vegetation: { ...this.vegetation.stats }, workers: { ...this.pool.stats },
      memory: mem, biome: this.currentBiome?.name, region: this.world.regionAtS(this.boat.physics.s).name, s: this.boat.physics.s,
      quality: this.quality.preset, laptop: !!this.quality.laptopMode,
    };
  }
}

export { BIOMES };
