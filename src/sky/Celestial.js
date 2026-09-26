// Sun, moon and star-sphere positions. World axes: +X east, -Z north, +Y up.
import { DEG } from '../core/math.js';

export const LATITUDE = 38 * DEG;
export const SUN_DECLINATION = 12 * DEG;
export const LUNAR_CYCLE_DAYS = 8; // a full set of moon phases every 8 in-game days

/** Direction of a body with hour angle H and declination d. Writes into out [x,y,z]. */
export function bodyDirection(H, d, out = [0, 0, 0], lat = LATITUDE) {
  const east = -Math.cos(d) * Math.sin(H);
  const up = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H);
  const north = Math.cos(lat) * Math.sin(d) - Math.sin(lat) * Math.cos(d) * Math.cos(H);
  out[0] = east;
  out[1] = up;
  out[2] = -north;
  return out;
}

/** Hour angle of the sun for a clock time in hours. */
export function sunHourAngle(hours) {
  return ((hours - 12) / 24) * Math.PI * 2;
}

export function sunDirection(hours, out) {
  return bodyDirection(sunHourAngle(hours), SUN_DECLINATION, out);
}

/** Moon phase angle in [0, 2PI): 0 = new moon, PI = full moon. */
export function moonPhaseAngle(totalDays) {
  const p = (totalDays / LUNAR_CYCLE_DAYS) % 1;
  return p * Math.PI * 2 + Math.PI * 0.85; // start the journey near a waxing gibbous
}

export function moonDirection(hours, totalDays, out) {
  const H = sunHourAngle(hours) - moonPhaseAngle(totalDays);
  return bodyDirection(H, 4 * DEG, out);
}

/** Illuminated fraction of the moon disc for a phase angle. */
export function moonIllumination(phaseAngle) {
  return 0.5 * (1 - Math.cos(phaseAngle));
}

/**
 * Rotation of the star sphere: stars rotate about the celestial pole once per
 * day. Returns a column-major 3x3 matrix (array of 9) mapping celestial
 * coordinates to world directions.
 */
export function starRotation(hours, totalDays, out = new Array(9)) {
  const angle = sunHourAngle(hours) + (totalDays % 365) * (Math.PI * 2 / 365);
  // Celestial pole points north, elevated by latitude.
  const px = 0, py = Math.sin(LATITUDE), pz = -Math.cos(LATITUDE);
  // Rodrigues rotation about pole axis.
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const m00 = t * px * px + c, m01 = t * px * py - s * pz, m02 = t * px * pz + s * py;
  const m10 = t * px * py + s * pz, m11 = t * py * py + c, m12 = t * py * pz - s * px;
  const m20 = t * px * pz - s * py, m21 = t * py * pz + s * px, m22 = t * pz * pz + c;
  // column-major for THREE.Matrix3.fromArray
  out[0] = m00; out[1] = m10; out[2] = m20;
  out[3] = m01; out[4] = m11; out[5] = m21;
  out[6] = m02; out[7] = m12; out[8] = m22;
  return out;
}
