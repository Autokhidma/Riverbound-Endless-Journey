# Art pipeline

Riverbound has **no imported art**. There are no textures, models, HDRIs or sprite sheets on disk. Every visual is generated at runtime by code in this repository, from simple primitives, noise and shaders. The look aims for a soft, painterly, stylised realism: warm light, deep atmosphere, readable silhouettes. It is designed for the game's own style and does not copy any reference image.

## Guiding choices

- **Vertex colour + procedural detail** instead of texture atlases. This keeps memory low, gives infinite variety per biome, and means there is nothing to stream from disk.
- **Instancing everywhere.** Vegetation, rocks, grass and lily pads are instanced per species per cell, with per-instance scale, rotation and tint.
- **A shared atmosphere.** One set of global uniforms feeds every material: sun, moon, fog, wind, wetness, snow cover, lantern and night glow. The whole world reacts to time and weather consistently.
- **Two LODs** per vegetation species, chosen per cell by distance. Terrain LOD comes from the quadtree, and water LOD from the ribbon segments.

## Meshes (all procedural)

| Asset family | Where | How it is built |
|-|-|-|
| Terrain | `world/TerrainMesher.js` | Height samples of `WorldGen.sample` on a 33×33 grid per quadtree node, with skirts. Per vertex: normal (Int8), sRGB colour + wetness, and material weights (rock, snow, sand, forest). The colour comes from biome palettes blended by slope, height, shore distance and noise |
| Rivers and lakes | `world/RiverMesher.js` | Ribbons along the river spline with adaptive lateral resolution. Per vertex: river coordinates, depth, rapids, flow vector and biome water colours |
| Vegetation and rocks | `world/Species.js` | 26 species built from primitives (displaced icosahedra, cones, cylinders, blades, crossed quads). They carry a wind attribute (sway, flutter, glow mask) and two LODs. Species: broadleaf, willow, cherry, maple, birch, pine, snow pine, jungle tree, palm, cypress, dead tree, mangrove, bamboo, bushes, flowering bushes, ferns, reeds, grass patches, flowers, lily pads, glowing mushrooms and plants, boulders, crystals, dry shrubs, cacti, driftwood |
| Landmarks | `world/LandmarkBuilder.js` | 39 types assembled from primitives: waterfalls with mist sprites, ruins, arches, pillars, lampstones (lit by the story), a lighthouse, shrines, bridges, mills, the vine veil, the unique wonders, and more |
| Villages | `world/SettlementBuilder.js` | Six architectural styles (cottage, stilt, stone, adobe, timber, coastal). Houses have emissive windows. Docks, stalls, lanterns, a shipwright's yard and chimney smoke |
| The *Wren* | `boat/BoatModel.js` | A lofted clinker hull with procedural wood planks, oars with oarlocks, a lantern and flag. There are upgrade parts (sail, paddlewheel, storage, comfort, figurehead) and paint colours |
| Characters | `character/CharacterModel.js` | An original traveller (bucket hat, knit scarf, satchel) on a joint hierarchy (hips → spine → chest → neck/head; arms; legs). Villagers use the same rig with seeded palettes and hats |
| Wildlife | `wildlife/Wildlife.js` | Low-poly birds with animated wings, herons, deer, frogs, butterflies, and firefly/fish effects |
| App icon | `scripts/make-icon.mjs` | Rendered in Node with signed-distance shapes and encoded to PNG and ICO by hand |

## Textures (runtime-generated)

`render/ProceduralTextures.js` creates, at start-up and all tileable:

- detail noise
- a water normal map
- foam
- wood planks
- canvas

They are periodic, and their world-space scales divide the 2048 m origin step, so they never seam when the floating origin shifts.

## Materials and shaders

- **Terrain:** `MeshStandardMaterial` extended through `onBeforeCompile`:
  - triplanar rock on steep slopes;
  - detail noise;
  - wet, darker and glossier shorelines;
  - rain wetness and snow cover;
  - shared fog.
- **Foliage:**
  - wind sway and leaf flutter in the vertex shader, phased by instance position;
  - back-lit subsurface translucency;
  - night bioluminescence (glow mask).
- **Water:** a custom `ShaderMaterial`:
  - flow-aligned Gerstner-style waves (the same table as the CPU physics);
  - two-phase flow-mapped normals;
  - Fresnel reflection of the analytic sky or the planar reflection;
  - sun and moon glitter;
  - lantern and village-light reflections;
  - depth absorption with biome colours;
  - shore, rapids and ripple foam;
  - rain rings;
  - a Kelvin wake;
  - interactive ripples;
  - bioluminescent Starwater.
- **Sky dome:**
  - a palette gradient with a belt of Venus and Mie glow;
  - a sun disc;
  - the moon with correct phase lighting;
  - two cube-mapped star layers, the Milky Way with dust lanes, and nebulae;
  - volumetric-looking clouds (fbm);
  - shooting stars and aurora;
  - sky fog.

  The dome is also rendered into a PMREM environment map for image-based lighting.
- **Precipitation:** GPU line and point sprites positioned in the vertex shader from `gl_VertexID`, with no per-particle CPU work.

## Lighting and post

- **Lights:**
  - one directional light (the sun, or the moon at night) with a texel-snapped shadow frustum that follows the player;
  - a hemisphere ambient;
  - a small fixed pool of point lights assigned each frame to the nearest village lanterns and lamps. Pooling avoids shader recompiles.
- **HDR pipeline:**
  - bloom (13-tap down/up);
  - god rays (a radial blur of a sun mask, strongest at golden hour in haze);
  - depth of field (photo mode and cinematic);
  - ACES tonemap with exposure, contrast, saturation, temperature, lift/gain, vignette, grain and fade;
  - colour-vision modes;
  - FXAA.
- **Palette keys:** the sky palette is keyframed by sun elevation, with separate morning keys, biome tints and weather overrides (`sky/SkyPalette.js`). Exposure adapts at night so darkness stays moody but readable.

## Adding content

- **A new biome:** add an entry to `src/data/biomes.json` with neighbours, river/terrain parameters, colours, water, atmosphere, vegetation list, weather weights, wildlife, ambience, music and landmarks. The data tests validate the references.
- **A new plant:** add a builder to `BUILDERS` in `Species.js` (two LODs, vertex colours, `aWind`), then list it in biome vegetation.
- **A new landmark:** add a type to `src/data/landmarks.json` (placement, names, description) and a builder in `LandmarkBuilder.js`.
