# Performance

Performance is a feature of Riverbound, not an afterthought. The game is meant to run from integrated laptop GPUs up to high-end desktops. The approach is to scale concrete workloads, keep frame time stable rather than chase peak resolution, and make performance visible.

## Presets

Each preset changes many systems independently. There is no single "quality" multiplier.

| Preset | Render scale (dyn. range) | View distance | Terrain LOD split | Shadows (map / distance) | Foliage (density / trees / grass) | Water | Sky | God rays | Bloom | AA | DOF | Particles | Wildlife | Point lights | IBL refresh |
|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|-|
| Very Low | 0.7 (0.5–0.8) | 1300 m | 1.35 | off | 0.35 / 280 m / 40 m | analytic reflection, 2 wave layers | 2 cloud octaves | off | off | none | off | 25% | 40% | 0 | 12 s |
| Low | 0.85 (0.55–0.9) | 1700 m | 1.45 | 1024 / 45 m | 0.55 / 380 m / 55 m | analytic reflection | 3 octaves, aurora | 20 samples | 3 levels | FXAA | off | 45% | 60% | 1 | 6 s |
| Medium | 1.0 (0.6–1.0) | 2200 m | 1.6 | 2048 / 60 m | 0.8 / 520 m / 75 m | + interactive ripples (128²) | 4 octaves | 32 | 4 | FXAA | on | 70% | 80% | 2 | 4 s |
| High | 1.0 (0.6–1.0) | 2600 m | 1.7 | 2048 / 80 m | 1.0 / 700 m / 90 m | + planar reflection (½ res), ripples 256² | 5 octaves | 48 | 5 | FXAA | on | 100% | 100% | 4 | 2 s |
| Ultra | 1.0 (0.6–1.0) | 3400 m | 2.0 | 4096 / 110 m | 1.15 / 950 m / 120 m | planar ¾ res | 5 octaves | 64 | 6 | MSAA 4× | on | 130% | 120% | 4 | 1 s |
| Cinematic | 1.0 (0.6–1.0) | 4200 m | 2.3 | 4096 / 150 m | 1.3 / 1200 m / 150 m | planar full res | 6 octaves | 96 | 6 | MSAA 4× | on | 150% | 130% | 4 | 0.5 s |

On first launch the game picks a preset from the detected GPU (`suggestPreset`):

- Software renderers: Very Low + Laptop Mode.
- Integrated GPUs: Low or Medium + Laptop Mode.
- Recent high-end GPUs: Ultra.
- Everything else: High.

You can change the preset at any time in *Settings → Graphics*. The change applies live, with no restart.

Individual overrides sit on top of the preset:

- view distance (60–140%)
- foliage density (30–150%)
- shadows, bloom and god rays on or off
- field of view
- target FPS, and the minimum, maximum and fixed resolution scale

## Laptop Mode

Laptop Mode can be combined with any preset. It prioritises **stable frame time, heat and battery** while keeping the look:

- turns dynamic resolution on, caps the target at 60 FPS and the pixel ratio at 1;
- caps the maximum render scale at 85% and lets it drop to 50%;
- caps view distance at 1800 m and the terrain split at 1.5;
- uses 1024 px shadows over 45 m, with no soft shadows and no vegetation shadows;
- caps foliage at 60% density, trees at 420 m and grass at 60 m;
- drops planar reflections (the sky reflections, foam and waves stay) and caps ripples at 128²;
- caps clouds at 3 octaves and removes nebulae;
- caps god rays at 24 samples at ¼ resolution and bloom at 3 levels;
- disables MSAA (FXAA only);
- caps particles at 50% and wildlife at 60%;
- uses one point light;
- refreshes the environment map at most every 6 s.

It keeps the day/night cycle, sunsets, stars, water, boat physics and exploration unchanged.

Medium + Laptop Mode renders roughly 30% fewer triangles than Medium (see the benchmark table below).

## Dynamic resolution

`render/DynamicResolution.js` scales **only the 3D render**; the UI is always native resolution.

- It targets your chosen frame rate (30–144 FPS).
- The frame-time signal comes from GPU timer queries (`EXT_disjoint_timer_query_webgl2`) when available, otherwise from the smoothed frame interval.
- It uses hysteresis:
  - it steps down fast when more than 12% over budget;
  - it steps up slowly when more than 20% under budget;
  - there are cooldowns between changes, and a minimum step of 4%.

  This avoids visible oscillation.
- It stays inside the preset's (or your) minimum and maximum scale. Values above 100% supersample, for screenshots on strong GPUs.

## CPU and GPU budget techniques

- **Workers.** Terrain meshing, river ribbons and vegetation scatter run in a Web Worker pool. The priority queue is ordered by distance, and stale requests are pruned when the camera moves on. The main thread only uploads buffers.
- **CPU update cost.** The whole simulation measured around 0.5–2 ms per frame on the test machine (the F3 overlay shows it live). This covers:
  - physics
  - wildlife AI
  - streaming decisions
  - atmosphere
  - UI
- **Instancing and draw calls.**
  - Vegetation, rocks and grass are one instanced draw per species per cell.
  - Terrain nodes share one material.
  - Water segments share materials.
  - Point lights come from a fixed pool, so shaders never recompile as lanterns come and go.
- **Level of detail.**
  - Terrain: quadtree with preset-dependent split distance; parent tiles stay visible until children are ready.
  - Water: two ribbon LODs.
  - Vegetation: near/far species LODs and distance culling.
  - Landmarks and villages: spawned only within 1.1–1.5 km. Resources and lore only within 140 m.
- **Shaders.**
  - Wave count, planar reflection, ripples, star reflections and foam are compile-time or uniform-gated per preset.
  - Cloud octaves, star layers and aurora scale with the preset.
  - Post effects are skipped entirely when disabled.
  - God rays run at reduced resolution.
- **Particles.** Rain and snow are single GPU draws positioned in the vertex shader from `gl_VertexID`, with no per-particle CPU work. Fireflies are one points draw.
- **Memory hygiene.**
  - Streamed geometries are disposed on unload, and shared geometries are flagged so they are never disposed twice.
  - The terrain uses an LRU cache.
  - Content despawns beyond its radius.
  - The drive test asserts that the live geometry count stays bounded while travelling (for example, a maximum of 358 geometries over 90 s of cruising in CI).
- **The world is not saved,** only player memory. Saves stay a few KB plus photo thumbnails (at most 30, as 320×180 JPEGs).
- **Floating origin.** 2048 m steps keep precision without per-frame matrix work.

## Measuring

- **F3 overlay:**
  - FPS, frame time, 1% worst frame;
  - CPU update and render-submit time, GPU time (when available);
  - draw calls, triangles, geometries, textures, shader programs;
  - render resolution and scale;
  - preset and laptop mode;
  - terrain, water, vegetation and worker stats;
  - JS heap;
  - a 240-frame frame-time graph (green under 17.5 ms, yellow under 33 ms, red above).
- **Benchmark:**
  - in game: *Settings → Performance → Run 30-second benchmark*, or the console command `benchmark 30`;
  - automated, per preset: `npm run benchmark` writes `tests/e2e/output/benchmark-report.{json,md}`.

  The benchmark cruises downstream at golden hour with the HUD hidden and records average FPS, 1% low, p50/p95/p99 frame time, draw calls, triangles and render scale.
- **Console:** `stats`, `quality`, `scale`, `dynres`, `preset`, `laptop`, `wire`.

## Benchmark results

These results were measured automatically in the headless test environment with **software rendering (SwiftShader, 4 CPU cores, no GPU)**, at 1280×720 with dynamic resolution on. Absolute FPS is therefore one to two orders of magnitude lower than on any real GPU, and is **not** representative of player hardware. The table is still useful to compare the relative workload of each preset: draw calls and triangles are what the GPU has to process.

| Preset | Laptop | Avg FPS (software GL) | Avg draw calls | Avg triangles | Avg render scale |
|-|-|-|-|-|-|
| Very Low | no | 4.2 | 122 | 73k | 50% |
| Low | no | 2.1 | 311 | 219k | 55% |
| Medium | no | 1.5 | 408 | 500k | 60% |
| Medium | yes | 1.9 | 338 | 360k | 50% |
| High | no | 0.8 | 806 | 1.10M | 60% |
| Ultra | no | 0.3 | 1166 | 2.04M | 60% |
| Cinematic | no | not measurable | — | — | — |

Cinematic (4× MSAA, 4096² shadows, a full-resolution planar reflection, 4.2 km view distance) did not finish its warm-up within 15 minutes on software rendering, so it has no row. It is intended for strong GPUs, screenshots and cinematic cruising.

Real-GPU frame rates have not been measured by the author (see [KNOWN_ISSUES.md](KNOWN_ISSUES.md)). Run `npm run benchmark`, or the in-game benchmark, on your own hardware to get real numbers.

### Expected targets on real hardware (design goals, not measurements)

- Integrated laptop GPU (Intel Iris Xe / Radeon 680M class): Low or Medium + Laptop Mode at 1080p, 30–60 FPS with dynamic resolution.
- Mid-range desktop GPU (GTX 1660 / RX 6600 class): High at 1080p, 60 FPS.
- High-end GPU (RTX 3080 / RX 6800 class and up): Ultra at 1440p, 60+ FPS. Cinematic is for screenshots and cutscene-like cruising.
