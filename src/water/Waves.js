// Wave model shared by the GPU (vertex displacement) and the CPU (boat
// buoyancy). Waves live in river coordinates (s = along the flow, t = across)
// so they naturally follow bends and travel downstream. The GLSL below is
// generated from the same table, which keeps the boat synchronised with the
// visible surface.

// [amplitude weight, wavelength (m), direction along s, direction along t, speed factor, phase]
export const WAVE_TABLE = [
  [1.0, 7.3, 0.94, 0.34, 1.0, 0.0],
  [0.7, 4.1, 0.8, -0.6, 1.1, 1.7],
  [0.45, 2.6, 0.55, 0.83, 1.2, 4.1],
  [0.3, 1.7, 0.98, -0.2, 1.35, 2.9],
];

const G = 9.81;
const PRE = WAVE_TABLE.map(([a, L, ds, dt, sp, ph]) => {
  const k = (Math.PI * 2) / L;
  const n = Math.hypot(ds, dt);
  const omega = Math.sqrt(G * k) * sp * 0.55;
  return { a, k, ds: ds / n, dt: dt / n, omega, ph };
});

/**
 * Height offset of the water surface.
 * @param s along-river distance (m), t lateral offset (m), time (s)
 * @param amp overall amplitude (m), layers number of wave layers used
 */
export function waveHeight(s, t, time, amp, layers = 4) {
  let h = 0;
  for (let i = 0; i < layers && i < PRE.length; i++) {
    const w = PRE[i];
    h += w.a * Math.sin(w.k * (w.ds * s + w.dt * t) - w.omega * time + w.ph);
  }
  return h * amp;
}

/** Surface slope (dh/ds, dh/dt) for pitch/roll. */
export function waveSlope(s, t, time, amp, layers = 4, out = { ds: 0, dt: 0 }) {
  let gs = 0, gt = 0;
  for (let i = 0; i < layers && i < PRE.length; i++) {
    const w = PRE[i];
    const c = Math.cos(w.k * (w.ds * s + w.dt * t) - w.omega * time + w.ph) * w.a * w.k;
    gs += c * w.ds;
    gt += c * w.dt;
  }
  out.ds = gs * amp;
  out.dt = gt * amp;
  return out;
}

/** GLSL implementation generated from the same table. */
export function wavesGLSL(layers = 4) {
  const lines = PRE.slice(0, layers).map((w, i) => {
    const f = (v) => v.toFixed(6);
    return `  { float ph = ${f(w.k)} * (${f(w.ds)} * st.x + ${f(w.dt)} * st.y) - ${f(w.omega)} * time + ${f(w.ph)};
    h += ${f(w.a)} * sin(ph);
    float c = ${f(w.a * w.k)} * cos(ph);
    g += vec2(c * ${f(w.ds)}, c * ${f(w.dt)}); }`;
  });
  return /* glsl */ `
// returns height in .x, slope (d/ds, d/dt) in .yz
vec3 rbWaves(vec2 st, float time, float amp) {
  float h = 0.0;
  vec2 g = vec2(0.0);
${lines.join('\n')}
  return vec3(h, g) * amp;
}`;
}
