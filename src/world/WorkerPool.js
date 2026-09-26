// Pool of world-generation workers with a priority queue, cancellation of
// stale jobs and a synchronous fallback (used in tests / if workers fail).
import { WorldGen } from './WorldGen.js';
import { buildTerrainNode } from './TerrainMesher.js';
import { buildRiverSegment } from './RiverMesher.js';
import { buildScatter } from './Scatter.js';

export class WorkerPool {
  constructor(seed, { count = 2, useWorkers = true } = {}) {
    this.seed = seed;
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.workers = [];
    this.stats = { done: 0, ms: 0, queued: 0, inFlight: 0, errors: 0 };
    this.maxInFlightPerWorker = 2;
    if (useWorkers && typeof Worker !== 'undefined') {
      try {
        for (let i = 0; i < count; i++) {
          const w = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
          w.inFlight = 0;
          w.onmessage = (e) => this.onMessage(w, e.data);
          w.onerror = (e) => { console.error('[worker] error', e.message || e); this.stats.errors++; };
          w.postMessage({ type: 'init', seed, id: 0 });
          this.workers.push(w);
        }
      } catch (err) {
        console.warn('[worker] falling back to main-thread generation', err);
        this.workers = [];
      }
    }
    if (!this.workers.length) this.syncWorld = new WorldGen(seed);
  }

  /** Queue a job. priority: lower runs first. Returns a promise. */
  request(type, params, priority = 0, key = null) {
    return new Promise((resolve, reject) => {
      const job = { id: this.nextId++, type, params, priority, key, resolve, reject, cancelled: false };
      this.queue.push(job);
      this.stats.queued = this.queue.length;
      this.pump();
      if (key) job.key = key;
      this._last = job;
    });
  }

  /** Cancel queued (not yet dispatched) jobs whose key fails the predicate. */
  prune(keep) {
    const before = this.queue.length;
    this.queue = this.queue.filter((j) => {
      if (j.key && !keep(j.key)) { j.cancelled = true; j.resolve(null); return false; }
      return true;
    });
    return before - this.queue.length;
  }

  reprioritize(fn) {
    for (const j of this.queue) if (j.key) j.priority = fn(j.key, j.priority);
  }

  pump() {
    if (!this.workers.length) return this.pumpSync();
    this.queue.sort((a, b) => a.priority - b.priority);
    for (const w of this.workers) {
      while (w.inFlight < this.maxInFlightPerWorker && this.queue.length) {
        const job = this.queue.shift();
        w.inFlight++;
        this.stats.inFlight++;
        this.pending.set(job.id, job);
        w.postMessage({ type: job.type, id: job.id, params: job.params });
      }
    }
    this.stats.queued = this.queue.length;
  }

  pumpSync(budgetMs = 8) {
    if (this.syncBusy) return;
    this.syncBusy = true;
    const run = () => {
      const t0 = performance.now();
      this.queue.sort((a, b) => a.priority - b.priority);
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        const job = this.queue.shift();
        try {
          const w = this.syncWorld;
          const res = job.type === 'terrain' ? buildTerrainNode(w, job.params) : job.type === 'water' ? buildRiverSegment(w, job.params) : buildScatter(w, job.params);
          this.stats.done++;
          job.resolve(res);
        } catch (err) { job.reject(err); }
      }
      this.stats.queued = this.queue.length;
      if (this.queue.length) setTimeout(run, 0); else this.syncBusy = false;
    };
    setTimeout(run, 0);
  }

  onMessage(w, msg) {
    if (msg.type === 'ready') return;
    const job = this.pending.get(msg.id);
    if (!job) return;
    this.pending.delete(msg.id);
    w.inFlight--;
    this.stats.inFlight--;
    if (msg.type === 'error') {
      this.stats.errors++;
      console.error('[worker] job failed', msg.error);
      job.reject(new Error(msg.error));
    } else {
      this.stats.done++;
      this.stats.ms += msg.ms;
      job.resolve(msg.result);
    }
    this.pump();
  }

  get busy() {
    return this.queue.length + this.pending.size;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
  }
}
