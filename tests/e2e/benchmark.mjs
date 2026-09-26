// Benchmark runner: for each preset, cruise down the river with real
// rendering and record frame-time statistics. Writes JSON + Markdown reports.
// Usage: node tests/e2e/benchmark.mjs [seconds] [presets comma-separated] [outDir]
// Note: in CI/headless this uses software WebGL (SwiftShader), so absolute
// numbers are far below a real GPU; compare presets relative to each other.
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, ROOT } from './harness.mjs';

const seconds = Number(process.argv[2] ?? 15);
const presets = (process.argv[3] ?? 'veryLow,low,medium,high').split(',');
const outDir = process.argv[4] ?? path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(outDir, { recursive: true });
const { server, url } = await serveDist();
const results = [];
try {
  for (const preset of presets) {
    for (const laptop of preset === 'medium' ? [0, 1] : [0]) {
      const { browser, page } = await launch({ width: 1280, height: 720 });
      await page.goto(`${url}?autostart=1&mode=free&quality=${preset}&laptop=${laptop}`);
      await waitReady(page);
      await page.waitForTimeout(1500);
      const r = await page.evaluate((s) => window.__RB__.game.debug.runBenchmark({ seconds: s, warmup: 2 }), seconds);
      console.log(`${preset}${laptop ? '+laptop' : ''}: ${r.avgFps.toFixed(1)} fps avg, 1% low ${r.onePercentLowFps.toFixed(1)}, p99 ${r.p99Ms.toFixed(0)} ms, ${r.avgDrawCalls.toFixed(0)} draws, ${(r.avgTriangles / 1000).toFixed(0)}k tris, scale ${(r.avgRenderScale * 100).toFixed(0)}%`);
      results.push(r);
      await browser.close();
    }
  }
} finally {
  server.close();
}
fs.writeFileSync(path.join(outDir, 'benchmark-report.json'), JSON.stringify(results, null, 1));
const md = ['| Preset | Laptop | Avg FPS | 1% low | p50 ms | p99 ms | Draw calls | Triangles | Render scale |', '|-|-|-|-|-|-|-|-|-|',
  ...results.map((r) => `| ${r.preset} | ${r.laptopMode ? 'yes' : 'no'} | ${r.avgFps.toFixed(1)} | ${r.onePercentLowFps.toFixed(1)} | ${r.p50Ms.toFixed(1)} | ${r.p99Ms.toFixed(1)} | ${r.avgDrawCalls.toFixed(0)} | ${(r.avgTriangles / 1000).toFixed(0)}k | ${(r.avgRenderScale * 100).toFixed(0)}% |`),
  '', `GPU: ${results[0]?.gpu ?? 'n/a'}`].join('\n');
fs.writeFileSync(path.join(outDir, 'benchmark-report.md'), md);
console.log(md);
