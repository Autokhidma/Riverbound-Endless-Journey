// Deterministic hashing and seeded pseudo-random numbers.
// Everything procedural in Riverbound derives from these so that a world seed
// reproduces exactly the same world on every machine.

/** 32-bit string hash (FNV-1a + avalanche). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return avalanche(h >>> 0);
}

/** Final avalanche mix of a 32-bit integer (murmur3 fmix32). */
export function avalanche(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combine any number of integers into one 32-bit hash. */
export function hashInts(...values) {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i++) {
    let v = values[i] | 0;
    v = Math.imul(v, 0xcc9e2d51);
    v = (v << 15) | (v >>> 17);
    v = Math.imul(v, 0x1b873593);
    h ^= v;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  return avalanche(h >>> 0);
}

/** Hash combining a seed and a string tag, e.g. subSeed(seed, 'biomes'). */
export function subSeed(seed, tag) {
  return hashInts(seed, hashString(String(tag)));
}

/** Hash of integers mapped to [0, 1). */
export function hash01(...values) {
  return hashInts(...values) / 4294967296;
}

/** Normalise a user seed (number or text) into an unsigned 32-bit integer. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (seed >>> 0) || 1;
  const s = String(seed ?? '').trim();
  if (s === '') return 1;
  if (/^\d+$/.test(s)) return (Number(s) >>> 0) || 1;
  return hashString(s) || 1;
}

/**
 * Small, fast seeded PRNG (sfc32). Deterministic across platforms.
 */
export class RNG {
  constructor(seed = 1) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next() { return this.nextU32() / 4294967296; }

  range(min, max) { return min + (max - min) * this.next(); }

  int(min, maxInclusive) { return min + Math.floor(this.next() * (maxInclusive - min + 1)); }

  chance(p) { return this.next() < p; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  sign() { return this.next() < 0.5 ? -1 : 1; }

  /** Weighted pick: items is an array, weightFn returns a weight >= 0. */
  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    if (total <= 0) return items[Math.floor(this.next() * items.length)];
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Approximately normal distribution (Irwin-Hall, 4 samples). */
  gaussian(mean = 0, sd = 1) {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + sd * s * 1.2247;
  }
}
