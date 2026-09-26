// UI manager: main menu, HUD (compass, prompts, toasts, objective, region
// titles), dialogue, letters, chapter cards, pause menu and panel routing.
import { h, clear, keyLabel, fmtTime } from './dom.js';
import { CAMERA_LABELS } from '../camera/CameraRig.js';
import { InventoryPanel } from './panels/InventoryPanel.js';
import { JournalPanel } from './panels/JournalPanel.js';
import { MapPanel } from './panels/MapPanel.js';
import { QuestPanel } from './panels/QuestPanel.js';
import { TradePanel } from './panels/TradePanel.js';
import { UpgradePanel } from './panels/UpgradePanel.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { SaveLoadPanel } from './panels/SaveLoadPanel.js';
import { FishingHUD } from './FishingHUD.js';
import { formatDistance } from '../core/math.js';
import { PAD_BINDINGS, PAD } from '../core/Input.js';

const WEATHER_ICON = { clear: '☀', cloudy: '☁', lightRain: '🌦', heavyRain: '🌧', storm: '⛈', mist: '🌫', fog: '🌫', haze: '◌', snow: '❄', calmNight: '☾' };

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.modal = null;
    this.hudVisible = true;
    this.toastsQueue = [];
    this.buildHUD();
    this.fishingHUD = new FishingHUD(game, this.root);
    const ev = game.events;
    ev.on('toast', (t) => this.toast(t));
    ev.on('prompt', (p) => this.setPrompt(p));
    ev.on('dialogue:show', (node) => this.showDialogue(node));
    ev.on('letter', (l) => this.showLetter(l));
    ev.on('story:chapter', ({ chapter }) => this.chapterCard(chapter));
    ev.on('region:enter', ({ region }) => this.regionTitle(region));
    ev.on('saved', ({ slot }) => { if (slot !== 'autosave') this.toast({ text: 'Journey saved.' }); });
    ev.on('caption', ({ text }) => this.showCaption(text));
    ev.on('lantern', ({ on }) => this.toast({ text: on ? 'Lantern lit' : 'Lantern out', kind: 'camera', life: 1.6 }));
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.applyAccessibility();
    game.settings.on('change', () => this.applyAccessibility());
  }

  get modalOpen() {
    return !!this.modal || !!this.dialogueEl;
  }

  applyAccessibility() {
    const a = this.game.settings.get('accessibility');
    document.documentElement.style.setProperty('--ui-scale', a.uiScale ?? 1);
    document.documentElement.style.setProperty('--sub-scale', a.subtitleSize ?? 1);
  }

  // ------------------------------------------------------------------- HUD
  buildHUD() {
    this.hud = h('div.hud.hidden');
    this.compassStrip = h('div.compass-strip');
    this.compass = h('div.compass', {}, this.compassStrip, h('div.compass-center'));
    this.timeEl = h('div.hud-time');
    this.hudTop = h('div.hud-top', {}, this.compass, this.timeEl);
    this.regionEl = h('div.hud-region', {}, h('div.name'), h('div.biome'));
    this.promptEl = h('div.prompt');
    this.subtitleEl = h('div.subtitle');
    this.hudBottom = h('div.hud-bottom', {}, this.promptEl);
    this.questEl = h('div.hud-quest');
    this.toastsEl = h('div.toasts');
    this.cornerEl = h('div.hud-corner');
    this.speedEl = h('div.speed-hint');
    this.hud.append(this.hudTop, this.regionEl, this.hudBottom, this.questEl, this.toastsEl, this.cornerEl, this.subtitleEl, this.speedEl);
    this.root.append(this.hud);
    this.chapterEl = h('div.chapter-card', {}, h('div.num'), h('div.title'));
    this.root.append(this.chapterEl);
    this.fadeEl = h('div.fade-screen');
    this.flashEl = h('div.flash');
    this.root.append(this.fadeEl, this.flashEl);
  }

  setHUDVisible(v) {
    this.hudVisible = v;
    this.hud.classList.toggle('hidden', !v || this.game.state !== 'playing');
  }

  toast({ title, text, kind = 'info', life = 3.6 }) {
    if (!text) return;
    const el = h(`div.toast.${kind}`, { style: { '--life': `${life}s` } }, title ? h('div.t-title', {}, title) : null, h('div', {}, text));
    this.toastsEl.append(el);
    setTimeout(() => el.remove(), (life + 0.8) * 1000);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstChild.remove();
  }

  setPrompt(p) {
    clear(this.promptEl);
    if (!p) { this.promptEl.classList.remove('show'); return; }
    const code = this.game.input.usingGamepad ? 'A' : keyLabel(this.game.settings.get('controls.bindings').interact[0]);
    this.promptEl.append(h('span.key', {}, code), h('span', {}, `${p.verb} ${p.label}`));
    this.promptEl.classList.add('show');
  }

  regionTitle(region) {
    if (this.chapterShowing) { clearTimeout(this.regionDefer); this.regionDefer = setTimeout(() => this.regionTitle(region), 5600); return; }
    const biome = this.game.world.biomeAt(this.game.player().x, this.game.player().z).dominant;
    this.regionEl.querySelector('.name').textContent = region.name;
    this.regionEl.querySelector('.biome').textContent = biome.name;
    this.regionEl.classList.add('show');
    clearTimeout(this.regionTimer);
    this.regionTimer = setTimeout(() => this.regionEl.classList.remove('show'), 5000);
  }

  showCaption(text) {
    this.subtitleEl.textContent = text;
    this.subtitleEl.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => this.subtitleEl.classList.remove('show'), 3200);
  }

  chapterCard(ch) {
    this.chapterEl.querySelector('.num').textContent = ch.number;
    this.chapterEl.querySelector('.title').textContent = ch.title;
    this.chapterEl.classList.add('show');
    this.chapterShowing = true;
    setTimeout(() => { this.chapterEl.classList.remove('show'); this.chapterShowing = false; }, 5200);
    if (ch.intro) setTimeout(() => this.toast({ text: ch.intro, kind: 'story', life: 7 }), 4200);
  }

  fadeThrough(fn, ms = 900) {
    this.fadeEl.classList.add('on');
    setTimeout(() => { fn(); setTimeout(() => this.fadeEl.classList.remove('on'), 200); }, ms);
  }

  flash() {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }

  /** Per-frame HUD refresh (cheap, throttled). */
  update(dt, game) {
    this.padNav(game);
    if (game.input.autoLock !== (game.state === 'playing' && !this.modalOpen && game.cameraRig.mode !== 'photo')) this.syncPointer();
    this.fishingHUD.update(dt);
    const playing = game.state === 'playing';
    this.hud.classList.toggle('hidden', !this.hudVisible || !playing || game.cameraRig.mode === 'photo');
    this.hudTimer = (this.hudTimer ?? 0) - dt;
    if (!playing || this.hudTimer > 0) return;
    this.hudTimer = 0.1;
    this.compass.style.display = game.settings.get('gameplay.showCompass') === false ? 'none' : '';
    this.updateCompass(game);
    const w = game.weather;
    const t = game.time;
    const clock = game.settings.get('gameplay.showSeed') ? ` · seed ${game.world.seed}` : '';
    this.timeEl.textContent = `${t.phaseLabel} · ${t.clockString()} · Day ${t.day + 1}  ${WEATHER_ICON[w.type] ?? ''}${clock}`;
    // Objective: story step, else tracked request.
    clear(this.questEl);
    const obj = game.story?.objectiveText();
    if (obj) this.questEl.append(h('div.title', {}, obj.chapter), h('div.obj', {}, obj.text));
    else {
      const q = game.quests?.active()[0];
      if (q) this.questEl.append(h('div.title', {}, q.title), h('div.obj', {}, q.objective.label + (q.ready ? ' (ready)' : '')));
    }
    const coins = game.session?.state.coins ?? 0;
    const inv = game.session?.inventory;
    clear(this.cornerEl);
    this.cornerEl.append(h('div', {}, `${coins} coins · ${inv?.used ?? 0}/${inv?.capacity ?? 0} storage`));
    if (game.pilot.enabled) this.cornerEl.append(h('div', {}, 'Cruising (R to stop)'));
    const sp = game.onFoot ? '' : `${(game.boat.physics.speed * 3.6).toFixed(1)} km/h`;
    this.speedEl.textContent = sp;
  }

  /** Gamepad: open panels in play, and navigate menus/panels/dialogue with the D-pad + A/B. */
  padNav(game) {
    const inp = game.input;
    if (!inp.pad || game.console?.open) return;
    const pressed = (b) => !!inp.padNow[b] && !inp.padPrev[b];
    const layer = this.dialogueEl ?? this.modal?.el ?? this.menuEl;
    if (!layer) {
      if (game.state !== 'playing') return;
      if (game.cameraRig.mode === 'photo') { if (pressed(PAD.B) || pressed(PAD_BINDINGS.photo)) game.photo?.exit(); return; }
      if (pressed(PAD_BINDINGS.pause)) this.showPause();
      else if (game.fishing?.active) return;
      else if (pressed(PAD_BINDINGS.journal)) this.openPanel(JournalPanel);
      else if (pressed(PAD_BINDINGS.map)) this.openPanel(MapPanel);
      else if (pressed(PAD_BINDINGS.inventory)) this.openPanel(InventoryPanel);
      else if (pressed(PAD_BINDINGS.quests)) this.openPanel(QuestPanel);
      else if (pressed(PAD_BINDINGS.photo)) game.photo?.enter();
      return;
    }
    const buttons = [...layer.querySelectorAll('button:not([disabled]), select, input')].filter((b) => b.offsetParent !== null);
    if (!buttons.length) return;
    let i = buttons.indexOf(document.activeElement);
    const axis = inp.padAxis(1);
    const now = performance.now();
    let dir = pressed(PAD.DOWN) || pressed(PAD.RIGHT) ? 1 : pressed(PAD.UP) || pressed(PAD.LEFT) ? -1 : 0;
    if (!dir && Math.abs(axis) > 0.6 && now - (this.padRepeat ?? 0) > 220) { dir = Math.sign(axis); this.padRepeat = now; }
    if (dir) {
      i = i < 0 ? 0 : (i + dir + buttons.length) % buttons.length;
      buttons[i].focus();
      buttons[i].scrollIntoView?.({ block: 'nearest' });
    }
    if (pressed(PAD.A)) (i >= 0 ? buttons[i] : buttons[0]).click();
    if (pressed(PAD.B) || pressed(PAD_BINDINGS.pause)) {
      if (this.dialogueEl) game.dialogue.close();
      else if (this.modal) this.closeModal();
    }
    const tabs = this.modal?.el.querySelectorAll('.tab');
    if (tabs?.length && (pressed(PAD.LB) || pressed(PAD.RB))) {
      const cur = [...tabs].findIndex((t) => t.classList.contains('active'));
      tabs[(cur + (pressed(PAD.RB) ? 1 : -1) + tabs.length) % tabs.length].click();
    }
  }

  updateCompass(game) {
    const cam = game.camera3;
    const dir = cam.getWorldDirection(cam.position.clone().set(0, 0, 0));
    const yaw = Math.atan2(dir.x, -dir.z); // 0 = north, +pi/2 = east
    const width = this.compass.clientWidth || 480;
    const pxPerRad = width / (Math.PI * 0.9);
    clear(this.compassStrip);
    const add = (angle, label, cls = 'compass-tick', extra = null) => {
      let d = angle - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > Math.PI * 0.46) return;
      const el = h(`div.${cls}`, { style: { left: `${width / 2 + d * pxPerRad}px` } }, label);
      if (extra) el.title = extra;
      this.compassStrip.append(el);
    };
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = 0; i < 8; i++) add((i / 8) * Math.PI * 2, names[i], i % 2 ? 'compass-tick.minor' : 'compass-tick');
    if (!game.settings.get('gameplay.showObjectiveMarkers')) return;
    const p = game.player();
    const markers = [];
    const st = game.story?.target();
    if (st) markers.push({ ...st, icon: '✦' });
    for (const m of game.quests?.markers() ?? []) markers.push({ ...m, icon: '◆' });
    for (const m of game.eventDirector?.markers() ?? []) markers.push({ ...m, icon: '◇' });
    if (game.navTier >= 2) {
      const next = game.findNearestUndiscovered?.();
      if (next) markers.push({ x: next.x, z: next.z, label: 'Something undiscovered', kind: 'discovery', icon: '✧' });
    }
    for (const m of markers) {
      const dx = m.x - p.x, dz = m.z - p.z;
      const ang = Math.atan2(dx, -dz);
      const dist = Math.hypot(dx, dz);
      add(ang, `${m.icon} ${formatDistance(dist)}`, `compass-marker.${m.kind === 'story' || m.kind === 'quest' ? 'quest' : 'discovery'}`, m.label);
    }
  }

  // -------------------------------------------------------------- dialogue
  showDialogue(node) {
    if (this.dialogueEl) { this.dialogueEl.remove(); this.dialogueEl = null; }
    if (!node) { this.updateInputLock(); return; }
    const choices = h('div.choices');
    node.choices.forEach((c, i) => {
      const b = h('button.btn.choice' + (c.highlight ? '.primary' : ''), { onclick: () => c.action() }, `${i + 1}. ${c.label}`);
      choices.append(b);
    });
    this.dialogueEl = h('div.dialogue', {}, h('div.speaker', {}, node.speaker, node.subtitle ? h('span.muted', { style: { fontSize: '15px', marginLeft: '10px', fontFamily: 'var(--font-body)' } }, node.subtitle) : null), h('div.line', {}, node.text), node.note ? h('div.muted', { style: { marginBottom: '10px' } }, node.note) : null, choices);
    this.root.append(this.dialogueEl);
    this.setPrompt(null);
    this.dialogueChoices = node.choices;
    this.updateInputLock();
  }

  showLetter({ title, text }) {
    this.openModal(() => h('div.panel', { style: { width: 'min(720px, 92vw)' } },
      h('div.panel-header', {}, h('div.panel-title', {}, title), h('button.close-x', { onclick: () => this.closeModal() }, '×')),
      h('div.panel-body', {}, h('div.letter', {}, text), h('div.row', { style: { marginTop: '14px' } }, h('div.spacer'), h('button.btn.primary', { onclick: () => this.closeModal() }, 'Fold the letter away')))), { pause: true });
  }

  // ---------------------------------------------------------------- modals
  openModal(build, { pause = true, onClose = null } = {}) {
    this.closeModal(true);
    const overlay = h('div.overlay', { onmousedown: (e) => { if (e.target === overlay) this.closeModal(); } });
    overlay.append(build());
    this.root.append(overlay);
    this.modal = { el: overlay, pause, onClose, wasPaused: this.game.paused };
    if (pause) this.game.paused = true;
    this.updateInputLock();
  }

  closeModal(silent = false) {
    if (!this.modal) return;
    const m = this.modal;
    this.modal = null;
    m.el.remove();
    if (m.pause) this.game.paused = m.wasPaused;
    m.onClose?.();
    this.updateInputLock();
    if (!silent) this.game.events.emit('ui:close', {});
  }

  updateInputLock() {
    const locked = this.modalOpen || this.game.state !== 'playing';
    this.game.controlLocked = !!this.dialogueEl;
    this.game.input.enabled = !this.modal && this.game.state === 'playing';
    this.syncPointer();
    if (locked) this.game.input.exitPointerLock();
  }

  /** Mouse capture only while freely playing (not in menus, dialogue or photo mode). */
  syncPointer() {
    const g = this.game;
    const free = g.state === 'playing' && !this.modalOpen && g.cameraRig.mode !== 'photo';
    g.input.autoLock = free;
    g.input.leftDragLook = g.cameraRig.mode === 'photo';
    if (!free) g.input.exitPointerLock();
  }

  openPanel(Panel, ...args) {
    const panel = new Panel(this.game, this, ...args);
    this.openModal(() => panel.render(), { pause: panel.pause !== false, onClose: () => panel.dispose?.() });
    this.activePanel = panel;
    return panel;
  }

  openTrade(npc, settlement, opts) { return this.openPanel(TradePanel, npc, settlement, opts); }
  openUpgrades(npc, settlement) { return this.openPanel(UpgradePanel, npc, settlement); }

  // ------------------------------------------------------------ keyboard
  onKey(e) {
    const game = this.game;
    if (game.console?.open) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && e.code !== 'Escape') return;
    const b = game.settings.get('controls.bindings');
    const is = (action) => b[action]?.includes(e.code);
    if (this.dialogueEl && /^Digit[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      this.dialogueChoices?.[i]?.action();
      return;
    }
    if (game.state === 'menu') return;
    if (is('pause')) {
      e.preventDefault();
      if (this.dialogueEl) { game.dialogue.close(); return; }
      if (game.cameraRig.mode === 'photo') { game.photo?.exit(); return; }
      if (this.modal) { this.closeModal(); return; }
      if (game.fishing?.active) return;
      this.showPause();
      return;
    }
    if (game.state !== 'playing' || this.dialogueEl) return;
    if (game.cameraRig.mode === 'photo') {
      if (is('photo')) game.photo?.exit();
      return;
    }
    const toggle = (Panel) => { if (this.modal && this.activePanel instanceof Panel) this.closeModal(); else if (!this.modal) this.openPanel(Panel); };
    if (is('inventory')) { e.preventDefault(); toggle(InventoryPanel); }
    else if (is('journal')) toggle(JournalPanel);
    else if (is('map')) toggle(MapPanel);
    else if (is('quests') && !game.onFoot) toggle(QuestPanel);
    else if (is('photo') && !this.modal) game.photo?.enter();
    else if (is('hideHud') && !this.modal) this.setHUDVisible(!this.hudVisible);
  }

  // ------------------------------------------------------------ menus
  showPause() {
    const game = this.game;
    const item = (label, fn, disabled = false) => h('button.menu-item', { onclick: fn, disabled }, label);
    this.openModal(() => h('div.menu', { style: { position: 'static', background: 'none', padding: 0 } },
      h('div.menu-title', { style: { fontSize: '64px' } }, 'Paused'),
      h('div.menu-tag', {}, game.session.meta().chapter),
      h('div.menu-items', {},
        item('Resume', () => this.closeModal()),
        item('Journal', () => this.openPanel(JournalPanel)),
        item('Map', () => this.openPanel(MapPanel)),
        item('Inventory', () => this.openPanel(InventoryPanel)),
        item('Requests', () => this.openPanel(QuestPanel)),
        item('Save Journey', () => this.openPanel(SaveLoadPanel, 'save')),
        item('Load Journey', () => this.openPanel(SaveLoadPanel, 'load')),
        item('Settings', () => this.openPanel(SettingsPanel)),
        item('Return to Title', () => { game.session.autosave('quit'); this.closeModal(); this.showMainMenu(); }),
        window.riverboundNative ? item('Quit to Desktop', async () => { await game.session.save('autosave'); window.riverboundNative.quit(); }) : null,
      )), { pause: true });
  }

  async showMainMenu() {
    const game = this.game;
    this.closeModal(true);
    game.state = 'menu';
    game.paused = false;
    game.cameraRig.setMode('cinematic');
    game.time.timeScale = 6;
    this.menuEl?.remove();
    const latest = await game.session.saves.latest();
    const item = (label, fn, disabled = false, sub = null) => h('div', {}, h('button.menu-item', { onclick: fn, disabled }, label), sub ? h('div.menu-sub', {}, sub) : null);
    const seedInput = h('input', { type: 'text', value: String(Math.floor(Math.random() * 1e9)), style: { fontSize: '15px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.3)', color: '#fff', width: '220px' } });
    this.menuEl = h('div.menu', {},
      h('div.menu-title', {}, 'Riverbound'),
      h('div.menu-tag', {}, 'An endless river. A small boat. All the time in the world.'),
      h('div.menu-items', {},
        latest ? item('Continue', () => this.continueJourney(latest.slot), false, `${latest.meta.chapter} · ${latest.meta.region} · ${fmtTime(latest.meta.playTime ?? 0)}`) : null,
        item('New Story', () => this.startJourney({ mode: 'story', seed: 'RIVERBOUND' }), false, 'Follow Oona\'s lamps down the endless river'),
        item('Free Exploration', () => this.startJourney({ mode: 'free', seed: seedInput.value.trim() || 'RIVERBOUND' }), false, 'A new world from a seed. No story, just the river.'),
        h('div', { style: { margin: '2px 0 10px 2px' } }, h('span.menu-sub', {}, 'World seed: '), seedInput),
        item('Load Journey', () => this.openPanel(SaveLoadPanel, 'load')),
        item('Settings', () => this.openPanel(SettingsPanel)),
        item('Credits', () => this.showCredits()),
        window.riverboundNative ? item('Quit', () => window.riverboundNative.quit()) : null,
      ),
      h('div.menu-foot', {}, `Riverbound · procedural world · ${game.pipeline.gpuInfo.renderer}`),
    );
    this.root.append(this.menuEl);
    this.setHUDVisible(this.hudVisible);
    this.updateInputLock();
  }

  hideMainMenu() {
    this.menuEl?.remove();
    this.menuEl = null;
  }

  async startJourney({ mode = 'story', seed = 'RIVERBOUND', skipIntro = false } = {}) {
    const game = this.game;
    this.hideMainMenu();
    this.closeModal(true);
    const go = async () => {
      await game.session.newJourney({ mode, seed });
      game.time.timeScale = 1;
      game.state = 'playing';
      game.cameraRig.setMode('third');
      this.setHUDVisible(true);
      this.updateInputLock();
      if (mode === 'free' && !skipIntro) this.toast({ title: 'Free Exploration', text: 'The river is yours. Press R to cruise, F to fish, P for photos, M for the map.', kind: 'story', life: 8 });
    };
    if (skipIntro) await go();
    else this.fadeThrough(go, 700);
  }

  async continueJourney(slot) {
    const game = this.game;
    this.hideMainMenu();
    this.fadeThrough(async () => {
      const ok = await game.session.load(slot);
      if (!ok) { this.toast({ text: 'That save could not be loaded.' }); this.showMainMenu(); return; }
      game.time.timeScale = 1;
      game.state = 'playing';
      game.cameraRig.setMode('third');
      this.setHUDVisible(true);
      this.updateInputLock();
      this.toast({ text: 'Welcome back to the river.' });
    }, 700);
  }

  showBenchmark(r) {
    const row = (k, v) => h('div.list-item.row', {}, h('div', { style: { flex: 1 } }, k), h('b', {}, v));
    this.openModal(() => h('div.panel', { style: { width: 'min(640px, 92vw)' } },
      h('div.panel-header', {}, h('div.panel-title', {}, 'Benchmark result'), h('div.spacer'), h('button.close-x', { onclick: () => this.closeModal() }, '×')),
      h('div.panel-body', {}, h('div.list', {},
        row('Preset', `${r.preset}${r.laptopMode ? ' + Laptop Mode' : ''}`),
        row('GPU', r.gpu),
        row('Average', `${r.avgFps.toFixed(1)} FPS (${r.avgFrameMs.toFixed(1)} ms)`),
        row('1% low', `${r.onePercentLowFps.toFixed(1)} FPS`),
        row('Frame time p50 / p95 / p99', `${r.p50Ms.toFixed(1)} / ${r.p95Ms.toFixed(1)} / ${r.p99Ms.toFixed(1)} ms`),
        row('Average render scale', `${Math.round(r.avgRenderScale * 100)}%`),
        row('Draw calls / triangles', `${r.avgDrawCalls.toFixed(0)} / ${(r.avgTriangles / 1000).toFixed(0)}k`),
        row('Biomes crossed', r.biomes.join(', '))),
      h('div.hint', { style: { marginTop: '10px' } }, 'If the average is below your target, try a lower preset or Laptop Mode; dynamic resolution keeps the frame rate steady by lowering the 3D resolution first.'))), { pause: true });
  }

  showCredits() {
    this.openModal(() => h('div.panel', { style: { width: 'min(760px, 92vw)' } },
      h('div.panel-header', {}, h('div.panel-title', {}, 'Credits'), h('button.close-x', { onclick: () => this.closeModal() }, '×')),
      h('div.panel-body.credits', {},
        h('p', {}, 'Riverbound: an endless, procedurally generated river journey.'),
        h('p', {}, 'All 3D models, terrain, water, sky, vegetation, characters, wildlife, textures, sound effects and music are generated procedurally by the game\'s own code. No external art, audio or music assets are used.'),
        h('p', {}, 'Built with three.js (MIT License). Desktop build runs on Electron (MIT License). Fonts: Cormorant Garamond and Nunito (SIL Open Font License 1.1), bundled via Fontsource.'),
        h('p', { class: 'muted' }, 'See ASSET_LICENSES.md for details.'))), { pause: false });
  }
}
