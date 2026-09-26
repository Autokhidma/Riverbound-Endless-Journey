// Photo mode: a free camera near the boat with time frozen (optional), lens
// and grading controls, time of day and weather, filters, subject detection
// (wildlife and landmarks) and saving: Pictures/Riverbound in the desktop
// build, a download in the browser, and a thumbnail in the journal.
import { h, clear } from './dom.js';
import { SPECIES_INFO } from '../wildlife/Wildlife.js';

const FILTERS = {
  natural: { label: 'Natural', grade: {} },
  warm: { label: 'Warm film', grade: { temperature: 0.22, saturation: 1.05, contrast: 1.08, grain: 0.03, fade: 0.04 } },
  cool: { label: 'Cool morning', grade: { temperature: -0.2, saturation: 0.9, contrast: 1.02, fade: 0.03 } },
  vivid: { label: 'Vivid', grade: { saturation: 1.3, contrast: 1.12 } },
  faded: { label: 'Faded print', grade: { saturation: 0.75, contrast: 0.92, fade: 0.12, grain: 0.035 } },
  mono: { label: 'Monochrome', grade: { saturation: 0, contrast: 1.15, grain: 0.03 } },
};

const WEATHER_TYPES = ['clear', 'cloudy', 'lightRain', 'heavyRain', 'mist', 'fog', 'storm', 'haze', 'calmNight'];

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = null;
    this.opts = null;
  }

  defaults() {
    const pp = this.game.pipeline.post.params;
    return {
      freeze: true, fov: this.game.camera3.fov, roll: 0, exposure: pp.exposure, contrast: pp.contrast, saturation: pp.saturation,
      temperature: pp.temperature, vignette: pp.vignette, grain: pp.grain, fade: 0, dof: false, focus: 12, aperture: 0.6,
      filter: 'natural', hideBoat: false, hideCharacter: false, hours: this.game.time.hours,
    };
  }

  enter() {
    const g = this.game;
    if (this.active || g.state !== 'playing' || g.ui.modalOpen) return;
    if (g.fishing?.active) g.fishing.cancel();
    this.active = true;
    this.prevMode = g.cameraRig.mode;
    this.savedTime = g.time.hours;
    this.savedGrade = { ...g.pipeline.post.params };
    this.savedDof = { ...g.pipeline.post.dof };
    g.cameraRig.setMode('photo');
    this.opts = this.defaults();
    g.timeFrozen = true;
    g.photoGrade = true;
    this.buildPanel();
    g.ui.syncPointer();
    g.events.emit('photo:enter', {});
  }

  exit() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    g.timeFrozen = false;
    g.photoGrade = false;
    Object.assign(g.pipeline.post.dof, this.savedDof);
    g.boat.model.group.visible = true;
    g.characterModel.root.visible = true;
    g.cameraRig.setMode(this.prevMode === 'photo' ? 'third' : this.prevMode ?? 'third');
    this.el?.remove();
    this.el = null;
    g.ui.syncPointer();
    g.events.emit('photo:exit', {});
  }

  apply() {
    const g = this.game;
    const o = this.opts;
    const pp = g.pipeline.post.params;
    const f = FILTERS[o.filter]?.grade ?? {};
    pp.exposure = o.exposure;
    pp.contrast = o.contrast * (f.contrast ?? 1);
    pp.saturation = o.saturation * (f.saturation ?? 1);
    pp.temperature = o.temperature + (f.temperature ?? 0);
    pp.vignette = o.vignette;
    pp.grain = Math.max(o.grain, f.grain ?? 0);
    pp.fade = o.fade + (f.fade ?? 0);
    const dof = g.pipeline.post.dof;
    dof.enabled = o.dof;
    dof.focus = o.focus;
    dof.aperture = o.aperture;
    g.cameraRig.photo.fov = o.fov;
    g.cameraRig.photo.roll = (o.roll * Math.PI) / 180;
    g.timeFrozen = o.freeze;
    g.boat.model.group.visible = !o.hideBoat;
    g.characterModel.root.visible = !o.hideCharacter;
  }

  /** Called every frame (keeps grading applied since atmosphere may reset it). */
  update(dt, game) {
    if (!this.active) return;
    if (game.state !== 'playing') { this.exit(); return; }
    this.apply();
    if (game.input.pressed('screenshot') || game.input.keyDown('Enter')) { if (!this.cooldown) this.capture(); this.cooldown = true; } else this.cooldown = false;
    // Scroll wheel zooms the lens.
    const wheel = game.input.mouse.wheel;
    if (wheel) { this.opts.fov = Math.max(15, Math.min(100, this.opts.fov + wheel * 2)); this.syncInputs(); }
  }

  buildPanel() {
    const g = this.game;
    const o = this.opts;
    this.inputs = {};
    const slider = (label, key, min, max, step, fmt = (v) => v.toFixed(2), after = null) => {
      const out = h('span.muted', {}, fmt(o[key]));
      const inp = h('input', { type: 'range', min, max, step, value: o[key], oninput: (e) => { o[key] = Number(e.target.value); out.textContent = fmt(o[key]); after?.(o[key]); } });
      this.inputs[key] = { inp, out, fmt };
      return h('div.field', {}, h('label', {}, label, ' ', out), inp);
    };
    const check = (label, key) => h('div.field', {}, h('label.toggle', {}, h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; } }), h('span', {}, label)));
    const filterSel = h('select', { onchange: (e) => { o.filter = e.target.value; } }, ...Object.entries(FILTERS).map(([k, f]) => h('option', { value: k, selected: k === o.filter }, f.label)));
    const weatherSel = h('select', { onchange: (e) => g.weatherSystem?.set(e.target.value, { instant: true, hold: 600 }) }, ...WEATHER_TYPES.map((w) => h('option', { value: w, selected: w === g.weather.type }, w.replace(/([A-Z])/g, ' $1').toLowerCase())));
    this.subjectEl = h('div.muted', { style: { minHeight: '20px', fontSize: '13px' } });
    this.el = h('div.photo-panel', {},
      h('div.section-title', { style: { marginTop: 0 } }, 'Photo mode'),
      h('div.hint', { style: { fontSize: '12px', marginBottom: '6px' } }, 'Drag to look · WASD move · E/Q up/down · Shift faster · wheel zoom · Enter or F12 to shoot · P / Esc to leave'),
      h('button.btn.primary', { style: { width: '100%', margin: '4px 0 8px' }, onclick: () => this.capture() }, '📷 Take photo'),
      this.subjectEl,
      h('div.section-title', {}, 'Lens'),
      slider('Field of view', 'fov', 15, 100, 1, (v) => `${v.toFixed(0)}°`),
      slider('Roll', 'roll', -30, 30, 0.5, (v) => `${v.toFixed(1)}°`),
      check('Depth of field', 'dof'),
      slider('Focus distance', 'focus', 0.5, 200, 0.5, (v) => `${v.toFixed(1)} m`),
      slider('Aperture (blur)', 'aperture', 0.05, 2, 0.05),
      h('div.section-title', {}, 'Light & colour'),
      h('div.field', {}, h('label', {}, 'Filter'), filterSel),
      slider('Exposure', 'exposure', 0.3, 3, 0.05),
      slider('Contrast', 'contrast', 0.7, 1.5, 0.01),
      slider('Saturation', 'saturation', 0, 1.8, 0.01),
      slider('Warmth', 'temperature', -0.6, 0.6, 0.01),
      slider('Vignette', 'vignette', 0, 1, 0.01),
      slider('Grain', 'grain', 0, 0.08, 0.002, (v) => v.toFixed(3)),
      slider('Fade', 'fade', 0, 0.3, 0.01),
      h('div.section-title', {}, 'World'),
      slider('Time of day', 'hours', 0, 23.99, 0.05, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`, (v) => { g.time.setHours(v); g.pipeline.updateEnvironment(g.sky.envScene, true); }),
      h('div.field', {}, h('label', {}, 'Weather'), weatherSel),
      check('Freeze time', 'freeze'),
      check('Hide the boat', 'hideBoat'),
      check('Hide the traveller', 'hideCharacter'),
      h('div.row', { style: { marginTop: '10px' } }, h('button.btn.ghost', { onclick: () => { this.opts = this.defaults(); this.el.remove(); this.buildPanel(); } }, 'Reset'), h('div.spacer'), h('button.btn', { onclick: () => this.exit() }, 'Done')));
    g.ui.root.append(this.el);
  }

  syncInputs() {
    for (const [k, { inp, out, fmt }] of Object.entries(this.inputs ?? {})) {
      if (document.activeElement === inp) continue;
      inp.value = this.opts[k];
      out.textContent = fmt(this.opts[k]);
    }
  }

  /** What is in frame: wildlife species and nearby landmarks. */
  subjects() {
    const g = this.game;
    const cam = g.camera3;
    cam.updateMatrixWorld();
    const out = g.wildlife?.visibleSpecies(cam, g.origin) ?? [];
    const places = [];
    const THREEFrustum = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    for (const s of g.content?.spawned.values() ?? []) {
      const it = s.item;
      if (it.kind !== 'landmark' && it.kind !== 'settlement') continue;
      const p = g.toScene(it.x, (it.y ?? 0) + 4, it.z).applyMatrix4(THREEFrustum);
      const d = Math.hypot(it.x - g.player().x, it.z - g.player().z);
      if (Math.abs(p.x) < 0.9 && Math.abs(p.y) < 0.9 && p.z < 1 && d < 900) places.push(it);
    }
    return { species: out, places };
  }

  async capture() {
    const g = this.game;
    const { species, places } = this.subjects();
    this.el && (this.el.style.visibility = 'hidden');
    let url;
    try {
      url = g.pipeline.capture(g.elapsed, { type: 'image/png' });
    } finally {
      if (this.el) this.el.style.visibility = '';
    }
    g.ui.flash();
    g.events.emit('sfx', { name: 'shutter' });
    const thumb = await this.thumbnail(url, 320, 180);
    const st = g.session.state;
    st.photos.push({ thumb, day: g.time.day, hours: g.time.hours, region: g.world.regionAtS(g.boat.physics.s).name, subjects: species, places: places.map((p) => p.name) });
    while (st.photos.length > 30) st.photos.shift();
    st.stats.photos++;
    for (const sp of species) g.journal?.onWildlife(sp, 'photographed');
    const saved = await this.save(url);
    const names = [...species.map((s) => SPECIES_INFO[s]?.name ?? s), ...places.map((p) => p.name)];
    clear(this.subjectEl);
    this.subjectEl.append(names.length ? `In frame: ${names.join(', ')}` : 'Photo saved to your journal.');
    g.events.emit('photo:taken', { subjects: species, places: places.map((p) => p.id), file: saved });
    g.events.emit('toast', { title: 'Photo taken', text: saved ? `Saved to ${saved}` : 'Added to your journal', kind: 'camera', life: 3 });
    return { species, places: places.map((p) => p.name), saved };
  }

  thumbnail(url, w, hgt) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = hgt;
        const ctx = c.getContext('2d');
        const s = Math.max(w / img.width, hgt / img.height);
        ctx.drawImage(img, (w - img.width * s) / 2, (hgt - img.height * s) / 2, img.width * s, img.height * s);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async save(url) {
    const name = `Riverbound_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    if (window.riverboundNative?.savePhoto) {
      try { return await window.riverboundNative.savePhoto(name, url); } catch (e) { console.error('[photo] save failed', e); return null; }
    }
    if (this.game.hooks?.noDownloads) return null;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    return 'your downloads';
  }
}

export { FILTERS };
