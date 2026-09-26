import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, hashString, normalizeSeed, subSeed, hash01 } from '../../src/core/rng.js';
import { Noise2D } from '../../src/core/noise.js';
import { clamp, smin, wrapAngle, softClamp, lerp, smoothstep, formatDistance } from '../../src/core/math.js';
import { EventBus } from '../../src/core/events.js';

test('RNG is deterministic per seed and differs between seeds', () => {
  const a = new RNG(1234), b = new RNG(1234), c = new RNG(4321);
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('RNG distribution is roughly uniform and int() stays in range', () => {
  const r = new RNG(99);
  const bins = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) bins[Math.floor(r.next() * 10)]++;
  for (const b of bins) assert.ok(b > 1700 && b < 2300, `bin ${b}`);
  for (let i = 0; i < 1000; i++) { const v = r.int(3, 7); assert.ok(v >= 3 && v <= 7 && Number.isInteger(v)); }
  const w = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i++) w[r.weighted(['a', 'b'], (x) => (x === 'a' ? 3 : 1))]++;
  assert.ok(w.a / w.b > 2.4 && w.a / w.b < 3.7);
});

test('seed normalisation: numbers, numeric strings and words', () => {
  assert.equal(normalizeSeed(42), 42);
  assert.equal(normalizeSeed('42'), 42);
  assert.equal(normalizeSeed('RIVERBOUND'), normalizeSeed('RIVERBOUND'));
  assert.notEqual(normalizeSeed('RIVERBOUND'), normalizeSeed('riverbound!'));
  assert.equal(normalizeSeed(''), 1);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(subSeed(5, 'terrain'), subSeed(5, 'detail'));
  const h = hash01(1, 2, 3);
  assert.ok(h >= 0 && h < 1);
});

test('noise is deterministic, bounded and continuous', () => {
  const n1 = new Noise2D(7), n2 = new Noise2D(7), n3 = new Noise2D(8);
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 13.37, z = i * -7.1;
    const v = n1.noise(x * 0.01, z * 0.01);
    assert.equal(v, n2.noise(x * 0.01, z * 0.01));
    assert.ok(v >= -1.01 && v <= 1.01);
    diff += Math.abs(v - n3.noise(x * 0.01, z * 0.01));
    // continuity: tiny step => tiny change
    assert.ok(Math.abs(n1.noise(x * 0.01 + 1e-4, z * 0.01) - v) < 0.01);
  }
  assert.ok(diff > 1, 'different seeds give different noise');
});

test('math helpers', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.ok(smin(1, 2, 0.5) <= 1);
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 || Math.abs(wrapAngle(Math.PI * 3) + Math.PI) < 1e-9);
  assert.ok(Math.abs(softClamp(100, 1.3)) <= 1.3 + 1e-9);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(smoothstep(0, 1, 2), 1);
  assert.match(formatDistance(1500), /km/);
});

test('event bus on/once/off/wildcard', () => {
  const bus = new EventBus();
  let a = 0, b = 0, all = 0;
  const fa = () => a++;
  bus.on('x', fa);
  bus.once('x', () => b++);
  bus.on('*', () => all++);
  bus.emit('x', {}); bus.emit('x', {});
  bus.off('x', fa);
  bus.emit('x', {});
  assert.equal(a, 2); assert.equal(b, 1); assert.ok(all >= 3);
});
