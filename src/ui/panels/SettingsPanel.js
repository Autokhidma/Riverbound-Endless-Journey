// Settings: graphics presets + Laptop Mode + dynamic resolution + individual
// overrides, audio mix, controls (rebinding), accessibility and gameplay.
import { Panel, h } from './shell.js';
import { PRESET_ORDER, PRESET_LABELS, resolveQuality } from '../../render/QualityPresets.js';
import { DEFAULT_BINDINGS } from '../../core/Settings.js';
import { keyLabel } from '../dom.js';

const ACTION_LABELS = {
  forward: 'Row forward', back: 'Back water', left: 'Steer left', right: 'Steer right', hurry: 'Hurry / run', brake: 'Brake / cast',
  interact: 'Interact', fish: 'Fishing rod', lantern: 'Lantern', camera: 'Camera view', photo: 'Photo mode', map: 'Map', journal: 'Journal',
  inventory: 'Storage', quests: 'Requests', pause: 'Pause / back', cruise: 'Cruise (river pilot)', screenshot: 'Screenshot', hideHud: 'Hide HUD',
  perf: 'Performance overlay', console: 'Debug console',
};

export class SettingsPanel extends Panel {
  constructor(game, ui) {
    super(game, ui);
    this.width = 'min(900px, 95vw)';
  }
  title() { return 'Settings'; }
  tabs() {
    return [{ id: 'graphics', label: 'Graphics' }, { id: 'performance', label: 'Performance' }, { id: 'audio', label: 'Audio' }, { id: 'controls', label: 'Controls' }, { id: 'access', label: 'Accessibility' }, { id: 'gameplay', label: 'Gameplay' }];
  }

  set(path, value, applyGraphics = false) {
    this.game.settings.set(path, value);
    if (applyGraphics) this.game.applyGraphics();
    this.refresh();
  }

  select(label, path, options, applyGraphics = false, hint = null) {
    const cur = this.game.settings.get(path);
    const sel = h('select', { onchange: (e) => { const v = options.find((o) => String(o.value) === e.target.value)?.value; this.set(path, v, applyGraphics); } },
      ...options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(cur) }, o.label)));
    return h('div.field', {}, h('label', {}, label), sel, hint ? h('div.hint', {}, hint) : null);
  }

  toggle(label, path, applyGraphics = false, hint = null, invertDefault = null) {
    let cur = this.game.settings.get(path);
    if (cur === null || cur === undefined) cur = invertDefault;
    const cb = h('input', { type: 'checkbox', checked: !!cur, onchange: (e) => this.set(path, e.target.checked, applyGraphics) });
    return h('div.field', {}, h('label.toggle', {}, cb, h('span', {}, label)), hint ? h('div.hint', {}, hint) : null);
  }

  slider(label, path, min, max, step, fmt = (v) => v, applyGraphics = false, fallback = null, hint = null) {
    const cur = this.game.settings.get(path) ?? fallback;
    const out = h('span.muted', { style: { marginLeft: '8px' } }, fmt(cur));
    const inp = h('input', { type: 'range', min, max, step, value: cur,
      oninput: (e) => { out.textContent = fmt(Number(e.target.value)); this.game.settings.set(path, Number(e.target.value)); if (!applyGraphics) this.game.events.emit('settings:live', { path }); },
      onchange: () => { if (applyGraphics) this.game.applyGraphics(); } });
    return h('div.field', {}, h('label', {}, label, out), inp, hint ? h('div.hint', {}, hint) : null);
  }

  body(tab) {
    const game = this.game;
    const g = game.settings.get('graphics');
    const q = game.quality;
    if (tab === 'graphics') {
      return [
        this.select('Quality preset', 'graphics.preset', PRESET_ORDER.map((p) => ({ value: p, label: PRESET_LABELS[p] })), true, 'Each preset changes view distance, terrain detail, foliage, shadows, water reflections, ripples, sky layers, clouds, particles, wildlife counts and post effects.'),
        this.toggle('Laptop Mode', 'graphics.laptopMode', true, 'Prioritises a stable frame rate, lower heat and battery use: caps resolution, lowers shadows, foliage, reflections, particles and background work while keeping the atmosphere.'),
        this.slider('Field of view', 'graphics.fov', 45, 90, 1, (v) => `${v}°`),
        this.slider('View distance', 'graphics.viewDistanceScale', 0.6, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`, true, 1),
        this.slider('Foliage density', 'graphics.foliageScale', 0.3, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, true, 1),
        this.toggle('Shadows', 'graphics.shadows', true, null, q.shadows.enabled),
        this.toggle('Bloom', 'graphics.bloom', true, null, q.bloom.enabled),
        this.toggle('God rays', 'graphics.godRays', true, null, q.godRays.enabled),
        this.toggle('Fullscreen', 'graphics.fullscreen', false),
        h('div.field', {}, h('label.toggle', { style: { opacity: 0.6 } }, h('input', { type: 'checkbox', disabled: true, checked: false }), h('span', {}, 'Hardware ray tracing')),
          h('div.hint', {}, 'Not available: the game renders through WebGL 2, which has no ray tracing API. Reflections use planar reflection + sky probes; lighting uses shadow maps and image-based light. This is the fallback path the game always runs.')),
        h('div.hint', {}, `Detected GPU: ${game.pipeline.gpuInfo.renderer}`),
      ];
    }
    if (tab === 'performance') {
      const st = game.stats();
      return [
        this.toggle('Dynamic resolution', 'graphics.dynamicRes', true, 'Adjusts the 3D render resolution to hold your target frame rate. UI stays sharp.', q.dynamicRes),
        this.select('Target frame rate', 'graphics.targetFps', [30, 45, 60, 75, 90, 120, 144].map((v) => ({ value: v, label: `${v} FPS` })), true),
        this.slider('Minimum resolution', 'graphics.minScale', 0.4, 1, 0.05, (v) => `${Math.round(v * 100)}%`, true, q.minScale),
        this.slider('Maximum resolution', 'graphics.maxScale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, true, q.maxScale, 'Above 100% supersamples (for powerful GPUs / cinematic screenshots).'),
        this.slider('Fixed resolution (when dynamic is off)', 'graphics.renderScale', 0.4, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`, true, q.renderScale),
        h('div.section-title', {}, 'Right now'),
        h('div.list', {},
          h('div.list-item', {}, `Preset: ${PRESET_LABELS[q.preset] ?? q.preset}${q.laptopMode ? ' + Laptop Mode' : ''}`),
          h('div.list-item', {}, `Frame: ${st.frameMs.toFixed(1)} ms (${st.fps.toFixed(0)} FPS) · 1% worst ${st.p99Ms.toFixed(1)} ms`),
          h('div.list-item', {}, `Render scale: ${Math.round(game.pipeline.scale * 100)}% · ${game.pipeline.width}×${game.pipeline.height}`),
          h('div.list-item', {}, `Draw calls ${st.render.drawCalls} · triangles ${(st.render.triangles / 1000).toFixed(0)}k · CPU update ${st.cpuUpdateMs.toFixed(2)} ms`)),
        h('div.row', { style: { marginTop: '12px' } }, h('button.btn', { onclick: () => { this.ui.closeModal(); game.debug?.runBenchmark(); } }, 'Run 30-second benchmark'), h('div.spacer'), h('span.muted', {}, 'F3 toggles the performance overlay')),
      ];
    }
    if (tab === 'audio') {
      const pct = (v) => `${Math.round(v * 100)}%`;
      return [
        this.slider('Master', 'audio.master', 0, 1, 0.01, pct),
        this.slider('Music', 'audio.music', 0, 1, 0.01, pct),
        this.slider('Ambience (river, wind, wildlife)', 'audio.ambience', 0, 1, 0.01, pct),
        this.slider('Effects', 'audio.effects', 0, 1, 0.01, pct),
        this.slider('Interface', 'audio.ui', 0, 1, 0.01, pct),
        this.toggle('Mute when the window is in the background', 'audio.muteUnfocused'),
      ];
    }
    if (tab === 'controls') {
      const b = game.settings.get('controls.bindings');
      const rows = Object.keys(ACTION_LABELS).map((action) => h('div.list-item.row', {},
        h('div', { style: { flex: 1 } }, ACTION_LABELS[action]),
        ...(b[action] ?? []).map((code, i) => h('button.btn.ghost', { title: 'Click, then press a new key', onclick: (e) => this.rebind(action, i, e.target) }, keyLabel(code))),
        (b[action] ?? []).length < 2 ? h('button.btn.ghost', { onclick: (e) => this.rebind(action, (b[action] ?? []).length, e.target) }, '+') : null));
      return [
        this.slider('Mouse sensitivity', 'controls.mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
        this.slider('Gamepad sensitivity', 'controls.gamepadSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
        this.toggle('Invert vertical look', 'controls.invertY'),
        this.toggle('Camera drifts back behind the boat', 'controls.autoRecenter'),
        h('div.section-title', {}, 'Keyboard'),
        h('div.list', {}, ...rows),
        h('div.row', { style: { marginTop: '10px' } }, h('button.btn', { onclick: () => this.set('controls.bindings', structuredClone(DEFAULT_BINDINGS)) }, 'Reset to defaults')),
        h('div.section-title', {}, 'Gamepad'),
        h('div.hint', {}, 'Left stick / triggers: row and steer · Right stick: look · A: interact · X: fishing · B: back · Y: journal · RB: camera · LB: hurry · D-pad: map / storage / requests / lantern · View: photo mode · Menu: pause · RS click: cruise.'),
      ];
    }
    if (tab === 'access') {
      return [
        this.slider('Interface size', 'accessibility.uiScale', 0.8, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`),
        this.toggle('Subtitles for spoken lines and sounds', 'accessibility.subtitles'),
        this.slider('Subtitle size', 'accessibility.subtitleSize', 0.8, 2, 0.05, (v) => `${Math.round(v * 100)}%`),
        this.select('Colour vision mode', 'accessibility.colorMode', [
          { value: 'normal', label: 'Standard' }, { value: 'deuteranopia', label: 'Deuteranopia (green-weak)' }, { value: 'protanopia', label: 'Protanopia (red-weak)' },
          { value: 'tritanopia', label: 'Tritanopia (blue-weak)' }, { value: 'highContrast', label: 'High contrast' }]),
        this.slider('Camera shake', 'accessibility.cameraShake', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        this.toggle('Depth of field', 'accessibility.depthOfField'),
        this.toggle('Reduce flashing (lightning, bright flashes)', 'accessibility.reduceFlashing'),
        this.toggle('Reduce motion (camera bob, roll, sway)', 'accessibility.reduceMotion', false, 'Also gives more time to react to fishing bites.'),
      ];
    }
    return [
      this.select('Length of a day', 'gameplay.dayLengthMinutes', [12, 18, 24, 36, 48, 72].map((v) => ({ value: v, label: `${v} minutes` }))),
      this.toggle('Compass', 'gameplay.showCompass'),
      this.toggle('Objective markers on the compass', 'gameplay.showObjectiveMarkers'),
      this.toggle('Show world seed in the HUD', 'gameplay.showSeed'),
      this.select('Autosave', 'gameplay.autosaveMinutes', [1, 3, 5, 10].map((v) => ({ value: v, label: `every ${v} min` }))),
      h('div.hint', {}, `This world's seed: ${game.world.seed}. Enter it under Free Exploration to visit the same river again.`),
    ];
  }

  rebind(action, index, btn) {
    btn.textContent = 'Press a key…';
    this.game.input.captureKey((code) => {
      if (code === 'Escape' && action !== 'pause') { this.refresh(); return; }
      const b = structuredClone(this.game.settings.get('controls.bindings'));
      const list = [...(b[action] ?? [])];
      list[index] = code;
      b[action] = list;
      this.set('controls.bindings', b);
    });
  }
}

export { resolveQuality };
