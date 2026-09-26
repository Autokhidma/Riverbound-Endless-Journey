// Settlement residents: generated deterministically from each settlement
// (names from the local culture, looks, roles), spawned as animated
// characters when the player is near, and offering conversation, trading,
// boat upgrades and small requests.
import * as THREE from 'three';
import npcData from '../data/npcs.json' with { type: 'json' };
import storyData from '../data/story.json' with { type: 'json' };
import { RNG, hashString } from '../core/rng.js';
import { CharacterModel } from '../character/CharacterModel.js';
import { CharacterAnimator } from '../character/CharacterAnimator.js';

const PALETTES = {
  skin: ['#f1c9a5', '#d9a47c', '#b57c56', '#8d5a3b', '#6b4430', '#e8b894'],
  hair: ['#2a1d14', '#4a3020', '#7a5a3a', '#b89060', '#c8c0b0', '#1a1a1a', '#8a3a20'],
  shirt: ['#e8e0cc', '#c8d8e0', '#e0c8b0', '#d0d8c0', '#f0e8d8'],
  vest: ['#5a6e4a', '#6a4a3a', '#3a4a6a', '#7a5a8a', '#8a6a3a', '#4a6a6a'],
  trousers: ['#4b5566', '#5a4a3a', '#3a3a3a', '#6a5a4a'],
  scarf: ['#c0573f', '#d9913a', '#3f7f8a', '#8a4a7a', '#6a8a3a', '#e0c050'],
  hat: ['#b89a64', '#6a4a3a', '#3a4a5a', '#8a3a3a', '#d8d0b8'],
};

export class NPCSystem {
  constructor(game) {
    this.game = game;
    this.spawned = new Map(); // npc id -> { npc, model, anim }
    this.cache = new Map(); // settlement id -> npc list
  }

  onWorldDispose() {
    for (const s of this.spawned.values()) this.game.worldRoot.remove(s.model.root);
    this.spawned.clear();
    this.cache.clear();
  }

  /** Deterministic residents of a settlement. */
  residents(settlement, spots) {
    let list = this.cache.get(settlement.id);
    if (list) return list;
    const rng = new RNG(hashString(`npc:${settlement.id}`));
    const names = npcData.names[settlement.style] ?? npcData.names.cottage;
    const used = new Set();
    list = spots.map((spot, i) => {
      let name = rng.pick(names);
      while (used.has(name) && used.size < names.length) name = rng.pick(names);
      used.add(name);
      const storyKey = settlement.storyKey ? `${settlement.storyKey}.${spot.role}` : null;
      const story = storyKey ? storyData.npcs[storyKey] : null;
      if (story) name = story.name;
      const look = Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, rng.pick(v)]));
      look.boots = '#5a3a26'; look.satchel = '#8a5a34'; look.hatBand = '#5a4430';
      return { id: `${settlement.id}:${spot.role}:${i}`, name, role: spot.role, spot, look, settlementId: settlement.id, storyKey, hasHat: rng.chance(0.6), seed: rng.nextU32() };
    });
    this.cache.set(settlement.id, list);
    return list;
  }

  update(dt, game) {
    const p = game.player();
    const content = game.content;
    if (!content) return;
    const want = new Set();
    for (const s of content.spawnedOf('settlement')) {
      const it = s.item;
      if (!s.group) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > 260) continue;
      for (const npc of this.residents(it, s.group.userData.npcSpots ?? [])) {
        want.add(npc.id);
        if (!this.spawned.has(npc.id)) this.spawn(npc, it);
      }
    }
    for (const [id, s] of this.spawned) if (!want.has(id)) { game.worldRoot.remove(s.model.root); this.spawned.delete(id); }
    // Animate those close enough to matter.
    for (const s of this.spawned.values()) {
      const n = s.npc;
      const d = Math.hypot(n.spot.x - p.x, n.spot.z - p.z);
      if (d > 120) continue;
      const talking = game.dialogue?.npc?.id === n.id;
      if (talking) {
        // turn to face the player
        const face = Math.atan2(p.z - n.spot.z, p.x - n.spot.x);
        s.model.root.rotation.y += ((-face) - s.model.root.rotation.y) * Math.min(1, dt * 4);
      }
      const pose = n.spot.pose === 'sit' ? 'sit' : (d < 12 && !talking && Math.sin(game.elapsed * 0.3 + s.phase) > 0.97 ? 'wave' : 'stand');
      s.anim.setState(pose);
      s.anim.update(dt);
    }
  }

  spawn(npc, settlement) {
    const model = new CharacterModel(npc.look);
    if (!npc.hasHat) model.hatMesh.visible = false;
    const anim = new CharacterAnimator(model);
    const y = npc.spot.y ?? settlement.y;
    model.root.position.set(npc.spot.x, y, npc.spot.z);
    model.root.rotation.y = -(npc.spot.angle ?? 0);
    model.root.scale.setScalar(0.92 + (npc.seed % 100) / 100 * 0.16);
    this.game.worldRoot.add(model.root);
    this.spawned.set(npc.id, { npc, model, anim, phase: (npc.seed % 628) / 100 });
  }

  /** Interaction provider: talk to nearby residents. */
  interactables(game, p) {
    const out = [];
    for (const s of this.spawned.values()) {
      const n = s.npc;
      const verb = n.role === 'trader' ? 'Trade with' : n.role === 'shipwright' ? 'Visit' : 'Talk to';
      out.push({ id: n.id, x: n.spot.x, z: n.spot.z, range: game.onFoot ? 3.5 : 9, label: `${n.name} (${npcData.roles[n.role]?.title ?? 'Villager'})`, verb, priority: 1, action: () => game.dialogue.open(n) });
    }
    return out;
  }

  /** A line for idle chatter. */
  static idleLine(npc, rng = Math.random) {
    const story = npc.storyKey ? storyData.npcs[npc.storyKey] : null;
    const pool = story?.idle ?? npcData.roles[npc.role]?.idle ?? npcData.roles.villager.idle;
    return pool[Math.floor(rng() * pool.length)];
  }

  static greeting(npc, ctx) {
    const pool = npcData.roles[npc.role]?.greet ?? npcData.roles.villager.greet;
    const line = pool[Math.floor(Math.random() * pool.length)];
    return line.replaceAll('{settlement}', ctx.settlementName ?? 'here');
  }
}

export { npcData };
