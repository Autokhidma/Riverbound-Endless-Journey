// River pilot: the relaxing "cruise" mode. When enabled the boat keeps
// rowing and gently follows the river (downstream or upstream, whichever way
// it is pointing); any manual input overrides it. Also used by automated
// tests and the benchmark fly-through.
import { angleDiff, clamp } from '../core/math.js';

export class RiverPilot {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.level = 0.7;
    this.direction = 1; // +1 downstream, -1 upstream
    this.laneBias = 0;
    this.hurry = false;
    this._t = {};
  }

  toggle(on = !this.enabled) {
    this.enabled = on;
    if (on) {
      const p = this.game.boat.physics;
      const r = this.game.world.main.sample(p.s, {});
      this.direction = Math.cos(p.heading - r.h) >= 0 ? 1 : -1;
    }
    return this.enabled;
  }

  /** Returns a control object; manual input takes priority. */
  control(manual) {
    if (!this.enabled) return manual;
    if (Math.abs(manual.throttle) > 0.1 || Math.abs(manual.steer) > 0.1) {
      this.enabled = false;
      this.game.events.emit('toast', { text: 'Cruise off', kind: 'camera' });
      return manual;
    }
    const g = this.game;
    const p = g.boat.physics;
    const world = g.world;
    const smp = world.sample(p.x, p.z, this._t);
    let target;
    const look = 16 + p.speed * 5;
    if (smp.riverKind === 'trib' && smp.tribId) {
      const T = world.tributaryById(smp.tribId);
      const n = T.nearest(p.x, p.z, {});
      // tributaries: +s is upstream
      const s = clamp(n.s - this.direction * look, 0, T.length);
      target = T.sample(s, {});
      if (this.direction < 0 && n.s > T.length - 40) { this.enabled = false; g.events.emit('toast', { text: 'You reached the end of the stream', kind: 'discovery' }); }
    } else {
      const s = smp.s + this.direction * look;
      const r = world.main.sample(s, {});
      const lane = clamp(smp.t * 0.6 + this.laneBias, -r.w * 0.22, r.w * 0.22);
      target = { x: r.x - Math.sin(r.h) * lane, z: r.z + Math.cos(r.h) * lane };
    }
    const desired = Math.atan2(target.z - p.z, target.x - p.x);
    const err = angleDiff(p.heading, desired);
    const steer = clamp(err * 2.2 - p.yawRate * 0.8, -1, 1);
    const throttle = this.level * (1 - Math.min(0.6, Math.abs(err)));
    return { throttle, steer, hurry: this.hurry, brake: false };
  }
}
