# Controls

All keyboard bindings can be changed in **Settings → Controls** (two keys per action). Gamepads (the standard mapping: Xbox, PlayStation, most others) work in gameplay and in every menu.

## On the river

| Action | Keyboard / mouse | Gamepad |
|-|-|-|
| Row forward / back water | W / S (or ↑ / ↓) | Left stick up/down, RT / LT |
| Steer | A / D (or ← / →) | Left stick left/right |
| Hurry (row harder) | Shift | LB |
| Brake / hold position | Space | Left stick click |
| Look around | Mouse (click the world to capture the mouse; Esc releases it) or hold right mouse button | Right stick |
| Zoom camera | Mouse wheel | — |
| Change camera (Exploration → First Person → Close Boat → Cinematic) | C | RB |
| Cruise (river pilot) on/off | R | Right stick click |
| Lantern | L | D-pad right |
| Interact (talk, trade, gather, read, light lamps, step ashore / board) | E | A |
| Fishing rod | F | X |
| Photo mode | P | View / Back |
| Journal | J | Y |
| River chart (map) | M | D-pad up |
| Boat storage (inventory) | I or Tab | D-pad down |
| Requests & story | Q | D-pad left |
| Pause menu (save, load, settings) | Esc | Menu / Start |
| Hide HUD | H | — |
| Performance overlay | F3 | — |
| Fullscreen (desktop build) | F11 or Alt+Enter | — |

**Steering assist** is on by default (*Settings → Controls*): turning is quick and direct, rowing speed is steady and the boat drifts less sideways. Turn it off for the full rowing simulation. The same page has *Invert horizontal look* and *Invert vertical look*.

## Fishing

1. Press **F** to ready the rod.
2. Aim with the camera.
3. **Hold** the left mouse button / Space / RT to charge the cast. Release to cast.
4. Wait for a bite. When the bobber dips and the prompt flashes, press **click / Space / E / A** to strike.
5. Reel in: **hold** to lift the green band and **release** to let it fall, keeping the fish inside the band until the progress bar fills.
6. To stop at any point, press **F**, right-click or Esc.

With *Reduce motion* enabled you get extra time to react to bites.

## On foot

Step ashore at a dock or a gentle bank with **E** (the prompt shows *Step ashore*).

- **WASD** moves relative to the camera.
- **Shift** runs.
- **E** talks, gathers or reads. Near the boat, **E** boards the *Wren* again.

## Menus and dialogue

- **Mouse:** click.
- **Keyboard:** number keys 1–9 pick a dialogue choice. Esc goes back or closes.
- **Gamepad:** the D-pad or left stick moves focus, **A** selects, **B** goes back, **LB / RB** switch tabs.

## Photo mode

| Action | Keyboard / mouse | Gamepad |
|-|-|-|
| Look | Drag with either mouse button | Right stick |
| Move | W A S D | Left stick |
| Up / down | E / Q (or Space / Ctrl) | — |
| Faster | Shift | — |
| Lens zoom (FOV) | Mouse wheel | — |
| Take photo | Enter, F12 or the button | — |
| Leave | P or Esc | B |

The panel sets field of view, roll, depth of field (focus distance, aperture), filter, exposure, contrast, saturation, warmth, vignette, grain, fade, time of day and weather. You can also freeze time and hide the boat or the traveller.

## Developer console

The console is enabled in development builds. In shipping builds, turn it on under **Settings → Gameplay → Developer console**, or launch with `?debug=1`. Press **`** (backquote) to open it and type `help`.

| Category | Commands |
|-|-|
| Travel | `tp <metres>`, `region <n>`, `find <type>`, `where` |
| World | `time <h>`, `timescale <x>`, `weather <type>` |
| Graphics and performance | `preset <name>`, `laptop on\|off`, `dynres on\|off [fps]`, `scale <x>`, `perf`, `stats`, `quality`, `rt` |
| Visualisation | `colliders`, `flow`, `wire` |
| Items and progress | `give <id> [n]`, `coins <n>`, `upgrade <track> <tier>`, `story next\|chapter <n>`, `lamp` |
| Other | `event <id>`, `cruise`, `hud`, `photo`, `save [slot]`, `benchmark [seconds]`, `audio`, `seed`, `clear` |
