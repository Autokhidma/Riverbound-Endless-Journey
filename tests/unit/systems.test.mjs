import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PRESETS, PRESET_ORDER, resolveQuality, applyLaptopMode, suggestPreset } from '../../src/render/QualityPresets.js';
import { migrateSettings, DEFAULT_SETTINGS, DEFAULT_BINDINGS, Settings } from '../../src/core/Settings.js';
import { Storage, MemoryBackend } from '../../src/save/Storage.js';
import { TimeOfDay } from '../../src/sky/TimeOfDay.js';
import { sunDirection, moonIllumination, moonPhaseAngle } from '../../src/sky/Celestial.js';
import { evaluatePalette } from '../../src/sky/SkyPalette.js';
import { BIOME_BY_ID } from '../../src/world/biomes.js';
import { CameraRig, CAMERA_MODES } from '../../src/camera/CameraRig.js';
import { musicContext, chordOn, SCALES } from '../../src/audio/Music.js';
import { waveHeight, WAVE_TABLE } from '../../src/water/Waves.js';

test('presets scale work monotonically from Very Low to Cinematic', () => {
  assert.deepEqual(PRESET_ORDER, ['veryLow', 'low', 'medium', 'high', 'ultra', 'cinematic']);
  for (let i = 1; i < PRESET_ORDER.length; i++) {
    const a = PRESETS[PRESET_ORDER[i - 1]], b = PRESETS[PRESET_ORDER[i]];
    assert.ok(b.viewDistance >= a.viewDistance, `view distance ${PRESET_ORDER[i]}`);
    assert.ok(b.foliage.density >= a.foliage.density, `foliage ${PRESET_ORDER[i]}`);
    assert.ok(b.terrainRes >= a.terrainRes, `terrain ${PRESET_ORDER[i]}`);
    assert.ok(b.particles >= a.particles);
  }
  assert.equal(PRESETS.veryLow.shadows.enabled, false);
  assert.equal(PRESETS.veryLow.water.planar, false);
});

test('laptop mode lowers the cost of any preset; ray tracing is never claimed', () => {
  for (const p of PRESET_ORDER) {
    const l = applyLaptopMode(PRESETS[p]);
    assert.ok(l.viewDistance <= PRESETS[p].viewDistance);
    assert.ok(l.foliage.density <= PRESETS[p].foliage.density);
    assert.ok(l.maxScale <= PRESETS[p].maxScale);
    assert.ok(l.pointLights <= PRESETS[p].pointLights);
    assert.equal(l.laptopMode, true);
  }
  const q = resolveQuality({ preset: 'ultra', laptopMode: false, rayTracing: true, dynamicRes: false, targetFps: 90, minScale: 0.5, maxScale: 0.9, viewDistanceScale: 0.5, shadows: false });
  assert.equal(q.rayTracing, false);
  assert.equal(q.rayTracingRequested, true);
  assert.equal(q.dynamicRes, false);
  assert.equal(q.targetFps, 90);
  assert.equal(q.shadows.enabled, false);
  assert.equal(q.viewDistance, PRESETS.ultra.viewDistance * 0.5);
  assert.equal(resolveQuality({ preset: 'bogus' }).viewDistance, PRESETS.medium.viewDistance);
});

test('GPU detection picks sensible defaults', () => {
  assert.equal(suggestPreset({ renderer: 'Google SwiftShader' }).preset, 'veryLow');
  const igpu = suggestPreset({ renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620)', cores: 4 });
  assert.equal(igpu.laptopMode, true);
  assert.ok(['low', 'medium'].includes(igpu.preset));
  assert.equal(suggestPreset({ renderer: 'NVIDIA GeForce RTX 4090' }).preset, 'ultra');
  assert.equal(suggestPreset({ renderer: 'NVIDIA GeForce GTX 1660' }).preset, 'high');
});

test('settings migrate from v1 and keep new default bindings', async () => {
  const s = migrateSettings({ version: 1, quality: 'high', controls: { bindings: { forward: ['KeyZ'] } } });
  assert.equal(s.graphics.preset, 'high');
  assert.deepEqual(s.controls.bindings.forward, ['KeyZ']);
  assert.deepEqual(s.controls.bindings.photo, DEFAULT_BINDINGS.photo);
  assert.equal(s.version, DEFAULT_SETTINGS.version);
  const st = new Settings(new Storage(new MemoryBackend()));
  await st.load();
  let changed = null;
  st.on('change', (e) => { changed = e; });
  st.set('audio.music', 0.3);
  assert.equal(st.get('audio.music'), 0.3);
  assert.equal(changed.path, 'audio.music');
  const st2 = new Settings(st.storage);
  await st2.load();
  assert.equal(st2.get('audio.music'), 0.3, 'persisted');
});

test('time of day: phases, day rollover, serialisation', () => {
  const t = new TimeOfDay({ hours: 5, dayLengthMinutes: 24 });
  const seen = new Set();
  for (let i = 0; i < 24 * 60; i++) { t.update(1); seen.add(t.phase); }
  for (const p of ['night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'twilight']) assert.ok(seen.has(p), `phase ${p}`);
  assert.equal(t.day, 1);
  const t2 = new TimeOfDay();
  t2.restore(t.serialize());
  assert.equal(t2.hours, t.hours);
  assert.equal(t2.day, 1);
  t.setHours(12); assert.ok(t.sunElevation > 30 && t.nightFactor === 0);
  t.setHours(0); assert.ok(t.sunElevation < -10 && t.nightFactor > 0.9);
});

test('celestial: sun rises east and sets west, moon phases cycle', () => {
  const m = sunDirection(7, [0, 0, 0]), e = sunDirection(17, [0, 0, 0]);
  assert.ok(m[1] > 0 && e[1] > 0);
  assert.ok(Math.sign(m[0]) !== Math.sign(e[0]), 'morning and evening on opposite sides');
  const lights = new Set();
  for (let d = 0; d < 8; d += 0.5) lights.add(Math.round(moonIllumination(moonPhaseAngle(d)) * 10));
  assert.ok(lights.has(0) || lights.has(1));
  assert.ok(lights.has(10) || lights.has(9));
});

test('sky palette: night is darker than day and storms are grey', () => {
  const atm = BIOME_BY_ID.spring.atmosphere;
  const atmosphere = { skyTintLin: atm.skyTintLin, fogTintLin: atm.fogTintLin, sunset: atm.sunset, stars: atm.stars };
  const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const day = evaluatePalette({ sunElevation: 45, isMorning: false, atmosphere, weather: {} });
  const night = evaluatePalette({ sunElevation: -30, isMorning: false, atmosphere, weather: {} });
  assert.ok(lum(day.zenith) > lum(night.zenith) * 5);
  assert.ok(night.stars > 0.5 && day.stars === 0);
  const storm = evaluatePalette({ sunElevation: 45, isMorning: false, atmosphere, weather: { cloud: 1, storm: 1, rain: 1 } });
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat(storm.zenith) < sat(day.zenith));
  assert.ok(storm.sunI < day.sunI * 0.5);
  const stormNight = evaluatePalette({ sunElevation: -30, isMorning: false, atmosphere, weather: { cloud: 1, storm: 1, rain: 1 } });
  assert.ok(lum(stormNight.fog) > 0.02, 'overcast nights stay readable');
});

test('camera rig: all modes produce finite transforms and transitions settle', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const settings = { get: (p) => ({ 'graphics.fov': 62, 'controls.autoRecenter': true, 'accessibility.reduceMotion': false, 'accessibility.cameraShake': 0.5 })[p] };
  const rig = new CameraRig(cam, settings);
  const ctx = { target: new THREE.Vector3(0, 0, 0), heading: 0.3, headPos: new THREE.Vector3(0, 1.1, 0), look: { x: 0, y: 0, active: false }, zoom: 0, speed: 1, waterY: 0, groundAt: () => -2, sunDir: new THREE.Vector3(0.3, 0.5, 0.2).normalize(), move: { x: 0, y: 0, z: 0 }, fast: false, rollPitch: { roll: 0, pitch: 0 }, rapids: 0, onFoot: false };
  for (const mode of [...CAMERA_MODES, 'photo']) {
    rig.setMode(mode);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, ctx);
    assert.ok([cam.position.x, cam.position.y, cam.position.z, cam.fov].every(Number.isFinite), mode);
    assert.ok(cam.position.y > -2, `${mode} above ground`);
  }
  rig.setMode('third');
  const order = [];
  for (let i = 0; i < CAMERA_MODES.length; i++) order.push(rig.cycle());
  assert.equal(new Set(order).size, CAMERA_MODES.length);
});

test('music: context follows biome/time/weather; chords stay in scale', () => {
  const day = musicContext({ biomeMusic: BIOME_BY_ID.spring.music });
  const night = musicContext({ biomeMusic: BIOME_BY_ID.spring.music, night: 1 });
  const storm = musicContext({ biomeMusic: BIOME_BY_ID.spring.music, storm: 1 });
  assert.ok(night.tempo < day.tempo && night.brightness < day.brightness);
  assert.equal(storm.scale, 'minor_pent');
  for (const [name, sc] of Object.entries(SCALES)) {
    const ch = chordOn(60, name, 1, 3);
    for (const n of ch) assert.ok(sc.includes((((n - 60) % 12) + 12) % 12), `${name} ${n}`);
  }
});

test('waves: CPU wave height matches table and stays bounded', () => {
  assert.ok(WAVE_TABLE.length >= 3);
  let max = 0;
  for (let i = 0; i < 500; i++) max = Math.max(max, Math.abs(waveHeight(i * 1.7, i * -2.3, i * 0.1, 0.3, 4)));
  assert.ok(max > 0 && max < 2, `max ${max}`);
});
