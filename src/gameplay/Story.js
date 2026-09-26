// Main story: chapters and steps from data/story.json bound to story anchors
// that the world generator placed for this seed. Story steps complete from
// gameplay events; lamps are lit at night; letters are collected into the
// journal. Finishing the story unlocks free exploration on the same save.
import storyData from '../data/story.json' with { type: 'json' };
import * as THREE from 'three';

export const CHAPTERS = storyData.chapters;
export const LETTERS = storyData.letters;
export const STORY_NPCS = storyData.npcs;

export class StorySystem {
  constructor(game) {
    this.game = game;
    this.featureCache = new Map();
    const ev = game.events;
    ev.on('discover', ({ item }) => this.onEvent('discover', item));
    ev.on('fish:caught', (e) => this.onEvent('catch', e));
    ev.on('trade:sell', (e) => this.onEvent('sell', e));
    ev.on('photo:taken', (e) => this.onEvent('photo', e));
    ev.on('dialogue:closed', ({ npc }) => this.onEvent('talk', npc));
    ev.on('content:spawn', ({ item, group }) => this.onSpawn(item, group));
    this.letterPickups = new Map();
  }

  get enabled() {
    return this.game.session?.storyEnabled;
  }

  get s() {
    return this.game.session.state.story;
  }

  get chapter() {
    return CHAPTERS[this.s.chapter] ?? null;
  }

  get step() {
    return this.chapter?.steps[this.s.step] ?? null;
  }

  /** Begin (or resume) the story. */
  start() {
    if (!this.enabled) return;
    if (!this.s.started) {
      this.s.started = true;
      this.s.chapter = 0;
      this.s.step = 0;
      this.game.events.emit('story:chapter', { chapter: CHAPTERS[0] });
    }
    this.announceStep();
  }

  feature(key) {
    if (this.featureCache.has(key)) return this.featureCache.get(key);
    const it = this.game.world.findFeature((i) => i.storyKey === key, 24);
    if (it) this.featureCache.set(key, it);
    return it;
  }

  /** World target of the current step (for compass/map markers). */
  target() {
    const st = this.step;
    if (!this.enabled || !st) return null;
    const key = st.feature ?? st.settlement;
    if (!key) {
      if (st.type === 'leave') return null;
      return null;
    }
    const it = this.feature(key);
    return it ? { x: it.x, z: it.z, label: st.objective, kind: 'story' } : null;
  }

  objectiveText() {
    if (!this.enabled) return null;
    if (this.s.completed && !this.step) return null;
    return this.step ? { chapter: `${this.chapter.number}: ${this.chapter.title}`, text: this.step.objective, hint: this.step.hint } : null;
  }

  announceStep() {
    const st = this.step;
    if (!st) return;
    this.game.events.emit('story:step', { step: st, chapter: this.chapter });
    if (st.hint) setTimeout(() => this.game.events.emit('toast', { title: 'Hint', text: st.hint, kind: 'story', life: 7 }), 1500);
  }

  completeStep() {
    const st = this.step;
    if (!st) return;
    const session = this.game.session;
    if (st.reward?.items) for (const [id, n] of Object.entries(st.reward.items)) session.inventory.add(id, n);
    if (st.reward?.flags) for (const f of st.reward.flags) if (!this.s.flags.includes(f)) this.s.flags.push(f);
    if (st.reward?.upgrade) for (const [track, tier] of Object.entries(st.reward.upgrade)) this.game.upgrades.grant(track, tier);
    if (st.letter) this.giveLetter(st.letter);
    this.game.events.emit('story:stepComplete', { step: st });
    this.s.step++;
    if (this.s.step >= this.chapter.steps.length) {
      this.s.chapter++;
      this.s.step = 0;
      const ch = this.chapter;
      if (ch) {
        this.game.events.emit('story:chapter', { chapter: ch });
        this.game.events.emit('music:moment', { kind: 'chapter' });
        if (ch.id === 'epilogue') this.s.completed = true;
      } else {
        this.s.completed = true;
        this.game.events.emit('story:complete', {});
      }
      this.game.session.autosave('chapter');
    }
    this.announceStep();
  }

  giveLetter(id) {
    if (!this.s.letters.includes(id)) this.s.letters.push(id);
    const L = LETTERS[id];
    if (L) {
      this.game.journal?.addLore(`letter:${id}`, L.text, L.title);
      this.game.events.emit('letter', { id, ...L });
    }
  }

  onEvent(type, payload) {
    if (!this.enabled) return;
    const st = this.step;
    if (!st) return;
    switch (st.type) {
      case 'talk':
        if (type === 'talk' && payload?.storyKey === `${st.settlement}.${st.role}`) this.completeStep();
        break;
      case 'catch':
        if (type === 'catch' && (st.species === 'any' || payload.id === st.species)) this.completeStep();
        break;
      case 'sell':
        if (type === 'sell') this.completeStep();
        break;
      case 'discover':
        if (type === 'discover' && payload.storyKey === st.feature) this.completeStep();
        break;
      case 'photo':
        if (type === 'photo') this.completeStep();
        break;
      default:
        break;
    }
  }

  update(dt, game) {
    if (!this.enabled || game.state !== 'playing') return;
    const st = this.step;
    if (!st) return;
    const p = game.player();
    if (st.type === 'reach') {
      const it = this.feature(st.feature);
      if (it && Math.hypot(it.x - p.x, it.z - p.z) < (st.radius ?? 50)) this.completeStep();
    } else if (st.type === 'leave') {
      const origin = this.s.chapter === 0 ? this.feature('home') : this.feature('lighthouse') ?? this.feature('home');
      if (origin && Math.hypot(origin.x - p.x, origin.z - p.z) > st.distance) this.completeStep();
    }
  }

  /** Lamps & the veil reflect story state when their meshes spawn. */
  onSpawn(item, group) {
    if (!group) return;
    const lamps = this.game.session?.state?.story?.lamps ?? {};
    if (group.userData.setLit && item.storyKey) group.userData.setLit(!!lamps[item.storyKey]);
    if (item.kind === 'veil' && group.userData.veil) group.userData.veil.open = !!this.game.session?.state?.story?.flags?.includes('veilOpen');
  }

  isLampLit(key) {
    return !!this.game.session.state.story.lamps[key];
  }

  lightLamp(item) {
    const g = this.game;
    const s = this.s;
    if (s.lamps[item.storyKey]) { g.events.emit('toast', { text: 'The lamp is already burning.' }); return; }
    if (g.time.sunElevation > -3) { g.events.emit('toast', { title: item.name, text: 'The old lamp will not take a flame in daylight. Come back after dusk.', life: 5 }); return; }
    s.lamps[item.storyKey] = true;
    g.session.state.stats.lampsLit++;
    const spawned = g.content.get(item.id);
    spawned?.group?.userData.setLit?.(true);
    g.events.emit('lamp:lit', { item });
    g.events.emit('toast', { title: 'A lamp is lit', text: `${item.name} burns again after all these years.`, kind: 'story', life: 6 });
    g.events.emit('music:moment', { kind: 'lamp' });
    const st = this.step;
    if (this.enabled && st?.type === 'light' && st.feature === item.storyKey) this.completeStep();
    g.session.autosave('lamp');
  }

  openVeil(item) {
    const g = this.game;
    const lanternTier = g.session.state.upgrades.lantern ?? 0;
    if (g.time.sunElevation > -3) { g.events.emit('toast', { text: 'The vines hang heavy and still. Nothing happens in daylight.' }); return; }
    if (lanternTier < 2 || !g.boat.lanternOn) { g.events.emit('toast', { text: 'The vines glimmer faintly, as if waiting for a particular kind of light.' }); return; }
    if (!this.s.flags.includes('veilOpen')) this.s.flags.push('veilOpen');
    const spawned = g.content.get(item.id);
    if (spawned?.group?.userData.veil) spawned.group.userData.veil.open = true;
    g.events.emit('toast', { title: 'The Hidden River', text: 'The vines draw apart in the lantern light, like a curtain.', kind: 'story', life: 6 });
    g.events.emit('music:moment', { kind: 'wonder' });
    const st = this.step;
    if (this.enabled && st?.type === 'veil') this.completeStep();
  }

  /** Blocking collider for the closed veil. */
  colliders(x, z) {
    if (this.game.session?.state?.story?.flags?.includes('veilOpen')) return [];
    const it = this.feature('hiddenRiver');
    if (!it) return [];
    const veil = this.game.world.findFeature((i) => i.kind === 'veil', 24);
    if (!veil || Math.hypot(veil.x - x, veil.z - z) > 60) return [];
    return [{ type: 'box', x: veil.x, z: veil.z, hl: 1.2, hw: veil.width / 2, angle: veil.angle, owner: 'veil' }];
  }

  /** Interaction provider: lamps, veil, readable records. */
  interactables(game) {
    const out = [];
    for (const s of game.content.spawned.values()) {
      const it = s.item;
      if (it.type === 'lampstone' || it.type === 'lighthouse') {
        out.push({ id: `lamp:${it.id}`, x: it.x, z: it.z, range: it.type === 'lighthouse' ? (game.onFoot ? 30 : 120) : 12, verb: this.isLampLit(it.storyKey) ? 'Admire' : 'Light', label: it.name, priority: 2, action: () => this.isLampLit(it.storyKey) ? game.events.emit('toast', { text: 'Its light reaches far across the water.' }) : this.lightLamp(it) });
      } else if (it.kind === 'veil') {
        out.push({ id: `veil:${it.id}`, x: it.x, z: it.z, range: 16, verb: 'Approach', label: 'the curtain of vines', priority: 2, action: () => this.openVeil(it) });
      }
    }
    // Readable records at story locations.
    const st = this.step;
    if (this.enabled && st?.type === 'read') {
      const it = this.feature(st.feature);
      if (it) {
        const x = it.x + 3, z = it.z + 2;
        out.push({ id: `read:${st.letter}`, x, z, range: game.onFoot ? 4 : 16, verb: 'Read', label: LETTERS[st.letter]?.title ?? 'the record', priority: 3, action: () => { this.giveLetter(st.letter); this.completeStep(); } });
      }
    }
    return out;
  }

  /** Sparkle marker for readable records (shown by the HUD). */
  readableMarker() {
    const st = this.step;
    if (!this.enabled || st?.type !== 'read') return null;
    const it = this.feature(st.feature);
    return it ? new THREE.Vector3(it.x + 3, 0, it.z + 2) : null;
  }
}
