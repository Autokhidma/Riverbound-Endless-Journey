// Versioned save slots with autosave and migration.
import { migrateState, SAVE_VERSION } from './GameState.js';

export const SLOTS = ['autosave', 'slot1', 'slot2', 'slot3'];

export class SaveSystem {
  constructor(storage) {
    this.storage = storage;
  }

  key(slot) {
    return `save_${slot}`;
  }

  async list() {
    const out = [];
    for (const slot of SLOTS) {
      const data = await this.storage.readJSON(this.key(slot), null);
      out.push({ slot, meta: data?.meta ?? null });
    }
    return out;
  }

  async save(slot, state, meta = {}) {
    const payload = {
      meta: { version: SAVE_VERSION, savedAt: Date.now(), ...meta },
      state,
    };
    await this.storage.writeJSON(this.key(slot), payload);
    return payload.meta;
  }

  async load(slot) {
    const data = await this.storage.readJSON(this.key(slot), null);
    if (!data?.state) return null;
    const state = migrateState(data.state);
    return { meta: data.meta, state };
  }

  async remove(slot) {
    await this.storage.remove(this.key(slot));
  }

  async latest() {
    const all = (await this.list()).filter((s) => s.meta);
    all.sort((a, b) => (b.meta.savedAt ?? 0) - (a.meta.savedAt ?? 0));
    return all[0] ?? null;
  }
}
