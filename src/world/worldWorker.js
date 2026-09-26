// World-generation worker: owns its own deterministic WorldGen and builds
// terrain nodes, water ribbons and vegetation scatter off the main thread.
import { WorldGen } from './WorldGen.js';
import { buildTerrainNode } from './TerrainMesher.js';
import { buildRiverSegment } from './RiverMesher.js';
import { buildScatter } from './Scatter.js';

let world = null;

function transferables(obj) {
  const list = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (ArrayBuffer.isView(o)) { list.push(o.buffer); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(obj);
  return list;
}

self.onmessage = (e) => {
  const msg = e.data;
  const t0 = performance.now();
  try {
    switch (msg.type) {
      case 'init':
        world = new WorldGen(msg.seed);
        self.postMessage({ type: 'ready', id: msg.id });
        return;
      case 'terrain': {
        const res = buildTerrainNode(world, msg.params);
        self.postMessage({ type: 'result', id: msg.id, kind: 'terrain', result: res, ms: performance.now() - t0 }, transferables(res));
        return;
      }
      case 'water': {
        const res = buildRiverSegment(world, msg.params);
        self.postMessage({ type: 'result', id: msg.id, kind: 'water', result: res, ms: performance.now() - t0 }, res ? transferables(res) : []);
        return;
      }
      case 'scatter': {
        const res = buildScatter(world, msg.params);
        self.postMessage({ type: 'result', id: msg.id, kind: 'scatter', result: res, ms: performance.now() - t0 }, transferables(res));
        return;
      }
      default:
        self.postMessage({ type: 'error', id: msg.id, error: `unknown job ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, error: String(err && err.stack || err) });
  }
};
