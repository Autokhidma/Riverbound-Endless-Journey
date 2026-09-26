// Inventory: slots, coins, capacity; use tea / paint / readable items.
import { Panel, h } from './shell.js';
import { itemDef } from '../../gameplay/GameState.js';

const CAT_ICON = { resource: '🌿', supply: '🧺', curio: '✧', quest: '✉', junk: '·', gift: '🎁', fish: '🐟' };

export class InventoryPanel extends Panel {
  title() { return 'Boat Storage'; }
  subtitle() {
    const inv = this.game.session.inventory;
    return `${inv.used} / ${inv.capacity} slots`;
  }
  headerExtra() {
    return h('div.row', {}, h('span.coins', {}, `${this.game.session.state.coins} coins`), h('button.btn.ghost', { onclick: () => { this.game.session.inventory.sort(); this.refresh(); } }, 'Sort'));
  }
  tabs() {
    return [{ id: 'all', label: 'All' }, { id: 'fish', label: 'Fish' }, { id: 'resource', label: 'Gathered' }, { id: 'supply', label: 'Supplies' }, { id: 'other', label: 'Curios & Letters' }];
  }
  body(tab) {
    const inv = this.game.session.inventory;
    const slots = inv.slots.filter((s) => {
      const d = itemDef(s.id);
      const cat = d?.kind === 'fish' ? 'fish' : d?.category;
      if (tab === 'all') return true;
      if (tab === 'other') return !['fish', 'resource', 'supply'].includes(cat);
      return cat === tab;
    });
    const cards = slots.map((s) => this.card(s));
    const empty = tab === 'all' ? Math.max(0, inv.capacity - inv.used) : 0;
    for (let i = 0; i < empty; i++) cards.push(h('div.card.locked', { style: { minHeight: '84px' } }, h('div.meta', {}, 'Empty')));
    if (!cards.length) return h('div.muted', {}, 'Nothing here yet.');
    return h('div.grid', {}, ...cards);
  }
  card(s) {
    const d = itemDef(s.id) ?? { name: s.id, category: 'junk' };
    const cat = d.kind === 'fish' ? 'fish' : d.category;
    const usable = s.id === 'river_tea' || d.paint || d.readable;
    return h('div.card' + (d.rarity ? `.rarity-${d.rarity}` : ''), {},
      h('div.row', {}, h('div.name', {}, `${CAT_ICON[cat] ?? ''} ${d.name}`), h('div.spacer'), h('div.count', {}, `×${s.count}`)),
      h('div.meta', {}, [cat === 'fish' ? `${d.rarity} fish${s.best ? ` · best ${s.best} cm` : ''}` : cat, d.value ? `~${d.value} coins` : null].filter(Boolean).join(' · ')),
      h('div.desc', {}, d.desc ?? ''),
      usable ? h('button.btn', { style: { marginTop: '8px' }, onclick: () => { this.ui.closeModal(); this.game.session.useItem(s.id); } }, s.id === 'river_tea' ? 'Brew & rest' : d.paint ? 'Paint the boat' : 'Read') : null);
  }
}
