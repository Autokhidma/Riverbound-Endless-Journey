import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGen } from '../../src/world/WorldGen.js';
import { BIOME_BY_ID, PUBLIC_BIOMES } from '../../src/world/biomes.js';
import { buildTerrainNode, buildTerrainIndices } from '../../src/world/TerrainMesher.js';
import { buildRiverSegment } from '../../src/world/RiverMesher.js';
import { buildScatter, TREE_IDS } from '../../src/world/Scatter.js';
import storyPlan from '../../src/data/storyPlan.json' with { type: 'json' };

const SEEDS = ['RIVERBOUND', 1, 42, 777, 'otter', 'lantern', 90210, 'Oona', 31337, 'mist'];

test('same seed => identical world; different seed => different world', () => {
  const a = new WorldGen('RIVERBOUND'), b = new WorldGen('RIVERBOUND'), c = new WorldGen('ANOTHER');
  for (let i = 0; i < 40; i++) {
    const x = (i * 97.3) % 1500 - 800, z = (i * 53.1) % 1500 - 700;
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
  }
  const ra = Array.from({ length: 12 }, (_, i) => a.seq.get(i).biome);
  const rb = Array.from({ length: 12 }, (_, i) => b.seq.get(i).biome);
  assert.deepEqual(ra, rb);
  const fa = a.regionFeatures(2).items.map((i) => `${i.kind}:${Math.round(i.x)}:${Math.round(i.z)}`);
  const fb = b.regionFeatures(2).items.map((i) => `${i.kind}:${Math.round(i.x)}:${Math.round(i.z)}`);
  assert.deepEqual(fa, fb);
  let differs = 0;
  for (let i = 0; i < 20; i++) if (a.heightAt(i * 200, i * 50) !== c.heightAt(i * 200, i * 50)) differs++;
  assert.ok(differs > 10);
});

test('features do not depend on generation order', () => {
  const a = new WorldGen(555), b = new WorldGen(555);
  const late = b.regionFeatures(6).items.map((i) => i.id + Math.round(i.x));
  for (let i = 0; i <= 6; i++) a.regionFeatures(i);
  assert.deepEqual(a.regionFeatures(6).items.map((i) => i.id + Math.round(i.x)), late);
});

test('region sequence respects biome adjacency and keeps the coast late', () => {
  for (const seed of SEEDS) {
    const w = new WorldGen(seed);
    for (let i = 1; i < 30; i++) {
      const prev = w.seq.get(i - 1).biome, cur = w.seq.get(i).biome;
      assert.ok(BIOME_BY_ID[prev].neighbors.includes(cur) || prev === cur, `${seed}: ${prev} -> ${cur}`);
      if (i < 9) assert.notEqual(cur, 'coast', `${seed}: coast at region ${i}`);
      assert.ok(w.seq.get(i).sStart === w.seq.get(i - 1).sEnd);
    }
  }
});

test('every story anchor lands in its range, in order, for every seed', () => {
  for (const seed of SEEDS) {
    const w = new WorldGen(seed);
    let lastRegion = -1;
    for (const A of storyPlan.anchors) {
      const r = w.seq.anchorRegion[A.id] ?? (w.seq.get(A.regions[1]), w.seq.anchorRegion[A.id]);
      assert.ok(r !== undefined, `${seed}: anchor ${A.id} missing`);
      assert.ok(r >= A.regions[0] && r <= A.regions[1], `${seed}: ${A.id} at ${r}`);
      assert.ok(A.biomes.includes(w.seq.get(r).biome), `${seed}: ${A.id} biome ${w.seq.get(r).biome}`);
      assert.ok(r >= lastRegion);
      lastRegion = r;
      for (const f of A.features) {
        const it = w.findFeature((i) => i.storyKey === f.key, 20);
        assert.ok(it, `${seed}: story feature ${f.key} not generated`);
        assert.ok(Number.isFinite(it.x) && Number.isFinite(it.z));
      }
    }
  }
});

test('many biomes are reached across seeds (12 public biomes exist)', () => {
  assert.equal(PUBLIC_BIOMES.length, 12);
  const seen = new Set();
  for (const seed of SEEDS) {
    const w = new WorldGen(seed);
    for (let i = 0; i < 24; i++) seen.add(w.seq.get(i).biome);
  }
  assert.ok(seen.size >= 11, `seen ${[...seen].join(',')}`);
});

test('river is continuous, monotonic in u, and water sits in the channel', () => {
  const w = new WorldGen('RIVERBOUND');
  const o = {};
  let prev = null, prevU = -Infinity;
  for (let s = -500; s < 12000; s += 8) {
    const r = w.main.sample(s, o);
    if (prev) assert.ok(Math.hypot(r.x - prev.x, r.z - prev.z) < 9, `jump at s=${s}`);
    assert.ok(r.u > prevU, `u not monotonic at s=${s}`);
    prevU = r.u;
    prev = { x: r.x, z: r.z };
  }
  let shallow = 0, n = 0;
  for (let s = 100; s < 12000; s += 173) {
    const c = w.riverToWorld(s, 0);
    const info = w.waterInfo(c.x, c.z, {});
    const rapids = w.main.sample(s, {}).rp > 0.3; // rapids have rocks breaking the surface
    n++;
    if (info.depth < 0.3 && !rapids) shallow++;
    assert.ok(info.height < info.level, `terrain above water at centre s=${s}`);
    const near = w.main.nearest(c.x, c.z, {});
    assert.ok(Math.abs(near.s - s) < 12, `nearest() mismatch at ${s}: ${near.s}`);
  }
  assert.ok(shallow <= n * 0.02, `${shallow}/${n} shallow centre samples outside rapids`);
});

test('the river is effectively endless (50 km downstream still generates)', () => {
  const w = new WorldGen(2024);
  const r = w.main.sample(50000, {});
  assert.ok(Number.isFinite(r.x) && Number.isFinite(r.z) && r.w > 5);
  const reg = w.regionAtS(50000);
  assert.ok(reg.index > 12);
  assert.ok(Number.isFinite(w.heightAt(r.x, r.z)));
  assert.ok(w.regionFeatures(reg.index).items.length > 0);
});

test('terrain node meshing produces finite attributes of the right size', () => {
  const w = new WorldGen('RIVERBOUND');
  const res = 16;
  const n = buildTerrainNode(w, { x0: -256, z0: -256, size: 512, res });
  const verts = (res + 1) * (res + 1);
  assert.ok(n.positions.length >= verts * 3);
  for (const v of n.positions) assert.ok(Number.isFinite(v));
  for (const v of n.normals) assert.ok(Number.isFinite(v));
  assert.ok(n.maxY >= n.minY);
  const idx = buildTerrainIndices(res);
  assert.ok(idx.length >= res * res * 6);
});

test('river segment and scatter builders', () => {
  const w = new WorldGen('RIVERBOUND');
  const seg = buildRiverSegment(w, { river: 'main', s0: 0, s1: 192, step: 8, lateral: 8 });
  assert.ok(seg.positions.length > 0 && seg.indices.length > 0);
  for (const v of seg.positions) assert.ok(Number.isFinite(v));
  const sc = buildScatter(w, { x0: -64, z0: 64, size: 128, small: false });
  let trees = 0, wet = 0;
  for (const [species, arr] of Object.entries(sc.species ?? sc)) {
    if (!arr || typeof arr.length !== 'number' || !TREE_IDS.has(species)) continue;
    for (let i = 0; i < arr.length; i += 8) {
      trees++;
      const info = w.waterInfo(arr[i] - 64, arr[i + 2] + 64, {});
      if (info.depth > 0.4) wet++;
    }
  }
  assert.ok(trees > 0, 'the home valley has trees');
  assert.ok(wet <= Math.max(1, trees * 0.02), `${wet}/${trees} trees in deep water`);
});
