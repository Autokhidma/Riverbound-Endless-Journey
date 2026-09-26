// Procedural sky/light palette keyed by sun elevation, with distinct morning
// and evening moods, biome tints and weather overrides. All output colours are
// linear RGB arrays ready for shader uniforms.
import { hexToLinear, lerp, saturate, smoothstep } from '../core/math.js';

const K = (el, o) => ({ el, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? hexToLinear(v) : v])) });

// Evening keyframes.
const EVENING = [
  K(-18, { zenith: '#02040b', horizon: '#080f20', sunward: '#0a1022', glow: '#000000', anti: '#070d1c', fog: '#070c18', sun: '#000000', sunI: 0, ambSky: '#1a2744', ambGround: '#040608', ambI: 0.18, cloudLit: '#1b2134', cloudShade: '#0a0d16', exposure: 1.0, stars: 1.0 }),
  K(-10, { zenith: '#050b1e', horizon: '#161d3c', sunward: '#241f44', glow: '#2a1530', anti: '#0f1631', fog: '#121830', sun: '#000000', sunI: 0, ambSky: '#26325a', ambGround: '#06080c', ambI: 0.22, cloudLit: '#2c2a48', cloudShade: '#10121e', exposure: 1.0, stars: 0.85 }),
  K(-6, { zenith: '#0c1738', horizon: '#35325f', sunward: '#6e3f63', glow: '#8a3c52', anti: '#262958', fog: '#343556', sun: '#000000', sunI: 0, ambSky: '#3c4478', ambGround: '#0c0c12', ambI: 0.3, cloudLit: '#6a4468', cloudShade: '#1c1a2c', exposure: 1.0, stars: 0.35 }),
  K(-3, { zenith: '#182a58', horizon: '#6a5486', sunward: '#d0706a', glow: '#ff6a40', anti: '#735f95', fog: '#665674', sun: '#ff5a30', sunI: 0.05, ambSky: '#5a5c94', ambGround: '#18141a', ambI: 0.42, cloudLit: '#e07a70', cloudShade: '#3a2c48', exposure: 1.0, stars: 0.08 }),
  K(0, { zenith: '#284684', horizon: '#c07c88', sunward: '#ff9448', glow: '#ff6428', anti: '#b488a6', fog: '#b98a8e', sun: '#ff6a2e', sunI: 0.9, ambSky: '#7c7cae', ambGround: '#3a2a26', ambI: 0.55, cloudLit: '#ffa070', cloudShade: '#6a4a68', exposure: 1.0, stars: 0.0 }),
  K(3, { zenith: '#365ca4', horizon: '#dc9c80', sunward: '#ffb060', glow: '#ff8a3a', anti: '#cca6b0', fog: '#d4ac96', sun: '#ff9650', sunI: 1.7, ambSky: '#8e98c4', ambGround: '#4a3a2c', ambI: 0.62, cloudLit: '#ffc890', cloudShade: '#8a6a78', exposure: 1.0, stars: 0.0 }),
  K(8, { zenith: '#4674bc', horizon: '#e4c4a0', sunward: '#ffd090', glow: '#ffb060', anti: '#b4bcd4', fog: '#dcc6a6', sun: '#ffc07c', sunI: 2.6, ambSky: '#9cb2d8', ambGround: '#5a4a34', ambI: 0.7, cloudLit: '#fff0d6', cloudShade: '#a8a0a8', exposure: 1.0, stars: 0.0 }),
  K(16, { zenith: '#467ecc', horizon: '#b6cee6', sunward: '#eee0c2', glow: '#fff0d0', anti: '#a6c2e6', fog: '#c6d6e6', sun: '#fff0da', sunI: 3.2, ambSky: '#a8c4ea', ambGround: '#5c5440', ambI: 0.75, cloudLit: '#ffffff', cloudShade: '#b0b8c8', exposure: 1.0, stars: 0.0 }),
  K(35, { zenith: '#3c76cc', horizon: '#a8c8ea', sunward: '#d6e6f4', glow: '#ffffff', anti: '#9ebee6', fog: '#b6cee6', sun: '#fff8f0', sunI: 3.6, ambSky: '#a8c6ec', ambGround: '#5e5a48', ambI: 0.78, cloudLit: '#ffffff', cloudShade: '#b8c2d2', exposure: 1.0, stars: 0.0 }),
  K(70, { zenith: '#3670c8', horizon: '#a2c4e8', sunward: '#d0e2f2', glow: '#ffffff', anti: '#9cbce4', fog: '#b2cae4', sun: '#ffffff', sunI: 3.8, ambSky: '#a6c4ec', ambGround: '#605c4a', ambI: 0.8, cloudLit: '#ffffff', cloudShade: '#bcc6d6', exposure: 1.0, stars: 0.0 }),
];

// Morning keyframes override a few colours: cooler, pinker, lavender mist.
const MORNING_OVERRIDES = [
  K(-6, { horizon: '#3a3a6c', sunward: '#8a4f7a', glow: '#a04a6a', anti: '#2c2e62' }),
  K(-3, { horizon: '#7a64a0', sunward: '#e2809a', glow: '#ff7c78', anti: '#7a6aa6', fog: '#7a6a8e', cloudLit: '#f090a8' }),
  K(0, { horizon: '#d096b4', sunward: '#ffa088', glow: '#ff8058', anti: '#b8a0c8', fog: '#c8a6bc', cloudLit: '#ffb0a8' }),
  K(3, { horizon: '#e6b6b0', sunward: '#ffc0a0', glow: '#ffa070', anti: '#c8bcd8', fog: '#dcc0c0', cloudLit: '#ffd8c8' }),
  K(8, { horizon: '#e6d2c6', sunward: '#ffdcb8', fog: '#dcd2cc' }),
];

const KEYS = ['zenith', 'horizon', 'sunward', 'glow', 'anti', 'fog', 'sun', 'ambSky', 'ambGround', 'cloudLit', 'cloudShade'];
const SCALARS = ['sunI', 'ambI', 'exposure', 'stars'];

function evalKeys(frames, el, out) {
  let i = 0;
  while (i < frames.length - 2 && el > frames[i + 1].el) i++;
  const a = frames[i], b = frames[i + 1];
  const t = saturate((el - a.el) / (b.el - a.el));
  const tt = t * t * (3 - 2 * t);
  for (const k of KEYS) {
    if (!a[k] || !b[k]) continue;
    const o = (out[k] ??= [0, 0, 0]);
    o[0] = lerp(a[k][0], b[k][0], tt); o[1] = lerp(a[k][1], b[k][1], tt); o[2] = lerp(a[k][2], b[k][2], tt);
  }
  for (const k of SCALARS) if (a[k] !== undefined) out[k] = lerp(a[k], b[k], tt);
  return out;
}

function evalOverrides(el, morningW, out) {
  if (morningW <= 0) return;
  const frames = MORNING_OVERRIDES;
  if (el < frames[0].el - 4 || el > frames[frames.length - 1].el + 6) return;
  let i = 0;
  while (i < frames.length - 2 && el > frames[i + 1].el) i++;
  const a = frames[i], b = frames[i + 1];
  const t = saturate((el - a.el) / (b.el - a.el));
  const fade = smoothstep(frames[0].el - 4, frames[0].el, el) * (1 - smoothstep(frames[frames.length - 1].el, frames[frames.length - 1].el + 6, el));
  for (const k of KEYS) {
    const ca = a[k] ?? b[k], cb = b[k] ?? a[k];
    if (!ca) continue;
    const w = morningW * fade;
    const o = out[k];
    for (let c = 0; c < 3; c++) o[c] = lerp(o[c], lerp(ca[c], cb[c], t), w);
  }
}

function mixInto(o, c, w) {
  o[0] = lerp(o[0], c[0], w); o[1] = lerp(o[1], c[1], w); o[2] = lerp(o[2], c[2], w);
}

function luminance(c) {
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}

function saturateColor(c, amount) {
  const l = luminance(c);
  c[0] = Math.max(0, l + (c[0] - l) * amount);
  c[1] = Math.max(0, l + (c[1] - l) * amount);
  c[2] = Math.max(0, l + (c[2] - l) * amount);
}

/**
 * Evaluate the full palette.
 * @param {object} p { sunElevation, isMorning, biome: {atmosphere}, weather: {cloud, rain, fog, storm, haze} }
 */
export function evaluatePalette({ sunElevation, isMorning, atmosphere, weather }, out = {}) {
  const el = sunElevation;
  evalKeys(EVENING, el, out);
  evalOverrides(el, isMorning ? 1 : 0, out);

  // Biome flavour.
  if (atmosphere) {
    const dayW = smoothstep(-2, 12, el);
    const sunsetW = smoothstep(-8, 0, el) * (1 - smoothstep(4, 16, el));
    mixInto(out.zenith, atmosphere.skyTintLin, 0.18 * dayW);
    mixInto(out.fog, atmosphere.fogTintLin, 0.35 * dayW);
    const boost = atmosphere.sunset ?? 1;
    if (sunsetW > 0) {
      saturateColor(out.sunward, lerp(1, boost, sunsetW));
      saturateColor(out.glow, lerp(1, boost, sunsetW));
      saturateColor(out.horizon, lerp(1, 0.5 + boost * 0.5, sunsetW));
    }
    out.stars *= atmosphere.stars ?? 1;
  }

  // Weather: overcast greys, dim sun, heavier fog.
  const w = weather || {};
  const cloud = saturate(w.cloud ?? 0);
  const storm = saturate(w.storm ?? 0);
  const overcast = saturate(cloud * 0.85 + (w.rain ?? 0) * 0.5 + storm * 0.6);
  if (overcast > 0) {
    const greyDay = [0.34, 0.37, 0.41];
    // Overcast nights keep a faint blue-grey cloud glow so the world stays readable.
    const greyNight = [0.034, 0.041, 0.058];
    const day = smoothstep(-8, 20, el);
    const grey = [lerp(greyNight[0], greyDay[0], day), lerp(greyNight[1], greyDay[1], day), lerp(greyNight[2], greyDay[2], day)];
    const dim = lerp(0.9, 0.58, day);
    const stormGrey = [grey[0] * dim, grey[1] * (dim + 0.03), grey[2] * (dim + 0.1)];
    const g = storm > 0 ? [lerp(grey[0], stormGrey[0], storm), lerp(grey[1], stormGrey[1], storm), lerp(grey[2], stormGrey[2], storm)] : grey;
    for (const k of ['zenith', 'horizon', 'sunward', 'anti', 'fog']) mixInto(out[k], g, overcast * 0.8);
    mixInto(out.glow, g, overcast * 0.6);
    mixInto(out.cloudLit, [g[0] * 1.8, g[1] * 1.8, g[2] * 1.8], overcast * 0.7);
    mixInto(out.cloudShade, [g[0] * 0.8, g[1] * 0.8, g[2] * 0.85], overcast * 0.7);
    out.sunI *= 1 - overcast * 0.78;
    out.ambI *= 1 - overcast * 0.2 * day;
    if (day < 1) mixInto(out.ambSky, [0.16, 0.2, 0.3], overcast * 0.5 * (1 - day));
    out.stars *= 1 - overcast;
  }
  out.stars *= 1 - saturate(w.fog ?? 0) * 0.7;
  out.overcast = overcast;
  return out;
}
