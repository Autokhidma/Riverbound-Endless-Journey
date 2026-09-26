// Streams instanced vegetation in two layers around the camera:
//   large (trees, bushes, rocks) in 128 m cells with near/far LOD,
//   small (grass, flowers, reeds, lilies) in 32 m cells close to the camera.
import * as THREE from 'three';
import { speciesGeometry, SPECIES_MATERIAL, TALL } from './Species.js';
import { getFoliageMaterials } from '../render/FoliageMaterials.js';
import { noReflect } from '../render/layers.js';

const LARGE = 128;
const SMALL = 32;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

export class VegetationStreamer {
  constructor(root, pool, quality) {
    this.root = root;
    this.pool = pool;
    this.cells = new Map();
    this.materials = getFoliageMaterials();
    this.stats = { cells: 0, instances: 0, pending: 0, meshes: 0 };
    this.setQuality(quality);
  }

  setQuality(q) {
    this.q = q;
    const f = q.foliage;
    this.treeDistance = f.treeDistance;
    this.smallDistance = f.smallDistance;
    this.lodDistance = f.lodDistance;
    this.density = f.density;
    this.smallDensity = f.smallDensity;
    this.shadows = q.shadows.enabled && q.shadows.vegetation;
    // Density changes require regeneration.
    for (const [k, c] of this.cells) this.disposeCell(k, c);
  }

  update(cam) {
    const need = new Set();
    this.scan(cam, LARGE, this.treeDistance, false, need);
    this.scan(cam, SMALL, this.smallDistance, true, need);
    for (const [k, c] of this.cells) if (!need.has(k)) this.disposeCell(k, c);
    // LOD switching for large cells.
    let inst = 0, meshes = 0;
    for (const c of this.cells.values()) {
      if (!c.meshes) continue;
      if (!c.small) {
        const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
        const lod = d < this.lodDistance ? 1 : 0;
        if (lod !== c.lod) {
          c.lod = lod;
          for (const m of c.meshes) {
            if (m.userData.far !== false) m.geometry = speciesGeometry(m.userData.species, lod);
            m.castShadow = this.shadows && lod === 1 && TALL.has(m.userData.species) && d < this.q.shadows.distance * 2;
          }
        }
      }
      for (const m of c.meshes) inst += m.count;
      meshes += c.meshes.length;
    }
    this.pool.prune((k) => !k.startsWith('v:') || need.has(k.slice(2)));
    this.stats.cells = this.cells.size;
    this.stats.instances = inst;
    this.stats.meshes = meshes;
    this.stats.pending = [...this.cells.values()].filter((c) => !c.meshes).length;
  }

  scan(cam, size, radius, small, need) {
    const i0 = Math.floor((cam.x - radius) / size), i1 = Math.floor((cam.x + radius) / size);
    const j0 = Math.floor((cam.z - radius) / size), j1 = Math.floor((cam.z + radius) / size);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * size, cz = (j + 0.5) * size;
        const d = Math.hypot(cx - cam.x, cz - cam.z) - size * 0.7;
        if (d > radius) continue;
        const key = `${small ? 's' : 'l'}:${i}:${j}`;
        need.add(key);
        if (!this.cells.has(key)) this.request(key, i * size, j * size, size, small, d);
      }
    }
  }

  request(key, x0, z0, size, small, dist) {
    const cell = { key, x0, z0, size, small, cx: x0 + size / 2, cz: z0 + size / 2, meshes: null, lod: -1 };
    this.cells.set(key, cell);
    const params = { x0, z0, size, small, density: this.density, smallDensity: this.smallDensity };
    this.pool.request('scatter', params, 2 + dist / 300 + (small ? 0.5 : 0), `v:${key}`).then((res) => {
      if (!res || this.cells.get(key) !== cell) return;
      this.build(cell, res);
    }).catch((e) => { console.error('[veg] cell failed', e); this.cells.delete(key); });
  }

  build(cell, res) {
    cell.meshes = [];
    const group = new THREE.Group();
    group.position.set(cell.x0, 0, cell.z0);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    for (const [id, arr] of Object.entries(res.species)) {
      const count = arr.length / 8;
      if (!count) continue;
      const geo = speciesGeometry(id, cell.small ? 1 : 0);
      const mat = this.materials[SPECIES_MATERIAL[id] ?? 'foliage'];
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.userData.species = id;
      let maxY = -Infinity, minY = Infinity;
      for (let n = 0; n < count; n++) {
        const o = n * 8;
        _p.set(arr[o], arr[o + 1], arr[o + 2]);
        _q.setFromAxisAngle(_up, arr[o + 3]);
        const sc = arr[o + 4];
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        _c.setRGB(arr[o + 5], arr[o + 6], arr[o + 7]);
        mesh.setColorAt(n, _c);
        maxY = Math.max(maxY, arr[o + 1]); minY = Math.min(minY, arr[o + 1]);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const h = (geo.boundingBox?.max.y ?? 5) * 1.5;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cell.size / 2, (minY + maxY) / 2 + h / 2, cell.size / 2), cell.size * 0.75 + h);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      if (cell.small) noReflect(mesh);
      group.add(mesh);
      cell.meshes.push(mesh);
    }
    cell.group = group;
    this.root.add(group);
    cell.lod = -1; // force LOD evaluation next update
  }

  disposeCell(key, cell) {
    if (cell.group) {
      this.root.remove(cell.group);
      for (const m of cell.meshes) m.dispose();
    }
    this.cells.delete(key);
  }

  dispose() {
    for (const [k, c] of this.cells) this.disposeCell(k, c);
  }
}
