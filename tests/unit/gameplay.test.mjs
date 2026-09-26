import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, migrateState, capacity, itemDef, ITEMS, FISH, UPGRADES, SAVE_VERSION } from '../../src/gameplay/GameState.js';
import { Inventory } from '../../src/gameplay/Inventory.js';
import { Economy, locationFactor, fishSizeFactor } from '../../src/gameplay/Economy.js';
import { candidates, rollCatch, ReelGame, timeTags, weatherTag, SPECIES } from '../../src/gameplay/FishingLogic.js';
import { SaveSystem } from '../../src/gameplay/SaveSystem.js';
import { Storage, MemoryBackend } from '../../src/save/Storage.js';
import { RNG } from '../../src/core/rng.js';
import { EventBus } from '../../src/core/events.js';

test('inventory stacks, respects capacity, pays costs', () => {
  const st = createState({ seed: 1 });
  const ev = new EventBus();
  const added = [];
  ev.on('inventory:add', (e) => added.push(e));
  const inv = new Inventory(st, ev);
  assert.equal(inv.capacity, capacity(st));
  assert.equal(inv.add('wild_mint', 25), 25);
  assert.equal(inv.used, 2, 'stack of 20 + 5');
  assert.equal(inv.count('wild_mint'), 25);
  assert.ok(inv.remove('wild_mint', 6));
  assert.equal(inv.count('wild_mint'), 19);
  assert.ok(!inv.remove('wild_mint', 100));
  assert.ok(added.length >= 1);
  // Fill to capacity.
  for (const id of Object.keys(ITEMS)) { if (inv.free <= 0) break; inv.add(id, 1); }
  assert.equal(inv.free, 0);
  assert.equal(inv.add('orchid_never_exists', 1), 0);
  // Costs.
  st.coins = 50;
  const mint = inv.count('wild_mint');
  assert.ok(inv.canAfford({ coins: 40, wild_mint: 10 }));
  assert.ok(!inv.canAfford({ coins: 60 }));
  assert.ok(inv.pay({ coins: 40, wild_mint: 10 }));
  assert.equal(st.coins, 10);
  assert.equal(inv.count('wild_mint'), mint - 10);
});

test('fish keep their best size in the slot', () => {
  const st = createState({ seed: 1 });
  const inv = new Inventory(st);
  const id = SPECIES[0].id;
  inv.add(id, 1, { size: 10 });
  inv.add(id, 1, { size: 14 });
  const slot = inv.slots.find((s) => s.id === id);
  assert.equal(slot.best, 14);
});

test('economy: far goods sell higher, selling lowers price, demand recovers', () => {
  const st = createState({ seed: 1 });
  const time = { totalDays: 0 };
  const eco = new Economy(st, time);
  const snowTown = { id: 'town_snow', biome: 'snow' };
  const springTown = { id: 'town_spring', biome: 'spring' };
  // blossom_sprig comes from spring: cheaper at home than far away.
  assert.ok(locationFactor('blossom_sprig', 'snow') > locationFactor('blossom_sprig', 'spring'));
  const far = eco.sellPrice('blossom_sprig', snowTown);
  const home = eco.sellPrice('blossom_sprig', springTown);
  assert.ok(far > home, `${far} > ${home}`);
  const p0 = eco.sellPrice('driftwood', springTown);
  eco.recordSale('driftwood', springTown, 20);
  const p1 = eco.sellPrice('driftwood', springTown);
  assert.ok(p1 < p0, `${p1} < ${p0}`);
  time.totalDays = 5;
  eco.recover(springTown.id);
  assert.ok(eco.sellPrice('driftwood', springTown) >= p0 - 1);
  assert.ok(eco.buyPrice('driftwood', springTown) > eco.sellPrice('driftwood', springTown));
  assert.equal(eco.sellPrice('parcel', springTown), 0, 'quest items cannot be sold');
  const stock1 = eco.stock(springTown);
  assert.deepEqual(eco.stock(springTown), stock1, 'stock stable within a day');
  assert.ok(fishSizeFactor(SPECIES[0].id, SPECIES[0].size[1]) > fishSizeFactor(SPECIES[0].id, SPECIES[0].size[0]));
});

test('fishing candidates depend on time, weather and biome', () => {
  const base = { biomes: ['spring'], habitat: 'river', rodTier: 0 };
  const day = candidates({ ...base, hours: 12, sunElevation: 50, weather: { cloud: 0.1 } }).map((c) => c.species.id);
  const night = candidates({ ...base, hours: 23, sunElevation: -30, weather: { cloud: 0.1 } }).map((c) => c.species.id);
  const rain = candidates({ ...base, hours: 12, sunElevation: 50, weather: { rain: 0.8, cloud: 0.9 } }).map((c) => c.species.id);
  assert.ok(day.length > 2 && night.length > 2);
  assert.notDeepEqual(day, night);
  assert.notDeepEqual(day, rain);
  const jungle = candidates({ ...base, biomes: ['jungle'], hours: 12, sunElevation: 50, weather: {} }).map((c) => c.species.id);
  assert.notDeepEqual(day, jungle);
  assert.ok(timeTags(12, 50).has('day') && timeTags(23, -30).has('night'));
  assert.equal(weatherTag({ storm: 1 }), 'storm');
  assert.equal(weatherTag({ cloud: 0.1 }), 'clear');
});

test('rollCatch is deterministic and rare fish are rarer', () => {
  const ctx = { biomes: ['spring', 'autumn'], habitat: 'lake', hours: 7, sunElevation: 8, weather: { cloud: 0.2 }, rodTier: 0 };
  const a = new RNG(5), b = new RNG(5);
  for (let i = 0; i < 50; i++) assert.deepEqual(rollCatch(a, ctx), rollCatch(b, ctx));
  const r = new RNG(11);
  const counts = {};
  for (let i = 0; i < 4000; i++) { const c = rollCatch(r, ctx); const k = c.junk ? 'junk' : c.species.rarity; counts[k] = (counts[k] ?? 0) + 1; }
  assert.ok((counts.common ?? 0) > (counts.rare ?? 0));
  assert.ok((counts.rare ?? 0) >= (counts.legendary ?? 0));
  const tier3 = { ...ctx, rodTier: 3 };
  const rr = new RNG(11);
  let rare3 = 0;
  for (let i = 0; i < 4000; i++) { const c = rollCatch(rr, tier3); if (!c.junk && c.species.rarity !== 'common' && c.species.rarity !== 'uncommon') rare3++; }
  assert.ok(rare3 >= (counts.rare ?? 0) + (counts.legendary ?? 0), 'better rods find rarer fish');
});

test('reel minigame: a player who tracks the fish lands it; idle loses it', () => {
  const play = (track) => {
    const g = new ReelGame(new RNG(3), { difficulty: 0.4 });
    for (let t = 0; t < 60 * 40 && !g.done; t++) {
      const centre = g.zone + g.zoneSize / 2;
      g.update(1 / 60, track ? g.fish > centre : false);
    }
    return g.done;
  };
  assert.equal(play(true), 'caught');
  assert.equal(play(false), 'escaped');
});

test('save migration v1 -> current keeps data and fills defaults', () => {
  const v1 = { version: 1, seed: 77, mode: 'story', coins: 123, inventory: [{ id: 'wild_mint', count: 3, kind: 'item' }], fish: [{ id: SPECIES[0].id, count: 2, size: 11 }], story: { chapter: 2 } };
  const s = migrateState(v1);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.coins, 123);
  assert.equal(s.story.chapter, 2);
  assert.ok(Array.isArray(s.story.letters));
  assert.ok(s.inventory.some((x) => x.id === SPECIES[0].id && x.kind === 'fish'));
  assert.ok(s.quests.active && s.stats.distance === 0);
  assert.ok(Object.keys(UPGRADES).every((k) => k in s.upgrades));
  assert.throws(() => migrateState(null));
});

test('save slots round-trip through storage; latest picks newest', async () => {
  const storage = new Storage(new MemoryBackend());
  const saves = new SaveSystem(storage);
  const st = createState({ seed: 'abc', mode: 'free' });
  st.coins = 999;
  await saves.save('slot1', st, { chapter: 'x', savedAt: 1 });
  await new Promise((r) => setTimeout(r, 5));
  await saves.save('slot2', { ...st, coins: 5 }, { chapter: 'y' });
  const l = await saves.load('slot1');
  assert.equal(l.state.coins, 999);
  assert.equal(l.state.mode, 'free');
  const latest = await saves.latest();
  assert.equal(latest.slot, 'slot2');
  await saves.remove('slot2');
  assert.equal((await saves.latest()).slot, 'slot1');
  assert.equal(await saves.load('slot3'), null);
});

test('storage tolerates corrupt JSON', async () => {
  const be = new MemoryBackend();
  const storage = new Storage(be);
  await be.write('bad', '{not json');
  assert.equal(await storage.readJSON('bad', 'fallback'), 'fallback');
});

test('item definitions cover fish and items', () => {
  assert.equal(itemDef(SPECIES[0].id).kind, 'fish');
  assert.equal(itemDef('wild_mint').kind, 'item');
  assert.equal(itemDef('nope'), null);
  assert.ok(Object.keys(FISH).length >= 40);
});
