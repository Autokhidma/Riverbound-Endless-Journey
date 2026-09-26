// Inventory operations over GameState (slot-based, stacking by item id).
import { capacity, itemDef } from './GameState.js';

export class Inventory {
  constructor(state, events = null) {
    this.state = state;
    this.events = events;
  }

  get slots() { return this.state.inventory; }
  get capacity() { return capacity(this.state); }
  get used() { return this.state.inventory.length; }
  get free() { return this.capacity - this.used; }

  count(id) {
    return this.state.inventory.filter((s) => s.id === id).reduce((a, s) => a + s.count, 0);
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  /** How many of `id` could be added right now. */
  room(id) {
    const def = itemDef(id);
    if (!def) return 0;
    const stack = def.stack ?? 20;
    let room = 0;
    for (const s of this.state.inventory) if (s.id === id) room += stack - s.count;
    room += (this.capacity - this.used) * stack;
    return room;
  }

  /**
   * Add items. Returns the number actually added (may be less if full).
   * @param meta for fish: { size }
   */
  add(id, n = 1, meta = {}) {
    const def = itemDef(id);
    if (!def || n <= 0) return 0;
    const stack = def.stack ?? 20;
    let left = n;
    for (const s of this.state.inventory) {
      if (left <= 0) break;
      if (s.id !== id || s.count >= stack) continue;
      const k = Math.min(stack - s.count, left);
      s.count += k;
      left -= k;
      if (meta.size) s.best = Math.max(s.best ?? 0, meta.size);
    }
    while (left > 0 && this.used < this.capacity) {
      const k = Math.min(stack, left);
      this.state.inventory.push({ id, count: k, kind: def.kind, best: meta.size ?? undefined });
      left -= k;
    }
    const added = n - left;
    if (added > 0) this.events?.emit('inventory:add', { id, count: added, meta });
    if (left > 0) this.events?.emit('inventory:full', { id, lost: left });
    return added;
  }

  remove(id, n = 1) {
    if (!this.has(id, n)) return false;
    let left = n;
    for (let i = this.state.inventory.length - 1; i >= 0 && left > 0; i--) {
      const s = this.state.inventory[i];
      if (s.id !== id) continue;
      const k = Math.min(s.count, left);
      s.count -= k;
      left -= k;
      if (s.count <= 0) this.state.inventory.splice(i, 1);
    }
    this.events?.emit('inventory:remove', { id, count: n });
    return true;
  }

  /** Check a cost object like { coins: 50, driftwood: 3 }. */
  canAfford(cost = {}) {
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'coins') { if (this.state.coins < v) return false; }
      else if (!this.has(k, v)) return false;
    }
    return true;
  }

  pay(cost = {}) {
    if (!this.canAfford(cost)) return false;
    for (const [k, v] of Object.entries(cost)) {
      if (k === 'coins') this.state.coins -= v;
      else this.remove(k, v);
    }
    this.events?.emit('coins', { coins: this.state.coins });
    return true;
  }

  addCoins(n) {
    this.state.coins += n;
    if (n > 0) this.state.stats.coinsEarned += n;
    this.events?.emit('coins', { coins: this.state.coins, delta: n });
  }

  /** Sort slots: fish first, then by category and name. */
  sort() {
    const order = { fish: 0, resource: 1, curio: 2, supply: 3, gift: 4, quest: 5, junk: 6 };
    this.state.inventory.sort((a, b) => {
      const da = itemDef(a.id), db = itemDef(b.id);
      return (order[da?.category] ?? 9) - (order[db?.category] ?? 9) || (da?.name ?? '').localeCompare(db?.name ?? '');
    });
  }
}
