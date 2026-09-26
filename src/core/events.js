// Minimal synchronous event bus used for decoupled system communication
// (e.g. fishing -> quests -> journal -> UI toasts).

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[events] handler for "${type}" failed`, err);
        }
      }
    }
    const any = this.handlers.get('*');
    if (any) for (const fn of [...any]) fn({ type, payload });
  }
}
