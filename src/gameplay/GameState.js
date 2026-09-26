// The persistent journey state: everything that goes into a save file.
// Pure data + small helpers; systems mutate it and emit events.
import itemData from '../data/items.json' with { type: 'json' };
import fishData from '../data/fish.json' with { type: 'json' };
import upgradeData from '../data/upgrades.json' with { type: 'json' };

export const ITEMS = itemData.items;
export const FISH = Object.fromEntries(fishData.species.map((f) => [f.id, f]));
export const UPGRADES = upgradeData.tracks;
export const SAVE_VERSION = 3;

export function createState({ seed, mode = 'story' } = {}) {
  return {
    version: SAVE_VERSION,
    mode,
    seed,
    created: Date.now(),
    playTime: 0,
    coins: 20,
    inventory: [], // [{ id, count, kind: 'item'|'fish', best?: size }]
    upgrades: Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0])),
    paint: null,
    discoveries: { features: {}, fish: {}, wildlife: {}, flora: {}, lore: {}, biomes: {}, regions: {} },
    photos: [],
    quests: { active: [], completed: [], offered: {} },
    story: { chapter: 0, step: 0, flags: [], lamps: {}, letters: [], completed: false, started: false },
    npcs: {},
    settlements: {},
    collected: {}, // feature id -> in-game day collected
    stats: { distance: 0, fishCaught: 0, photos: 0, lampsLit: 0, coinsEarned: 0, furthestS: 0, itemsGathered: 0, questsDone: 0 },
    player: null,
    time: null,
    weather: null,
    lanternOn: false,
    cameraMode: 'third',
    flags: {},
  };
}

export function itemName(id) {
  return ITEMS[id]?.name ?? FISH[id]?.name ?? id;
}

export function itemDef(id) {
  if (ITEMS[id]) return { ...ITEMS[id], id, kind: 'item' };
  if (FISH[id]) return { ...FISH[id], id, kind: 'fish', category: 'fish', stack: 10 };
  return null;
}

/** Storage capacity (slots) from the storage upgrade. */
export function capacity(state) {
  const tier = UPGRADES.storage.tiers[state.upgrades.storage ?? 0];
  return tier?.slots ?? 12;
}

/** Map a flat collected set onto the ContentStreamer's expectations. */
export function collectedSet(state, day, respawnDays = 3) {
  const set = new Set();
  for (const [id, d] of Object.entries(state.collected)) {
    if (id.includes('_lore_') || day - d < respawnDays) set.add(id);
  }
  return set;
}

/** Migrate older save versions to the current schema. */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid save');
  let s = { ...raw };
  const v = s.version ?? 1;
  if (v < 2) {
    // v1 stored fish separately from items.
    s.inventory = [...(s.inventory ?? []), ...((s.fish ?? []).map((f) => ({ id: f.id, count: f.count ?? 1, kind: 'fish', best: f.size ?? 0 })))];
    delete s.fish;
    s.discoveries = s.discoveries ?? { features: {}, fish: {}, wildlife: {}, flora: {}, lore: {}, biomes: {}, regions: {} };
  }
  if (v < 3) {
    s.quests = { active: s.quests?.active ?? [], completed: s.quests?.completed ?? [], offered: {} };
    s.stats = { distance: 0, fishCaught: 0, photos: 0, lampsLit: 0, coinsEarned: 0, furthestS: 0, itemsGathered: 0, questsDone: 0, ...(s.stats ?? {}) };
    s.flags = s.flags ?? {};
  }
  const fresh = createState({ seed: s.seed, mode: s.mode });
  const merged = { ...fresh, ...s };
  merged.upgrades = { ...fresh.upgrades, ...(s.upgrades ?? {}) };
  merged.discoveries = { ...fresh.discoveries, ...(s.discoveries ?? {}) };
  merged.story = { ...fresh.story, ...(s.story ?? {}) };
  merged.version = SAVE_VERSION;
  return merged;
}
