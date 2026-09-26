// PlayerBoat: glues boat physics to the world (terrain, water, flow,
// colliders), drives the boat + seated character visuals, lantern and wake.
import * as THREE from 'three';
import { BoatPhysics } from './BoatPhysics.js';
import { BoatModel, BOAT_DIMENSIONS } from './BoatModel.js';
import { smoothstep } from '../core/math.js';

export class PlayerBoat {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.world = world;
    const tmpS = {}, tmpR = {}, tmpT = {};
    const self = this;
    this.env = {
      heightAt: (x, z) => world.heightAt(x, z),
      water(x, z, out) {
        const smp = world.sample(x, z, tmpS);
        out.level = smp.water;
        out.depth = smp.water - smp.height;
        out.edge = smp.edge;
        let h;
        if (smp.riverKind === 'trib' && smp.tribId) {
          const T = world.tributaryById(smp.tribId);
          const n = T.nearest(x, z, tmpT);
          const ts = T.sample(n.s, tmpR);
          out.s = n.s; out.t = n.t; h = ts.h; out.rapids = 0;
        } else {
          const rs = world.main.sample(smp.s, tmpR);
          out.s = smp.s; out.t = smp.t; h = rs.h; out.rapids = rs.rp;
        }
        const H = self.physics ? self.physics.heading : 0;
        out.dirS = Math.cos(H - h);
        out.dirT = Math.sin(H - h);
        out.sea = smp.sea;
        return out;
      },
      flowAt: (x, z, out) => world.flowAt(x, z, out),
      colliders: (x, z, r) => game.collidersNear(x, z, r),
      waveAmpAt: () => self.waveAmp,
    };
    this.physics = new BoatPhysics(this.env);
    this.model = new BoatModel();
    game.worldRoot.add(this.model.group);
    this.lanternOn = false;
    this.lanternLevel = 0;
    this.waveAmp = 0.05;
    this.stern = {};
    this.prevSpeed = 0;
    this.rowing = false;
    this.seat = new THREE.Group();
    this.seat.position.set(BOAT_DIMENSIONS.rowerX, BOAT_DIMENSIONS.seatHeight, 0);
    this.model.hullGroup.add(this.seat);
    this._v = new THREE.Vector3();
    this._hL = new THREE.Vector3();
    this._hR = new THREE.Vector3();
    this.splashTimer = 0;
  }

  placeAt(x, z, heading) {
    const p = this.physics;
    p.x = x; p.z = z; p.heading = heading;
    p.vx = p.vz = p.yawRate = 0;
    const w = this.env.water(x, z, {});
    p.y = w.level; p.vy = 0;
    p.pitch = p.roll = p.pitchVel = p.rollVel = 0;
    this.game.water?.wake.clear();
  }

  /** Seat the character in the boat. */
  seatCharacter(character) {
    this.seat.add(character.model.root);
    character.model.root.position.set(0, 0, 0);
    character.model.root.rotation.set(0, 0, 0);
  }

  update(dt, control) {
    const p = this.physics;
    const game = this.game;
    // Wave amplitude at the boat (biome * weather) - same inputs as the shader.
    const bl = this.world.biomeAt(p.x, p.z);
    this.waveAmp = bl.a.water.waveAmp + (bl.b.water.waveAmp - bl.a.water.waveAmp) * bl.t;
    p.waveScale = game.water ? game.water.material.uniforms.uWaveScale.value : 1;
    p.wind.x = game.weather?.windX ?? 0;
    p.wind.z = game.weather?.windZ ?? 0;
    p.setInput(control);
    p.update(dt);
    for (const e of p.drainEvents()) {
      if (e.type === 'bump') {
        game.camera?.addShake(0.6 * e.strength);
        game.events.emit('boat:bump', e);
      } else if (e.type === 'oarDip') {
        game.events.emit('boat:oar', {});
        for (const o of this.model.oars) {
          const tip = this.model.oarTipWorld(o, this._v);
          // convert scene -> absolute
          game.water?.splash(tip.x + game.origin.x, tip.z + game.origin.z, 0.35, 0.9);
        }
      }
    }
    this.rowing = p.strokeActive && p.propulsion.pulsed;
    // Lantern fades in/out.
    this.lanternLevel += ((this.lanternOn ? 1 : 0) - this.lanternLevel) * (1 - Math.exp(-dt * 3));
  }

  /** Sync visuals to physics state (scene coordinates via floating origin). */
  syncVisuals(dt) {
    const p = this.physics;
    const o = this.game.origin;
    const g = this.model.group;
    g.position.set(p.x, p.y, p.z); // under worldRoot (absolute coords)
    g.rotation.set(0, -p.heading, 0);
    const accel = (p.forwardSpeed - this.prevSpeed) / Math.max(dt, 1e-3);
    this.prevSpeed = p.forwardSpeed;
    this.model.update({
      dt, stroke: p.stroke, rowing: this.rowing || (p.strokeActive && p.propulsion.pulsed),
      steerBias: p.steer, pitch: p.pitch, roll: p.roll, rollVel: p.rollVel, pitchVel: p.pitchVel, yawRate: p.yawRate,
      speed: p.speed, lanternLevel: this.lanternLevel, windStrength: Math.hypot(p.wind.x, p.wind.z) / 6, accel,
    });
    void o;
  }

  /** Oar handle positions in world space for the rower's hands. */
  handTargets() {
    const m = this.model;
    const L = m.handleLocal(m.oars[0], this._hL);
    const R = m.handleLocal(m.oars[1], this._hR);
    m.hullGroup.localToWorld(L);
    m.hullGroup.localToWorld(R);
    return { L, R };
  }

  /** Data for the water system (absolute coordinates). */
  wakeInfo() {
    const p = this.physics;
    p.stern(this.stern);
    return {
      x: p.x, z: p.z, heading: p.heading, speed: p.speed, heaveVel: p.vy,
      sternX: this.stern.x, sternZ: this.stern.z, waterY: p.waterLevel, dirX: p.forwardX, dirZ: p.forwardZ,
    };
  }

  get nightLanternHint() {
    return smoothstep(0.3, 0.7, this.game.time?.nightFactor ?? 0);
  }
}
