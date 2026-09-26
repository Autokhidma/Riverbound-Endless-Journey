# Known issues and honest notes

## Technology choices

- **Engine.** Riverbound is built on Three.js / WebGL 2 and packaged with Electron, not on Unreal Engine or Unity. No game-engine editor or Windows machine was available in the build environment, and this stack could be built, run, profiled and tested end to end there.
  - "Shipping build" here means the production Vite build (minified, hashed, no dev server, developer console off by default) packaged into an asar archive inside `Riverbound.exe`.
- **Hardware ray tracing is not available.** WebGL 2 has no ray-tracing API, so the game always uses its fallback path:
  - planar reflections for water;
  - a PMREM-captured procedural sky for image-based lighting;
  - shadow maps;
  - screen-space god rays.

  The *Hardware ray tracing* option is shown in Settings, but disabled, with this explanation. The `rt` console command and the F3 overlay also report that it is unavailable. It is never claimed as working.
- **How the Windows build was verified.** `Riverbound.exe` is built and smoke-tested automatically by GitHub Actions on `windows-latest`: it boots, plays, and saves and loads through native file storage. CI runners have no GPU, so that test runs with software rendering (SwiftShader). The game has not been profiled on physical Windows GPUs by the author, so real-hardware frame rates are not measured (see [PERFORMANCE.md](PERFORMANCE.md)).
- **Unsigned executable.** The exe is not code-signed, so Windows SmartScreen may warn on first launch ("More info → Run anyway").
- **Download size.** Electron bundles Chromium, so the unpacked build is about 370 MB (about 150 MB zipped). The game itself is about 1.1 MB of JavaScript.

## Visual

- Characters, animals and buildings are stylised and low-poly. There is no facial animation and no voice acting; dialogue is text.
- Lit windows on distant houses can read as small bright crosses.
- Fireflies and particles are sparse on Very Low / Low and in Laptop Mode (by design).
- At the tail of a very long cruise, a distant terrain tile can briefly show a lower-detail parent tile while its replacement streams in. There are never holes.
- Rain and snow fall as GPU streaks and flakes around the camera. Only the water shows rain impacts (ring ripples); there are no splashes or drips on other objects.

## Gameplay

- **Pointer lock.** The first click in the world captures the mouse for free look. Browsers reserve **Esc** for releasing a captured mouse, so you may need to press Esc twice to open the pause menu. To look around without capturing, turn off *Settings → Controls → Capture the mouse* and hold the right button instead.
- **Audio** starts after the first click or key press (browser autoplay policy).
- **Walking on foot** is simple: no climbing or jumping, and building collision is approximate (per-house circles).
- **Gamepads** use a fixed layout. Only keyboard keys can be rebound.
- **Language:** English only.
- **Fast travel** is limited to villages you have discovered, and advances the clock by the time the trip would take.
- **Photos in the browser build** are saved as downloads. The desktop build saves them to `Pictures/Riverbound`.

## Technical

- World-generation caches (river samples, per-region features) are not evicted. They grow by a few tens of KB per region, which is negligible for any realistic session, but a multi-hundred-kilometre session keeps them in memory.
- GPU timer queries (used by dynamic resolution and the F3 overlay) are not available in every browser or driver. The game then falls back to frame-interval timing.
- In headless and CI testing, the world is rendered with SwiftShader, so absolute frame rates in the test reports are one to two orders of magnitude below a real GPU.
