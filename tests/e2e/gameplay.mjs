// Gameplay loop test: main menu -> New Story -> talk to the elder (story step)
// -> fish (full cast/bite/reel) -> trade (sell) -> gather -> every panel ->
// save to a slot -> reload the page -> continue -> state restored.
// Usage: node tests/e2e/gameplay.mjs [outDir]
import path from 'node:path';
import fs from 'node:fs';
import { serveDist, launch, waitReady, errorsFrom, ROOT } from './harness.mjs';

const outDir = process.argv[2] ?? path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };

const { server, url } = await serveDist();
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
const shot = (name) => page.screenshot({ path: path.join(outDir, `gp_${name}.png`) });
const G = (fn, arg) => page.evaluate(fn, arg);
/** Step the simulation n frames at dt (the rAF loop is paused for determinism). */
const step = (n = 10, dt = 1 / 30) => G(({ n, dt }) => { const g = window.__RB__.game; for (let i = 0; i < n; i++) g.step(dt, dt * 1000, { render: i === n - 1 }); }, { n, dt });

try {
  await page.goto(`${url}?quality=veryLow&laptop=1`);
  await waitReady(page);
  await page.waitForTimeout(1500);
  check(await G(() => window.__RB__.game.state === 'menu'), 'boots into the main menu');
  check(await page.isVisible('text=New Story'), 'main menu shows New Story');
  await shot('01_menu');

  // --- New Story
  await page.click('text=New Story');
  await page.waitForFunction(() => window.__RB__.game.state === 'playing', null, { timeout: 30000 });
  await G(() => { const g = window.__RB__.game; g.stop(); g.time.setHours(10); });
  await step(20);
  const st0 = await G(() => { const g = window.__RB__.game; return { mode: g.session.state.mode, chapter: g.session.state.story.chapter, step: g.story.step?.id, obj: g.story.objectiveText()?.text }; });
  check(st0.mode === 'story' && st0.chapter === 0 && st0.step === 'p1', `story starts at the prologue (${JSON.stringify(st0)})`);
  await page.waitForTimeout(600);
  await shot('02_start');

  // --- Talk to Tamsin (the home elder): walk the dialogue.
  const npc = await G(() => {
    const g = window.__RB__.game;
    for (let i = 0; i < 30; i++) g.step(1 / 30, 33, { render: false });
    const n = [...g.npcs.spawned.values()].map((s) => s.npc).find((x) => x.storyKey === 'home.elder');
    if (!n) return null;
    g.dialogue.open(n);
    return { name: n.name, role: n.role };
  });
  check(!!npc && npc.name === 'Tamsin', `home elder spawned and is Tamsin (${JSON.stringify(npc)})`);
  await page.waitForTimeout(300);
  check(await page.isVisible('.dialogue'), 'dialogue box visible');
  await shot('03_dialogue');
  for (let i = 0; i < 12; i++) {
    const has = await page.$('.dialogue .choice');
    if (!has) break;
    const labels = await page.$$eval('.dialogue .choice', (els) => els.map((e) => e.textContent));
    const pick = labels.findIndex((l) => /Continue|Thank you/.test(l));
    if (pick >= 0) await page.click(`.dialogue .choice >> nth=${pick}`);
    else { await page.click('.dialogue .choice >> text=Goodbye'); break; }
    await page.waitForTimeout(80);
  }
  await step(3);
  const st1 = await G(() => { const g = window.__RB__.game; return { step: g.story.step?.id, letters: g.session.state.story.letters, dialogue: !!document.querySelector('.dialogue'), modal: !!g.ui.modal }; });
  check(st1.step === 'p2', `talking to Tamsin completes the first story step (${JSON.stringify(st1)})`);
  if (st1.modal) { await shot('04_letter'); await G(() => window.__RB__.game.ui.closeModal()); }

  // --- Fishing: full cycle through the real state machine.
  const fish = await G(() => {
    const g = window.__RB__.game;
    const f = g.fishing;
    const before = g.session.inventory.slots.filter((s) => s.kind === 'fish').length;
    // Aim at open water beside the boat.
    const p = g.boat.physics;
    g.cameraRig.orbit.yaw = p.heading + Math.PI / 2;
    f.toggle();
    const states = [f.state];
    f.power = 0.5; f.cast();
    states.push(f.state);
    for (let i = 0; i < 120 && f.state === 'casting'; i++) g.step(1 / 30, 33, { render: false });
    states.push(f.state);
    if (f.state === 'waiting') { f.timer = 0.01; f.nibbles = 0; g.step(1 / 30, 33, { render: false }); }
    states.push(f.state);
    if (f.state === 'bite') { f.startReel(); }
    states.push(f.state);
    if (f.reel) { f.reel.progress = 0.995; f.reel.fish = f.reel.zone + f.reel.zoneSize / 2; }
    for (let i = 0; i < 20 && f.state === 'reeling'; i++) g.step(1 / 30, 33, { render: i === 19 });
    states.push(f.state);
    const after = g.session.inventory.slots.filter((s) => s.kind === 'fish').length;
    return { states, info: f.catchInfo, before, after, caught: g.session.state.stats.fishCaught };
  });
  check(fish.info && fish.caught === 1, `fishing cast -> bite -> reel -> catch works (${JSON.stringify(fish)})`);
  await page.waitForTimeout(200);
  await shot('05_catch');
  await G(() => { const g = window.__RB__.game; g.fishing.cancel(); });

  // --- Trade: sell the catch to a trader.
  const trade = await G(() => {
    const g = window.__RB__.game;
    const trader = [...g.npcs.spawned.values()].map((s) => s.npc).find((x) => x.role === 'trader');
    if (!trader) return { error: 'no trader' };
    const set = g.dialogue.settlementOf(trader);
    g.session.inventory.add('wild_mint', 5);
    g.ui.openTrade(trader, set);
    return { coins: g.session.state.coins, trader: trader.name };
  });
  await page.waitForTimeout(300);
  await shot('06_trade');
  if (!trade.error) {
    await page.click('.panel .list-item >> text=Sell >> nth=0');
    await page.waitForTimeout(100);
    const coins2 = await G(() => window.__RB__.game.session.state.coins);
    check(coins2 > trade.coins, `selling raises coins (${trade.coins} -> ${coins2})`);
    await page.click('.panel .list-item >> text=Buy >> nth=0');
    const coins3 = await G(() => window.__RB__.game.session.state.coins);
    check(coins3 < coins2, `buying spends coins (${coins2} -> ${coins3})`);
  } else check(false, trade.error);
  await G(() => window.__RB__.game.ui.closeModal());

  // --- Every panel renders.
  const panels = [['KeyI', 'inventory'], ['KeyJ', 'journal'], ['KeyM', 'map'], ['KeyQ', 'quests']];
  for (const [key, name] of panels) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
    check(await page.isVisible('.overlay .panel'), `${name} panel opens with ${key}`);
    await shot(`07_${name}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
  for (const tab of ['Fish', 'Journey']) {
    await page.keyboard.press('KeyJ');
    await page.click(`.tab >> text=${tab}`);
    await page.waitForTimeout(150);
    await shot(`08_journal_${tab.toLowerCase()}`);
    await page.keyboard.press('Escape');
  }
  await G(() => { const g = window.__RB__.game; const sw = [...g.npcs.spawned.values()].map((s) => s.npc).find((x) => x.role === 'shipwright') ?? { name: 'Shipwright' }; g.ui.openUpgrades(sw, null); });
  await page.waitForTimeout(200);
  check(await page.isVisible('text=Propulsion'), 'shipwright upgrade panel lists tracks');
  await shot('09_upgrades');
  await G(() => window.__RB__.game.ui.closeModal());

  // --- Pause menu + settings.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(await page.isVisible('text=Resume'), 'pause menu opens with Esc');
  check(await G(() => window.__RB__.game.paused), 'game pauses in the pause menu');
  await page.click('text=Settings');
  await page.waitForTimeout(200);
  await shot('10_settings');
  await page.click('.tab >> text=Performance');
  await page.waitForTimeout(150);
  await shot('11_settings_perf');
  // Change preset live.
  await page.click('.tab >> text=Graphics');
  await page.selectOption('.field select >> nth=0', 'low');
  await page.waitForTimeout(200);
  check(await G(() => window.__RB__.game.quality.preset === 'low'), 'changing the preset applies live');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  // --- Save to slot 1, reload, continue.
  const saved = await G(async () => {
    const g = window.__RB__.game;
    for (let i = 0; i < 60; i++) g.step(1 / 30, 33, { render: false });
    const meta = await g.session.save('slot1');
    return { meta, coins: g.session.state.coins, s: g.boat.physics.s, step: g.story.step?.id, fish: g.session.state.stats.fishCaught, hours: g.time.hours };
  });
  check(!!saved.meta, 'saved to slot 1');
  await page.reload();
  await waitReady(page);
  await page.waitForTimeout(1200);
  check(await page.isVisible('text=Continue'), 'Continue appears on the main menu after saving');
  await page.click('text=Load Journey');
  await page.waitForTimeout(400);
  await shot('12_load');
  await page.click('.panel .list-item >> text=Load >> nth=0');
  await page.waitForFunction(() => window.__RB__.game.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const loaded = await G(() => { const g = window.__RB__.game; return { coins: g.session.state.coins, s: g.boat.physics.s, step: g.story.step?.id, fish: g.session.state.stats.fishCaught, hours: g.time.hours }; });
  check(loaded.coins === saved.coins && loaded.step === saved.step && loaded.fish === saved.fish && Math.abs(loaded.s - saved.s) < 5, `loaded state matches saved (${JSON.stringify(saved)} vs ${JSON.stringify(loaded)})`);
  await shot('13_loaded');

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
