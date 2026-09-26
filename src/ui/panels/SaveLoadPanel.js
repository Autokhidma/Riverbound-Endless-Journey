// Save / load slots (autosave + three manual slots) with journey summaries.
import { Panel, h } from './shell.js';
import { fmtTime } from '../dom.js';
import { formatDistance } from '../../core/math.js';

export class SaveLoadPanel extends Panel {
  constructor(game, ui, mode = 'load') {
    super(game, ui);
    this.mode = mode;
    this.slots = null;
    this.width = 'min(760px, 94vw)';
    game.session.saves.list().then((s) => { this.slots = s; this.refresh(); });
  }
  title() { return this.mode === 'save' ? 'Save Journey' : 'Load Journey'; }
  body() {
    if (!this.slots) return h('div.muted', {}, 'Reading saves…');
    return h('div.list', {}, ...this.slots.map(({ slot, meta }) => {
      const name = slot === 'autosave' ? 'Autosave' : `Slot ${slot.slice(4)}`;
      const info = meta ? `${meta.mode === 'free' ? 'Free Exploration' : meta.chapter} · ${meta.region ?? ''} · ${formatDistance(meta.distance ?? 0)} travelled · ${fmtTime(meta.playTime ?? 0)} · ${new Date(meta.savedAt).toLocaleString()}` : 'Empty';
      const actions = [];
      if (this.mode === 'save' && slot !== 'autosave') actions.push(h('button.btn.primary', { onclick: async () => { await this.game.session.save(slot); this.slots = await this.game.session.saves.list(); this.refresh(); } }, meta ? 'Overwrite' : 'Save here'));
      if (this.mode === 'load' && meta) actions.push(h('button.btn.primary', { onclick: () => { this.ui.closeModal(true); this.ui.continueJourney(slot); } }, 'Load'));
      if (meta && slot !== 'autosave') actions.push(h('button.btn.ghost', { onclick: async () => { if (!confirm(`Delete ${name}?`)) return; await this.game.session.saves.remove(slot); this.slots = await this.game.session.saves.list(); this.refresh(); } }, 'Delete'));
      return h('div.list-item.row', {}, h('div', { style: { flex: 1 } }, h('b', {}, name), h('div.muted', {}, info), meta?.seed !== undefined ? h('div.muted', { style: { fontSize: '12px' } }, `Seed ${meta.seed}`) : null), ...actions);
    }));
  }
}
