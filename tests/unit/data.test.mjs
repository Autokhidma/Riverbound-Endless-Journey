// Data integrity: every id referenced by data files exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, FISH, UPGRADES } from '../../src/gameplay/GameState.js';
import { BIOME_BY_ID, BIOMES } from '../../src/world/biomes.js';
import { RESOURCES_BY_BIOME, LANDMARKS } from '../../src/world/Features.js';
import story from '../../src/data/story.json' with { type: 'json' };
import storyPlan from '../../src/data/storyPlan.json' with { type: 'json' };
import events from '../../src/data/events.json' with { type: 'json' };
import weather from '../../src/data/weather.json' with { type: 'json' };
import npcs from '../../src/data/npcs.json' with { type: 'json' };
import lore from '../../src/data/lore.json' with { type: 'json' };

test('biomes: neighbours, weather and landmark references are valid', () => {
  assert.equal(BIOMES.filter((b) => !b.hidden).length, 12);
  for (const b of BIOMES) {
    for (const n of b.neighbors) assert.ok(BIOME_BY_ID[n], `${b.id} neighbour ${n}`);
    for (const w of Object.keys(b.weather)) assert.ok(weather.types[w], `${b.id} weather ${w}`);
    for (const k of ['common', 'rare', 'unique']) for (const l of b.landmarks?.[k] ?? []) assert.ok(LANDMARKS[l], `${b.id} landmark ${l}`);
    assert.ok(b.music?.scale && b.ambience);
  }
});

test('resources, fish habitats and upgrades reference real ids', () => {
  for (const [b, list] of Object.entries(RESOURCES_BY_BIOME)) {
    assert.ok(BIOME_BY_ID[b], `resource biome ${b}`);
    for (const id of list) assert.ok(ITEMS[id], `resource ${id}`);
  }
  for (const f of Object.values(FISH)) {
    for (const b of f.biomes) assert.ok(b === 'any' || BIOME_BY_ID[b], `${f.id} biome ${b}`);
    assert.ok(f.size[1] > f.size[0] && f.value > 0);
  }
  for (const [track, t] of Object.entries(UPGRADES)) {
    assert.ok(t.tiers.length >= 2, track);
    for (const tier of t.tiers) for (const k of Object.keys(tier.cost ?? {})) assert.ok(k === 'coins' || ITEMS[k], `${track} cost ${k}`);
  }
});

test('story: steps reference anchored features, letters and characters', () => {
  const keys = new Set(storyPlan.anchors.flatMap((a) => a.features.map((f) => f.key)));
  const settlements = new Set(storyPlan.anchors.flatMap((a) => a.features.filter((f) => f.type === 'settlement' || f.role).map((f) => f.key)));
  assert.equal(story.chapters.length, 8, 'prologue + 6 chapters + epilogue');
  for (const ch of story.chapters) {
    for (const st of ch.steps) {
      assert.ok(st.objective, `${st.id} objective`);
      if (st.feature) assert.ok(keys.has(st.feature), `${st.id} feature ${st.feature}`);
      if (st.settlement) assert.ok(keys.has(st.settlement), `${st.id} settlement ${st.settlement}`);
      if (st.letter) assert.ok(story.letters[st.letter], `${st.id} letter ${st.letter}`);
      if (st.type === 'talk') assert.ok(story.npcs[`${st.settlement}.${st.role}`], `${st.id} npc ${st.settlement}.${st.role}`);
      for (const id of Object.keys(st.reward?.items ?? {})) assert.ok(ITEMS[id], `${st.id} reward ${id}`);
    }
  }
  assert.ok(settlements.size >= 5);
});

test('events, npcs and lore are well formed', () => {
  for (const e of events.events) {
    assert.ok(e.id && e.name && e.desc && typeof e.chance === 'number', e.id);
    for (const b of e.biomes) assert.ok(b === 'any' || BIOME_BY_ID[b], `${e.id} biome ${b}`);
    for (const id of Object.keys(e.reward?.items ?? {})) assert.ok(ITEMS[id] || FISH[id], `${e.id} reward ${id}`);
  }
  for (const r of ['trader', 'fisher', 'shipwright', 'elder', 'villager']) assert.ok(npcs.roles[r]?.greet?.length, r);
  assert.ok(lore.carvings.length >= 15 && lore.bottles.length >= 10);
  for (const [k, t] of Object.entries(weather.types)) for (const n of t.next) assert.ok(weather.types[n], `${k} -> ${n}`);
});
