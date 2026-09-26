// Planar reflection for calm water (High / Ultra / Cinematic). Renders the
// scene mirrored about the local water plane at reduced resolution with an
// oblique near plane, excluding objects on the NO_REFLECT layer.
import * as THREE from 'three';
import { LAYERS } from '../render/layers.js';

export class PlanarReflection {
  constructor(scale) {
    this.scale = scale;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(LAYERS.DEFAULT);
    this.textureMatrix = new THREE.Matrix4();
    this.rt = null;
    this.enabled = scale > 0;
    this._v = {
      normal: new THREE.Vector3(0, 1, 0), refl: new THREE.Vector3(), camPos: new THREE.Vector3(), rot: new THREE.Matrix4(),
      look: new THREE.Vector3(), target: new THREE.Vector3(), view: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(),
    };
  }

  resize(w, h) {
    if (!this.enabled) return;
    const W = Math.max(64, Math.round(w * this.scale)), H = Math.max(64, Math.round(h * this.scale));
    if (this.rt && this.rt.width === W && this.rt.height === H) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  /** Render the reflection about plane y = planeY (scene space). */
  render(renderer, camera, scene, planeY) {
    if (!this.enabled || !this.rt) return false;
    const v = this._v;
    v.refl.set(camera.position.x, planeY, camera.position.z);
    camera.updateMatrixWorld();
    v.camPos.setFromMatrixPosition(camera.matrixWorld);
    v.view.subVectors(v.refl, v.camPos);
    if (v.view.dot(v.normal) > 0) return false; // camera below the water
    v.view.reflect(v.normal).negate().add(v.refl);
    v.rot.extractRotation(camera.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.camPos);
    v.target.subVectors(v.refl, v.look).reflect(v.normal).negate().add(v.refl);
    const vc = this.camera;
    vc.position.copy(v.view);
    vc.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.normal);
    vc.lookAt(v.target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // Oblique clipping so nothing below the water leaks into the reflection.
    v.plane.setFromNormalAndCoplanarPoint(v.normal, v.refl).applyMatrix4(vc.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const pm = vc.projectionMatrix.elements;
    v.q.x = (Math.sign(v.clip.x) + pm[8]) / pm[0];
    v.q.y = (Math.sign(v.clip.y) + pm[9]) / pm[5];
    v.q.z = -1;
    v.q.w = (1 + pm[10]) / pm[14];
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    pm[2] = v.clip.x;
    pm[6] = v.clip.y;
    pm[10] = v.clip.z + 1 - 0.003;
    pm[14] = v.clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, false);
    renderer.render(scene, vc);
    renderer.shadowMap.autoUpdate = shadowAuto;
    return true;
  }

  dispose() {
    this.rt?.dispose();
  }
}
