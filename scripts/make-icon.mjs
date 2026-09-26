// Generates the application icon procedurally (no external art):
// a dusk river winding towards a low sun, with a small boat and its lantern.
// Writes build/icon.png (512) and build/icon.ico (256/128/64/48/32/16).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build');

const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const ss = size < 64 ? 4 : 2; // supersampling
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const u = (x + (sx + 0.5) / ss) / size, v = (y + (sy + 0.5) / ss) / size;
        const c = shade(u, v);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const n = ss * ss, i = (y * size + x) * 4;
      px[i] = a ? Math.round(r / a) : 0; px[i + 1] = a ? Math.round(g / a) : 0; px[i + 2] = a ? Math.round(b / a) : 0; px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

function shade(u, v) {
  // Rounded-square mask.
  const q = 0.5 - 0.06, rr = 0.2;
  const dx = Math.max(Math.abs(u - 0.5) - (q - rr), 0), dy = Math.max(Math.abs(v - 0.5) - (q - rr), 0);
  const d = Math.hypot(dx, dy) - rr;
  if (d > 0.004) return [0, 0, 0, 0];
  const alpha = 1 - smooth(-0.004, 0.004, d);
  // Sky gradient: indigo -> rose -> amber at the horizon.
  const hz = 0.56;
  let c;
  if (v < hz) {
    const t = v / hz;
    c = [mix(38, 238, t * t), mix(44, 150, t * t), mix(92, 120, t)];
    // Sun.
    const sd = Math.hypot(u - 0.5, v - 0.47);
    const sun = 1 - smooth(0.085, 0.095, sd);
    const glow = Math.exp(-sd * 9) * 0.5;
    c = [mix(c[0], 255, sun) + glow * 60, mix(c[1], 214, sun) + glow * 40, mix(c[2], 150, sun) + glow * 10];
    // Hills.
    const hill = 0.52 + Math.sin(u * 7.0) * 0.018 + Math.sin(u * 13 + 1) * 0.01;
    if (v > hill) c = [52, 64, 70];
  } else {
    // Land and the river: a band that widens toward the viewer.
    const t = (v - hz) / (1 - hz);
    const centre = 0.5 + Math.sin(t * 3.2 + 0.4) * 0.12 * t;
    const half = 0.02 + t * 0.26;
    const inRiver = Math.abs(u - centre) < half;
    c = inRiver ? [mix(210, 40, t * 0.9), mix(140, 96, t), mix(120, 124, t)] : [mix(60, 38, t), mix(92, 70, t), mix(62, 50, t)];
    if (inRiver) {
      // Sun glitter on the water.
      const glit = Math.max(0, 1 - Math.abs(u - centre) / (half * 0.35)) * (1 - t) * 0.7 * (0.6 + 0.4 * Math.sin(v * 180));
      c = [c[0] + glit * 60, c[1] + glit * 50, c[2] + glit * 30];
    }
    // Boat: a dark hull with a warm lantern.
    const bx = centre - 0.02, by = 0.8;
    const hull = Math.abs(u - bx) < 0.13 - Math.abs(v - by) * 1.6 && v > by - 0.03 && v < by + 0.035;
    if (hull) c = [48, 30, 22];
    const mast = Math.abs(u - (bx + 0.07)) < 0.007 && v > by - 0.13 && v < by;
    if (mast) c = [40, 26, 20];
    const ld = Math.hypot(u - (bx + 0.07), v - (by - 0.14));
    const lamp = 1 - smooth(0.018, 0.024, ld);
    const lampGlow = Math.exp(-ld * 22) * 0.9;
    c = [mix(c[0], 255, lamp) + lampGlow * 120, mix(c[1], 200, lamp) + lampGlow * 80, mix(c[2], 110, lamp) + lampGlow * 20];
  }
  return [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), alpha];
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    dir[i * 16] = size >= 256 ? 0 : size; dir[i * 16 + 1] = size >= 256 ? 0 : size;
    dir[i * 16 + 2] = 0; dir[i * 16 + 3] = 0;
    dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(data.length, i * 16 + 8); dir.writeUInt32LE(offset, i * 16 + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((im) => im.data)]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), png(512, render(512)));
const sizes = [256, 128, 64, 48, 32, 16];
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(sizes.map((s) => ({ size: s, data: png(s, render(s)) }))));
console.log('wrote build/icon.png and build/icon.ico');
