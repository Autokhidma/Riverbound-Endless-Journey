// Persistent storage abstraction.
//  - Desktop (Electron): JSON files under the user-data folder via the preload bridge.
//  - Browser / tests: localStorage (namespaced), or an in-memory map if unavailable.

const PREFIX = 'riverbound:';

class MemoryBackend {
  constructor() { this.map = new Map(); }
  async read(key) { return this.map.has(key) ? this.map.get(key) : null; }
  async write(key, text) { this.map.set(key, text); return true; }
  async remove(key) { this.map.delete(key); return true; }
  async list(prefix = '') { return [...this.map.keys()].filter((k) => k.startsWith(prefix)); }
}

class LocalStorageBackend {
  async read(key) {
    try { return localStorage.getItem(PREFIX + key); } catch { return null; }
  }
  async write(key, text) {
    try { localStorage.setItem(PREFIX + key, text); return true; } catch (e) { console.warn('[storage] write failed', e); return false; }
  }
  async remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
    return true;
  }
  async list(prefix = '') {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
      }
    } catch { /* ignore */ }
    return out;
  }
}

class NativeBackend {
  constructor(native) { this.native = native; }
  read(key) { return this.native.storageRead(key); }
  write(key, text) { return this.native.storageWrite(key, text); }
  remove(key) { return this.native.storageRemove(key); }
  list(prefix = '') { return this.native.storageList(prefix); }
}

function pickBackend() {
  const native = typeof window !== 'undefined' ? window.riverboundNative : null;
  if (native?.storageRead) return new NativeBackend(native);
  if (typeof localStorage !== 'undefined') return new LocalStorageBackend();
  return new MemoryBackend();
}

export class Storage {
  constructor(backend = pickBackend()) {
    this.backend = backend;
  }

  async readJSON(key, fallback = null) {
    const text = await this.backend.read(key);
    if (text == null) return fallback;
    try { return JSON.parse(text); } catch (e) { console.warn(`[storage] corrupt JSON in ${key}`, e); return fallback; }
  }

  writeJSON(key, value) {
    return this.backend.write(key, JSON.stringify(value));
  }

  remove(key) { return this.backend.remove(key); }
  list(prefix) { return this.backend.list(prefix); }
}

export { MemoryBackend };
