// Story playthrough: plays every step of the main story from the Prologue to
// the end of the Epilogue in a real generated world, using the game's own
// triggers (travel to places, talk to characters, fish, sell, discover, read,
// photograph, open the veil, light lamps at night). Then checks the journey
// continues as free exploration on the same save.
// Usage: node tests/e2e/story.mjs [seed] [outDir]
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, errorsFrom, screenshot, ROOT } from './harness.mjs';

const seed = process.argv[2] ?? 'RIVERBOUND';
const outDir = process.argv[3] ?? path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

const { server, url } = await serveDist();
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
try {
  await page.goto(`${url}?quality=veryLow&laptop=1&seed=${encodeURIComponent(seed)}`);
  await waitReady(page);
  await page.evaluate(async (seed) => {
    const g = window.__RB__.game;
    g.stop();
    g.hooks.noDownloads = true;
    await g.ui.startJourney({ mode: 'story', seed, skipIntro: true });
  }, seed);
  // Install the driver in the page.
  await page.evaluate(() => {
    const g = window.__RB__.game;
    const run = (n, render = false) => { for (let i = 0; i < n; i++) g.step(1 / 30, 33, { render: render && i === n - 1 }); };
    /** Put the boat on water near a world point (searching rings around it). */
    const goNear = (x, z, within = 30) => {
      const w = g.world;
      let best = null;
      for (let r = 0; r <= within + 60 && !best; r += 4) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          const info = w.waterInfo(px, pz, {});
          if (info.depth > 0.7) { best = { x: px, z: pz, info }; break; }
        }
      }
      if (!best) { const n = w.main.nearest(x, z, {}); const p = w.riverToWorld(n.s, 0); best = { x: p.x, z: p.z }; }
      const f = g.world.flowAt(best.x, best.z, {});
      if (g.onFoot) g.onFootSystem.board();
      g.setOrigin(best.x, best.z);
      g.boat.placeAt(best.x, best.z, Math.atan2(f.z, f.x));
      g.boat.physics.anchored = true;
      run(45);
      return Math.hypot(best.x - x, best.z - z);
    };
    const setNight = () => { g.time.setHours(22.5); run(2); };
    const interact = (prefix) => {
      const list = [...g.story.interactables(g)];
      const it = list.find((i) => i.id.startsWith(prefix));
      if (!it) return false;
      it.action();
      return true;
    };
    const npcFor = (key) => [...g.npcs.spawned.values()].map((s) => s.npc).find((n) => n.storyKey === key);
    window.__STORY__ = {
      async doStep() {
        const st = g.story.step;
        if (!st) return { done: true };
        const log = { chapter: g.story.chapter?.id, step: st.id, type: st.type };
        const feat = (k) => g.story.feature(k);
        g.ui.closeModal(true);
        switch (st.type) {
          case 'reach': { const it = feat(st.feature); log.dist = goNear(it.x, it.z, (st.radius ?? 50) * 0.5); run(5); break; }
          case 'leave': {
            const origin = g.session.state.story.chapter === 0 ? feat('home') : feat('lighthouse') ?? feat('home');
            const n = g.world.main.nearest(origin.x, origin.z, {});
            const p = g.world.riverToWorld(n.s + st.distance + 250, 0);
            goNear(p.x, p.z, 10); run(5); break;
          }
          case 'talk': {
            const set = feat(st.settlement);
            goNear(set.dock?.end?.x ?? set.x, set.dock?.end?.z ?? set.z, 10);
            const npc = npcFor(`${st.settlement}.${st.role}`);
            log.npc = npc?.name;
            if (npc) { g.dialogue.open(npc); g.dialogue.close(); }
            break;
          }
          case 'catch': {
            // Keep casting until a fish (not junk) bites, like a player would.
            const f = g.fishing;
            const p = g.boat.physics;
            for (let attempt = 0; attempt < 8 && g.story.step === st; attempt++) {
              g.cameraRig.orbit.yaw = p.heading + Math.PI / 2 + attempt * 0.3;
              if (f.state === 'idle') f.toggle();
              f.power = 0.5; f.cast();
              for (let i = 0; i < 150 && f.state === 'casting'; i++) run(1);
              if (f.state === 'waiting') { f.timer = 0.01; f.nibbles = 0; run(1); }
              if (f.state === 'bite') f.startReel();
              if (f.reel) { f.reel.progress = 0.995; f.reel.fish = f.reel.zone + f.reel.zoneSize / 2; }
              for (let i = 0; i < 30 && f.state === 'reeling'; i++) run(1);
              log.caught = [...(log.caught ?? []), f.catchInfo?.name];
              f.state = 'ready'; f.catchInfo = null;
            }
            f.cancel();
            break;
          }
          case 'sell': {
            const set = feat('firstTown');
            goNear(set.dock?.end?.x ?? set.x, set.dock?.end?.z ?? set.z, 10);
            const trader = [...g.npcs.spawned.values()].map((s) => s.npc).find((n) => n.role === 'trader' && n.settlementId === set.id) ?? [...g.npcs.spawned.values()].map((s) => s.npc).find((n) => n.role === 'trader');
            const panel = g.ui.openTrade(trader, set);
            const slot = g.session.inventory.slots.find((s) => g.session.economy.buys(s.id));
            log.sold = slot?.id;
            if (slot) panel.sell(slot.id, 1);
            g.ui.closeModal(true);
            break;
          }
          case 'discover': { const it = feat(st.feature); goNear(it.x, it.z, 10); run(20); break; }
          case 'read': {
            const it = feat(st.feature);
            goNear(it.x + 3, it.z + 2, 8);
            log.read = interact('read:');
            break;
          }
          case 'photo': { g.photo.enter(); run(3, true); await g.photo.capture(); g.photo.exit(); break; }
          case 'veil': {
            setNight();
            g.boat.lanternOn = true; g.boat.lanternLevel = 1;
            const veil = g.world.findFeature((i) => i.kind === 'veil', 30);
            goNear(veil.x, veil.z, 10);
            log.lantern = g.session.state.upgrades.lantern;
            log.opened = interact(`veil:${veil.id}`);
            break;
          }
          case 'light': {
            const it = feat(st.feature);
            goNear(it.x, it.z, 8);
            setNight();
            log.lit = interact(`lamp:${it.id}`);
            break;
          }
          default: log.unknown = true;
        }
        run(3);
        log.next = g.story.step?.id ?? null;
        log.advanced = log.next !== st.id || g.session.state.story.chapter !== undefined && g.story.step !== st;
        return log;
      },
    };
  });

  const steps = [];
  let guard = 0;
  let shots = 0;
  while (guard++ < 60) {
    const r = await page.evaluate(() => window.__STORY__.doStep());
    if (r.done) break;
    steps.push(r);
    console.log(`${r.chapter}/${r.step} ${r.type} -> ${r.next} ${JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['chapter', 'step', 'type', 'next', 'advanced'].includes(k))))}`);
    if (r.next === r.step) { failures.push(`step ${r.step} (${r.type}) did not complete: ${JSON.stringify(r)}`); break; }
    if (r.type === 'light' && shots < 3) { shots++; await page.evaluate(() => window.__RB__.game.step(1 / 30)); await screenshot(page, path.join(outDir, `st_${r.step}.png`)); }
  }
  const end = await page.evaluate(() => {
    const g = window.__RB__.game;
    const s = g.session.state.story;
    return { completed: s.completed, chapter: s.chapter, lamps: Object.keys(s.lamps).length, letters: s.letters, objective: g.story.objectiveText(), mode: g.session.state.mode, lantern: g.session.state.upgrades.lantern, lore: Object.keys(g.session.state.discoveries.lore).length };
  });
  console.log(JSON.stringify(end));
  check(steps.length >= 30, `played ${steps.length} story steps`);
  check(end.completed === true && end.objective === null, 'the story reaches the end of the Epilogue');
  check(end.lamps === 6, `all six lamps are lit (${end.lamps})`);
  check(end.letters.length >= 8, `letters collected (${end.letters.length})`);
  check(end.lore >= 8, `letters are recorded in the journal (${end.lore})`);
  // Free exploration continues on the same save.
  const after = await page.evaluate(async () => {
    const g = window.__RB__.game;
    g.boat.physics.anchored = false;
    g.pilot.toggle();
    const s0 = g.boat.physics.s;
    for (let i = 0; i < 300; i++) g.step(1 / 30, 33, { render: false });
    const meta = await g.session.save('slot2');
    const loaded = await g.session.saves.load('slot2');
    return { moved: g.boat.physics.s - s0, storyDone: meta.storyDone, loadedDone: loaded.state.story.completed, region: g.world.regionAtS(g.boat.physics.s).name };
  });
  check(after.moved > 20 && after.storyDone && after.loadedDone, `journey continues after the story on the same save (${JSON.stringify(after)})`);
  await screenshot(page, path.join(outDir, 'st_after.png'));
  const errs = errorsFrom(logs);
  check(errs.length === 0, `no console errors${errs.length ? `: ${errs.slice(0, 5).join(' | ')}` : ''}`);
  fs.writeFileSync(path.join(outDir, `story-${seed}.json`), JSON.stringify({ steps, end, after }, null, 1));
} catch (e) {
  failures.push(String(e && e.stack || e));
  console.log(e);
} finally {
  console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 1));
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
}
