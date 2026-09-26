// Procedural character animation: pose functions per state, smooth
// cross-fading (quaternion slerp per joint), breathing/look-around layers and
// analytic two-bone IK so hands follow the oar handles and fishing rod.
import * as THREE from 'three';

const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z, 'YXZ');
const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4();

function seatedBase(p, t, breathe) {
  p.hipsY = 0.1;
  p.hips = E(0, 0, -0.05);
  p.spine = E(0, 0, -0.05 + breathe * 0.02);
  p.chest = E(0, 0, 0.02 + breathe * 0.03);
  p.thighL = E(0.08, 0, Math.PI / 2 - 0.05);
  p.thighR = E(-0.08, 0, Math.PI / 2 - 0.05);
  p.shinL = E(0, 0, -Math.PI / 2 - 0.25);
  p.shinR = E(0, 0, -Math.PI / 2 - 0.25);
  p.footL = E(0, 0, 0.25);
  p.footR = E(0, 0, 0.25);
}

const POSES = {
  sit(p, t, s) {
    const breathe = Math.sin(t * 1.4);
    seatedBase(p, t, breathe);
    p.upperArmL = E(0.15, 0, 0.55); p.upperArmR = E(-0.15, 0, 0.55);
    p.forearmL = E(0, 0, 0.9); p.forearmR = E(0, 0, 0.9);
    p.handL = E(0, 0, 0.1); p.handR = E(0, 0, 0.1);
    p.neck = E(0, 0, 0.05);
    p.head = E(0, s.lookYaw ?? 0, (s.lookPitch ?? 0) + 0.05);
  },
  row(p, t, s) {
    const breathe = Math.sin(t * 1.6);
    seatedBase(p, t, breathe);
    const ph = s.stroke ?? 0;
    const drive = ph < 0.5 ? Math.sin((ph / 0.5) * Math.PI) : -Math.sin(((ph - 0.5) / 0.5) * Math.PI) * 0.6;
    p.hips = E(0, 0, -0.08 - drive * 0.18);
    p.spine = E(0, 0, -0.04 - drive * 0.06);
    p.chest = E(0, 0, 0.0);
    p.upperArmL = E(0.1, 0, 1.2); p.upperArmR = E(-0.1, 0, 1.2);
    p.forearmL = E(0, 0, 0.5); p.forearmR = E(0, 0, 0.5);
    p.handL = E(0, 0, 0); p.handR = E(0, 0, 0);
    p.neck = E(0, 0, 0.1 + drive * 0.05);
    p.head = E(0, s.lookYaw ?? 0, (s.lookPitch ?? 0) + 0.02);
  },
  fish(p, t, s) {
    const breathe = Math.sin(t * 1.3);
    seatedBase(p, t, breathe);
    const cast = s.castPhase ?? 0; // 0 idle, 0..0.5 wind-up, 0.5..1 release
    const reel = s.reeling ? Math.sin(t * 9) : 0;
    p.hips = E(0, -0.35, -0.04);
    p.spine = E(0, -0.1, -0.05);
    const windup = cast > 0 && cast < 0.5 ? Math.sin((cast / 0.5) * Math.PI * 0.5) : cast >= 0.5 ? 1 - (cast - 0.5) / 0.5 : 0;
    p.chest = E(0, -0.1, 0.05 - windup * 0.25 + (s.tension ?? 0) * 0.15);
    p.upperArmL = E(0.2, 0, 1.0 + reel * 0.08); p.upperArmR = E(-0.25, 0, 1.1 + windup * 1.2);
    p.forearmL = E(0, 0, 0.9 + reel * 0.2); p.forearmR = E(0, 0, 0.6 - windup * 0.4);
    p.handL = E(reel * 0.4, 0, 0); p.handR = E(0, 0, 0);
    p.neck = E(0, 0.15, 0.1);
    p.head = E(0, 0.25 + (s.lookYaw ?? 0) * 0.3, 0.12);
  },
  stand(p, t, s) {
    const breathe = Math.sin(t * 1.4);
    p.hipsY = 0.92;
    p.hips = E(0, 0, 0);
    p.spine = E(0, 0, breathe * 0.01);
    p.chest = E(0, 0, breathe * 0.025);
    p.neck = E(0, 0, 0);
    p.head = E(0, s.lookYaw ?? 0, s.lookPitch ?? 0);
    p.upperArmL = E(0.1, 0, 0.05 + breathe * 0.02); p.upperArmR = E(-0.1, 0, 0.05 + breathe * 0.02);
    p.forearmL = E(0, 0, 0.15); p.forearmR = E(0, 0, 0.15);
    p.handL = E(0, 0, 0); p.handR = E(0, 0, 0);
    p.thighL = E(0, 0, 0); p.thighR = E(0, 0, 0);
    p.shinL = E(0, 0, 0); p.shinR = E(0, 0, 0);
    p.footL = E(0, 0, 0); p.footR = E(0, 0, 0);
  },
  walk(p, t, s) {
    const sp = Math.min(1.5, s.speed ?? 1);
    const ph = (s.walkPhase ?? 0) * Math.PI * 2;
    const sw = Math.sin(ph) * 0.55 * sp;
    POSES.stand(p, t, s);
    p.hipsY = 0.92 - Math.abs(Math.cos(ph)) * 0.025 * sp;
    p.hips = E(0, Math.sin(ph) * 0.08 * sp, -0.04 * sp);
    p.chest = E(0, -Math.sin(ph) * 0.12 * sp, 0.03);
    p.thighL = E(0, 0, sw); p.thighR = E(0, 0, -sw);
    p.shinL = E(0, 0, -Math.max(0, -Math.cos(ph)) * 0.9 * sp - 0.05);
    p.shinR = E(0, 0, -Math.max(0, Math.cos(ph)) * 0.9 * sp - 0.05);
    p.footL = E(0, 0, Math.max(0, sw) * 0.2); p.footR = E(0, 0, Math.max(0, -sw) * 0.2);
    p.upperArmL = E(0.08, 0, -sw * 0.7); p.upperArmR = E(-0.08, 0, sw * 0.7);
    p.forearmL = E(0, 0, 0.3); p.forearmR = E(0, 0, 0.3);
  },
  collect(p, t, s) {
    POSES.stand(p, t, s);
    const k = Math.sin(Math.min(1, s.actionT ?? 0) * Math.PI);
    p.hipsY = 0.92 - k * 0.35;
    p.hips = E(0, 0, -k * 0.5);
    p.spine = E(0, 0, -k * 0.3);
    p.thighL = E(0, 0, k * 1.2); p.thighR = E(0, 0, k * 0.7);
    p.shinL = E(0, 0, -k * 1.6); p.shinR = E(0, 0, -k * 1.1);
    p.footL = E(0, 0, k * 0.4); p.footR = E(0, 0, k * 0.4);
    p.upperArmR = E(-0.1, 0, k * 1.4); p.forearmR = E(0, 0, k * 0.2);
    p.head = E(0, 0, k * 0.4);
  },
  wave(p, t, s) {
    POSES.stand(p, t, s);
    p.upperArmR = E(-1.2, 0, 0.3);
    p.forearmR = E(0.2 + Math.sin(t * 9) * 0.35, 0, 1.0);
  },
  sitWave(p, t, s) {
    POSES.sit(p, t, s);
    p.upperArmR = E(-1.3, 0, 0.4);
    p.forearmR = E(0.2 + Math.sin(t * 9) * 0.35, 0, 1.0);
  },
};

export class CharacterAnimator {
  constructor(model) {
    this.model = model;
    this.state = 'sit';
    this.params = {};
    this.time = 0;
    this.blendRate = 8;
    this.pose = {};
    this.look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, timer: 3 };
    this.ik = { L: null, R: null, weight: 0 };
    this.targets = {};
    for (const k of Object.keys(model.joints)) this.targets[k] = new THREE.Quaternion();
  }

  setState(state, params = {}) {
    if (!POSES[state]) state = 'sit';
    this.state = state;
    Object.assign(this.params, params);
  }

  /** Set IK hand targets in world space (or null to disable). */
  setHandTargets(left, right, weight = 1) {
    this.ik.L = left; this.ik.R = right; this.ik.weight = weight;
  }

  update(dt) {
    this.time += dt;
    // Idle look-around layer: occasionally glance at the scenery.
    const L = this.look;
    L.timer -= dt;
    if (L.timer <= 0) {
      const busy = this.state === 'row' || this.state === 'fish';
      L.targetYaw = (Math.random() - 0.5) * (busy ? 0.5 : 1.6);
      L.targetPitch = (Math.random() - 0.4) * 0.3;
      L.timer = 2.5 + Math.random() * 5;
    }
    const lk = 1 - Math.exp(-dt * 2.2);
    L.yaw += (L.targetYaw - L.yaw) * lk;
    L.pitch += (L.targetPitch - L.pitch) * lk;
    const s = { ...this.params, lookYaw: this.params.lookYaw ?? L.yaw, lookPitch: this.params.lookPitch ?? L.pitch };
    const p = this.pose;
    for (const k of Object.keys(p)) delete p[k];
    POSES[this.state](p, this.time, s);
    const j = this.model.joints;
    const a = 1 - Math.exp(-dt * this.blendRate);
    for (const [name, joint] of Object.entries(j)) {
      const e = p[name];
      if (e) this.targets[name].setFromEuler(e);
      else this.targets[name].copy(this.model.restQuat[name]);
      joint.quaternion.slerp(this.targets[name], a);
    }
    if (p.hipsY !== undefined) j.hips.position.y += (p.hipsY - j.hips.position.y) * a;
    // Arms IK.
    if (this.ik.weight > 0.001) {
      this.model.root.updateMatrixWorld(true);
      if (this.ik.L) this.solveArm('L', this.ik.L, this.ik.weight);
      if (this.ik.R) this.solveArm('R', this.ik.R, this.ik.weight);
    }
  }

  solveArm(side, target, weight) {
    const j = this.model.joints;
    const up = j[`upperArm${side}`], fore = j[`forearm${side}`];
    const a = this.model.lengths.upperArm, b = this.model.lengths.forearm;
    const S = up.getWorldPosition(_v1);
    const toT = _v2.copy(target).sub(S);
    let d = toT.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 0.01), a + b - 0.005);
    const dir = toT.normalize();
    // Elbows point down and slightly outward.
    const chestQ = j.chest.getWorldQuaternion(_q);
    const pole = _v3.set(-0.3, -1, side === 'L' ? 0.6 : -0.6).applyQuaternion(chestQ);
    const n = _v4.crossVectors(dir, pole).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const elbowDir = dir.clone().applyAxisAngle(n, A);
    const Epos = S.clone().addScaledVector(elbowDir, a);
    this.aimBone(up, elbowDir, pole, weight);
    up.updateMatrixWorld(true);
    const handDir = _v2.copy(target).sub(Epos).normalize();
    this.aimBone(fore, handDir, pole, weight);
    fore.updateMatrixWorld(true);
  }

  /** Rotate a bone so its local -Y axis points along worldDir. */
  aimBone(bone, worldDir, pole, weight) {
    const y = worldDir.clone().negate();
    let x = pole.clone().sub(y.clone().multiplyScalar(pole.dot(y))).normalize();
    if (x.lengthSq() < 1e-6) x = new THREE.Vector3(1, 0, 0);
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
    _m.makeBasis(x, y, z);
    const worldQ = new THREE.Quaternion().setFromRotationMatrix(_m);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const local = parentQ.invert().multiply(worldQ);
    bone.quaternion.slerp(local, weight);
  }
}

export const POSE_NAMES = Object.keys(POSES);
