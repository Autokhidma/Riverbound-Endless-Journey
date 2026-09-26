// Feature test: audio engine starts after a gesture and produces sound,
// photo mode (grading, capture, subject detection, journal thumbnail),
// debug console commands, performance overlay, the benchmark, the camera
// modes and a night/storm check. Usage: node tests/e2e/features.mjs [outDir]
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, errorsFrom, screenshot, ROOT } from './harness.mjs';

const outDir = process.argv[2] ?? path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

const { server, url } = await serveDist();
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
const shot = (name) => screenshot(page, path.join(outDir, `ft_${name}.png`));
const G = (fn, arg) => page.evaluate(fn, arg);
const step = (n = 10, dt = 1 / 30) => G(({ n, dt }) => { const g = window.__RB__.game; for (let i = 0; i < n; i++) g.step(dt, dt * 1000, { render: i === n - 1 }); }, { n, dt });

try {
  await page.goto(`${url}?quality=veryLow&laptop=1&autostart=1&mode=free&seed=4242&debug=1`);
  await waitReady(page);
  await page.mouse.click(640, 360); // user gesture unlocks audio
  await page.waitForTimeout(500);
  await G(() => { const g = window.__RB__.game; g.stop(); g.time.setHours(16.8); g.hooks.noDownloads = true; });
  await step(30);
  const audio = await G(() => window.__RB__.game.audio.stats());
  check(audio.state === 'running', `audio context running after a click (${JSON.stringify(audio)})`);
  check(audio.beds && audio.beds.river > 0, 'river ambience bed is audible');

  // Audio output is not silent: analyse the master output briefly.
  const level = await G(async () => {
    const g = window.__RB__.game; const e = g.audio.engine;
    const an = e.ctx.createAnalyser(); an.fftSize = 2048; e.master.connect(an);
    g.events.emit('boat:oar', {}); g.audio.bird();
    await new Promise((r) => setTimeout(r, 400));
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    let rms = 0; for (const v of d) rms += v * v; return Math.sqrt(rms / d.length);
  });
  check(level > 0.0005, `audio output has signal (rms ${level.toFixed(5)})`);

  // Music moments do not throw.
  await G(() => { const g = window.__RB__.game; for (const k of ['discovery', 'wonder', 'lamp', 'quest', 'biome', 'chapter']) g.events.emit('music:moment', { kind: k }); g.audio.music.startSection(true); });
  await page.waitForTimeout(300);
  await G(() => { const g = window.__RB__.game; g.audio.update(0.016, g); });
  check((await G(() => window.__RB__.game.audio.music.state)) === 'play', 'generative music section plays');

  // Controls: D turns right, mouse-right turns the view right (every mode).
  const ctl = await G(() => {
    const g = window.__RB__.game;
    const THREE_V = (x, y, z) => g.camera3.position.clone().set(x, y, z);
    const out = {};
    g.cameraRig.setMode('third');
    g.boat.physics.anchored = false;
    for (let i = 0; i < 60; i++) g.step(1 / 30, 33, { render: false });
    // Steering: a world point ahead of the boat must slide left on screen
    // (the boat turns right), and the heading must increase (turn right).
    const p = g.boat.physics;
    const h0 = p.heading;
    const ahead = { x: p.x + Math.cos(p.heading) * 40, z: p.z + Math.sin(p.heading) * 40, y: p.y };
    g.input.keys.add('KeyD');
    for (let i = 0; i < 30; i++) g.step(1 / 30, 33, { render: false });
    g.input.keys.delete('KeyD');
    let dh = p.heading - h0; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    out.turnRate = dh;
    out.bowScreenDx = -g.toScene(ahead.x, ahead.y, ahead.z).project(g.camera3).x;
    // Mouse look, per camera mode: a point straight ahead must move left on screen.
    out.look = {};
    for (const mode of ['third', 'first', 'close']) {
      g.cameraRig.setMode(mode);
      for (let i = 0; i < 60; i++) g.step(1 / 30, 33, { render: false });
      const cam = g.camera3;
      const dir = cam.getWorldDirection(THREE_V(0, 0, 0));
      const pt = cam.position.clone().addScaledVector(dir, 20);
      g.input.mouse.locked = true;
      for (let i = 0; i < 6; i++) { g.input.mouse.dx = 25; g.step(1 / 30, 33, { render: false }); }
      g.input.mouse.locked = false; g.input.mouse.dx = 0;
      out.look[mode] = pt.project(cam).x;
    }
    g.cameraRig.setMode('third');
    return out;
  });
  check(ctl.turnRate > 0.4 && ctl.bowScreenDx > 0.05, `holding D turns the boat right, quickly (${JSON.stringify({ rate: ctl.turnRate.toFixed(2), bowDx: ctl.bowScreenDx.toFixed(3) })})`);
  check(Object.values(ctl.look).every((x) => x < -0.02), `moving the mouse right turns the view right in every camera mode (${JSON.stringify(ctl.look)})`);

  // Camera modes.
  for (const m of ['third', 'first', 'close', 'cinematic']) {
    await G((m) => window.__RB__.game.cameraRig.setMode(m), m);
    await step(40);
    await shot(`cam_${m}`);
  }
  await G(() => window.__RB__.game.cameraRig.setMode('third'));
  await step(20);

  // Photo mode.
  await page.keyboard.press('KeyP');
  await step(5);
  check(await G(() => window.__RB__.game.cameraRig.mode === 'photo' && window.__RB__.game.timeFrozen), 'P enters photo mode with time frozen');
  check(await page.isVisible('.photo-panel'), 'photo panel visible');
  await G(() => { const ph = window.__RB__.game.photo; ph.opts.filter = 'warm'; ph.opts.vignette = 0.6; ph.opts.dof = true; ph.opts.focus = 8; });
  await step(5);
  await shot('photo_panel');
  const photo = await G(async () => { const g = window.__RB__.game; const r = await g.photo.capture(); return { r, count: g.session.state.photos.length, thumb: (g.session.state.photos.at(-1)?.thumb ?? '').slice(0, 30) }; });
  check(photo.count === 1 && photo.thumb.startsWith('data:image/jpeg'), `photo captured with journal thumbnail (${JSON.stringify(photo)})`);
  await page.keyboard.press('Escape');
  await step(5);
  check(await G(() => window.__RB__.game.cameraRig.mode !== 'photo' && !window.__RB__.game.timeFrozen), 'Esc leaves photo mode');

  // Console.
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(100);
  check(await page.isVisible('.console'), 'console opens with `');
  await page.keyboard.type('where');
  await page.keyboard.press('Enter');
  await page.keyboard.type('weather storm');
  await page.keyboard.press('Enter');
  await page.keyboard.type('time 21.5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const logText = await page.textContent('.console .log');
  check(/regionIndex/.test(logText) && /weather storm/.test(logText), 'console commands run');
  await shot('console');
  await page.keyboard.press('Backquote');
  const cmds = await G(() => {
    const d = window.__RB__.game.debug;
    const out = {};
    for (const c of ['help', 'seed', 'stats', 'quality', 'rt', 'give river_tea 2', 'coins 50', 'colliders', 'flow', 'wire', 'wire', 'find waterfall', 'tp 900', 'region 2', 'story', 'audio']) {
      try { const r = d.run(c); out[c] = r === undefined ? 'ok' : 'ok'; } catch (e) { out[c] = `ERR ${e.message}`; }
    }
    return out;
  });
  const bad = Object.entries(cmds).filter(([, v]) => v !== 'ok');
  check(bad.length === 0, `all console commands succeed ${bad.length ? JSON.stringify(bad) : ''}`);
  await step(60);
  // Storm at night with lightning.
  await G(() => { const g = window.__RB__.game; g.debug.run('colliders'); g.debug.run('flow'); g.debug.run('tp 400'); g.debug.run('time 22'); g.debug.run('weather storm'); });
  await step(90);
  await shot('storm_night');

  // Perf overlay.
  await page.keyboard.press('F3');
  await step(10);
  const perf = await page.textContent('.perf');
  check(/FPS/.test(perf) && /draw calls/.test(perf), 'F3 performance overlay shows metrics');
  await shot('perf');

  // Benchmark (short, real frames).
  await G(() => { const g = window.__RB__.game; g.debug.run('weather clear'); g.start(); });
  const report = await G(() => window.__RB__.game.debug.runBenchmark({ seconds: 6, warmup: 1 }));
  check(report && report.frames > 5 && report.avgFps > 0, `benchmark report (${report.avgFps.toFixed(1)} fps, ${report.frames} frames, p99 ${report.p99Ms.toFixed(0)} ms)`);
  await page.waitForTimeout(300);
  await shot('benchmark');
  const errs = errorsFrom(logs);
  check(errs.length === 0, `no console errors${errs.length ? `: ${errs.slice(0, 5).join(' | ')}` : ''}`);
} catch (e) {
  failures.push(String(e && e.stack || e));
  console.log(e);
  await shot('zz_failure').catch(() => {});
} finally {
  console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 1));
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
}
