// Boat progression: purchase upgrades at shipwrights, apply their effects to
// physics, visuals, fishing, navigation and comfort.
import { UPGRADES } from './GameState.js';

export class UpgradeSystem {
  constructor(game) {
    this.game = game;
  }

  get state() {
    return this.game.session.state;
  }

  tier(track) {
    return this.state.upgrades[track] ?? 0;
  }

  next(track) {
    const t = UPGRADES[track];
    const i = this.tier(track) + 1;
    return i < t.tiers.length ? { index: i, ...t.tiers[i] } : null;
  }

  /** Whether the next tier is available (story gates). */
  available(track) {
    const n = this.next(track);
    if (!n) return { ok: false, reason: 'Fully upgraded' };
    if (n.requires) {
      const story = this.state.story;
      const chapters = ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'epilogue'];
      const needIdx = chapters.indexOf(n.requires) + 1;
      const done = this.state.mode === 'free' || story.completed || story.chapter >= needIdx;
      if (!done) return { ok: false, reason: 'Something on your journey will unlock this' };
      if (track === 'lantern' && this.state.mode !== 'free') return { ok: false, reason: 'A gift from the Lamplighters, not a purchase' };
    }
    const inv = this.game.session.inventory;
    if (!inv.canAfford(n.cost ?? {})) return { ok: false, reason: 'Not enough materials', affordable: false };
    return { ok: true };
  }

  buy(track) {
    const n = this.next(track);
    if (!n) return false;
    const a = this.available(track);
    if (!a.ok) { this.game.events.emit('toast', { text: a.reason }); return false; }
    if (!this.game.session.inventory.pay(n.cost ?? {})) return false;
    this.state.upgrades[track] = n.index;
    this.apply();
    this.game.events.emit('toast', { title: 'Boat upgraded', text: n.name, kind: 'discovery' });
    this.game.events.emit('upgrade', { track, tier: n.index });
    return true;
  }

  grant(track, tier) {
    if (this.tier(track) >= tier) return;
    this.state.upgrades[track] = tier;
    this.apply();
    const t = UPGRADES[track].tiers[tier];
    this.game.events.emit('toast', { title: 'A gift', text: `${t.name}: ${t.desc}`, kind: 'story', life: 6 });
  }

  /** Apply upgrade effects to the boat and systems. */
  apply() {
    const g = this.game;
    const u = this.state.upgrades;
    const prop = UPGRADES.propulsion.tiers[u.propulsion ?? 0].id;
    g.boat.physics.setPropulsion(prop);
    g.boat.physics.hullLevel = u.hull ?? 0;
    g.boat.model.applyUpgrades({
      storage: u.storage ?? 0,
      comfort: u.comfort ?? 0,
      propulsion: prop,
      figurehead: (u.figurehead ?? 0) > 0,
      lantern: u.lantern ?? 0,
      paint: this.state.paint,
    });
    g.hasSpyglass = (u.exploration ?? 0) >= 1;
    g.hasCameraFilters = (u.exploration ?? 0) >= 2;
    g.navTier = u.navigation ?? 0;
  }

  /** Paint the boat with a paint item. */
  paint(itemId, hex) {
    this.state.paint = hex;
    this.game.boat.model.applyUpgrades({ ...this.state.upgrades, propulsion: UPGRADES.propulsion.tiers[this.state.upgrades.propulsion ?? 0].id, paint: hex, figurehead: (this.state.upgrades.figurehead ?? 0) > 0 });
    this.game.session.inventory.remove(itemId, 1);
    this.game.events.emit('toast', { text: 'The Wren has a fresh coat of paint.' });
  }
}
