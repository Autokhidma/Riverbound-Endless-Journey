// Builds water-surface ribbons that follow a river centre-line (runs in
// workers). Each vertex carries its along-river distance, lateral offset,
// water depth (from the terrain) and flow, so the water shader can do
// depth colour, shoreline foam and flow-aligned waves without a depth texture.

/**
 * @param world WorldGen
 * @param {object} o { river: 'main' | tribId, s0, s1, step, lateral }
 */
function isTribRiver(r) { return r !== 'main'; }

export function buildRiverSegment(world, { river, s0, s1, step = 4, lateral = 16 }) {
  const R = river === 'main' ? world.main : world.tributaryById(river);
  if (!R) return null;
  const sMax = river === 'main' ? Infinity : R.length;
  s1 = Math.min(s1, sMax);
  if (s1 <= s0) return null;
  const rows = Math.max(2, Math.ceil((s1 - s0) / step) + 1);
  // Adapt lateral resolution to the widest cross-section (lakes need more).
  let maxW = 0;
  for (let k = 0; k <= 4; k++) {
    const ss = s0 + ((s1 - s0) * k) / 4;
    maxW = Math.max(maxW, R.sample(isTribRiver(river) ? Math.max(0, Math.min(ss, R.length)) : ss, {}).w);
  }
  const spacing = step <= 4 ? 7 : 16;
  lateral = Math.max(lateral, Math.min(40, Math.ceil((maxW * 1.24 + 24) / spacing)));
  if (lateral % 2) lateral++;
  const cols = lateral + 1;
  const origin = R.sample(s0, {});
  const ox = origin.x, oz = origin.z, oy = origin.wl;
  const vCount = rows * cols;
  const positions = new Float32Array(vCount * 3);
  const river4 = new Float32Array(vCount * 4); // s, t, depth, foam
  const flow = new Float32Array(vCount * 3); // s-tangent X, Z, signed flow speed along +s
  const waterA = new Float32Array(vCount * 4); // shallow rgb, absorption
  const waterB = new Float32Array(vCount * 4); // deep rgb, wave amplitude
  const tmp = {}, smp = {};
  const isTrib = river !== 'main';
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const under = new Uint8Array(vCount);
  for (let r = 0; r < rows; r++) {
    const s = Math.min(s1, s0 + r * step);
    const st = R.sample(isTrib ? Math.max(0, Math.min(s, R.length)) : s, tmp);
    const half = st.w * 0.5;
    const margin = 12 + st.w * 0.12;
    const extent = half + margin;
    // Smoothed tangent (average over a window) prevents folding on tight bends.
    const win = Math.min(160, Math.max(16, extent));
    let tx = 0, tz = 0;
    for (let k = -3; k <= 3; k++) {
      const ss = s + (k / 3) * win;
      const sc = isTrib ? Math.max(0, Math.min(R.length, ss)) : ss;
      const h = R.sample(sc, smp).h;
      const w = 1 - Math.abs(k) / 4;
      tx += Math.cos(h) * w; tz += Math.sin(h) * w;
    }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const fdir = isTrib ? -1 : 1; // tributaries flow towards the junction (decreasing s)
    // Biome water look at this cross-section (blended across transitions).
    const bl = world.biomeAt(st.x, st.z);
    const star = isTrib && R.biomeOverride === 'starwater' ? Math.min(1, Math.max(0, (s - 250) / 400)) : 0;
    const wa = bl.a.water, wb = bl.b.water;
    const bt = bl.t;
    const shallow = [0, 1, 2].map((i) => wa.shallowLin[i] + (wb.shallowLin[i] - wa.shallowLin[i]) * bt);
    const deep = [0, 1, 2].map((i) => wa.deepLin[i] + (wb.deepLin[i] - wa.deepLin[i]) * bt);
    let absorb = wa.clarity + (wb.clarity - wa.clarity) * bt;
    let amp = wa.waveAmp + (wb.waveAmp - wa.waveAmp) * bt;
    if (star > 0) {
      const sw = world.constructor.STARWATER;
      for (let i = 0; i < 3; i++) { shallow[i] += (sw.shallowLin[i] - shallow[i]) * star; deep[i] += (sw.deepLin[i] - deep[i]) * star; }
      absorb += (sw.clarity - absorb) * star;
      amp += (sw.waveAmp - amp) * star;
    }
    // Round lake ends of tributaries / river head.
    for (let c = 0; c < cols; c++) {
      const f = c / lateral;
      const t = (f * 2 - 1) * extent;
      const x = st.x + nx * t, z = st.z + nz * t;
      let wl = st.wl;
      if (isTrib && s < 60) wl -= 0.03 * (1 - s / 60) + 0.015; // sit just under the main river at the junction
      const v = r * cols + c;
      positions[v * 3] = x - ox;
      positions[v * 3 + 1] = wl - oy;
      positions[v * 3 + 2] = z - oz;
      const h = world.heightAt(x, z);
      const depth = wl - h;
      if (depth < -1.5) under[v] = 1;
      river4[v * 4] = s;
      river4[v * 4 + 1] = t;
      river4[v * 4 + 2] = depth;
      river4[v * 4 + 3] = st.rp;
      const lateralProfile = Math.max(0, 1 - 0.7 * (t / Math.max(1, half)) ** 2);
      flow[v * 3] = tx;
      flow[v * 3 + 1] = tz;
      flow[v * 3 + 2] = st.fl * lateralProfile * fdir;
      waterA[v * 4] = shallow[0]; waterA[v * 4 + 1] = shallow[1]; waterA[v * 4 + 2] = shallow[2]; waterA[v * 4 + 3] = absorb;
      waterB[v * 4] = deep[0]; waterB[v * 4 + 1] = deep[1]; waterB[v * 4 + 2] = deep[2]; waterB[v * 4 + 3] = amp;
      minY = Math.min(minY, wl); maxY = Math.max(maxY, wl);
      minX = Math.min(minX, x - ox); maxX = Math.max(maxX, x - ox);
      minZ = Math.min(minZ, z - oz); maxZ = Math.max(maxZ, z - oz);
    }
  }
  // Index buffer; skip quads entirely buried under terrain.
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < lateral; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      if (under[a] && under[b] && under[d] && under[e]) continue;
      idx.push(a, b, d, b, e, d); // counter-clockwise seen from above
    }
  }
  const indices = vCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return {
    positions, river4, flow, waterA, waterB, indices, origin: { x: ox, y: oy, z: oz }, starwater: isTrib && R.biomeOverride === 'starwater',
    bounds: { minX, maxX, minY: minY - oy, maxY: maxY - oy + 0.5, minZ, maxZ },
    river, s0, s1,
  };
}
