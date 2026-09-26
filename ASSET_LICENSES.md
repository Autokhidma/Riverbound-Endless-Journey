# Asset licences

## Original content (this repository)

Every game asset is **original and generated procedurally by Riverbound's own code**. The repository contains no third-party images, 3D models, textures, HDRIs, sound effects, music, animations or voice recordings. This covers:

- terrain, rivers, lakes and the sea;
- skies, stars, clouds and weather;
- trees and plants;
- rocks and landmarks;
- buildings and villages;
- the boat, the characters and the animals;
- textures;
- the application icon;
- every sound effect and all of the music.

| Content | Source |
|-|-|
| Meshes (terrain, water, vegetation, landmarks, villages, boat, characters, wildlife) | Generated at runtime from code in `src/world`, `src/boat`, `src/character`, `src/wildlife` |
| Textures (detail noise, water normals, foam, wood, canvas) | Generated at runtime in `src/render/ProceduralTextures.js` |
| Shaders (water, sky, terrain, foliage, post) | Written for this project |
| Sound effects, ambience and music | Synthesised at runtime with Web Audio (`src/audio`) |
| Application icon (`build/icon.png`, `build/icon.ico`) | Rendered by `scripts/make-icon.mjs` |
| Writing | Story, letters, dialogue, lore, names and descriptions in `src/data/*.json`, written for this project |

The visual style was designed for this game and does not reproduce any reference image, existing game, character or brand.

## Third-party software and fonts

| Component | Version | Licence | Used for | Shipped |
|-|-|-|-|-|
| [three.js](https://threejs.org) | 0.186.1 | MIT | 3D rendering | Yes (bundled JS) |
| [Nunito](https://github.com/googlefonts/nunito) via @fontsource/nunito | 5.3.0 | SIL Open Font License 1.1 (Copyright 2014 The Nunito Project Authors) | UI body text | Yes (woff/woff2) |
| [Cormorant Garamond](https://github.com/CatharsisFonts/Cormorant) via @fontsource/cormorant-garamond | 5.3.0 | SIL Open Font License 1.1 (Copyright 2015 The Cormorant Project Authors) | Titles | Yes (woff/woff2) |
| [Electron](https://www.electronjs.org) | 44.4.5 | MIT (Chromium components under their own licences, shipped as `LICENSES.chromium.html`) | Desktop runtime | Desktop builds |
| [Vite](https://vitejs.dev) | 8.3.1 | MIT | Build tool | No |
| [@electron/packager](https://github.com/electron/packager) | 20.3.0 | BSD-2-Clause | Packaging | No |
| [Playwright](https://playwright.dev) | 1.63.0 | Apache-2.0 | Automated tests | No |

The full licence texts for everything that ships with the game are in `public/licenses/`. That folder is copied into every build as `dist/licenses/` and packaged inside the desktop app. The in-game **Credits** screen summarises these notices.
