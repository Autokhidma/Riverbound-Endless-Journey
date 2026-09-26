// Camera system with five perspectives and smooth transitions:
//   third (exploration orbit), first (eyes of the traveller), close (low,
//   intimate boat view), cinematic (automatic shot director), photo (free cam).
import * as THREE from 'three';
import { clamp, dampValue, dampAngle, easeInOut, lerp } from '../core/math.js';

export const CAMERA_MODES = ['third', 'first', 'close', 'cinematic'];
export const CAMERA_LABELS = { third: 'Exploration Camera', first: 'First Person', close: 'Close Boat Camera', cinematic: 'Cinematic Camera', photo: 'Photo Mode' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

export class CameraRig {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.mode = 'third';
    this.prevMode = 'third';
    this.pos = new THREE.Vector3(0, 5, 10);
    this.quat = new THREE.Quaternion();
    this.fov = 62;
    // third-person orbit
    this.orbit = { yaw: 0, pitch: 0.28, dist: 9.5, idle: 0, targetDist: 9.5 };
    this.smoothTarget = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.initialized = false;
    // first-person look
    this.fp = { yaw: 0, pitch: -0.05 };
    // close cam
    this.close = { yaw: 0.5, pitch: 0.08 };
    // cinematic director
    this.cine = { shot: null, timer: 0, blend: 1, from: null, pos: new THREE.Vector3(), look: new THREE.Vector3(), anchor: new THREE.Vector3(), index: 0 };
    // photo free cam
    this.photo = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 55, roll: 0 };
    // transition
    this.trans = { t: 1, dur: 0.9, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), fromFov: 62 };
    this.shake = { t: 0, amp: 0 };
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.trans.t = 0;
    this.trans.dur = mode === 'photo' || this.mode === 'photo' ? 0.35 : 0.9;
    this.trans.fromPos.copy(this.camera.position);
    this.trans.fromQuat.copy(this.camera.quaternion);
    this.trans.fromFov = this.camera.fov;
    if (mode === 'photo') {
      this.photo.pos.copy(this.camera.position);
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.photo.yaw = e.y; this.photo.pitch = e.x; this.photo.roll = 0;
      this.photo.fov = this.camera.fov;
    }
    if (mode === 'first') { this.fp.yaw = 0; this.fp.pitch = -0.08; }
    if (mode === 'cinematic') { this.cine.shot = null; this.cine.timer = 0; }
    this.prevMode = this.mode;
    this.mode = mode;
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  addShake(amount) {
    this.shake.amp = Math.max(this.shake.amp, amount);
  }

  /**
   * @param ctx { target: Vector3 (scene), heading, headPos: Vector3, look: {x,y,active}, zoom, speed,
   *              groundAt(x,z) scene coords -> height, waterY, sunDir: Vector3, move: {x,y,z}, fast, rollPitch: {roll,pitch}, onFoot }
   */
  update(dt, ctx) {
    const fovSetting = this.settings.get('graphics.fov') ?? 62;
    let pos = _v, look = null, fov = fovSetting;
    const q = _q;
    switch (this.mode) {
      case 'first': {
        this.fp.yaw = clamp(this.fp.yaw - ctx.look.x, -2.3, 2.3);
        this.fp.pitch = clamp(this.fp.pitch - ctx.look.y, -1.25, 1.2);
        if (!ctx.look.active && ctx.speed > 1.5 && this.settings.get('controls.autoRecenter')) {
          this.fp.yaw = dampValue(this.fp.yaw, 0, 0.35, dt);
        }
        pos.copy(ctx.headPos);
        const shakeScale = this.settings.get('accessibility.cameraShake') ?? 0.6;
        const e = new THREE.Euler(this.fp.pitch + ctx.rollPitch.pitch * 0.5 * shakeScale, -ctx.heading + this.fp.yaw - Math.PI / 2, -ctx.rollPitch.roll * 0.5 * shakeScale, 'YXZ');
        q.setFromEuler(e);
        fov = fovSetting + 10;
        break;
      }
      case 'close': {
        this.close.yaw = clamp(this.close.yaw - ctx.look.x * 0.6, -1.2, 1.2);
        this.close.pitch = clamp(this.close.pitch - ctx.look.y * 0.4, -0.2, 0.5);
        const h = ctx.heading + Math.PI + this.close.yaw;
        const d = 3.1;
        pos.set(ctx.target.x + Math.cos(h) * d, ctx.waterY + 0.75 + this.close.pitch * 2, ctx.target.z + Math.sin(h) * d);
        const sway = Math.sin(performance.now() * 0.0007) * 0.06;
        pos.y += sway;
        look = _v2.set(ctx.target.x + Math.cos(ctx.heading) * 5, ctx.waterY + 0.9, ctx.target.z + Math.sin(ctx.heading) * 5);
        fov = fovSetting + 6;
        break;
      }
      case 'cinematic': {
        this.updateCinematic(dt, ctx);
        pos.copy(this.cine.pos);
        look = _v2.copy(this.cine.look);
        fov = this.cine.fov ?? 48;
        if (ctx.look.active) {
          // player nudges the shot
          this.cine.yawNudge = (this.cine.yawNudge ?? 0) - ctx.look.x;
        }
        break;
      }
      case 'photo': {
        const P = this.photo;
        P.yaw -= ctx.look.x * 0.8;
        P.pitch = clamp(P.pitch - ctx.look.y * 0.8, -1.5, 1.5);
        const speed = (ctx.fast ? 14 : 4) * dt;
        const fwd = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
        const right = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
        P.pos.addScaledVector(fwd, ctx.move.z * speed).addScaledVector(right, ctx.move.x * speed);
        P.pos.y += ctx.move.y * speed;
        // stay near the boat and above ground/water
        const off = P.pos.clone().sub(ctx.target);
        if (off.length() > 300) P.pos.copy(ctx.target).addScaledVector(off.normalize(), 300);
        const g = Math.max(ctx.groundAt(P.pos.x, P.pos.z), ctx.waterY) + 0.3;
        if (P.pos.y < g) P.pos.y = g;
        pos.copy(P.pos);
        q.setFromEuler(new THREE.Euler(P.pitch, P.yaw, P.roll, 'YXZ'));
        fov = P.fov;
        break;
      }
      case 'third':
      default: {
        const O = this.orbit;
        if (ctx.look.active) { O.yaw -= ctx.look.x; O.pitch = clamp(O.pitch + ctx.look.y, -0.25, 1.35); O.idle = 0; }
        else O.idle += dt;
        if (ctx.zoom) O.targetDist = clamp(O.targetDist * (1 + ctx.zoom * 0.12), 3.5, ctx.onFoot ? 12 : 38);
        O.dist = dampValue(O.dist, O.targetDist, 6, dt);
        if (this.settings.get('controls.autoRecenter') && O.idle > 2.5 && ctx.speed > 1.0) {
          O.yaw = dampAngle(O.yaw, 0, 0.6, dt);
          O.pitch = dampValue(O.pitch, 0.28, 0.4, dt);
        }
        const target = _v2.copy(ctx.target);
        target.y += ctx.onFoot ? 1.5 : 1.4;
        if (!this.initialized) { this.smoothTarget.copy(target); this.initialized = true; }
        this.smoothTarget.x = dampValue(this.smoothTarget.x, target.x, 10, dt);
        this.smoothTarget.z = dampValue(this.smoothTarget.z, target.z, 10, dt);
        this.smoothTarget.y = dampValue(this.smoothTarget.y, target.y, 5, dt);
        const yaw = ctx.heading + Math.PI + O.yaw;
        const cp = Math.cos(O.pitch), sp = Math.sin(O.pitch);
        let d = O.dist;
        const dir = new THREE.Vector3(Math.cos(yaw) * cp, sp, Math.sin(yaw) * cp);
        // Terrain occlusion: pull the camera in if the ground blocks the view.
        for (let i = 1; i <= 8; i++) {
          const f = i / 8;
          const px = this.smoothTarget.x + dir.x * d * f, pz = this.smoothTarget.z + dir.z * d * f;
          const py = this.smoothTarget.y + dir.y * d * f;
          const gy = ctx.groundAt(px, pz) + 0.4;
          if (gy > py) { d = Math.max(2.5, d * (f - 0.1)); break; }
        }
        pos.copy(this.smoothTarget).addScaledVector(dir, d);
        const minY = Math.max(ctx.groundAt(pos.x, pos.z) + 0.5, ctx.waterY + 0.45);
        if (pos.y < minY) pos.y = minY;
        look = this.smoothTarget;
        fov = fovSetting;
        break;
      }
    }
    if (look) {
      _m.lookAt(pos, look, THREE.Object3D.DEFAULT_UP);
      q.setFromRotationMatrix(_m);
    }
    // Camera shake (bumps, rapids) scaled by accessibility setting.
    const shakeScale = this.settings.get('accessibility.cameraShake') ?? 0.6;
    this.shake.amp = Math.max(0, this.shake.amp - dt * 1.5);
    const extra = (ctx.rapids ?? 0) * 0.25;
    const amp = (this.shake.amp + extra) * shakeScale * (this.mode === 'photo' ? 0 : 1);
    if (amp > 0.001) {
      this.shake.t += dt;
      const t = this.shake.t;
      const sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 23) * 0.01 * amp, Math.sin(t * 19 + 1) * 0.01 * amp, Math.sin(t * 29 + 2) * 0.006 * amp));
      q.multiply(sq);
    }
    // Transition blend between modes.
    if (this.trans.t < 1) {
      this.trans.t = Math.min(1, this.trans.t + dt / this.trans.dur);
      const w = easeInOut(this.trans.t);
      this.camera.position.lerpVectors(this.trans.fromPos, pos, w);
      this.camera.quaternion.slerpQuaternions(this.trans.fromQuat, q, w);
      this.camera.fov = lerp(this.trans.fromFov, fov, w);
    } else {
      this.camera.position.copy(pos);
      this.camera.quaternion.copy(q);
      this.camera.fov = fov;
    }
    this.camera.near = this.mode === 'first' ? 0.05 : 0.15;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  updateCinematic(dt, ctx) {
    const C = this.cine;
    C.timer -= dt;
    const sunLow = ctx.sunDir.y < 0.25 && ctx.sunDir.y > -0.05;
    if (!C.shot || C.timer <= 0) {
      const shots = ['crane', 'tracking', 'ahead', 'overhead', 'low'];
      if (sunLow) shots.push('sunset', 'sunset');
      if (ctx.sunDir.y < -0.15) shots.push('stars', 'stars');
      let shot = shots[Math.floor(Math.random() * shots.length)];
      if (shot === C.shot?.type) shot = shots[(shots.indexOf(shot) + 1) % shots.length];
      C.shot = { type: shot, side: Math.random() < 0.5 ? -1 : 1, t: 0, seed: Math.random() };
      C.timer = 13 + Math.random() * 9;
      C.anchor.copy(ctx.target);
      C.yawNudge = 0;
      if (shot === 'ahead') {
        const fx = Math.cos(ctx.heading), fz = Math.sin(ctx.heading);
        C.anchor.set(ctx.target.x + fx * 55 + -fz * 14 * C.shot.side, 0, ctx.target.z + fz * 55 + fx * 14 * C.shot.side);
      }
    }
    const S = C.shot;
    S.t += dt;
    const fx = Math.cos(ctx.heading), fz = Math.sin(ctx.heading);
    const rx = -fz, rz = fx;
    const t = ctx.target;
    const desired = new THREE.Vector3();
    const look = new THREE.Vector3(t.x, ctx.waterY + 1.2, t.z);
    let fov = 50;
    switch (S.type) {
      case 'crane': {
        const a = S.t * 0.03 * S.side + (C.yawNudge ?? 0);
        const r = 48;
        const ang = ctx.heading + Math.PI + 0.6 * S.side + a;
        desired.set(t.x + Math.cos(ang) * r, ctx.waterY + 26 + Math.sin(S.t * 0.1) * 4, t.z + Math.sin(ang) * r);
        look.set(t.x + fx * 20, ctx.waterY + 2, t.z + fz * 20);
        fov = 46;
        break;
      }
      case 'tracking':
        desired.set(t.x + rx * 17 * S.side - fx * 4, ctx.waterY + 3.2, t.z + rz * 17 * S.side - fz * 4);
        fov = 42;
        break;
      case 'ahead':
        desired.set(C.anchor.x, 0, C.anchor.z);
        desired.y = Math.max(ctx.groundAt(desired.x, desired.z), ctx.waterY) + 2.2;
        fov = 38;
        if (Math.hypot(t.x - C.anchor.x, t.z - C.anchor.z) < 10) C.timer = Math.min(C.timer, 1.5);
        break;
      case 'overhead': {
        const a = S.t * 0.05 + (C.yawNudge ?? 0);
        desired.set(t.x + Math.cos(a) * 12, ctx.waterY + 34, t.z + Math.sin(a) * 12);
        look.set(t.x, ctx.waterY, t.z);
        fov = 45;
        break;
      }
      case 'low':
        desired.set(t.x - fx * 9 + rx * 3 * S.side, ctx.waterY + 0.35, t.z - fz * 9 + rz * 3 * S.side);
        look.set(t.x + fx * 4, ctx.waterY + 1.4, t.z + fz * 4);
        fov = 55;
        break;
      case 'sunset': {
        // Boat silhouetted against the setting sun.
        const sx = ctx.sunDir.x, sz = ctx.sunDir.z;
        const sl = Math.hypot(sx, sz) || 1;
        desired.set(t.x - (sx / sl) * 26 + rx * 4 * S.side, ctx.waterY + 2.4, t.z - (sz / sl) * 26 + rz * 4 * S.side);
        look.set(t.x + (sx / sl) * 30, ctx.waterY + 6, t.z + (sz / sl) * 30);
        fov = 44;
        break;
      }
      case 'stars':
        desired.set(t.x - fx * 7 + rx * 3 * S.side, ctx.waterY + 1.6, t.z - fz * 7 + rz * 3 * S.side);
        look.set(t.x + fx * 30, ctx.waterY + 22, t.z + fz * 30);
        fov = 64;
        break;
      default:
        break;
    }
    const g = Math.max(ctx.groundAt(desired.x, desired.z), ctx.waterY) + 0.6;
    if (desired.y < g) desired.y = g;
    // Smooth dolly.
    if (!C.initialized) { C.pos.copy(desired); C.look.copy(look); C.initialized = true; C.fov = fov; }
    const k = S.type === 'ahead' ? 3 : 1.4;
    C.pos.x = dampValue(C.pos.x, desired.x, k, dt);
    C.pos.y = dampValue(C.pos.y, desired.y, k, dt);
    C.pos.z = dampValue(C.pos.z, desired.z, k, dt);
    if (S.t < 0.05) C.pos.copy(desired);
    C.look.x = dampValue(C.look.x, look.x, 3, dt);
    C.look.y = dampValue(C.look.y, look.y, 3, dt);
    C.look.z = dampValue(C.look.z, look.z, 3, dt);
    if (S.t < 0.05) C.look.copy(look);
    C.fov = dampValue(C.fov ?? fov, fov, 2, dt);
  }

  /** Rebase positions after a floating-origin shift. */
  shift(dx, dz) {
    for (const v of [this.smoothTarget, this.cine.pos, this.cine.look, this.cine.anchor, this.photo.pos, this.trans.fromPos, this.camera.position]) {
      v.x -= dx; v.z -= dz;
    }
  }
}
