# World generation

The whole world is a deterministic function of one seed. A seed can be a number or any word: words are hashed (FNV-1a + avalanche).

Every subsystem draws from its own sub-seed (`subSeed(seed, 'terrain')`, per-region seeds, per-feature seeds). This means generation order never changes results. The tests generate region 6 cold and after regions 0–5, and assert identical output.

Choose a seed under **Free Exploration → World seed**. The current seed is shown in *Settings → Gameplay* (and optionally in the HUD).

## 1. Region sequence (`RegionSequencer`)

The river is divided into **regions** of 1.9–3.2 km, each with one biome. The first region, Willowmere, is a 1.9 km home lake with the river's head.

Biomes follow an **adjacency graph** (`neighbors` in `biomes.json`): spring ↔ autumn ↔ misty, jungle ↔ monsoon ↔ swamp, canyon, northern ↔ snow, and so on. Each next biome is a weighted choice among the neighbours of the current one, which keeps climates coherent.

The **story anchors** (`storyPlan.json`) must land in given region ranges and biomes, in order. For example:

- Chapter 2's village and lamp are in a jungle or monsoon region between 2 and 4.
- The lighthouse is on the coast between regions 10 and 14.

A memoised **feasibility dynamic program** (`feasible(biome, region, anchor)`) only allows a choice if every remaining anchor can still be satisfied through the graph. So for every seed, every anchor is reachable, in order. The unit tests check this for ten seeds.

Other rules:

- The coast is suppressed before region 9, so the sea comes late in the journey.
- Each region also plans its lakes, rapids stretches and which side the coast is on.

## 2. The main river (`River.js`)

The river centreline is integrated along arc length `s` in 8 m steps, starting at `s = -600`, the head of the home lake.

Its heading is `theta0 + softClamp(macro + meander, 1.3)`:

- `theta0` points roughly west-south-west, so evening suns often sit ahead of the boat.
- `macro` is a slow noise.
- `meander` uses the biome's blended amplitude and scale.

Because the heading is soft-clamped around `theta0`, the projection `u = p · dir0` grows strictly with `s`. This matters for two things:

- **Nearest-point queries** (`nearest(x, z)`) are an O(log n) binary search in `u`, followed by a local refinement.
- **Biome lookup** at any world point works in `u`-space, with smooth transitions (±460 m in `u`, ±600 m in `s`).

Per-sample fields:

- width
- water level (a monotone downhill profile, with lakes flat)
- flow speed
- depth
- rapids factor
- lake factor

The river is generated lazily as far as needed. It is endless: the tests sample 50 km downstream.

## 3. Features, in two phases (`Features.js`)

**Phase A, hydrology** (`regionHydro(i)`) places:

- **Tributaries** (chance per biome). They branch off at a junction and wind 1.3–3.4 km into the hills. Each ends in a hidden lake, a waterfall with a plunge pool, or a grotto.
- **Islands** in the channel.

Phase A depends only on the main river and on earlier regions' hydrology.

**Phase B, sites** (`regionFeatures(i)`) uses raw terrain sampling that includes Phase A but never later sites, so there is no recursion. It places:

- **Story features** for the region's anchors: villages, lamps, the ruined Hollowmere, the Archive, the high shrine, the Hidden River and Grandmother's camp, the lighthouse.
- **A regular village** (chance per biome), in one of six styles: cottage, stilt, stone, adobe, timber, coastal. Each has a dock, lit houses, a stall, maybe a shipwright, and residents. Residents are generated deterministically from the village id (names from the local culture, looks, roles).
- **Landmarks:**
  - 2–4 **common** ones per region;
  - a 35% chance of a **rare** one;
  - each biome's **unique** wonder, in exactly one of that biome's regions per world (its first or second occurrence, chosen by seed).

  There are 39 landmark types. Examples:

  - common: ancient trees, ruins, rock pillars, mills, shrines;
  - rare: natural arches, floating islands, giant waterfalls, glow groves;
  - unique: the Giant Blossom Tree, Temple of Roots, Sky Stair, Painted Wall, Rain Temple, Frozen Giant, Aurora Stones, Tidal Gate, and others.

  Placement types include cliff, bank, water, span (bridges), cove, sea, head, shore, tributary end and coast bank.
- **Fishing spots** (quality and habitat), **resource nodes** (biome resource lists) and **lore** (carved stones, bottles).
- **Zones** that flatten, carve or raise the terrain for sites, plus **colliders** for docks, pillars and islands.

The **Hidden River** tributary ends in **Starwater**, a hidden biome with bioluminescent water. It opens only at night, to the Lamplighter's lantern.

## 4. Terrain (`WorldGen.sample`)

The height at a point combines several layers:

- **Land:**
  - fbm hills;
  - ridged mountains beyond the valley walls;
  - plateaus and terraces (canyon);
  - snow lines.

  The land parameters are blended between the two nearest biomes.
- **The river profile**, combined with the land via a smooth-min:
  - a flat channel bed shelving up to the banks;
  - biome-specific bank slopes and cliff masks;
  - valley walls.
- **Local features:**
  - the headwall behind the river head;
  - tributary valleys with their own headwalls;
  - the coast (a barrier, inlets and a sea floor on the sea side);
  - island bumps;
  - rocks in rapids;
  - site zones.
- **A floor constraint** (`minAllowed`), so water never floats above the ground.

`waterInfo(x, z)` returns the water level, terrain height, depth, edge distance, river kind (main, tributary, sea), flow and the river coordinate. Physics, fishing, audio, scatter and gameplay all share it.

## 5. Streaming (runtime)

**Terrain.** A quadtree over 2048 m roots, with 33×33 vertices per node and skirts to hide cracks.

- Nodes split by distance and preset (`terrainSplit`).
- They are built in workers and cached (LRU).
- A node is shown only when its replacement is ready. Until then the nearest loaded ancestor covers the area, so there are never holes.

**Water.** Ribbons of 192 m segments along the main river and the tributaries, with two LODs. Lateral resolution adapts to the river's width. The per-vertex data are:

- river coordinate and depth
- rapids
- flow direction and speed
- biome water colours
- absorption and wave amplitude

**Vegetation.** Instanced species per cell, with near/far LODs:

- 128 m cells for trees, bushes and rocks;
- 32 m cells near the camera for grass, flowers, reeds and lilies.

Density follows the biome lists, forest noise, slope, shore distance and the preset.

**Content.** Landmarks and villages spawn within about 1.1–1.5 km, and resources and lore within 140 m. Discovery fires when you come within a feature's radius. Collected resources respawn after three in-game days.

## 6. Memory of the world

The world is never stored; the save records only what you did:

- discovered places, fish and species;
- collected nodes and read lore;
- lit lamps;
- village friendship and supply;
- quests;
- letters.

Loading a save regenerates the same world from the seed and reapplies that memory: lamps you lit are lit, gathered plants are still gone (until they regrow), and villages remember your trades.

## 7. Coherence rules (summary)

- Biome changes follow the climate graph and blend over hundreds of metres.
- Story locations always exist, in order, in fitting biomes.
- The sea comes late.
- Each unique wonder appears once per world.
- Water always sits in a channel, and trees never grow in deep water (tested).
- Villages sit on levelled plateaus by the water, with docks pointing into the current.
- Tributaries never start inside lakes or rapids.
