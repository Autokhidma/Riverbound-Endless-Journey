// User settings (graphics, audio, controls, accessibility, gameplay).
// Stored separately from save games so they apply to every journey.
import { EventBus } from './events.js';

export const SETTINGS_VERSION = 2;

export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  hurry: ['ShiftLeft', 'ShiftRight'],
  brake: ['Space'],
  interact: ['KeyE'],
  fish: ['KeyF'],
  lantern: ['KeyL'],
  camera: ['KeyC'],
  photo: ['KeyP'],
  map: ['KeyM'],
  journal: ['KeyJ'],
  inventory: ['KeyI', 'Tab'],
  quests: ['KeyQ'],
  pause: ['Escape'],
  cruise: ['KeyR'],
  screenshot: ['F12'],
  hideHud: ['KeyH'],
  perf: ['F3'],
  console: ['Backquote'],
  up: ['KeyE'],
  down: ['KeyQ'],
};

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  graphics: {
    preset: null, // chosen automatically on first run
    laptopMode: null,
    dynamicRes: null,
    targetFps: 60,
    minScale: null,
    maxScale: null,
    renderScale: null,
    viewDistanceScale: 1,
    foliageScale: 1,
    shadows: null,
    bloom: null,
    godRays: null,
    rayTracing: false,
    fullscreen: false,
    fov: 62,
    motionBlur: false,
  },
  audio: { master: 0.85, music: 0.6, ambience: 0.9, effects: 0.8, ui: 0.6, muteUnfocused: true },
  controls: {
    bindings: DEFAULT_BINDINGS,
    mouseSensitivity: 1.0,
    gamepadSensitivity: 1.0,
    invertY: false,
    autoRecenter: true,
  },
  accessibility: {
    subtitles: true,
    subtitleSize: 1.0,
    uiScale: 1.0,
    colorMode: 'normal', // normal | deuteranopia | protanopia | tritanopia | highContrast
    cameraShake: 0.6,
    depthOfField: true,
    reduceFlashing: false,
    reduceMotion: false,
  },
  gameplay: {
    dayLengthMinutes: 24,
    showCompass: true,
    showObjectiveMarkers: true,
    autosaveMinutes: 3,
    showSeed: false,
  },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

export function migrateSettings(raw) {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_SETTINGS);
  let s = raw;
  if ((s.version ?? 1) < 2) {
    // v1 stored a flat "quality" string.
    s = { ...s, graphics: { ...(s.graphics || {}), preset: s.quality ?? s.graphics?.preset ?? null } };
    delete s.quality;
  }
  const merged = deepMerge(DEFAULT_SETTINGS, s);
  // New default bindings for actions added after the save was made.
  merged.controls.bindings = { ...DEFAULT_BINDINGS, ...(merged.controls.bindings || {}) };
  merged.version = SETTINGS_VERSION;
  return merged;
}

export class Settings extends EventBus {
  constructor(storage) {
    super();
    this.storage = storage;
    this.data = structuredClone(DEFAULT_SETTINGS);
  }

  async load() {
    const raw = await this.storage.readJSON('settings', null);
    this.data = migrateSettings(raw);
    return this.data;
  }

  save() {
    return this.storage.writeJSON('settings', this.data);
  }

  get(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
  }

  set(path, value) {
    const keys = path.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    o[keys[keys.length - 1]] = value;
    this.emit('change', { path, value });
    this.emit(`change:${keys[0]}`, { path, value });
    this.save();
  }
}
