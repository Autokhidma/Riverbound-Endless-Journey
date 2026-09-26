// Stepping ashore: disembark at docks or gentle banks, walk on the terrain
// (and dock planks), talk to people up close, gather plants, then board again.
import * as THREE from 'three';
import { angleDiff, clamp, dampAngle } from '../core/math.js';

export class OnFoot {
  constructor(game) {
    this.game = game;
    this.pos = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.speed = 0;
    this.walkPhase = 0;
    this.dock = null;
  }

  /** Where the player could step ashore from the boat, if anywhere. */
  landingSpot(game) {
    const p = game.boat.physics;
    // Docks.
    for (const s of game.content.spawnedOf('settlement')) {
      const d = s.item.dock;
      if (!d) continue;
      if (Math.hypot(d.end.x - p.x, d.end.z - p.z) < 7) {
        const back = { x: d.end.x - Math.cos(d.angle) * 1.2, z: d.end.z - Math.sin(d.angle) * 1.2 };
        return { x: back.x, z: back.z, y: d.y + 0.12, heading: d.angle + Math.PI, dock: d, label: `the ${s.item.name} dock` };
      }
    }
    // Gentle banks: look sideways from the boat for walkable ground.
    const world = game.world;
    const fx = Math.cos(p.heading), fz = Math.sin(p.heading);
    for (const side of [1, -1]) {
      for (let r = 2; r <= 5; r += 1) {
        const x = p.x - fz * side * r, z = p.z + fx * side * r;
        const w = world.waterInfo(x, z, {});
        if (w.height > w.level + 0.1 && w.height < w.level + 1.6) {
          const slope = Math.abs(world.heightAt(x + 1, z) - w.height) + Math.abs(world.heightAt(x, z + 1) - w.height);
          if (slope < 0.6) return { x, z, y: w.height, heading: p.heading + side * Math.PI / 2, label: 'the bank' };
        }
      }
    }
    return null;
  }

  disembark(spot) {
    const g = this.game;
    g.onFoot = true;
    g.walker = this;
    g.pilot.enabled = false;
    g.boat.physics.anchored = true;
    g.fishing?.active && g.fishing.cancel();
    this.pos = { x: spot.x, y: spot.y, z: spot.z };
    this.heading = spot.heading;
    this.dock = spot.dock ?? null;
    const root = g.characterModel.root;
    g.worldRoot.add(root);
    root.position.set(this.pos.x, this.pos.y, this.pos.z);
    root.scale.setScalar(1);
    g.events.emit('onfoot', { on: true });
    if (g.cameraRig.mode === 'close' || g.cameraRig.mode === 'cinematic') g.cameraRig.setMode('third');
  }

  board() {
    const g = this.game;
    g.onFoot = false;
    g.walker = null;
    g.boat.physics.anchored = false;
    g.characterAction = null;
    g.boat.seatCharacter(g.character);
    g.events.emit('onfoot', { on: false });
  }

  /** Walkable height at a point: dock planks or terrain; null if too deep. */
  groundAt(x, z) {
    const world = this.game.world;
    if (this.dock) {
      const d = this.dock;
      const dx = x - d.x, dz = z - d.z;
      const along = dx * Math.cos(d.angle) + dz * Math.sin(d.angle);
      const across = -dx * Math.sin(d.angle) + dz * Math.cos(d.angle);
      if (along > -3.5 && along < d.length + 0.6 && Math.abs(across) < 1.1) return d.y + 0.12;
    }
    const w = world.waterInfo(x, z, {});
    if (w.height < w.level - 0.45) return null;
    return Math.max(w.height, w.level - 0.45);
  }

  update(dt, game) {
    if (!game.onFoot) return;
    const input = game.input;
    const gameplay = game.state === 'playing' && !game.ui?.modalOpen && game.cameraRig.mode !== 'photo';
    let mx = 0, mz = 0;
    if (gameplay) {
      const mv = input.move();
      mz = mv.throttle; mx = mv.steer;
    }
    // Move relative to the camera.
    const cam = game.camera3;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    let dx = fwd.x * mz + right.x * mx, dz = fwd.z * mz + right.z * mx;
    const len = Math.hypot(dx, dz);
    const run = input.down('hurry');
    const target = len > 0.1 ? (run ? 3.6 : 1.8) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    if (len > 0.1) {
      dx /= len; dz /= len;
      const want = Math.atan2(dz, dx);
      this.heading = dampAngle(this.heading, want, 10, dt);
    }
    if (this.speed > 0.01) {
      const nx = this.pos.x + Math.cos(this.heading) * this.speed * dt;
      const nz = this.pos.z + Math.sin(this.heading) * this.speed * dt;
      const gy = this.groundAt(nx, nz);
      const blocked = gy === null || gy - this.pos.y > 0.9 || this.hitsBuilding(nx, nz);
      if (!blocked) { this.pos.x = nx; this.pos.z = nz; this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12); }
      else this.speed *= 0.5;
    } else {
      const gy = this.groundAt(this.pos.x, this.pos.z);
      if (gy !== null) this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
    }
    this.walkPhase = (this.walkPhase + dt * this.speed * 0.9) % 1;
    const root = game.characterModel.root;
    root.position.set(this.pos.x, this.pos.y, this.pos.z);
    root.rotation.set(0, -this.heading, 0);
    const anim = game.character.anim;
    if (game.characterAction) anim.setState(game.characterAction.state, game.characterAction.params);
    else if (this.speed > 0.2) anim.setState('walk', { speed: this.speed / 1.8, walkPhase: this.walkPhase });
    else anim.setState('stand', {});
    anim.setHandTargets(null, null, 0);
    anim.update(dt);
    if (this.collectAnim) { this.collectAnim -= dt; if (this.collectAnim <= 0) game.characterAction = null; }
  }

  hitsBuilding(x, z) {
    for (const s of this.game.content.spawnedOf('settlement')) {
      const houses = s.group?.userData?.houses;
      if (!houses) continue;
      for (const h of houses) if (Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.55) return true;
    }
    return false;
  }

  playCollect() {
    this.game.characterAction = { state: 'collect', params: { actionT: 0 } };
    this.collectAnim = 1.0;
    const start = performance.now();
    const tick = () => {
      if (!this.game.characterAction || this.game.characterAction.state !== 'collect') return;
      this.game.characterAction.params.actionT = (performance.now() - start) / 1000;
      if (this.collectAnim > 0) requestAnimationFrame(tick);
    };
    tick();
  }

  /** Interaction provider: disembark / board. */
  interactables(game) {
    const out = [];
    if (!game.onFoot) {
      const spot = this.landingSpot(game);
      if (spot) out.push({ id: 'disembark', x: game.boat.physics.x, z: game.boat.physics.z, range: 1, verb: 'Step ashore at', label: spot.label, priority: -1, action: () => this.disembark(spot) });
    } else {
      const p = game.boat.physics;
      out.push({ id: 'board', x: p.x, z: p.z, range: 4.5, verb: 'Board', label: 'the Wren', priority: 1, action: () => this.board() });
    }
    return out;
  }
}

export { clamp, angleDiff };
