// Dynamic resolution controller: targets a stable frame time rather than the
// maximum resolution. Uses GPU timer queries when available, otherwise the
// smoothed CPU frame interval. Hysteresis avoids oscillation.

export class DynamicResolution {
  constructor() {
    this.configure({ targetFps: 60, minScale: 0.6, maxScale: 1, dynamicRes: true });
  }

  configure(q) {
    this.enabled = q.dynamicRes;
    this.targetMs = 1000 / (q.targetFps || 60);
    this.minScale = q.minScale ?? 0.6;
    this.maxScale = q.maxScale ?? 1;
    this.avg = this.targetMs;
    this.cooldown = 1.5;
    this.lastChange = 0;
  }

  /**
   * @param frameMs measured frame interval (ms)
   * @param gpuMs GPU time if known
   * @param scale current scale
   * @returns new scale or null for no change
   */
  update(frameMs, gpuMs, scale) {
    if (!this.enabled) return null;
    const sample = gpuMs && gpuMs > 0 ? Math.max(gpuMs, frameMs * 0.6) : frameMs;
    this.avg += (Math.min(sample, 100) - this.avg) * 0.05;
    this.cooldown -= frameMs / 1000;
    if (this.cooldown > 0) return null;
    const ratio = this.avg / this.targetMs;
    let next = scale;
    if (ratio > 1.12) next = scale * Math.max(0.85, 1 / Math.sqrt(ratio));
    else if (ratio < 0.8) next = scale * 1.06;
    next = Math.min(this.maxScale, Math.max(this.minScale, next));
    if (Math.abs(next - scale) < 0.04) return null;
    this.cooldown = ratio > 1.3 ? 0.8 : 2.0;
    return next;
  }
}
