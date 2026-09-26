// Boat dynamics (pure logic, fixed timestep, unit-testable).
// Planar rigid body (x, z, yaw) with keel-like anisotropic drag relative to
// the moving water, rowing-stroke thrust, wind, bank collisions from terrain
// sampling, circle/box colliders, shallow-water drag, and a spring-damper
// vertical model (heave/pitch/roll) driven by the shared wave function.
import { clamp, wrapAngle } from '../core/math.js';
import { waveHeight } from '../water/Waves.js';

export const PROPULSION = {
  oars: { name: 'Oars', thrust: 1400, maxSpeed: 4.2, strokeRate: 0.9, pulsed: true, turnTorque: 900 },
  sculling: { name: 'Sculling Oars', thrust: 1650, maxSpeed: 5.0, strokeRate: 1.0, pulsed: true, turnTorque: 1000 },
  sail: { name: 'Sail & Oars', thrust: 1650, maxSpeed: 5.0, strokeRate: 1.0, pulsed: true, turnTorque: 1000, sail: 1 },
  paddlewheel: { name: 'Clockwork Paddle', thrust: 2100, maxSpeed: 7.0, strokeRate: 0, pulsed: false, turnTorque: 1200, sail: 1 },
};

export class BoatPhysics {
  /**
   * @param env { heightAt(x,z), water(x,z,out) -> {level, s, t, edge, depth}, flowAt(x,z,out), colliders(x,z,r) -> [], waveAmpAt(s) }
   */
  constructor(env, opts = {}) {
    this.env = env;
    this.mass = opts.mass ?? 420;
    this.inertia = opts.inertia ?? 900;
    this.length = 4.2;
    this.beam = 1.45;
    this.draft = 0.32;
    this.x = opts.x ?? 0;
    this.z = opts.z ?? 0;
    this.heading = opts.heading ?? 0; // angle in x/z plane, forward = (cos, sin)
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.y = 0; this.vy = 0;
    this.pitch = 0; this.pitchVel = 0;
    this.roll = 0; this.rollVel = 0;
    this.propulsion = PROPULSION.oars;
    this.hullLevel = 1;
    this.stroke = 0; // 0..1 rowing cycle
    this.strokeActive = false;
    this.throttle = 0; this.steer = 0; this.hurry = false; this.brake = false;
    this.cruise = 0; // paddlewheel cruise speed setting 0..1
    this.wind = { x: 0, z: 0 };
    this.waveScale = 1;
    this.time = 0;
    this.collision = { hit: false, impulse: 0, grounded: false, point: null };
    this.anchored = false;
    this.events = [];
    this._w = {}; this._f = { x: 0, z: 0, speed: 0 };
    this.acc = 0;
    this.waterLevel = 0;
    this.s = 0; this.t = 0;
    this.rapids = 0;
  }

  setPropulsion(id) {
    this.propulsion = PROPULSION[id] ?? PROPULSION.oars;
    this.propulsionId = id;
  }

  get forwardX() { return Math.cos(this.heading); }
  get forwardZ() { return Math.sin(this.heading); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  /** Signed speed along the boat's forward axis. */
  get forwardSpeed() { return this.vx * this.forwardX + this.vz * this.forwardZ; }

  setInput({ throttle = 0, steer = 0, hurry = false, brake = false }) {
    this.throttle = clamp(throttle, -1, 1);
    this.steer = clamp(steer, -1, 1);
    this.hurry = hurry;
    this.brake = brake;
  }

  /** Advance with a fixed internal step (1/60 s). */
  update(dt) {
    this.acc = Math.min(this.acc + dt, 0.25);
    const h = 1 / 60;
    while (this.acc >= h) {
      this.step(h);
      this.acc -= h;
    }
  }

  step(dt) {
    this.time += dt;
    const env = this.env;
    const fx = this.forwardX, fz = this.forwardZ;
    const rx = -fz, rz = fx; // right/left lateral axis (left of forward in x/z)
    const w = env.water(this.x, this.z, this._w);
    this.waterLevel = w.level;
    this.s = w.s; this.t = w.t;
    const flow = env.flowAt(this.x, this.z, this._f);
    this.rapids = w.rapids ?? 0;

    // ---- propulsion
    const P = this.propulsion;
    let thrust = 0;
    const input = this.anchored ? 0 : this.throttle;
    const effort = this.hurry ? 1.3 : 1;
    if (P.pulsed) {
      const rowing = Math.abs(input) > 0.05 || Math.abs(this.steer) > 0.05;
      if (rowing) {
        const rate = P.strokeRate * (0.75 + 0.35 * Math.abs(input)) * effort;
        this.stroke = (this.stroke + dt * rate) % 1;
        this.strokeActive = true;
      } else if (this.strokeActive) {
        // finish the current stroke gracefully
        this.stroke += dt * P.strokeRate;
        if (this.stroke >= 1) { this.stroke = 0; this.strokeActive = false; }
      }
      // Drive phase of the stroke produces thrust (smooth pulse).
      const ph = this.stroke;
      const drive = ph < 0.5 ? Math.sin((ph / 0.5) * Math.PI) : 0;
      thrust = P.thrust * drive * 1.75 * input * effort;
      if (this.strokeActive && this._lastPh !== undefined && this._lastPh < 0.05 && ph >= 0.05 && Math.abs(input) > 0.05) this.events.push({ type: 'oarDip' });
      this._lastPh = ph;
    } else {
      const target = this.cruise > 0 && Math.abs(input) < 0.05 ? this.cruise : input;
      thrust = P.thrust * target * effort;
      this.stroke = (this.stroke + dt * Math.abs(target) * 1.8) % 1;
    }
    // Sail: wind force projected on the heading (points of sail).
    if (P.sail) {
      const ws = Math.hypot(this.wind.x, this.wind.z);
      if (ws > 0.05) {
        const cosA = (this.wind.x * fx + this.wind.z * fz) / ws;
        const eff = cosA > -0.5 ? 0.35 + 0.65 * Math.sin(Math.acos(Math.max(-1, Math.min(1, cosA))) * 0.9 + 0.3) : 0;
        thrust += eff * ws * 120 * P.sail;
      }
    }

    // ---- hydrodynamic drag relative to moving water
    const relX = this.vx - flow.x, relZ = this.vz - flow.z;
    const u = relX * fx + relZ * fz; // forward component
    const v = relX * rx + relZ * rz; // lateral component
    const shallow = w.depth < this.draft + 0.25 ? Math.min(1, (this.draft + 0.25 - w.depth) / 0.4) : 0;
    const cf = 18 + 55 * shallow + (this.brake ? 260 : 0);
    const cl = 420 + 300 * shallow;
    const dragU = -(cf * u + 14 * u * Math.abs(u));
    const dragV = -(cl * v + 160 * v * Math.abs(v));
    let Fx = fx * (thrust + dragU) + rx * dragV;
    let Fz = fz * (thrust + dragU) + rz * dragV;
    // Speed limiter keeps top speed in the designed range.
    const fs = this.forwardSpeed;
    const vmax = P.maxSpeed * effort;
    if (fs > vmax) { Fx -= fx * (fs - vmax) * 900; Fz -= fz * (fs - vmax) * 900; }

    // Wind pushes the hull (and canvas awning) slightly.
    Fx += this.wind.x * 22; Fz += this.wind.z * 22;

    // ---- steering: differential rowing / rudder
    const steerTorque = this.anchored ? 0 : this.steer * P.turnTorque * (0.55 + 0.45 * Math.min(1, Math.abs(u) / 2.5)) * effort;
    const yawDamp = -this.yawRate * (650 + 900 * shallow) - this.yawRate * Math.abs(this.yawRate) * 500;
    // Current shear rotates the boat gently (weather-vaning with the flow).
    const flowTorque = (flow.x * rx + flow.z * rz) * -40;
    this.yawRate += ((steerTorque + yawDamp + flowTorque) / this.inertia) * dt;
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    this.vx += (Fx / this.mass) * dt;
    this.vz += (Fz / this.mass) * dt;
    if (this.anchored) { this.vx *= 0.97; this.vz *= 0.97; }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.resolveCollisions(dt);
    this.updateVertical(dt, w);
  }

  /** Hull outline sample points in world space. */
  hullPoints() {
    const fx = this.forwardX, fz = this.forwardZ, rx = -fz, rz = fx;
    const L = this.length * 0.5, B = this.beam * 0.5;
    const local = [[L, 0], [L * 0.6, B * 0.8], [L * 0.6, -B * 0.8], [0, B], [0, -B], [-L * 0.7, B * 0.85], [-L * 0.7, -B * 0.85], [-L, 0]];
    return local.map(([a, b]) => ({ x: this.x + fx * a + rx * b, z: this.z + fz * a + rz * b }));
  }

  resolveCollisions(dt) {
    const env = this.env;
    this.collision.hit = false;
    this.collision.impulse = 0;
    this.collision.grounded = false;
    const level = this.waterLevel;
    let pushX = 0, pushZ = 0, count = 0, maxPen = 0;
    for (const p of this.hullPoints()) {
      const h = env.heightAt(p.x, p.z);
      const pen = h - (level - this.draft);
      if (pen > 0) {
        // Push down-slope (towards deeper water).
        const e = 0.6;
        const gx = env.heightAt(p.x + e, p.z) - env.heightAt(p.x - e, p.z);
        const gz = env.heightAt(p.x, p.z + e) - env.heightAt(p.x, p.z - e);
        const gl = Math.hypot(gx, gz) || 1;
        pushX -= (gx / gl) * pen; pushZ -= (gz / gl) * pen;
        count++;
        maxPen = Math.max(maxPen, pen);
      }
    }
    // Static colliders (docks, rock pillars, arches...).
    const cols = env.colliders ? env.colliders(this.x, this.z, 6) : [];
    for (const c of cols) {
      for (const p of this.hullPoints()) {
        let nx = 0, nz = 0, pen = 0;
        if (c.type === 'circle') {
          const dx = p.x - c.x, dz = p.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < c.r) { pen = c.r - d; nx = dx / (d || 1); nz = dz / (d || 1); }
        } else if (c.type === 'box') {
          const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
          const dx = p.x - c.x, dz = p.z - c.z;
          const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
          if (Math.abs(lx) < c.hl && Math.abs(lz) < c.hw) {
            const px = c.hl - Math.abs(lx), pz = c.hw - Math.abs(lz);
            if (px < pz) { pen = px; const s = Math.sign(lx) || 1; nx = ca * s; nz = sa * s; }
            else { pen = pz; const s = Math.sign(lz) || 1; nx = -sa * s; nz = ca * s; }
          }
        }
        if (pen > 0) { pushX += nx * pen * 2; pushZ += nz * pen * 2; count++; maxPen = Math.max(maxPen, pen); }
      }
    }
    if (count > 0) {
      const pl = Math.hypot(pushX, pushZ) || 1;
      const nx = pushX / pl, nz = pushZ / pl;
      const corr = Math.min(0.25, maxPen * 0.6);
      this.x += nx * corr; this.z += nz * corr;
      // Remove velocity into the obstacle, keep a sliding component (with friction).
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        this.vx -= vn * nx * 1.25; this.vz -= vn * nz * 1.25;
        this.collision.impulse = -vn;
        this.collision.hit = true;
        if (-vn > 0.6) this.events.push({ type: 'bump', strength: Math.min(1, -vn / 3) });
      }
      this.vx *= 0.985; this.vz *= 0.985;
      this.yawRate *= 0.9;
      this.collision.grounded = maxPen > 0.05;
      this.collision.normal = { x: nx, z: nz };
    }
  }

  updateVertical(dt, w) {
    const env = this.env;
    const amp = (env.waveAmpAt ? env.waveAmpAt(w.s, w.t) : 0.05) * this.waveScale * (1 + (w.rapids ?? 0) * 3);
    const t = this.time;
    const fx = this.forwardX, fz = this.forwardZ;
    // Wave height at bow, stern, port, starboard in river coordinates.
    const L = this.length * 0.4, B = this.beam * 0.45;
    const ds = w.dirS ?? 1; // projection of boat forward onto +s
    const dtl = w.dirT ?? 0;
    const hb = waveHeight(w.s + ds * L, w.t + dtl * L, t, amp);
    const hs = waveHeight(w.s - ds * L, w.t - dtl * L, t, amp);
    const hp = waveHeight(w.s - dtl * B, w.t + ds * B, t, amp);
    const hsb = waveHeight(w.s + dtl * B, w.t - ds * B, t, amp);
    const surf = (hb + hs + hp + hsb) * 0.25;
    // Rapids add some chop.
    const chop = (w.rapids ?? 0) * (Math.sin(t * 7.1 + this.x) * 0.05 + Math.sin(t * 11.3 + this.z) * 0.03);
    const targetY = w.level + surf + chop - 0.02;
    const k = 38, c = 9;
    this.vy += (-(this.y - targetY) * k - this.vy * c) * dt;
    this.y += this.vy * dt;
    if (!Number.isFinite(this.y) || Math.abs(this.y - targetY) > 5) { this.y = targetY; this.vy = 0; }
    const targetPitch = Math.atan2(hb - hs, 2 * L) - this.forwardSpeed * 0.012 + (this.collision.grounded ? 0.02 : 0);
    // Lean into turns (centripetal) and a slight sway from rowing.
    const sway = this.strokeActive ? Math.sin(this.stroke * Math.PI * 2) * 0.012 : 0;
    const targetRoll = Math.atan2(hp - hsb, 2 * B) + this.yawRate * this.forwardSpeed * -0.05 + sway;
    this.pitchVel += (-(this.pitch - targetPitch) * 30 - this.pitchVel * 6) * dt;
    this.rollVel += (-(this.roll - targetRoll) * 24 - this.rollVel * 4.5) * dt;
    this.pitch += this.pitchVel * dt;
    this.roll += this.rollVel * dt;
    this.pitch = clamp(this.pitch, -0.35, 0.35);
    this.roll = clamp(this.roll, -0.4, 0.4);
    void fx; void fz;
  }

  /** Stern position (for wake). */
  stern(out = {}) {
    out.x = this.x - this.forwardX * this.length * 0.5;
    out.z = this.z - this.forwardZ * this.length * 0.5;
    return out;
  }

  serialize() {
    return { x: this.x, z: this.z, heading: this.heading };
  }

  restore(d) {
    if (!d) return;
    this.x = d.x; this.z = d.z; this.heading = d.heading ?? 0;
    this.vx = this.vz = this.yawRate = 0;
    this.y = this.env.water(this.x, this.z, {}).level;
    this.vy = 0;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
