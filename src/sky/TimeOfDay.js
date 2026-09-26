// In-game clock and named day phases. Pure logic (no rendering).
import { sunDirection, moonDirection, moonPhaseAngle, moonIllumination, starRotation } from './Celestial.js';

export const PHASES = [
  { id: 'night', label: 'Night' },
  { id: 'predawn', label: 'Pre-dawn' },
  { id: 'dawn', label: 'Dawn' },
  { id: 'morning', label: 'Morning' },
  { id: 'midday', label: 'Midday' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'golden', label: 'Golden Hour' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'twilight', label: 'Twilight' },
];

export class TimeOfDay {
  constructor({ hours = 16.2, day = 0, dayLengthMinutes = 24 } = {}) {
    this.hours = hours;
    this.day = day;
    this.dayLengthMinutes = dayLengthMinutes;
    this.paused = false;
    this.timeScale = 1;
    this.sunDir = [0, 1, 0];
    this.moonDir = [0, -1, 0];
    this.starMatrix = new Array(9).fill(0);
    this.update(0);
  }

  get totalDays() {
    return this.day + this.hours / 24;
  }

  /** Real seconds per in-game hour. */
  get secondsPerHour() {
    return (this.dayLengthMinutes * 60) / 24;
  }

  setHours(h) {
    this.hours = ((h % 24) + 24) % 24;
    this.update(0);
  }

  /** Advance the clock by dt real seconds. */
  update(dt) {
    if (!this.paused && dt > 0) {
      this.hours += (dt * this.timeScale) / this.secondsPerHour;
      while (this.hours >= 24) { this.hours -= 24; this.day += 1; }
    }
    sunDirection(this.hours, this.sunDir);
    moonDirection(this.hours, this.totalDays, this.moonDir);
    starRotation(this.hours, this.totalDays, this.starMatrix);
    this.sunElevation = Math.asin(Math.max(-1, Math.min(1, this.sunDir[1]))) * 180 / Math.PI;
    this.moonElevation = Math.asin(Math.max(-1, Math.min(1, this.moonDir[1]))) * 180 / Math.PI;
    this.moonPhase = moonPhaseAngle(this.totalDays);
    this.moonLight = moonIllumination(this.moonPhase);
    this.isMorning = this.hours < 12;
    this.phase = this.computePhase();
  }

  computePhase() {
    const el = this.sunElevation;
    const morning = this.isMorning;
    if (el < -12) return morning && this.hours > 2 ? 'predawn' : 'night';
    if (el < -2) return morning ? 'predawn' : 'twilight';
    if (el < 5) return morning ? 'dawn' : 'sunset';
    if (el < 14) return morning ? 'morning' : 'golden';
    if (el > 48) return 'midday';
    return morning ? 'morning' : 'afternoon';
  }

  get phaseLabel() {
    return PHASES.find((p) => p.id === this.phase)?.label ?? this.phase;
  }

  /** 0 in full day, 1 in full night (sun well below horizon). */
  get nightFactor() {
    const el = this.sunElevation;
    return Math.max(0, Math.min(1, (-el - 2) / 12));
  }

  get isNight() {
    return this.sunElevation < -4;
  }

  clockString() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  serialize() {
    return { hours: this.hours, day: this.day };
  }

  restore(data) {
    if (!data) return;
    this.hours = data.hours ?? this.hours;
    this.day = data.day ?? this.day;
    this.update(0);
  }
}
