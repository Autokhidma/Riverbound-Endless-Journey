// Screenshot tour: boots the build and captures scenes at different times of
// day and camera modes. Usage: node tests/e2e/shots.mjs [outDir] [quality]
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, errorsFrom, ROOT } from './harness.mjs';

const outDir = process.argv[2] ?? path.join(ROOT, 'docs/screenshots');
const quality = process.argv[3] ?? 'medium';
const only = process.argv[4] ?? null;
fs.mkdirSync(outDir, { recursive: true });

const { server, url } = await serveDist();
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
try {
  await page.goto(`${url}?autostart=1&quality=${quality}&laptop=0`);
  await waitReady(page);
  const shots = [
    { name: 'afternoon_third', hours: 15.2, cam: 'third', steps: 3 },
    { name: 'golden_hour', hours: 18.0, cam: 'third', yaw: 0.6 },
    { name: 'sunset_cinematic', hours: 18.55, cam: 'cinematic' },
    { name: 'twilight_close', hours: 19.05, cam: 'close', lantern: true },
    { name: 'night_sky', hours: 23.2, cam: 'third', pitch: -0.2, lantern: true },
    { name: 'night_first_person', hours: 22.5, cam: 'first', lantern: true },
    { name: 'sunrise', hours: 5.75, cam: 'third', yaw: 2.6 },
  ].filter((s) => !only || s.name.includes(only));
  for (const s of shots) {
    await page.evaluate(async (s) => {
      const g = window.__RB__.game;
      g.time.setHours(s.hours);
      g.boat.lanternOn = !!s.lantern;
      g.boat.lanternLevel = s.lantern ? 1 : 0;
      g.cameraRig.setMode(s.cam);
      g.cameraRig.trans.t = 1;
      if (s.yaw !== undefined) g.cameraRig.orbit.yaw = s.yaw;
      if (s.pitch !== undefined) g.cameraRig.orbit.pitch = s.pitch;
      g.pipeline.updateEnvironment(g.sky.envScene, true);
      g.stop();
      for (let i = 0; i < (s.steps ?? 3); i++) g.step(1 / 30);
    }, s);
    // Give streaming a moment, then render a few frames.
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const g = window.__RB__.game; for (let i = 0; i < 2; i++) g.step(1 / 30); });
    await page.screenshot({ path: path.join(outDir, `${s.name}.png`) });
    console.log('shot', s.name);
  }
  const stats = await page.evaluate(() => window.__RB__.game.stats());
  console.log(JSON.stringify(stats, null, 1));
} finally {
  const errs = errorsFrom(logs);
  if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 20).join('\n'));
  const warns = logs.filter((l) => l.type === 'warning').slice(0, 10);
  if (warns.length) console.log('WARNINGS:\n' + warns.map((w) => w.text).join('\n'));
  await browser.close();
  server.close();
}
