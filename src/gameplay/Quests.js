// Procedural side quests: small stories offered by residents. Fishing
// requests, deliveries downstream, lost belongings near landmarks, places to
// go and see, photographs of wildlife, and gathering. No combat, no grind.
import npcData from '../data/npcs.json' with { type: 'json' };
import { RNG, hashString } from '../core/rng.js';
import { FISH, ITEMS } from './GameState.js';
import { candidates } from './FishingLogic.js';
import { RESOURCES_BY_BIOME } from '../world/Features.js';
import { SPECIES_INFO } from '../wildlife/Wildlife.js';

const LOST_ITEMS = ['lost_compass', 'lost_locket', 'lost_flute', 'lost_map'];

function fill(t, vars) {
  return t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export class QuestSystem {
  constructor(game) {
    this.game = game;
    const ev = game.events;
    ev.on('fish:caught', () => this.refreshReady());
    ev.on('inventory:add', () => this.refreshReady());
    ev.on('discover', ({ item }) => this.onDiscover(item));
    ev.on('photo:taken', ({ subjects }) => this.onPhoto(subjects));
  }

  get state() {
    return this.game.session.state.quests;
  }

  active() {
    return this.state.active;
  }

  /** Offer (or re-offer) a quest from an NPC. Returns quest or null. */
  offerFor(npc, settlement) {
    const q = this.state;
    if (q.active.some((a) => a.giver === npc.id)) return null;
    if (q.active.length >= 5) return null;
    if (!['villager', 'elder', 'fisher'].includes(npc.role)) return null;
    const day = Math.floor(this.game.time.totalDays);
    const key = `${npc.id}:${day}`;
    if (q.offered[key] === 'declined' || q.offered[key] === 'accepted') return null;
    const rng = new RNG(hashString(key));
    if (!rng.chance(0.75)) return null;
    const quest = this.generate(rng, npc, settlement);
    if (quest) quest.offerKey = key;
    return quest;
  }

  generate(rng, npc, settlement) {
    const world = this.game.world;
    const biome = settlement.biome;
    const types = npc.role === 'fisher' ? ['fish', 'fish', 'photo', 'collect'] : ['fish', 'delivery', 'lost', 'explore', 'photo', 'collect'];
    for (let attempt = 0; attempt < 6; attempt++) {
      const type = rng.pick(types);
      const base = { id: `q${Date.now().toString(36)}${Math.floor(rng.next() * 1e6).toString(36)}`, type, giver: npc.id, giverName: npc.name, settlementId: settlement.id, settlementName: settlement.name, state: 'active', reward: { coins: 20 + rng.int(0, 5) * 10 } };
      const req = (k, vars) => fill(rng.pick(npcData.requests[k]), vars);
      if (type === 'fish') {
        const list = candidates({ biomes: [biome], habitat: 'river', hours: 12, sunElevation: 30, weather: { cloud: 0.2 }, rodTier: 0 }).map((c) => c.species).filter((s) => s.rarity === 'common' || s.rarity === 'uncommon');
        if (!list.length) continue;
        const f = rng.pick(list);
        return { ...base, title: `A ${f.name} for ${npc.name}`, text: req('fish', { fish: f.name }), objective: { kind: 'bring', item: f.id, count: 1, label: `Bring a ${f.name} to ${npc.name}` }, reward: { coins: Math.round(f.value * 2.5 + 15) } };
      }
      if (type === 'collect') {
        const res = RESOURCES_BY_BIOME[biome] ?? ['driftwood'];
        const item = rng.pick(res);
        const count = rng.int(3, 5);
        return { ...base, title: `Gathering ${ITEMS[item].name}`, text: req('collect', { count, item: ITEMS[item].name }), objective: { kind: 'bring', item, count, label: `Bring ${count} ${ITEMS[item].name} to ${npc.name}` }, reward: { coins: ITEMS[item].value * count * 2 + 10 } };
      }
      if (type === 'delivery') {
        const target = this.findSettlementAhead(settlement, 2500, 14000);
        if (!target) continue;
        return { ...base, title: `A parcel for ${target.name}`, text: req('delivery', { target: target.name }), objective: { kind: 'deliver', item: 'parcel', target: target.id, targetName: target.name, x: target.x, z: target.z, label: `Deliver the parcel to ${target.name}` }, giveItems: { parcel: 1 }, reward: { coins: 60 + rng.int(0, 4) * 10 } };
      }
      if (type === 'lost' || type === 'explore') {
        const lm = this.findLandmarkNear(settlement, type === 'explore');
        if (!lm) continue;
        if (type === 'lost') {
          const item = rng.pick(LOST_ITEMS);
          const a = rng.next() * Math.PI * 2;
          return { ...base, title: `${npc.name}'s ${ITEMS[item].name}`, text: req('lost', { item: ITEMS[item].name.toLowerCase(), landmark: lm.name }), objective: { kind: 'find', item, x: lm.x + Math.cos(a) * 6, z: lm.z + Math.sin(a) * 6, landmark: lm.name, label: `Find the ${ITEMS[item].name.toLowerCase()} near ${lm.name}`, returnTo: npc.name }, reward: { coins: 45 + rng.int(0, 3) * 10, items: { honey_cake: 1 } } };
        }
        return { ...base, title: `Go and see ${lm.name}`, text: req('explore', { landmark: lm.name }), objective: { kind: 'discover', feature: lm.id, x: lm.x, z: lm.z, label: `Find ${lm.name}` }, reward: { coins: 40 + rng.int(0, 3) * 10 } };
      }
      if (type === 'photo') {
        const bl = this.game.world.biomeAt(settlement.x, settlement.z);
        const wl = bl.dominant.wildlife;
        const opts = Object.keys(SPECIES_INFO).filter((sp) => ({ songbird: 'birds', heron: 'herons', butterfly: 'butterflies', firefly: 'fireflies', fish: 'fish', frog: 'frogs', deer: 'deer' })[sp] && (wl[{ songbird: 'birds', heron: 'herons', butterfly: 'butterflies', firefly: 'fireflies', fish: 'fish', frog: 'frogs', deer: 'deer' }[sp]] ?? 0) > 0.4);
        if (!opts.length) continue;
        const sp = rng.pick(opts);
        return { ...base, title: `A picture of a ${SPECIES_INFO[sp].name}`, text: req('photo', { species: SPECIES_INFO[sp].name }), objective: { kind: 'photo', species: sp, label: `Photograph a ${SPECIES_INFO[sp].name} (photo mode: P)` }, reward: { coins: 50 + rng.int(0, 3) * 10 } };
      }
    }
    return null;
  }

  findSettlementAhead(from, minD, maxD) {
    const world = this.game.world;
    for (let i = from.region; i < from.region + 8; i++) {
      const f = world.regionFeatures(i);
      for (const it of f.items) {
        if (it.kind !== 'settlement' || it.id === from.id) continue;
        const ds = (it.s ?? 0) - (from.s ?? 0);
        if (ds > minD && ds < maxD) return it;
      }
    }
    return null;
  }

  findLandmarkNear(from, undiscoveredOnly) {
    const world = this.game.world;
    const disc = this.game.session.state.discoveries.features;
    const list = [];
    for (let i = Math.max(0, from.region - 1); i <= from.region + 2; i++) {
      for (const it of world.regionFeatures(i).items) {
        if (it.kind !== 'landmark' || it.rarity === 'story') continue;
        if (undiscoveredOnly && disc[it.id]) continue;
        const ds = (it.s ?? from.s) - from.s;
        if (ds < -1500 || ds > 6000) continue;
        list.push(it);
      }
    }
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  accept(quest) {
    this.state.active.push(quest);
    if (quest.offerKey) this.state.offered[quest.offerKey] = 'accepted';
    if (quest.giveItems) for (const [id, n] of Object.entries(quest.giveItems)) this.game.session.inventory.add(id, n);
    this.game.events.emit('toast', { title: 'New request', text: quest.title, kind: 'quest' });
    this.game.events.emit('quest:accepted', { quest });
    this.refreshReady();
  }

  abandon(quest) {
    this.state.active = this.state.active.filter((a) => a !== quest);
    if (quest.giveItems) for (const [id, n] of Object.entries(quest.giveItems)) this.game.session.inventory.remove(id, n);
    this.game.events.emit('toast', { text: `You let go of "${quest.title}".` });
  }

  decline(quest) {
    if (quest.offerKey) this.state.offered[quest.offerKey] = 'declined';
  }

  refreshReady() {
    const inv = this.game.session?.inventory;
    if (!inv) return;
    for (const q of this.state.active) {
      const o = q.objective;
      if (o.kind === 'bring') q.ready = inv.has(o.item, o.count);
      else if (o.kind === 'find') q.ready = inv.has(o.item, 1);
      else if (o.kind === 'deliver') q.ready = inv.has(o.item, 1);
    }
  }

  /** Quests completable by talking to this NPC. */
  turnInsFor(npc, settlement) {
    this.refreshReady();
    return this.state.active.filter((q) => (q.giver === npc.id && q.ready && q.objective.kind !== 'deliver') || (q.objective.kind === 'deliver' && q.objective.target === settlement.id && q.ready));
  }

  complete(q) {
    const inv = this.game.session.inventory;
    const o = q.objective;
    if (o.kind === 'bring') { if (!inv.remove(o.item, o.count)) return false; }
    if (o.kind === 'find' || o.kind === 'deliver') inv.remove(o.item, 1);
    this.finish(q);
    return true;
  }

  finish(q) {
    const s = this.game.session;
    q.state = 'done';
    this.state.active = this.state.active.filter((a) => a !== q);
    this.state.completed.push({ id: q.id, title: q.title, giverName: q.giverName, settlementName: q.settlementName, day: this.game.time.day });
    s.state.stats.questsDone++;
    if (q.reward?.coins) s.inventory.addCoins(q.reward.coins);
    if (q.reward?.items) for (const [id, n] of Object.entries(q.reward.items)) s.inventory.add(id, n);
    const set = s.state.settlements[q.settlementId] ??= { supply: {}, friendship: 0 };
    set.friendship = Math.min(10, (set.friendship ?? 0) + 1);
    this.game.events.emit('toast', { title: 'Request complete', text: `${q.title}  +${q.reward?.coins ?? 0} coins`, kind: 'quest' });
    this.game.events.emit('quest:complete', { quest: q });
    this.game.events.emit('music:moment', { kind: 'quest' });
  }

  onDiscover(item) {
    for (const q of [...this.state.active]) if (q.objective.kind === 'discover' && q.objective.feature === item.id) this.finish(q);
  }

  onPhoto(subjects) {
    for (const q of [...this.state.active]) if (q.objective.kind === 'photo' && subjects.includes(q.objective.species)) this.finish(q);
  }

  /** Interaction provider: pick up lost items for 'find' quests. */
  interactables(game) {
    const out = [];
    for (const q of this.state.active) {
      const o = q.objective;
      if (o.kind !== 'find' || game.session.inventory.has(o.item)) continue;
      out.push({ id: `find:${q.id}`, x: o.x, z: o.z, range: game.onFoot ? 3 : 7, verb: 'Pick up', label: ITEMS[o.item].name, priority: 2, action: () => {
        if (game.session.inventory.add(o.item, 1)) {
          game.events.emit('toast', { title: 'Found it', text: `${ITEMS[o.item].name}. Return it to ${o.returnTo}.`, kind: 'quest' });
          this.refreshReady();
        }
      } });
    }
    return out;
  }

  /** Markers for the compass (tracked objectives). */
  markers() {
    const out = [];
    for (const q of this.state.active) {
      const o = q.objective;
      if (o.x !== undefined) out.push({ x: o.x, z: o.z, label: q.title, kind: 'quest' });
    }
    return out;
  }
}

export { FISH };
