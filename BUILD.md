# Building Riverbound

## Requirements

- Node.js 22 or newer, and npm.
- For development: any modern desktop browser with WebGL 2 (Chrome, Edge or Firefox).
- For desktop packaging: nothing extra. `@electron/packager` downloads the Electron runtime for the target platform.
  - Windows builds can be produced from Windows, Linux or macOS. Resource editing uses a pure-JS library, so Wine is not needed.
- For the browser E2E tests: Playwright's Chromium (`npx playwright install chromium`).
- For the packaged Linux smoke test on a headless machine: `xvfb-run` and `zip`.

```bash
npm ci
```

## Development build

```bash
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

Useful URL parameters:

| Parameter | Effect |
|-|-|
| `?quality=veryLow\|low\|medium\|high\|ultra\|cinematic` | Force a preset |
| `?laptop=1` / `?laptop=0` | Force Laptop Mode on or off |
| `?seed=12345` or `?seed=word` | World seed used before a journey starts |
| `?autostart=1&mode=story\|free` | Skip the main menu |
| `?workers=0` | Generate on the main thread (debugging) |
| `?debug=1` | Enable the developer console in a production build |

## Shipping build (web)

```bash
npm run build     # production Vite build into dist/ (minified, hashed assets, ES workers)
npm run preview   # serve dist/ locally
```

## Windows desktop build (Riverbound.exe)

```bash
npm run package:win
```

The script runs these steps:

1. `vite build --mode production` (the Shipping build).
2. Generates `build/icon.ico` / `build/icon.png` procedurally, if they are missing.
3. Packages with Electron.
   - The asar archive contains only `dist/`, `electron/`, the icons and `package.json`.
4. Writes `release/Riverbound-win32-x64/Riverbound.exe` and `release/Riverbound-win32-x64.zip`.
5. Writes `build-info.json` next to the exe.

To install, unzip anywhere and run `Riverbound.exe`. The user data lives in `%APPDATA%/riverbound/`:

- `data/*.json`: settings, saves and backups.
- `logs/riverbound.log`: the log file.

Photos go to `Pictures/Riverbound/`.

Other targets:

```bash
npm run package:linux                          # release/Riverbound-linux-x64/Riverbound
node scripts/package.mjs win32 x64 --no-build  # re-package without rebuilding dist/
```

### Desktop shell features (electron/main.cjs)

- Serves `dist/` over a privileged `app://` protocol, so ES-module workers work exactly as they do on the web.
- Graphics:
  - Prefers the high-performance GPU (`force_high_performance_gpu`) and allows blocklisted drivers.
  - Does not throttle in the background.
- Saves are written atomically (temp file → rename) and the previous version is kept as `.bak`, which is read back automatically if the main file is damaged.
- F11 or Alt+Enter toggles fullscreen.
- The window is sandboxed: context isolation, no Node in the renderer, navigation locked to `app://`.
- `--smoke-test`: boots the game, plays a few seconds, saves and loads through native storage, writes a JSON report, and exits with 0/1. CI uses it to test the real exe.

## Tests

```bash
npm test                 # 39 unit tests (node:test) — world generation, gameplay logic, data, presets, time, camera…
npm run build
npm run test:e2e         # browser E2E: gameplay loop, features, full story playthrough, river drive
npm run smoke:electron   # smoke-test the packaged build for this OS (after npm run package:*)
npm run benchmark        # per-preset benchmark -> tests/e2e/output/benchmark-report.{json,md}
```

The E2E suites run the Shipping build in Chromium with software WebGL (SwiftShader), so they work on machines without a GPU. Screenshots and reports go to `tests/e2e/output/`.

| Suite | Covers |
|-|-|
| `tests/e2e/gameplay.mjs` | Main menu → New Story → talk to Tamsin (completes a story step, receives a letter) → full fishing cycle → selling and buying → every panel → pause and settings (preset applied live) → save to a slot → reload the page → Load → state matches |
| `tests/e2e/features.mjs` | Audio context starts and outputs signal, generative music plays, every camera mode, photo mode (grading, capture, thumbnail, subjects), console commands, visualisations, storm at night, F3 overlay, benchmark |
| `tests/e2e/story.mjs [seed]` | Plays the whole story, Prologue → Epilogue (31 steps), in a generated world, using the game's own triggers: travel, talk, fish, sell, discover, read, photograph, open the veil, light six lamps at night. Then checks that the journey continues on the same save |
| `tests/e2e/drive.mjs` | Cruises down the river. Checks streaming, the boat staying on the water, biome transitions, origin shifts and a bounded geometry count |
| `tests/e2e/electron-smoke.mjs` | Runs the packaged executable with `--smoke-test` |

## Publishing a download (GitHub Release)

`.github/workflows/release.yml` runs when a tag like `v1.0.1` is pushed, or manually from the Actions tab. It builds and smoke-tests the Windows Shipping build on `windows-latest` and attaches `Riverbound-Windows-x64.zip` to a GitHub Release. The newest release is always at:

`https://github.com/Autokhidma/Riverbound-Endless-Journey/releases/latest/download/Riverbound-Windows-x64.zip`

While the repository is private, only people with access to it can use that link.

```bash
git tag v1.0.2 && git push origin v1.0.2
```

## Continuous integration

`.github/workflows/build.yml` has two jobs.

**Linux:**

1. `npm ci`
2. Unit tests
3. Shipping build
4. Browser E2E
5. Package the Linux desktop build and smoke-test it under Xvfb
6. Upload the screenshots

**Windows (`windows-latest`):**

1. `npm ci`
2. Unit tests
3. `node scripts/package.mjs win32 x64`
4. Smoke-test `release/Riverbound-win32-x64/Riverbound.exe`
5. Upload the packaged folder as the `Riverbound-Windows-x64` artifact

The smoke test uses SwiftShader because CI runners have no GPU.
