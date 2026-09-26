// Procedural events chosen contextually (biome, time of day, place) with
// cooldowns, so the river keeps surprising you without scripted pacing.
import * as THREE from 'three';
import eventData from '../data/events.json' with { type: 'json' };
import loreData from '../data/lore.json' with { type: 'json' };
import { RNG } from '../core/rng.js';
import { CharacterModel } from '../character/CharacterModel.js';
import { CharacterAnimator } from '../character/CharacterAnimator.js';
import { buildLandmark } from '../world/LandmarkBuilder.js';

export const EVENTS = eventData.events;

export class EventDirector {
  constructor(game) {
    this.game = game;
    this.rng = new RNG((Date.now() & 0xffff) + 99);
    this.timer = 45;
    this.cooldowns = {};
    this.active = [];
    this.root = new THREE.Group();
    this.root.name = 'events';
    game.worldRoot.add(this.root);
  }

  onWorldDispose() {
    for (const e of this.active) this.end(e, true);
    this.active = [];
  }

  eligible(def, game) {
    if ((this.cooldowns[def.id] ?? 0) > game.elapsed) return false;
    if (this.active.some((a) => a.def.id === def.id)) return false;
    const biome = game.currentBiome?.id;
    if (!def.biomes.includes('any') && !def.biomes.includes(biome)) return false;
    const t = game.time;
    if (def.time === 'day' && t.sunElevation < 5) return false;
    if (def.time === 'night' && t.sunElevation > -8) return false;
    if (def.time === 'dusk' && !(t.hours > 16 && t.sunElevation < 14 && t.sunElevation > -6)) return false;
    if (def.time === 'dawn' && !(t.hours < 11 && t.sunElevation < 14 && t.sunElevation > -6)) return false;
    if (def.where === 'settlement' && !this.nearSettlement(game)) return false;
    if (def.where === 'sky' && game.weather.cloud > 0.7) return false;
    return true;
  }

  nearSettlement(game) {
    return game.content?.spawnedOf('settlement').find((s) => Math.hypot(s.item.x - game.player().x, s.item.z - game.player().z) < 250) ?? null;
  }

  update(dt, game) {
    if (game.state !== 'playing') return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 50 + this.rng.next() * 70;
      const list = EVENTS.filter((d) => this.eligible(d, game));
      if (list.length && this.active.length < 3) {
        const def = this.rng.weighted(list, (d) => d.chance);
        this.start(def, game);
      }
    }
    for (const e of [...this.active]) {
      e.t += dt;
      e.update?.(dt, game, e);
      if (e.t > e.duration || e.done) this.end(e);
    }
  }

  /** Force-start an event by id (console / tests). */
  trigger(id) {
    const def = EVENTS.find((e) => e.id === id);
    if (def) return this.start(def, this.game);
    return null;
  }

  aheadPoint(game, dist, lateral = 0) {
    const p = game.boat.physics;
    const r = game.world.main.sample(p.s + dist, {});
    const t = lateral * (r.w * 0.5);
    return game.world.riverToWorld(p.s + dist, t);
  }

  start(def, game) {
    const e = { def, t: 0, duration: 240, objects: [], interact: null };
    this.cooldowns[def.id] = game.elapsed + def.cooldown;
    const H = this[`start_${def.id}`];
    if (H) H.call(this, e, game);
    this.active.push(e);
    game.events.emit('event:start', { id: def.id, name: def.name });
    game.events.emit('toast', { title: def.name, text: def.desc, kind: 'discovery', life: 6 });
    const j = game.session.state.discoveries;
    (j.events ??= {})[def.id] = (j.events[def.id] ?? 0) + 1;
    return e;
  }

  end(e, silent = false) {
    for (const o of e.objects) this.root.remove(o);
    e.cleanup?.();
    this.active = this.active.filter((a) => a !== e);
    if (!silent) this.game.events.emit('event:end', { id: e.def.id });
  }

  reward(def) {
    const s = this.game.session;
    if (def.reward?.coins) s.inventory.addCoins(def.reward.coins);
    if (def.reward?.items) for (const [id, n] of Object.entries(def.reward.items)) s.inventory.add(id, n);
  }

  // ------------------------------------------------------------ event types
  start_fishRun(e, game) {
    const pt = this.aheadPoint(game, 60, this.rng.range(-0.3, 0.3));
    e.duration = 180;
    game.fishing.eventBoost = { x: pt.x, z: pt.z, until: game.elapsed + 180, biteSpeed: e.def.effect.biteSpeed, rareBonus: e.def.effect.rareBonus };
    e.update = (dt) => { if (Math.random() < dt * 3) game.water?.splash(pt.x + (Math.random() - 0.5) * 16, pt.z + (Math.random() - 0.5) * 16, 0.35, 0.8); };
    e.marker = { x: pt.x, z: pt.z, label: 'Fish run', kind: 'discovery' };
  }

  start_goldenRun(e, game) {
    const pt = this.aheadPoint(game, 50, 0);
    e.duration = 150;
    game.fishing.eventBoost = { x: pt.x, z: pt.z, until: game.elapsed + 150, biteSpeed: 2, legendary: 'sunscale', rareBonus: 2 };
    e.update = (dt) => { if (Math.random() < dt * 2) game.water?.splash(pt.x + (Math.random() - 0.5) * 12, pt.z + (Math.random() - 0.5) * 12, 0.4, 1); };
    e.marker = { x: pt.x, z: pt.z, label: 'Golden rise', kind: 'discovery' };
  }

  spawnNpc(e, x, z, look, pose = 'wave', y = null) {
    const model = new CharacterModel(look);
    const anim = new CharacterAnimator(model);
    const yy = y ?? this.game.world.heightAt(x, z);
    model.root.position.set(x, yy, z);
    model.root.rotation.y = -Math.atan2(this.game.player().z - z, this.game.player().x - x);
    this.root.add(model.root);
    e.objects.push(model.root);
    anim.setState(pose);
    return { model, anim };
  }

  start_stranded(e, game) {
    const side = this.rng.sign();
    const r = game.world.main.sample(game.boat.physics.s + 120, {});
    const pt = game.world.riverToWorld(game.boat.physics.s + 120, side * (r.w * 0.5 + 3));
    const npc = this.spawnNpc(e, pt.x, pt.z, { skin: '#c89a74', hair: '#3a2a1a', shirt: '#d8d0b8', vest: '#8a4a3a', trousers: '#4a4a5a', boots: '#4a3020', scarf: '#3f7f8a', hat: '#6a4a3a', hatBand: '#3a2a1e', satchel: '#6a4a30' }, 'wave');
    const canoe = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 8, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0x8a6a48, side: THREE.DoubleSide }));
    canoe.position.set(pt.x + 2, game.world.heightAt(pt.x + 2, pt.z) + 0.3, pt.z);
    canoe.rotation.z = 0.4;
    this.root.add(canoe);
    e.objects.push(canoe);
    e.duration = 400;
    e.update = (dt) => npc.anim.update(dt);
    e.interact = { x: pt.x, z: pt.z, range: 12, verb: 'Help', label: 'the stranded traveller', action: () => {
      game.events.emit('toast', { title: 'Stranded Traveller', text: 'You patch their canoe with reeds and resin. They insist you take something for your trouble.', kind: 'quest', life: 6 });
      this.reward(e.def);
      e.done = true;
    } };
  }

  start_lostBoat(e, game) {
    const pt = this.aheadPoint(game, 90, this.rng.range(-0.25, 0.25));
    const boat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.6, 8, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0x5a7a8a, side: THREE.DoubleSide }));
    this.root.add(boat);
    e.objects.push(boat);
    const pos = { x: pt.x, z: pt.z };
    const flow = { x: 0, z: 0 };
    e.duration = 300;
    e.update = (dt, g) => {
      g.world.flowAt(pos.x, pos.z, flow);
      pos.x += flow.x * dt; pos.z += flow.z * dt;
      boat.position.set(pos.x, g.world.waterInfo(pos.x, pos.z, {}).level + 0.1, pos.z);
      boat.rotation.y += dt * 0.1;
      if (e.interact) { e.interact.x = pos.x; e.interact.z = pos.z; }
    };
    e.interact = { x: pos.x, z: pos.z, range: 7, verb: 'Tie up', label: 'the drifting boat', action: () => {
      game.events.emit('toast', { title: 'Drifting Boat', text: 'You tie it to the Wren\'s stern. At the next village, its owner is overjoyed to see it.', kind: 'quest', life: 6 });
      this.reward(e.def);
      e.done = true;
    } };
  }

  start_merchant(e, game) {
    const pt = this.aheadPoint(game, 80, this.rng.range(-0.2, 0.2));
    const raft = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 3), new THREE.MeshStandardMaterial({ color: 0x8a6a48 }));
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0xc0573f }));
    tent.position.set(-0.6, 1.2, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.8) }));
    lamp.position.set(1.4, 1.6, 1.2);
    raft.add(deck, tent, lamp);
    this.root.add(raft);
    e.objects.push(raft);
    const w = game.world.waterInfo(pt.x, pt.z, {});
    raft.position.set(pt.x, w.level + 0.1, pt.z);
    const npc = this.spawnNpc(e, pt.x + 0.8, pt.z, { skin: '#b57c56', hair: '#1a1a1a', shirt: '#e0c8b0', vest: '#7a5a8a', trousers: '#3a3a3a', boots: '#4a3020', scarf: '#e0c050', hat: '#3a4a5a', hatBand: '#e0c050', satchel: '#6a4a30' }, 'stand', w.level + 0.25);
    e.duration = 300;
    e.update = (dt, g) => { npc.anim.update(dt); raft.position.y = w.level + 0.1 + Math.sin(g.elapsed * 1.2) * 0.04; };
    const settlement = { id: 'merchant', name: 'Travelling Merchant', biome: 'none', shipwright: false, x: pt.x, z: pt.z };
    e.interact = { x: pt.x, z: pt.z, range: 10, verb: 'Trade with', label: 'the travelling merchant', action: () => game.ui.openTrade({ id: 'merchant', name: 'Travelling Merchant', role: 'trader' }, settlement, { special: true }) };
  }

  start_wisp(e, game) {
    const side = this.rng.sign();
    let hops = 0;
    const r = game.world.main.sample(game.boat.physics.s + 60, {});
    let pt = game.world.riverToWorld(game.boat.physics.s + 60, side * (r.w * 0.5 + 4));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 3.5, 3.2) }));
    this.root.add(orb);
    e.objects.push(orb);
    e.duration = 360;
    e.update = (dt, g) => {
      const y = g.world.heightAt(pt.x, pt.z) + 1.4 + Math.sin(g.elapsed * 2) * 0.3;
      orb.position.lerp(new THREE.Vector3(pt.x, y, pt.z), Math.min(1, dt * 2));
      const p = g.player();
      if (Math.hypot(pt.x - p.x, pt.z - p.z) < 14 && hops < 3) {
        hops++;
        const rr = g.world.main.sample(g.boat.physics.s + 50, {});
        pt = g.world.riverToWorld(g.boat.physics.s + 50, side * (rr.w * 0.5 + 5));
        if (hops === 3) {
          e.interact = { x: pt.x, z: pt.z, range: 9, verb: 'Look at', label: 'what the light left behind', action: () => { this.reward(e.def); g.events.emit('toast', { title: 'Mysterious Light', text: 'The light winks out, leaving a little pile of treasures.', kind: 'story' }); e.done = true; } };
        }
      }
    };
  }

  start_meteorShower(e, game) {
    e.duration = 200;
    game.meteorRate = 12;
    e.cleanup = () => { game.meteorRate = 1; };
  }

  start_aurora(e, game) {
    e.duration = 300;
    e.update = (dt, g) => { g.aurora = Math.min(1, e.t / 20) * Math.min(1, (e.duration - e.t) / 20); };
    e.cleanup = () => { game.aurora = 0; };
  }

  start_glowBloom(e, game) {
    e.duration = 240;
    e.update = (dt, g) => { g.glowEvent = Math.min(1, e.t / 10) * Math.min(1, (e.duration - e.t) / 10); };
    e.cleanup = () => { game.glowEvent = 0; };
  }

  start_festival(e, game) {
    const s = this.nearSettlement(game);
    if (!s) { e.done = true; return; }
    const it = s.item;
    const n = 36;
    const geo = new THREE.SphereGeometry(0.18, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.6) });
    const lanterns = new THREE.InstancedMesh(geo, mat, n);
    lanterns.frustumCulled = false;
    this.root.add(lanterns);
    e.objects.push(lanterns);
    const list = [];
    for (let i = 0; i < n; i++) list.push({ x: it.dock.end.x + (Math.random() - 0.5) * 6, z: it.dock.end.z + (Math.random() - 0.5) * 6, delay: i * 3, alive: false });
    const flow = { x: 0, z: 0 };
    const m = new THREE.Matrix4();
    e.duration = 400;
    e.update = (dt, g) => {
      for (let i = 0; i < n; i++) {
        const L = list[i];
        if (e.t < L.delay) { m.makeTranslation(0, -9999, 0); lanterns.setMatrixAt(i, m); continue; }
        g.world.flowAt(L.x, L.z, flow);
        L.x += flow.x * dt * 0.8 + Math.sin(g.elapsed * 0.4 + i) * dt * 0.2;
        L.z += flow.z * dt * 0.8 + Math.cos(g.elapsed * 0.3 + i) * dt * 0.2;
        const lvl = g.world.waterInfo(L.x, L.z, {}).level;
        m.makeTranslation(L.x, lvl + 0.2 + Math.sin(g.elapsed * 2 + i) * 0.03, L.z);
        lanterns.setMatrixAt(i, m);
      }
      lanterns.instanceMatrix.needsUpdate = true;
    };
  }

  start_race(e, game) {
    const s = game.boat.physics.s;
    const goal = game.world.riverToWorld(s + 450, 0);
    const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0xd8402a, emissive: 0x401008 }));
    buoy.position.set(goal.x, goal.water + 0.4, goal.z);
    this.root.add(buoy);
    e.objects.push(buoy);
    e.duration = 90;
    e.marker = { x: goal.x, z: goal.z, label: 'Race buoy', kind: 'quest' };
    e.update = (dt, g) => {
      const p = g.player();
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 14) {
        g.events.emit('toast', { title: 'You win!', text: `Reached the buoy in ${e.t.toFixed(0)} seconds. The villagers cheer from the bank.`, kind: 'quest' });
        this.reward(e.def);
        e.done = true;
      } else if (e.t > 85) g.events.emit('toast', { text: 'Time\'s up! "Next time," laughs your rival.' });
    };
  }

  start_migration(e, game) {
    e.duration = 60;
    const wl = game.wildlife;
    const p = game.player();
    const flock = { cx: p.x - 200, cz: p.z, y: game.world.heightAt(p.x, p.z) + 45, heading: 0, radius: 400, speed: 12, birds: [], life: 60 };
    for (let i = 0; i < 40; i++) flock.birds.push({ off: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 30), ph: Math.random() * 6 });
    wl?.flocks.push(flock);
  }

  start_bottle(e, game) {
    const pt = this.aheadPoint(game, 50, this.rng.range(-0.3, 0.3));
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0x6aa89a, roughness: 0.1, transparent: true, opacity: 0.8 }));
    bottle.rotation.z = Math.PI / 2;
    this.root.add(bottle);
    e.objects.push(bottle);
    const pos = { x: pt.x, z: pt.z };
    e.duration = 240;
    e.update = (dt, g) => {
      const f = g.world.flowAt(pos.x, pos.z, {});
      pos.x += f.x * dt; pos.z += f.z * dt;
      bottle.position.set(pos.x, g.world.waterInfo(pos.x, pos.z, {}).level + 0.05 + Math.sin(g.elapsed * 1.5) * 0.03, pos.z);
      if (e.interact) { e.interact.x = pos.x; e.interact.z = pos.z; }
    };
    e.interact = { x: pos.x, z: pos.z, range: 6, verb: 'Fish out', label: 'the bottle', action: () => { game.events.emit('lore:bottle', {}); e.done = true; } };
  }

  start_campfire(e, game) {
    const side = this.rng.sign();
    const r = game.world.main.sample(game.boat.physics.s + 90, {});
    const pt = game.world.riverToWorld(game.boat.physics.s + 90, side * (r.w * 0.5 + 6));
    const g = buildLandmark({ type: 'camp', x: pt.x, z: pt.z, y: game.world.heightAt(pt.x, pt.z), angle: r.h }, { world: game.world, quality: game.quality });
    if (g) { this.root.add(g); e.objects.push(g); }
    e.duration = 400;
    e.interact = { x: pt.x, z: pt.z, range: 12, verb: 'Search', label: 'the abandoned campsite', action: () => { this.reward(e.def); game.events.emit('toast', { title: 'Abandoned Campsite', text: 'You find some tea and bait, and a note: "Take what helps. Leave what doesn\'t."', kind: 'story' }); e.done = true; } };
  }

  /** Interaction provider for active events. */
  interactables() {
    return this.active.filter((e) => e.interact && !e.done).map((e) => ({ id: `event:${e.def.id}`, priority: 2, ...e.interact }));
  }

  markers() {
    return this.active.filter((e) => e.marker && !e.done).map((e) => e.marker);
  }

  /** A random bottle message (lore). */
  static bottleText(rng = Math.random) {
    const list = loreData.bottles;
    return list[Math.floor(rng() * list.length)];
  }
}

export { loreData };
