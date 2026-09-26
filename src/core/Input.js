// Input: rebindable keyboard + mouse (pointer lock) + standard gamepads.
// Gameplay reads actions/axes; menus can suspend gameplay input.

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
export const PAD_BINDINGS = {
  interact: PAD.A, fish: PAD.X, cancel: PAD.B, journal: PAD.Y, camera: PAD.RB, hurry: PAD.LB, photo: PAD.BACK, pause: PAD.START,
  map: PAD.UP, inventory: PAD.DOWN, quests: PAD.LEFT, lantern: PAD.RIGHT, cruise: PAD.RS, brake: PAD.LS,
};

export class Input {
  constructor(target, settings) {
    this.target = target;
    this.settings = settings;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, locked: false, clicked: false, rightDown: false };
    this.padPrev = [];
    this.padNow = [];
    this.pad = null;
    this.enabled = true; // gameplay input
    this.captureNext = null;
    this.usingGamepad = false;
    this.listeners = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); this.listeners.push([el, ev, fn, opt]); };
    on(window, 'keydown', (e) => {
      if (this.captureNext) { e.preventDefault(); const cb = this.captureNext; this.captureNext = null; cb(e.code); return; }
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (['Tab', 'F12', 'F3', 'Backquote', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.mouse.buttons = 0; });
    on(target, 'mousedown', (e) => {
      this.mouse.buttons |= 1 << e.button;
      if (e.button === 0) this.mouse.clicked = true;
      if (e.button === 2) this.mouse.rightDown = true;
      this.usingGamepad = false;
    });
    on(window, 'mouseup', (e) => {
      this.mouse.buttons &= ~(1 << e.button);
      if (e.button === 2) this.mouse.rightDown = false;
    });
    on(target, 'contextmenu', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => {
      if (this.mouse.locked || this.mouse.rightDown) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    on(target, 'wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    on(document, 'pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === this.target; });
  }

  get bindings() {
    return this.settings.get('controls.bindings');
  }

  requestPointerLock() {
    if (document.pointerLockElement !== this.target && this.target.requestPointerLock) {
      try {
        const p = this.target.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch { /* ignore (e.g. headless) */ }
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Call once per frame before gameplay reads input. */
  poll() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    this.pad = pads.find((p) => p.mapping === 'standard') ?? pads[0] ?? null;
    this.padPrev = this.padNow;
    this.padNow = this.pad ? this.pad.buttons.map((b) => b.pressed || b.value > 0.5) : [];
    if (this.pad && (this.padNow.some(Boolean) || this.pad.axes.some((a) => Math.abs(a) > 0.3))) this.usingGamepad = true;
  }

  /** Clear per-frame edge state. Call at the end of the frame. */
  endFrame() {
    this.pressedKeys.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.clicked = false;
  }

  keyDown(code) { return this.keys.has(code); }

  down(action) {
    const b = this.bindings[action];
    if (b && b.some((k) => this.keys.has(k))) return true;
    const pb = PAD_BINDINGS[action];
    return pb !== undefined && !!this.padNow[pb];
  }

  /** True only on the frame the action was pressed. */
  pressed(action) {
    const b = this.bindings[action];
    if (b && b.some((k) => this.pressedKeys.has(k))) return true;
    const pb = PAD_BINDINGS[action];
    return pb !== undefined && !!this.padNow[pb] && !this.padPrev[pb];
  }

  padAxis(i) {
    const v = this.pad?.axes?.[i] ?? 0;
    return Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
  }

  padTrigger(i) {
    const b = this.pad?.buttons?.[i];
    return b ? b.value : 0;
  }

  /** Movement axes: throttle (+forward) and steer (+right). */
  move() {
    let throttle = 0, steer = 0;
    if (this.down('forward')) throttle += 1;
    if (this.down('back')) throttle -= 1;
    if (this.down('left')) steer -= 1;
    if (this.down('right')) steer += 1;
    if (this.pad) {
      throttle += -this.padAxis(1) + this.padTrigger(PAD.RT) - this.padTrigger(PAD.LT);
      steer += this.padAxis(0);
    }
    return { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)) };
  }

  /** Camera look delta in radians-ish units. */
  look(dt) {
    const sens = this.settings.get('controls.mouseSensitivity') ?? 1;
    const padSens = this.settings.get('controls.gamepadSensitivity') ?? 1;
    const inv = this.settings.get('controls.invertY') ? -1 : 1;
    let x = this.mouse.dx * 0.0025 * sens;
    let y = this.mouse.dy * 0.0025 * sens * inv;
    if (this.pad) {
      x += this.padAxis(2) * dt * 2.6 * padSens;
      y += this.padAxis(3) * dt * 2.0 * padSens * inv;
    }
    return { x, y, active: Math.abs(x) + Math.abs(y) > 1e-5 };
  }

  zoom() {
    let z = this.mouse.wheel;
    if (this.pad) {
      if (this.padNow[PAD.RS] && !this.padPrev[PAD.RS]) z += 0;
    }
    return z;
  }

  /** Wait for the next key press (for rebinding). */
  captureKey(cb) {
    this.captureNext = cb;
  }

  dispose() {
    for (const [el, ev, fn, opt] of this.listeners) el.removeEventListener(ev, fn, opt);
  }
}

export { PAD };
