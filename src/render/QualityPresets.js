// Graphics presets. Each preset changes many concrete systems (not a single
// global scalability number). "Laptop mode" is applied on top of any preset and
// prioritises stable frame time while keeping the atmosphere intact.

export const PRESET_ORDER = ['veryLow', 'low', 'medium', 'high', 'ultra', 'cinematic'];
export const PRESET_LABELS = {
  veryLow: 'Very Low', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', cinematic: 'Cinematic',
};

const BASE = {
  renderScale: 1.0,
  pixelRatioCap: 1.5,
  dynamicRes: true,
  targetFps: 60,
  minScale: 0.6,
  maxScale: 1.0,
  viewDistance: 2600,
  cameraFar: 5200,
  terrainRes: 32,
  terrainSplit: 1.7,
  shadows: { enabled: true, mapSize: 2048, distance: 80, soft: true, vegetation: true },
  foliage: { density: 1.0, treeDistance: 700, smallDistance: 90, lodDistance: 240, smallDensity: 1.0 },
  water: { quality: 'high', planar: true, planarScale: 0.5, ripples: true, rippleRes: 256, waveLayers: 4, foam: true, stars: true, detailDistance: 400 },
  sky: { cloudOctaves: 5, clouds: true, milkyWay: true, starLayers: 2, nebula: true, aurora: true },
  godRays: { enabled: true, samples: 48, scale: 0.5 },
  bloom: { enabled: true, levels: 5 },
  aa: 'fxaa',
  msaa: 0,
  dof: true,
  particles: 1.0,
  wildlife: 1.0,
  pointLights: 4,
  envUpdateSeconds: 2,
  horizonRing: true,
  rayTracing: false,
};

function merge(base, over) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

export const PRESETS = {
  veryLow: merge(BASE, {
    renderScale: 0.7, pixelRatioCap: 1, minScale: 0.5, maxScale: 0.8, viewDistance: 1300, cameraFar: 2800, terrainRes: 16, terrainSplit: 1.35,
    shadows: { enabled: false, mapSize: 512, distance: 40, soft: false, vegetation: false },
    foliage: { density: 0.35, treeDistance: 280, smallDistance: 40, lodDistance: 110, smallDensity: 0.35 },
    water: { quality: 'low', planar: false, planarScale: 0, ripples: false, rippleRes: 0, waveLayers: 2, foam: true, stars: false, detailDistance: 150 },
    sky: { cloudOctaves: 2, clouds: true, milkyWay: true, starLayers: 1, nebula: false, aurora: false },
    godRays: { enabled: false, samples: 0, scale: 0.25 },
    bloom: { enabled: false, levels: 0 },
    aa: 'none', dof: false, particles: 0.25, wildlife: 0.4, pointLights: 0, envUpdateSeconds: 12, horizonRing: true,
  }),
  low: merge(BASE, {
    renderScale: 0.85, pixelRatioCap: 1, minScale: 0.55, maxScale: 0.9, viewDistance: 1700, cameraFar: 3400, terrainRes: 24, terrainSplit: 1.45,
    shadows: { enabled: true, mapSize: 1024, distance: 45, soft: false, vegetation: false },
    foliage: { density: 0.55, treeDistance: 380, smallDistance: 55, lodDistance: 150, smallDensity: 0.5 },
    water: { quality: 'low', planar: false, planarScale: 0, ripples: false, rippleRes: 0, waveLayers: 3, foam: true, stars: false, detailDistance: 220 },
    sky: { cloudOctaves: 3, clouds: true, milkyWay: true, starLayers: 1, nebula: false, aurora: true },
    godRays: { enabled: true, samples: 20, scale: 0.25 },
    bloom: { enabled: true, levels: 3 },
    aa: 'fxaa', dof: false, particles: 0.45, wildlife: 0.6, pointLights: 1, envUpdateSeconds: 6,
  }),
  medium: merge(BASE, {
    renderScale: 1.0, pixelRatioCap: 1.25, viewDistance: 2200, cameraFar: 4400, terrainRes: 32, terrainSplit: 1.6,
    shadows: { enabled: true, mapSize: 2048, distance: 60, soft: false, vegetation: true },
    foliage: { density: 0.8, treeDistance: 520, smallDistance: 75, lodDistance: 200, smallDensity: 0.75 },
    water: { quality: 'medium', planar: false, planarScale: 0, ripples: true, rippleRes: 128, waveLayers: 3, foam: true, stars: true, detailDistance: 320 },
    sky: { cloudOctaves: 4, clouds: true, milkyWay: true, starLayers: 2, nebula: true, aurora: true },
    godRays: { enabled: true, samples: 32, scale: 0.35 },
    bloom: { enabled: true, levels: 4 },
    particles: 0.7, wildlife: 0.8, pointLights: 2, envUpdateSeconds: 4,
  }),
  high: merge(BASE, {}),
  ultra: merge(BASE, {
    pixelRatioCap: 2, viewDistance: 3400, cameraFar: 6500, terrainRes: 32, terrainSplit: 2.0,
    shadows: { enabled: true, mapSize: 4096, distance: 110, soft: true, vegetation: true },
    foliage: { density: 1.15, treeDistance: 950, smallDistance: 120, lodDistance: 320, smallDensity: 1.2 },
    water: { quality: 'ultra', planar: true, planarScale: 0.75, ripples: true, rippleRes: 256, waveLayers: 4, foam: true, stars: true, detailDistance: 600 },
    godRays: { enabled: true, samples: 64, scale: 0.5 },
    bloom: { enabled: true, levels: 6 },
    msaa: 4, aa: 'msaa', particles: 1.3, wildlife: 1.2, pointLights: 4, envUpdateSeconds: 1,
  }),
  cinematic: merge(BASE, {
    pixelRatioCap: 2, dynamicRes: false, targetFps: 30, viewDistance: 4200, cameraFar: 8000, terrainRes: 32, terrainSplit: 2.3,
    shadows: { enabled: true, mapSize: 4096, distance: 150, soft: true, vegetation: true },
    foliage: { density: 1.3, treeDistance: 1200, smallDistance: 150, lodDistance: 420, smallDensity: 1.4 },
    water: { quality: 'ultra', planar: true, planarScale: 1.0, ripples: true, rippleRes: 256, waveLayers: 4, foam: true, stars: true, detailDistance: 800 },
    sky: { cloudOctaves: 6, clouds: true, milkyWay: true, starLayers: 2, nebula: true, aurora: true },
    godRays: { enabled: true, samples: 96, scale: 0.6 },
    bloom: { enabled: true, levels: 6 },
    msaa: 4, aa: 'msaa', particles: 1.5, wildlife: 1.3, pointLights: 4, envUpdateSeconds: 0.5,
  }),
};

/**
 * Laptop / performance mode: stable frame time and low memory first, while
 * preserving the day/night cycle, sunsets, stars, water, boat physics and
 * exploration. Applied on top of the chosen preset.
 */
export function applyLaptopMode(cfg) {
  const c = structuredClone(cfg);
  c.dynamicRes = true;
  c.targetFps = Math.min(c.targetFps, 60);
  c.minScale = Math.min(c.minScale, 0.5);
  c.maxScale = Math.min(c.maxScale, 0.85);
  c.pixelRatioCap = 1;
  c.viewDistance = Math.min(c.viewDistance, 1800);
  c.cameraFar = Math.min(c.cameraFar, 3600);
  c.terrainSplit = Math.min(c.terrainSplit, 1.5);
  c.shadows = { ...c.shadows, mapSize: Math.min(c.shadows.mapSize, 1024), distance: Math.min(c.shadows.distance, 45), soft: false, vegetation: false };
  c.foliage = { ...c.foliage, density: Math.min(c.foliage.density, 0.6), treeDistance: Math.min(c.foliage.treeDistance, 420), smallDistance: Math.min(c.foliage.smallDistance, 60), lodDistance: Math.min(c.foliage.lodDistance, 160), smallDensity: Math.min(c.foliage.smallDensity, 0.55) };
  // Water keeps its look (sky reflections, foam, waves) but drops the planar pass.
  c.water = { ...c.water, planar: false, planarScale: 0, rippleRes: Math.min(c.water.rippleRes || 128, 128), quality: c.water.quality === 'low' ? 'low' : 'medium', detailDistance: Math.min(c.water.detailDistance, 300) };
  c.sky = { ...c.sky, cloudOctaves: Math.min(c.sky.cloudOctaves, 3), nebula: false };
  c.godRays = { ...c.godRays, samples: Math.min(c.godRays.samples, 24), scale: 0.25 };
  c.bloom = { ...c.bloom, levels: Math.min(c.bloom.levels || 0, 3) };
  c.msaa = 0;
  c.aa = c.aa === 'none' ? 'none' : 'fxaa';
  c.particles = Math.min(c.particles, 0.5);
  c.wildlife = Math.min(c.wildlife, 0.6);
  c.pointLights = Math.min(c.pointLights, 1);
  c.envUpdateSeconds = Math.max(c.envUpdateSeconds, 6);
  c.rayTracing = false;
  c.laptopMode = true;
  return c;
}

/** Resolve the effective quality config from user graphics settings. */
export function resolveQuality(g) {
  let cfg = structuredClone(PRESETS[g.preset] ?? PRESETS.medium);
  cfg.preset = g.preset;
  if (g.laptopMode) cfg = applyLaptopMode(cfg);
  // Explicit user overrides.
  if (g.dynamicRes !== undefined && g.dynamicRes !== null) cfg.dynamicRes = g.dynamicRes;
  if (g.targetFps) cfg.targetFps = g.targetFps;
  if (g.minScale) cfg.minScale = g.minScale;
  if (g.maxScale) cfg.maxScale = g.maxScale;
  if (g.renderScale) cfg.renderScale = g.renderScale;
  if (g.shadows === false) cfg.shadows = { ...cfg.shadows, enabled: false };
  if (g.bloom === false) cfg.bloom = { ...cfg.bloom, enabled: false };
  if (g.godRays === false) cfg.godRays = { ...cfg.godRays, enabled: false };
  if (g.viewDistanceScale) {
    cfg.viewDistance *= g.viewDistanceScale;
    cfg.cameraFar *= g.viewDistanceScale;
  }
  if (g.foliageScale) cfg.foliage.density *= g.foliageScale;
  // Hardware ray tracing is not available in WebGL 2; we always use the
  // raster/planar/analytic fallback path and report it honestly.
  cfg.rayTracing = false;
  cfg.rayTracingRequested = !!g.rayTracing;
  return cfg;
}

/** Guess a sensible default preset from GPU info (renderer string, cores). */
export function suggestPreset(gpuInfo = {}) {
  const r = (gpuInfo.renderer || '').toLowerCase();
  const cores = gpuInfo.cores || 4;
  const software = /swiftshader|llvmpipe|software|basic render/.test(r);
  if (software) return { preset: 'veryLow', laptopMode: true };
  const integrated = /intel|uhd|iris|vega \d|radeon\(tm\) graphics|apple m1|adreno|mali/.test(r) && !/arc a/.test(r);
  const highEnd = /rtx 40|rtx 50|rtx 30[789]0|rx 7[89]00|rx 69|rtx 4080|rtx 4090|apple m[234] (max|ultra)/.test(r);
  if (integrated) return { preset: cores >= 8 ? 'medium' : 'low', laptopMode: true };
  if (highEnd) return { preset: 'ultra', laptopMode: false };
  return { preset: 'high', laptopMode: false };
}
