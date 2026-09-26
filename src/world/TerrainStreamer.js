// Quadtree terrain streaming. Only nodes around the camera exist; coarse
// nodes stay visible until their refined children are ready (no holes), and
// recently used nodes are kept in an LRU cache for quick return trips.
import * as THREE from 'three';
import { buildTerrainIndices } from './TerrainMesher.js';

const ROOT = 2048;

export class TerrainStreamer {
  constructor(root, pool, material, quality) {
    this.root = root;
    this.pool = pool;
    this.material = material;
    this.nodes = new Map(); // key -> { key, level, ix, iz, size, x0, z0, mesh, state, lastUsed }
    this.indexCache = new Map();
    this.visible = new Set();
    this.frame = 0;
    this.cacheLimit = 380;
    this.stats = { loaded: 0, visible: 0, pending: 0, desired: 0 };
    this.setQuality(quality);
  }

  setQuality(q) {
    this.q = q;
    this.res = q.terrainRes;
    this.split = q.terrainSplit;
    this.viewDistance = q.viewDistance;
    this.minSize = q.terrainRes <= 16 ? 128 : 64;
    this.castShadow = q.shadows.enabled;
    // Different resolution invalidates cached meshes.
    for (const n of this.nodes.values()) if (n.res !== this.res) this.disposeNode(n);
  }

  indices(res) {
    let idx = this.indexCache.get(res);
    if (!idx) {
      idx = new THREE.BufferAttribute(buildTerrainIndices(res), 1);
      this.indexCache.set(res, idx);
    }
    return idx;
  }

  key(level, ix, iz) {
    return `${level}:${ix}:${iz}`;
  }

  getNode(level, ix, iz) {
    const k = this.key(level, ix, iz);
    let n = this.nodes.get(k);
    if (!n) {
      const size = ROOT >> level;
      n = { key: k, level, ix, iz, size, x0: ix * size, z0: iz * size, mesh: null, state: 'empty', lastUsed: 0, res: this.res };
      this.nodes.set(k, n);
    }
    return n;
  }

  /** Distance from camera to node footprint (xz), including height above ground. */
  nodeDistance(n, cam, camAboveGround) {
    const dx = Math.max(n.x0 - cam.x, 0, cam.x - (n.x0 + n.size));
    const dz = Math.max(n.z0 - cam.z, 0, cam.z - (n.z0 + n.size));
    return Math.sqrt(dx * dx + dz * dz + camAboveGround * camAboveGround);
  }

  /**
   * @param cam absolute camera position {x, y, z}
   * @param ground terrain height below the camera
   */
  update(cam, ground, frustumHint = null) {
    this.frame++;
    const above = Math.max(0, cam.y - ground);
    const desired = [];
    const vd = this.viewDistance;
    const r0 = Math.floor((cam.x - vd) / ROOT), r1 = Math.floor((cam.x + vd) / ROOT);
    const c0 = Math.floor((cam.z - vd) / ROOT), c1 = Math.floor((cam.z + vd) / ROOT);
    const roots = [];
    for (let iz = c0; iz <= c1; iz++) {
      for (let ix = r0; ix <= r1; ix++) {
        const n = this.getNode(0, ix, iz);
        if (this.nodeDistance(n, cam, 0) > vd) continue;
        roots.push(n);
      }
    }
    const isLeaf = new Map();
    const walk = (n) => {
      n.lastUsed = this.frame;
      const d = this.nodeDistance(n, cam, above);
      if (n.size > this.minSize && d < n.size * this.split) {
        isLeaf.set(n.key, false);
        const lv = n.level + 1;
        const ch = [this.getNode(lv, n.ix * 2, n.iz * 2), this.getNode(lv, n.ix * 2 + 1, n.iz * 2), this.getNode(lv, n.ix * 2, n.iz * 2 + 1), this.getNode(lv, n.ix * 2 + 1, n.iz * 2 + 1)];
        n.children = ch;
        for (const c of ch) {
          if (this.nodeDistance(c, cam, 0) > vd + c.size) continue;
          walk(c);
        }
      } else {
        isLeaf.set(n.key, true);
        n.children = null;
        desired.push({ n, d });
      }
    };
    for (const r of roots) walk(r);
    this.stats.desired = desired.length;

    // Request missing leaves (near and large nodes first), keep ancestors as fallback.
    for (const { n, d } of desired) {
      if (n.state === 'empty') this.requestNode(n, d / n.size + (n.level === 0 ? -1 : 0));
    }
    // Ensure coarse fallbacks exist for fast coverage.
    for (const r of roots) if (r.state === 'empty') this.requestNode(r, -2);

    // Resolve the visible set: loaded leaves, else nearest loaded ancestor.
    const visible = new Set();
    const coveredAll = (n) => {
      if (isLeaf.get(n.key) === true || !n.children) return n.state === 'ready';
      return n.children.every((c) => isLeaf.has(c.key) ? coveredAll(c) : true);
    };
    const place = (n) => {
      if (!isLeaf.has(n.key)) return;
      if (isLeaf.get(n.key)) {
        if (n.state === 'ready') visible.add(n);
        return;
      }
      if (coveredAll(n)) {
        for (const c of n.children) place(c);
      } else if (n.state === 'ready') {
        visible.add(n);
      } else {
        for (const c of n.children) place(c);
      }
    };
    for (const r of roots) place(r);

    for (const n of this.visible) if (!visible.has(n) && n.mesh) n.mesh.visible = false;
    for (const n of visible) { n.mesh.visible = true; n.lastUsed = this.frame; }
    this.visible = visible;

    // Drop queued requests for nodes no longer needed.
    this.pool.prune((k) => !k.startsWith('t:') || (this.nodes.get(k.slice(2))?.lastUsed ?? 0) >= this.frame - 2);
    this.evict();
    this.stats.loaded = [...this.nodes.values()].filter((n) => n.state === 'ready').length;
    this.stats.visible = visible.size;
    this.stats.pending = [...this.nodes.values()].filter((n) => n.state === 'pending').length;
  }

  requestNode(n, priority) {
    n.state = 'pending';
    const res = this.res;
    n.res = res;
    this.pool.request('terrain', { x0: n.x0, z0: n.z0, size: n.size, res }, priority, `t:${n.key}`).then((data) => {
      if (!data) { if (n.state === 'pending') n.state = 'empty'; return; }
      if (!this.nodes.has(n.key) || n.res !== res) return;
      this.createMesh(n, data);
    }).catch((err) => { console.error('[terrain] node failed', err); n.state = 'empty'; });
  }

  createMesh(n, data) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 4, true));
    g.setAttribute('aMat', new THREE.BufferAttribute(data.mats, 4, true));
    g.setIndex(this.indices(data.res));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, data.minY, 0), new THREE.Vector3(n.size, data.maxY, n.size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(n.x0, 0, n.z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = this.castShadow && n.size <= 256;
    mesh.visible = false;
    mesh.name = `terrain ${n.key}`;
    mesh.userData.terrain = true;
    this.root.add(mesh);
    n.mesh = mesh;
    n.state = 'ready';
    n.minY = data.minY; n.maxY = data.maxY;
  }

  disposeNode(n) {
    if (n.mesh) {
      this.root.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
    this.visible.delete(n);
    this.nodes.delete(n.key);
  }

  evict() {
    // Never evict nodes walked this frame: parents are the fallback that
    // covers the ground while their children are still loading.
    const ready = [...this.nodes.values()].filter((n) => n.state === 'ready' && !this.visible.has(n) && n.lastUsed < this.frame);
    const excess = ready.length + this.visible.size - this.cacheLimit;
    if (excess > 0) {
      ready.sort((a, b) => a.lastUsed - b.lastUsed);
      for (let i = 0; i < Math.min(excess, ready.length); i++) this.disposeNode(ready[i]);
    }
    // Forget empty bookkeeping nodes that have not been used for a while.
    if (this.frame % 120 === 0) {
      for (const n of this.nodes.values()) if (n.state === 'empty' && n.lastUsed < this.frame - 120) this.nodes.delete(n.key);
    }
  }

  get ready() {
    return this.visible.size > 0 && this.stats.pending === 0;
  }

  dispose() {
    for (const n of [...this.nodes.values()]) this.disposeNode(n);
  }
}
