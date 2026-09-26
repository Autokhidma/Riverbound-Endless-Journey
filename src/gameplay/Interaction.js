// Interaction prompts: systems register providers that return nearby
// interactables; the nearest valid one is shown as a prompt and triggered with
// the Interact action (E / gamepad A).

export class Interaction {
  constructor(game) {
    this.game = game;
    this.providers = [];
    this.current = null;
    this.cooldown = 0;
  }

  /** provider(game, pos) -> [{ id, x, z, range, label, verb, action(), priority }] */
  addProvider(fn) {
    this.providers.push(fn);
  }

  update(dt, game) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (game.state !== 'playing' || game.ui?.modalOpen || game.cameraRig.mode === 'photo' || game.fishing?.active) {
      this.setCurrent(null);
      return;
    }
    const p = game.player();
    let best = null, bestScore = Infinity;
    for (const prov of this.providers) {
      let list;
      try { list = prov(game, p) ?? []; } catch (e) { console.error('[interaction] provider failed', e); continue; }
      for (const it of list) {
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d > (it.range ?? 4)) continue;
        const score = d - (it.priority ?? 0) * 3;
        if (score < bestScore) { bestScore = score; best = it; }
      }
    }
    this.setCurrent(best);
    if (best && game.input.pressed('interact') && this.cooldown <= 0) {
      this.cooldown = 0.35;
      try { best.action(); } catch (e) { console.error('[interaction] action failed', e); }
    }
  }

  setCurrent(it) {
    const key = it ? `${it.id}|${it.label}` : null;
    if (key === this.key) return;
    this.key = key;
    this.current = it;
    this.game.events.emit('prompt', it ? { verb: it.verb ?? 'Interact', label: it.label, key: 'interact' } : null);
  }
}
