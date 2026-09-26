// Procedural player character: an original traveller (bucket hat, knit scarf,
// satchel) built on a joint hierarchy. Body parts are attached to joints and
// animated procedurally by CharacterAnimator.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hexToLinear } from '../core/math.js';
import { paint } from '../boat/BoatModel.js';

function part(geo, color) { return paint(geo, color); }
function mergeParts(list) {
  return mergeGeometries(list.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) ng.deleteAttribute(k);
    return ng;
  }));
}
function capsule(r, len, color, y = -len / 2, seg = 8) {
  const g = new THREE.CapsuleGeometry(r, len, 4, seg);
  g.translate(0, y, 0);
  return part(g, color);
}
function sphere(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 12) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.66 | 0));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return part(g, color);
}
function rbox(w, h, d, color, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  // round the corners a little
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const k = 0.18;
    const n = v.clone().multiply(new THREE.Vector3(2 / w, 2 / h, 2 / d));
    const len = n.length();
    if (len > 1.2) v.multiplyScalar(1 - k * (len - 1.2) / 0.5);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return part(g, color);
}

export const DEFAULT_LOOK = {
  skin: '#d9a47c', hair: '#4a3020', shirt: '#e8e0cc', vest: '#5a6e4a', trousers: '#4b5566', boots: '#5a3a26',
  scarf: '#c0573f', hat: '#b89a64', hatBand: '#6b4a2e', satchel: '#8a5a34',
};

export class CharacterModel {
  constructor(look = DEFAULT_LOOK) {
    const c = Object.fromEntries(Object.entries(look).map(([k, v]) => [k, hexToLinear(v)]));
    this.colors = c;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    this.root = new THREE.Group();
    this.root.name = 'Traveller';
    const J = (name, parent, x, y, z) => {
      const j = new THREE.Group();
      j.name = name;
      j.position.set(x, y, z);
      parent.add(j);
      return j;
    };
    const joints = {};
    joints.hips = J('hips', this.root, 0, 0.92, 0);
    joints.spine = J('spine', joints.hips, 0, 0.1, 0);
    joints.chest = J('chest', joints.spine, 0, 0.2, 0);
    joints.neck = J('neck', joints.chest, 0, 0.2, 0);
    joints.head = J('head', joints.neck, 0, 0.08, 0);
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;
      joints[`shoulder${side}`] = J(`shoulder${side}`, joints.chest, 0, 0.14, 0.17 * s);
      joints[`upperArm${side}`] = J(`upperArm${side}`, joints[`shoulder${side}`], 0, 0, 0.03 * s);
      joints[`forearm${side}`] = J(`forearm${side}`, joints[`upperArm${side}`], 0, -0.28, 0);
      joints[`hand${side}`] = J(`hand${side}`, joints[`forearm${side}`], 0, -0.25, 0);
      joints[`thigh${side}`] = J(`thigh${side}`, joints.hips, 0, -0.04, 0.095 * s);
      joints[`shin${side}`] = J(`shin${side}`, joints[`thigh${side}`], 0, -0.42, 0);
      joints[`foot${side}`] = J(`foot${side}`, joints[`shin${side}`], 0, -0.41, 0);
    }
    this.joints = joints;
    this.lengths = { upperArm: 0.28, forearm: 0.25, thigh: 0.42, shin: 0.41 };

    const add = (joint, geo, { head = false } = {}) => {
      const m = new THREE.Mesh(geo, this.material);
      m.castShadow = true;
      m.receiveShadow = true;
      if (head) m.userData.headPart = true;
      joint.add(m);
      return m;
    };
    // Pelvis + satchel strap.
    add(joints.hips, mergeParts([
      rbox(0.32, 0.2, 0.22, c.trousers, 0, 0.02, 0),
      rbox(0.34, 0.05, 0.24, c.hatBand, 0, 0.12, 0),
      rbox(0.12, 0.16, 0.06, c.satchel, 0.02, 0.0, -0.17),
    ]));
    // Torso: shirt + vest.
    add(joints.spine, mergeParts([
      rbox(0.3, 0.22, 0.2, c.shirt, 0, 0.1, 0),
      rbox(0.31, 0.2, 0.21, c.vest, 0, 0.12, 0.002),
    ]));
    add(joints.chest, mergeParts([
      rbox(0.38, 0.26, 0.24, c.vest, 0, 0.08, 0),
      rbox(0.12, 0.2, 0.02, c.shirt, 0.121, 0.1, 0),
      sphere(0.075, c.shirt, 0, 0.12, 0.2, 1, 1, 1, 8), sphere(0.075, c.shirt, 0, 0.12, -0.2, 1, 1, 1, 8),
    ]));
    // Neck, scarf.
    const scarf = new THREE.TorusGeometry(0.075, 0.04, 6, 12);
    scarf.rotateX(Math.PI / 2);
    scarf.translate(0, 0.03, 0);
    const tail = rbox(0.06, 0.2, 0.025, c.scarf, 0.09, -0.09, 0.05);
    tail.rotateZ(-0.2);
    add(joints.neck, mergeParts([capsule(0.05, 0.06, c.skin, 0.03), part(scarf, c.scarf), tail]));
    // Head: face, hair, eyes, nose, ears, bucket hat.
    this.headMesh = add(joints.head, mergeParts([
      sphere(0.115, c.skin, 0, 0.11, 0, 0.95, 1.08, 0.95, 16),
      sphere(0.118, c.hair, -0.018, 0.14, 0, 1.0, 0.9, 1.0, 14),
      sphere(0.017, [0.05, 0.04, 0.04], 0.1, 0.12, 0.042, 0.5, 1, 1, 6),
      sphere(0.017, [0.05, 0.04, 0.04], 0.1, 0.12, -0.042, 0.5, 1, 1, 6),
      sphere(0.022, c.skin, 0.115, 0.095, 0, 1.2, 0.8, 0.8, 6),
      sphere(0.028, c.skin, 0, 0.1, 0.11, 0.5, 1, 0.8, 6), sphere(0.028, c.skin, 0, 0.1, -0.11, 0.5, 1, 0.8, 6),
      sphere(0.03, [0.85, 0.45, 0.4], 0.092, 0.075, 0.06, 0.4, 0.5, 0.8, 6), sphere(0.03, [0.85, 0.45, 0.4], 0.092, 0.075, -0.06, 0.4, 0.5, 0.8, 6),
    ]), { head: true });
    const brim = new THREE.CylinderGeometry(0.2, 0.2, 0.018, 18);
    brim.translate(0, 0.2, 0);
    const crown = new THREE.CylinderGeometry(0.105, 0.125, 0.12, 16);
    crown.translate(0, 0.265, 0);
    const band = new THREE.CylinderGeometry(0.127, 0.127, 0.03, 16);
    band.translate(0, 0.225, 0);
    this.hatMesh = add(joints.head, mergeParts([part(brim, c.hat), part(crown, c.hat), part(band, c.hatBand)]), { head: true });
    this.hatMesh.rotation.z = -0.08;
    // Arms.
    for (const side of ['L', 'R']) {
      add(joints[`upperArm${side}`], mergeParts([capsule(0.052, 0.2, c.shirt, -0.13)]));
      add(joints[`forearm${side}`], mergeParts([capsule(0.047, 0.1, c.shirt, -0.06), capsule(0.04, 0.12, c.skin, -0.16)]));
      const s = side === 'L' ? 1 : -1;
      add(joints[`hand${side}`], mergeParts([rbox(0.08, 0.1, 0.045, c.skin, 0, -0.045, 0), sphere(0.022, c.skin, 0.035, -0.02, 0.02 * s, 1, 1.4, 1, 6)]));
      add(joints[`thigh${side}`], mergeParts([capsule(0.075, 0.28, c.trousers, -0.2)]));
      add(joints[`shin${side}`], mergeParts([capsule(0.062, 0.26, c.trousers, -0.17), capsule(0.066, 0.1, c.boots, -0.33)]));
      add(joints[`foot${side}`], mergeParts([rbox(0.2, 0.08, 0.1, c.boots, 0.05, -0.02, 0)]));
    }
    // Fishing rod (held in the right hand during fishing).
    const rodGeo = mergeParts([
      part(new THREE.CylinderGeometry(0.008, 0.016, 2.1, 6).translate(0, 1.05, 0), hexToLinear('#6b4a2e')),
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.25, 6).translate(0, 0.1, 0), hexToLinear('#3a2a1e')),
      part(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10).rotateX(Math.PI / 2).translate(0.03, 0.28, 0), hexToLinear('#c9a255')),
    ]);
    this.rod = new THREE.Mesh(rodGeo, this.material);
    this.rod.castShadow = true;
    this.rod.visible = false;
    this.rodTip = new THREE.Object3D();
    this.rodTip.position.set(0, 2.1, 0);
    this.rod.add(this.rodTip);
    const rodHolder = new THREE.Group();
    rodHolder.position.set(0, -0.08, 0);
    rodHolder.rotation.set(0, 0, -Math.PI / 2 + 0.3);
    rodHolder.add(this.rod);
    joints.handR.add(rodHolder);
    this.rodHolder = rodHolder;

    // Rest pose (arms down, T-pose-free).
    this.restQuat = {};
    for (const [k, j] of Object.entries(joints)) this.restQuat[k] = j.quaternion.clone();
  }

  /** Hide head parts in first-person view. */
  setFirstPerson(on) {
    this.headMesh.visible = !on;
    this.hatMesh.visible = !on;
  }
}
