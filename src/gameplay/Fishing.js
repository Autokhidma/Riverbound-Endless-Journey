// Fishing activity: ready the rod, cast (aim with the camera, hold to charge),
// wait for a bite, strike, then reel with a relaxed minigame. Species depend on
// biome, habitat, time, weather, rod, bait, fishing spots and events.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { rollCatch, biteDelay, ReelGame } from './FishingLogic.js';
import { ITEMS, FISH } from './GameState.js';
import { noReflect } from '../render/layers.js';
import { BIOMES } from '../world/biomes.js';

export class Fishing {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.rng = new RNG((Date.now() & 0xffffff) + 7);
    this.power = 0;
    this.bobber = new THREE.Group();
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8402a, roughness: 0.5 }));
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.5 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 4), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    stick.position.y = 0.1;
    this.bobber.add(b1, b2, stick);
    this.bobber.visible = false;
    game.scene.add(this.bobber);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e4d8, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    noReflect(this.line);
    game.scene.add(this.line);
    this.bob = { x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, flying: false };
    this.timer = 0;
    this.reel = null;
    this.catchInfo = null;
    this.message = null;
    this.eventBoost = null;
  }

  get active() {
    return this.state !== 'idle';
  }

  canFish() {
    const g = this.game;
    return g.session?.state?.story?.flags?.includes('canFish') || g.session?.state?.mode === 'free' || g.session?.state?.story?.chapter > 1 || !g.session?.storyEnabled;
  }

  toggle() {
    if (this.state === 'idle') {
      if (!this.canFish()) { this.game.events.emit('toast', { text: 'You should ask someone about fishing first.' }); return; }
      if (this.game.onFoot) { this.game.events.emit('toast', { text: 'Fishing is best from the boat.' }); return; }
      this.state = 'ready';
      this.game.pilot.enabled = false;
      this.game.events.emit('fishing:state', { state: 'ready' });
    } else this.cancel();
  }

  cancel(msg) {
    this.state = 'idle';
    this.bobber.visible = false;
    this.line.visible = false;
    this.reel = null;
    this.game.characterAction = null;
    this.game.characterModel.rod.visible = false;
    if (msg) this.game.events.emit('toast', { text: msg });
    this.game.events.emit('fishing:state', { state: 'idle' });
  }

  context(x, z) {
    const g = this.game;
    const world = g.world;
    const bl = world.biomeAt(x, z);
    const smp = world.sample(x, z, {});
    const biomes = [...new Set([bl.a.id, bl.b.id, BIOMES[smp.a].id, BIOMES[smp.b].id])];
    // Habitat from nearby fishing spot or river state.
    let habitat = 'river', spotQuality = 0.6;
    const spots = world.featuresNear(x, z, 20, ['fishingSpot']);
    let spot = null;
    for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < s.radius) { spot = s; break; }
    if (spot) { habitat = spot.habitat; spotQuality = spot.quality; }
    else {
      if (smp.riverKind === 'trib') {
        const T = world.tributaryById(smp.tribId);
        if (T?.biomeOverride === 'starwater') { habitat = 'starwater'; biomes.push('starwater'); }
        const n = T ? T.nearest(x, z, {}) : null;
        if (T && n && n.s > T.length - 300) habitat = T.endType === 'lake' || T.endType === 'starwater' ? 'lake' : 'pool';
      } else {
        const r = world.main.sample(smp.s, {});
        if (r.lk > 0.35) habitat = 'lake';
        else if (r.rp > 0.2) habitat = 'rapids';
        else if (smp.water - smp.height > 4) habitat = 'deep';
      }
      if (smp.sea > 0.4) habitat = 'sea';
    }
    if (smp.riverKind === 'trib' && world.tributaryById(smp.tribId)?.biomeOverride === 'starwater' && !biomes.includes('starwater')) biomes.push('starwater');
    const state = g.session.state;
    const inv = g.session.inventory;
    const night = g.time.nightFactor > 0.5;
    let bait = null;
    if (night && inv.has('glow_bait')) bait = { id: 'glow_bait', ...ITEMS.glow_bait.effect };
    else if (inv.has('bait_worms')) bait = { id: 'bait_worms', ...ITEMS.bait_worms.effect };
    else if (inv.has('glow_bait')) bait = { id: 'glow_bait', ...ITEMS.glow_bait.effect };
    return {
      biomes, habitat, spotQuality, spot, hours: g.time.hours, sunElevation: g.time.sunElevation, weather: g.weather,
      rodTier: state.upgrades.fishing ?? 0, bait, event: this.eventBoost && this.eventBoost.until > g.elapsed && Math.hypot(this.eventBoost.x - x, this.eventBoost.z - z) < 40 ? this.eventBoost : null,
    };
  }

  update(dt, game) {
    if (game.state !== 'playing') return;
    const input = game.input;
    if (game.input.pressed('fish') && !game.ui?.modalOpen && game.cameraRig.mode !== 'photo') this.toggle();
    if (this.state === 'idle') return;
    if (game.onFoot) { this.cancel(); return; }
    const model = game.characterModel;
    model.rod.visible = true;
    const holding = (input.mouse.buttons & 1) === 1 || input.padTrigger(7) > 0.5 || input.keyDown('Space');
    const pressedNow = input.mouse.clicked || input.pressed('interact') || (input.pad && input.padNow[7] && !input.padPrev[7]) || input.pressedKeys.has('Space');
    if (input.pressed('pause') || (input.mouse.rightDown && this.state !== 'reeling')) { this.cancel(); return; }
    const action = { state: 'fish', params: { castPhase: 0, reeling: false, tension: 0 } };
    switch (this.state) {
      case 'ready':
        if (holding && !game.ui?.modalOpen) { this.state = 'charging'; this.power = 0; }
        break;
      case 'charging':
        this.power = Math.min(1, this.power + dt * 0.8);
        action.params.castPhase = 0.05 + this.power * 0.4;
        if (!holding) this.cast();
        break;
      case 'casting': {
        this.castT += dt;
        action.params.castPhase = Math.min(1, 0.5 + this.castT * 1.5);
        const b = this.bob;
        b.vy -= 9.8 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const w = game.world.waterInfo(b.x, b.z, {});
        if (b.y <= w.level) {
          if (w.depth < 0.25) { this.cancel('The line snags on the bank. Try casting over open water.'); return; }
          b.y = w.level;
          this.state = 'waiting';
          this.ctx = this.context(b.x, b.z);
          if (this.ctx.bait) game.session.inventory.remove(this.ctx.bait.id, 1);
          this.timer = biteDelay(this.rng, this.ctx);
          this.nibbles = Math.floor(this.rng.next() * 3);
          game.water?.splash(b.x, b.z, 0.25, 0.6);
          game.events.emit('fishing:land', { x: b.x, z: b.z, spot: !!this.ctx.spot });
        }
        break;
      }
      case 'waiting': {
        this.timer -= dt;
        // Drift slightly with the current.
        const f = game.world.flowAt(this.bob.x, this.bob.z, {});
        this.bob.x += f.x * dt * 0.3; this.bob.z += f.z * dt * 0.3;
        if (this.nibbles > 0 && this.timer < this.nibbles * 1.7 && this.timer > 0.5 && !this.nibbleNow) {
          this.nibbleNow = 0.3; this.nibbles--;
          game.events.emit('fishing:nibble', {});
        }
        if (this.nibbleNow) { this.nibbleNow -= dt; if (this.nibbleNow <= 0) this.nibbleNow = 0; }
        if (this.timer <= 0) {
          this.state = 'bite';
          this.timer = 1.4 + (game.settings.get('accessibility.reduceMotion') ? 0.8 : 0);
          this.pending = rollCatch(this.rng, this.ctx);
          game.water?.splash(this.bob.x, this.bob.z, 0.3, 1.0);
          game.events.emit('fishing:bite', {});
          game.camera?.addShake(0.2);
        }
        break;
      }
      case 'bite':
        this.timer -= dt;
        if (pressedNow) this.startReel();
        else if (this.timer <= 0) { this.state = 'ready'; this.bobber.visible = false; this.line.visible = false; game.events.emit('toast', { text: 'Too slow. The fish slipped away.' }); }
        break;
      case 'reeling': {
        const r = this.reel;
        const res = r.update(dt, holding);
        action.params.reeling = true;
        action.params.tension = r.fishInZone ? 0.2 : 0.7;
        // Bobber gets pulled around.
        this.bob.x += (Math.sin(game.elapsed * 3) * 0.4) * dt;
        const toBoat = { x: game.boat.physics.x - this.bob.x, z: game.boat.physics.z - this.bob.z };
        const dl = Math.hypot(toBoat.x, toBoat.z);
        if (dl > 2) { this.bob.x += (toBoat.x / dl) * dt * r.progress * 1.2; this.bob.z += (toBoat.z / dl) * dt * r.progress * 1.2; }
        if (Math.random() < dt * 4) game.water?.splash(this.bob.x, this.bob.z, 0.25, 0.4);
        if (res === 'caught') this.land();
        else if (res === 'escaped') { this.state = 'ready'; this.bobber.visible = false; this.line.visible = false; game.events.emit('fishing:escaped', {}); game.events.emit('toast', { text: 'It got away. There will be others.' }); }
        break;
      }
      case 'result':
        this.timer -= dt;
        if (this.timer <= 0 || pressedNow) { this.state = 'ready'; this.catchInfo = null; }
        break;
      default:
        break;
    }
    game.characterAction = action;
    this.updateVisuals(dt, game);
  }

  cast() {
    const g = this.game;
    const cam = g.camera3;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(Math.cos(g.boat.physics.heading), 0, Math.sin(g.boat.physics.heading));
    dir.normalize();
    const tip = g.characterModel.rodTip.getWorldPosition(new THREE.Vector3());
    const dist = 5 + this.power * 18;
    const t = 0.9 + this.power * 0.4;
    this.bob.x = tip.x + g.origin.x; this.bob.y = tip.y; this.bob.z = tip.z + g.origin.z;
    this.bob.vx = (dir.x * dist) / t; this.bob.vz = (dir.z * dist) / t;
    const waterY = g.boat.physics.waterLevel;
    this.bob.vy = ((waterY - tip.y) + 0.5 * 9.8 * t * t) / t;
    this.state = 'casting';
    this.castT = 0;
    this.nibbleNow = 0;
    g.events.emit('fishing:cast', { power: this.power });
  }

  startReel() {
    const p = this.pending;
    if (p.junk) {
      this.catchInfo = { junk: p.junk };
      this.land();
      return;
    }
    const relaxed = this.game.settings.get('accessibility.reduceMotion') || this.game.settings.get('gameplay.relaxedFishing');
    this.reel = new ReelGame(this.rng, { difficulty: p.species.difficulty, rodTier: this.game.session.state.upgrades.fishing ?? 0, relaxed });
    this.state = 'reeling';
    this.game.events.emit('fishing:reel', { species: p.species.id });
  }

  land() {
    const g = this.game;
    const p = this.pending;
    const session = g.session;
    this.state = 'result';
    this.timer = 3.5;
    this.bobber.visible = false;
    this.line.visible = false;
    if (p.junk) {
      const added = session.inventory.add(p.junk, 1);
      this.catchInfo = { name: ITEMS[p.junk]?.name ?? p.junk, junk: true, kept: added > 0 };
      g.events.emit('fishing:junk', { id: p.junk });
      if (p.junk === 'message_bottle') g.events.emit('lore:bottle', {});
      return;
    }
    const sp = p.species;
    const added = session.inventory.add(sp.id, 1, { size: p.size });
    this.catchInfo = { id: sp.id, name: sp.name, size: p.size, rarity: sp.rarity, desc: sp.desc, kept: added > 0, value: sp.value };
    session.state.stats.fishCaught++;
    g.events.emit('fish:caught', { id: sp.id, size: p.size, rarity: sp.rarity, kept: added > 0, habitat: this.ctx.habitat, x: this.bob.x, z: this.bob.z });
    if (!added) g.events.emit('toast', { text: 'Your storage is full, so you let it go. The river will keep it safe.' });
    g.water?.splash(this.bob.x, this.bob.z, 0.4, 1.2);
  }

  updateVisuals(dt, game) {
    const o = game.origin;
    const tip = game.characterModel.rodTip.getWorldPosition(new THREE.Vector3());
    const showBob = ['casting', 'waiting', 'bite', 'reeling'].includes(this.state);
    this.bobber.visible = showBob;
    this.line.visible = showBob;
    if (!showBob) return;
    let by = this.bob.y;
    if (this.state === 'waiting' || this.state === 'bite' || this.state === 'reeling') {
      by = game.world.waterInfo(this.bob.x, this.bob.z, {}).level + Math.sin(game.elapsed * 2.2) * 0.02;
      if (this.nibbleNow > 0) by -= 0.05;
      if (this.state === 'bite') by -= 0.12 + Math.sin(game.elapsed * 30) * 0.03;
      if (this.state === 'reeling') by -= 0.08;
    }
    this.bobber.position.set(this.bob.x - o.x, by, this.bob.z - o.z);
    // Sagging line from rod tip to bobber.
    const pos = this.line.geometry.attributes.position;
    const n = pos.count;
    const sag = this.state === 'reeling' ? 0.05 : this.state === 'casting' ? 0.1 : 0.6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = tip.x + (this.bobber.position.x - tip.x) * t;
      const z = tip.z + (this.bobber.position.z - tip.z) * t;
      const y = tip.y + (by + 0.12 - tip.y) * t - Math.sin(t * Math.PI) * sag;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }

  /** Data for the fishing UI. */
  uiState() {
    return { state: this.state, power: this.power, reel: this.reel && { zone: this.reel.zone, zoneSize: this.reel.zoneSize, fish: this.reel.fish, progress: this.reel.progress, inZone: this.reel.fishInZone }, catchInfo: this.catchInfo, bite: this.state === 'bite' };
  }
}

export { FISH };
