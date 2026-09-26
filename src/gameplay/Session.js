// Session: owns the persistent GameState for the current journey and wires
// gameplay systems to it: new journeys (story or free exploration, any seed),
// saving/loading with autosave, gathering, lore and resting.
import { createState, ITEMS, itemName } from './GameState.js';
import { Inventory } from './Inventory.js';
import { Economy } from './Economy.js';
import { SaveSystem } from './SaveSystem.js';
import loreData from '../data/lore.json' with { type: 'json' };
import { RNG, normalizeSeed } from '../core/rng.js';

export class Session {
  constructor(game) {
    this.game = game;
    this.saves = new SaveSystem(game.storage);
    this.state = createState({ seed: game.world.seed, mode: 'story' });
    this.inventory = new Inventory(this.state, game.events);
    this.economy = new Economy(this.state, game.time);
    this.autosaveTimer = 120;
    this.slot = 'autosave';
    game.events.on('fish:caught', () => this.markDirty());
    game.events.on('lore:bottle', () => this.readBottle());
  }

  get storyEnabled() {
    return this.state.mode === 'story';
  }

  markDirty() {
    this.dirty = true;
  }

  bind(state) {
    this.state = state;
    this.inventory = new Inventory(this.state, this.game.events);
    this.economy = new Economy(this.state, this.game.time);
  }

  /** Start a fresh journey. */
  async newJourney({ mode = 'story', seed = null } = {}) {
    const game = this.game;
    const targetSeed = seed ?? game.world.seed;
    if (normalizeSeed(targetSeed) !== game.world.seed) await game.loadWorld(targetSeed);
    else this.resetPlayer();
    const state = createState({ seed: game.world.seed, mode });
    this.bind(state);
    game.time.setHours(mode === 'story' ? 9.2 : 16.4);
    game.time.day = 0;
    game.boat.lanternOn = false;
    game.upgrades.apply();
    game.content.discovered.clear();
    game.journal.lastRegion = -1;
    this.applyCollected();
    if (mode === 'story') game.story.start();
    game.events.emit('session:new', { mode });
    this.autosave('start');
  }

  /** Continue from a slot (or the latest). */
  async load(slot) {
    const game = this.game;
    const data = slot ? await this.saves.load(slot) : null;
    if (!data) return false;
    const st = data.state;
    if (normalizeSeed(st.seed) !== game.world.seed) await game.loadWorld(st.seed);
    this.bind(st);
    this.slot = slot;
    if (st.time) game.time.restore(st.time);
    if (st.weather) game.weatherSystem?.restore(st.weather);
    if (st.player) {
      game.setOrigin(st.player.x, st.player.z);
      game.boat.placeAt(st.player.x, st.player.z, st.player.heading ?? 0);
    }
    game.boat.lanternOn = !!st.lanternOn;
    game.boat.lanternLevel = st.lanternOn ? 1 : 0;
    game.upgrades.apply();
    game.content.discovered = new Set(Object.keys(st.discoveries.features));
    this.applyCollected();
    if (this.storyEnabled) game.story.start();
    game.events.emit('session:loaded', { slot });
    return true;
  }

  /** Put the Wren back at the home mooring (same world, fresh journey). */
  resetPlayer() {
    const game = this.game;
    const home = game.world.findFeature((i) => i.storyKey === 'home', 1);
    const start = home?.moor ?? game.world.riverToWorld(60, 0);
    const r = game.world.main.nearest(start.x, start.z, {});
    game.setOrigin(start.x, start.z);
    game.boat.placeAt(start.x, start.z, game.world.main.sample(r.s, {}).h);
  }

  snapshot() {
    const game = this.game;
    const p = game.boat.physics;
    this.state.player = { x: p.x, z: p.z, heading: p.heading, s: p.s };
    this.state.time = game.time.serialize();
    this.state.weather = game.weatherSystem?.serialize() ?? null;
    this.state.lanternOn = game.boat.lanternOn;
    this.state.cameraMode = game.cameraRig.mode === 'photo' ? 'third' : game.cameraRig.mode;
    return this.state;
  }

  meta() {
    const game = this.game;
    const story = this.state.story;
    const chapterTitle = this.storyEnabled ? (game.story.chapter ? `${game.story.chapter.number}: ${game.story.chapter.title}` : 'Journey complete') : 'Free Exploration';
    return {
      mode: this.state.mode, seed: this.state.seed, playTime: this.state.playTime, day: game.time.day, chapter: chapterTitle,
      biome: game.currentBiome?.name ?? '', region: game.world.regionAtS(game.boat.physics.s).name, distance: Math.round(this.state.stats.distance), storyDone: !!story.completed,
    };
  }

  async save(slot = this.slot) {
    if (this.game.state !== 'playing' && this.game.state !== 'paused') return null;
    const meta = await this.saves.save(slot, structuredClone(this.snapshot()), this.meta());
    this.game.events.emit('saved', { slot, meta });
    return meta;
  }

  autosave(reason = 'timer') {
    this.autosaveTimer = (this.game.settings.get('gameplay.autosaveMinutes') ?? 3) * 60;
    if (this.game.state !== 'playing') return;
    this.save('autosave').then(() => this.game.events.emit('autosave', { reason })).catch((e) => console.error('[save] autosave failed', e));
  }

  /** Collected resources/lore are hidden by the content streamer on its next refresh. */
  applyCollected() {
    if (this.game.content) this.game.content.timer = 0;
  }

  isCollected(id) {
    const d = this.state.collected[id];
    if (d === undefined) return false;
    if (id.includes('_lore_')) return true;
    return this.game.time.totalDays - d < 3;
  }

  update(dt, game) {
    if (game.state !== 'playing') return;
    this.state.playTime += dt;
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) this.autosave('timer');
  }

  /** Interaction provider: gather resources and read lore. */
  interactables(game) {
    const out = [];
    for (const s of game.content.spawned.values()) {
      const it = s.item;
      if (it.kind === 'resource' && !this.isCollected(it.id)) {
        out.push({ id: it.id, x: it.x, z: it.z, range: game.onFoot ? 2.8 : 7, verb: 'Gather', label: itemName(it.item), priority: 0, action: () => this.gather(it, s) });
      } else if (it.kind === 'lore' && !this.isCollected(it.id)) {
        out.push({ id: it.id, x: it.x, z: it.z, range: game.onFoot ? 3 : 8, verb: it.type === 'bottle' ? 'Fish out' : 'Read', label: it.type === 'bottle' ? 'a bottle' : 'the carved stone', priority: 1, action: () => this.readLore(it, s) });
      }
    }
    return out;
  }

  gather(it, spawned) {
    const game = this.game;
    const n = 1 + (Math.random() < 0.35 ? 1 : 0);
    const added = this.inventory.add(it.item, n);
    if (!added) { game.events.emit('toast', { text: 'Your storage is full.' }); return; }
    this.state.collected[it.id] = game.time.totalDays;
    this.state.stats.itemsGathered += added;
    game.events.emit('toast', { text: `Gathered ${added} ${itemName(it.item)}` });
    game.events.emit('gather', { item: it.item, count: added });
    if (game.onFoot) game.walker?.playCollect();
    if (spawned?.group) spawned.group.visible = false;
  }

  readLore(it, spawned) {
    const game = this.game;
    this.state.collected[it.id] = game.time.totalDays;
    const rng = new RNG(it.loreSeed ?? 1);
    const list = it.type === 'bottle' ? loreData.bottles : loreData.carvings;
    const text = list[Math.floor(rng.next() * list.length)];
    const title = it.type === 'bottle' ? 'A message in a bottle' : 'Words carved in stone';
    game.journal.addLore(it.id, text, title);
    game.events.emit('letter', { id: it.id, title, text });
    if (spawned?.group) spawned.group.visible = false;
  }

  readBottle() {
    const game = this.game;
    const text = loreData.bottles[Math.floor(Math.random() * loreData.bottles.length)];
    const id = `bottle_${Date.now()}`;
    game.journal.addLore(id, text, 'A message in a bottle');
    game.events.emit('letter', { id, title: 'A message in a bottle', text });
  }

  /** Brew tea / rest: advance time to the next part of the day. */
  rest() {
    const game = this.game;
    const comfort = this.state.upgrades.comfort ?? 0;
    if (comfort < 2 && !this.inventory.has('river_tea')) { game.events.emit('toast', { text: 'You need river tea (or a kettle on board) to rest.' }); return false; }
    if (comfort < 2) this.inventory.remove('river_tea', 1);
    const h = game.time.hours;
    const stops = [5.6, 9, 13, 17.4, 19.6, 22.5];
    let next = stops.find((s) => s > h + 0.3);
    let day = game.time.day;
    if (next === undefined) { next = stops[0]; day++; }
    game.ui?.fadeThrough?.(() => { game.time.day = day; game.time.setHours(next); game.pipeline.updateEnvironment(game.sky.envScene, true); });
    game.events.emit('toast', { text: 'You brew a cup of tea and watch the river for a while.' });
    return true;
  }

  useItem(id) {
    const def = ITEMS[id];
    if (!def) return;
    if (id === 'river_tea') this.rest();
    else if (def.paint) this.game.upgrades.paint(id, def.paint);
    else if (def.readable) { this.inventory.remove(id, 1); this.readBottle(); }
  }
}
