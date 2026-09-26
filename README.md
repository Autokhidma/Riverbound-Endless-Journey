# Riverbound

*An endless river. A small boat. All the time in the world.*

Riverbound is a cozy 3D exploration game about following a procedurally generated river that never ends. You row the *Wren*, your grandmother's old boat, from a quiet lake called Willowmere through twelve kinds of land: blossom valleys, jungle, misty highlands, red canyons, wetlands, snowy heights and finally the sea. There's no combat and no fail state, just the river, the weather, the people you meet and the things you find.

The whole world is generated from a **seed**. The same seed always gives the same river, villages, landmarks and story locations. A different seed gives a new world.

## What's in the game

- **An endless, coherent world.** The river is generated forever downstream. Regions follow a climate graph, so jungle never jumps straight to glacier, and they blend into each other over hundreds of metres.
  - 12 biomes, plus one hidden one.
  - Lakes, rapids, tributaries that lead to hidden lakes, waterfalls and grottos, islands, and a coast with a sea.
- **Story Mode.** A Prologue, six chapters and an Epilogue: *Oona's lamps*.
  - Story locations are generated into the right regions for every seed, and always in order.
  - After the Epilogue the same save continues as free exploration.
- **Free Exploration.** Any seed, no story, the same systems.
- **Boat physics.**
  - Buoyancy on waves shared exactly between GPU and CPU, river current and eddy drag, shallow water, rapids and collisions.
  - Oars, sculling oars, a sail and a paddlewheel.
  - "Cruise" hands the steering to a river pilot.
- **Advanced water.**
  - Flow-mapped normals and planar reflections.
  - Sun and moon glitter, and lantern and village-light reflections.
  - Depth colouring and absorption, shore and rapids foam.
  - An interactive ripple simulation, a Kelvin wake, rain rings and bioluminescence.
- **Sky and weather.**
  - A physically placed sun and moon with phases, two star layers, the Milky Way, shooting stars and aurora.
  - Golden hour and sunrise/sunset palettes.
  - God rays and height fog.
  - Weather: clear, cloudy, light rain, heavy rain, mist, fog, storm (with lightning), haze, snow and calm night.
- **A living world.**
  - Instanced forests and grass with wind.
  - Villages with lit windows, chimney smoke, docks and residents.
  - Birds, herons, deer, frogs, butterflies, fireflies and jumping fish.
- **Things to do.**
  - Fishing: 45 species, with rarity by habitat, biome, time, weather, rod and bait.
  - Gathering, and trading in a location-aware economy.
  - Village requests (no combat).
  - 14 random river events.
  - Boat upgrades across 9 tracks.
  - A journal of places, fish, wildlife, flora, lore, letters and photographs.
  - A river chart with fast travel.
- **Photo mode.**
  - Free camera and frozen time.
  - FOV, roll, depth of field, exposure, grading and filters.
  - Time of day and weather.
  - Subject detection.
  - Photos are saved to `Pictures/Riverbound`.
- **Adaptive procedural audio.**
  - Every sound and all of the music is synthesized at runtime.
  - The music follows the biome, time and weather.
- **Performance first.**
  - Six presets (Very Low → Cinematic) and a Laptop Mode.
  - Dynamic resolution that targets your FPS.
  - An F3 overlay and a built-in benchmark.
- **Accessibility.**
  - Interface scale, subtitles and captions for important sounds, and colour-vision modes.
  - Camera shake scale, reduce motion and reduce flashing.
  - Fully rebindable keys and full gamepad support.

## Quick start

```bash
npm ci
npm run dev            # play in the browser at http://localhost:5173
npm test               # unit tests
npm run package:win    # Windows Shipping build -> release/Riverbound-win32-x64/Riverbound.exe
```

See [BUILD.md](BUILD.md) for full build, test and packaging instructions and [CONTROLS.md](CONTROLS.md) for controls.

## Documentation

| Document | Contents |
|-|-|
| [BUILD.md](BUILD.md) | Requirements, dev build, Shipping build, Windows packaging, tests, CI |
| [CONTROLS.md](CONTROLS.md) | Keyboard, mouse, gamepad, photo mode, console |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modules, frame loop, systems, data flow, save format |
| [WORLD_GENERATION.md](WORLD_GENERATION.md) | Seeds, regions, river, terrain, features, story anchors, streaming |
| [PERFORMANCE.md](PERFORMANCE.md) | Presets, Laptop Mode, dynamic resolution, profiling, benchmark results |
| [ART_PIPELINE.md](ART_PIPELINE.md) | Procedural art: meshes, materials, shaders, post-processing |
| [AUDIO.md](AUDIO.md) | Procedural ambience, effects and adaptive music |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Limitations and honest notes |
| [ASSET_LICENSES.md](ASSET_LICENSES.md) | Third-party code and fonts; all game assets are original |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Final feature checklist with the test evidence for each item |

## Technology

- Three.js (WebGL 2) for rendering.
- Vite for building.
- Electron for the Windows/Linux desktop build.
- Playwright for the automated browser and packaged-build tests.

Everything the player sees and hears, including terrain, water, sky, plants, buildings, characters, animals, textures, the icon, sound effects and music, is generated by the game's own code. The repository contains no image, model or audio assets.
