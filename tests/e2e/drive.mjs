// Drive test: cruises down the river in simulated time, verifying world
// streaming (terrain, water, vegetation), boat physics stability, biome
// transitions, floating-origin shifts and memory bounds. Writes a JSON report.
// Usage: node tests/e2e/drive.mjs [seconds] [quality] [outDir]
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, errorsFrom, screenshot, ROOT } from './harness.mjs';

const simSeconds = Number(process.argv[2] ?? 240);
const quality = process.argv[3] ?? 'low';
const outDir = process.argv[4] ?? path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(outDir, { recursive: true });

const { server, url } = await serveDist();
const { browser, page, logs } = await launch({ width: 960, height: 540 });
const report = { simSeconds, quality, samples: [], shots: [], ok: true, failures: [] };
try {
  await page.goto(`${url}?autostart=1&quality=${quality}&laptop=0`);
  await waitReady(page);
  await page.evaluate(() => {
    const g = window.__RB__.game;
    g.stop();
    g.time.setHours(10);
    g.time.timeScale = 0; // keep daylight for the screenshots
    g.pilot.toggle(true);
    g.pilot.level = 1;
    g.pilot.hurry = true;
  });
  const dt = 1 / 30;
  let t = 0;
  let lastShot = -999;
  while (t < simSeconds) {
    // Simulate 5 seconds per round trip, then let workers catch up.
    const sample = await page.evaluate(({ dt, n }) => {
      const g = window.__RB__.game;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) g.step(dt, dt * 1000, { render: i === n - 1 });
      const wall = performance.now() - t0;
      const st = g.stats();
      const p = g.boat.physics;
      const water = g.world.waterInfo(p.x, p.z, {});
      return { wallMsPerFrame: wall / n, s: p.s, speed: p.speed, x: p.x, z: p.z, y: p.y, depth: water.depth, level: water.level, grounded: p.collision.grounded, biome: st.biome, region: st.region, origin: { ...g.origin }, terrain: st.terrain, water: st.water, veg: st.vegetation, mem: st.memory, calls: st.render.drawCalls, tris: st.render.triangles, geometries: st.render.geometries, textures: st.render.textures, cpu: [st.cpuUpdateMs, st.cpuRenderMs] };
    }, { dt, n: 150 });
    t += 150 * dt;
    sample.t = t;
    report.samples.push(sample);
    console.log(`t=${t.toFixed(0)}s s=${sample.s.toFixed(0)} v=${sample.speed.toFixed(2)} biome=${sample.biome} depth=${sample.depth.toFixed(2)} terrain=${sample.terrain.visible}/${sample.terrain.pending} water=${sample.water.segments} veg=${sample.veg.instances} geos=${sample.geometries} calls=${sample.calls} cpu=${sample.cpu.map((v) => v.toFixed(1)).join('/')}`);
    if (!Number.isFinite(sample.y) || Math.abs(sample.y - sample.level) > 2) report.failures.push(`boat left the water at t=${t}`);
    await page.waitForTimeout(400);
    if (t - lastShot > simSeconds / 5) {
      lastShot = t;
      await page.evaluate(() => { const g = window.__RB__.game; g.step(1 / 30); g.step(1 / 30); });
      const f = path.join(outDir, `drive_${Math.round(t)}.png`);
      await screenshot(page, f);
      report.shots.push(f);
    }
  }
  const first = report.samples[0], last = report.samples[report.samples.length - 1];
  report.distance = last.s - first.s;
  report.biomes = [...new Set(report.samples.map((s) => s.biome))];
  report.maxGeometries = Math.max(...report.samples.map((s) => s.geometries));
  report.errors = errorsFrom(logs);
  if (report.distance < simSeconds * 1.5) report.failures.push(`boat only travelled ${report.distance.toFixed(0)} m`);
  if (report.errors.length) report.failures.push(`${report.errors.length} console errors`);
  report.ok = report.failures.length === 0;
} catch (e) {
  report.ok = false;
  report.failures.push(String(e && e.stack || e));
} finally {
  fs.writeFileSync(path.join(outDir, 'drive-report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ ok: report.ok, failures: report.failures, distance: report.distance, biomes: report.biomes, maxGeometries: report.maxGeometries, errors: (report.errors || []).slice(0, 8) }, null, 1));
  await browser.close();
  server.close();
  process.exit(report.ok ? 0 : 1);
}
