// Trading with a settlement's trader: sell fish and goods (prices depend on
// origin, local supply and friendship), buy supplies and imported goods.
import { Panel, h } from './shell.js';
import { itemDef, itemName } from '../../gameplay/GameState.js';
import { BIOME_BY_ID } from '../../world/biomes.js';

export class TradePanel extends Panel {
  constructor(game, ui, npc, settlement, opts = {}) {
    super(game, ui);
    this.npc = npc;
    this.settlement = settlement ?? { id: 'wander', name: 'the river', biome: game.currentBiome?.id ?? 'spring' };
    this.opts = opts;
    this.game.session.economy.recover(this.settlement.id);
    this.width = 'min(1040px, 95vw)';
  }
  title() { return this.opts.title ?? `Trading with ${this.npc?.name ?? 'a trader'}`; }
  subtitle() {
    const b = BIOME_BY_ID[this.settlement.biome];
    return `${this.settlement.name}${b ? ` · ${b.name}` : ''} · goods from far away fetch better prices`;
  }
  headerExtra() { return h('span.coins', {}, `${this.game.session.state.coins} coins`); }
  body() {
    const eco = this.game.session.economy;
    const inv = this.game.session.inventory;
    const set = this.settlement;
    const sellRows = inv.slots.filter((s) => eco.buys(s.id)).map((s) => {
      const price = eco.sellPrice(s.id, set, { size: s.best });
      const d = itemDef(s.id);
      return h('div.list-item.row', {},
        h('div', { style: { flex: 1 } }, h('b', {}, itemName(s.id)), ' ', h('span.muted', {}, `×${s.count}${d.kind === 'fish' ? ` · ${d.rarity}` : ''}`)),
        h('span', { style: { minWidth: '70px', textAlign: 'right' } }, `${price} c`),
        h('button.btn', { onclick: () => this.sell(s.id, 1) }, 'Sell'),
        s.count > 1 ? h('button.btn.ghost', { onclick: () => this.sell(s.id, s.count) }, 'All') : null);
    });
    const stock = this.opts.stock ?? eco.stock(set);
    const buyRows = Object.entries(stock).filter(([, n]) => n > 0).map(([id, n]) => {
      const price = Math.round(eco.buyPrice(id, set) * (this.opts.priceScale ?? 1));
      const d = itemDef(id);
      return h('div.list-item.row', {},
        h('div', { style: { flex: 1 } }, h('b', {}, d?.name ?? id), ' ', h('span.muted', {}, `${n} left`), h('div.muted', { style: { fontSize: '13px' } }, d?.desc ?? '')),
        h('span', { style: { minWidth: '70px', textAlign: 'right' } }, `${price} c`),
        h('button.btn', { disabled: this.game.session.state.coins < price || inv.room(id) <= 0, onclick: () => this.buy(id, price, stock) }, 'Buy'));
    });
    return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '18px' } },
      h('div', {}, h('div.section-title', {}, 'Sell'), sellRows.length ? h('div.list', {}, ...sellRows) : h('div.muted', {}, 'Nothing they would buy right now.')),
      h('div', {}, h('div.section-title', {}, 'Buy'), buyRows.length ? h('div.list', {}, ...buyRows) : h('div.muted', {}, 'Sold out for today.')));
  }
  sell(id, n) {
    const s = this.game.session;
    let earned = 0;
    for (let i = 0; i < n; i++) {
      const slot = s.inventory.slots.find((x) => x.id === id);
      if (!slot) break;
      const price = s.economy.sellPrice(id, this.settlement, { size: slot.best });
      if (!s.inventory.remove(id, 1)) break;
      s.economy.recordSale(id, this.settlement, 1);
      earned += price;
    }
    if (earned > 0) {
      s.inventory.addCoins(earned);
      this.game.events.emit('trade:sell', { id, count: n, coins: earned, settlement: this.settlement.id });
      this.game.events.emit('sfx', { name: 'coins' });
    }
    this.refresh();
  }
  buy(id, price, stock) {
    const s = this.game.session;
    if (s.state.coins < price) return;
    if (!s.inventory.add(id, 1)) { this.game.events.emit('toast', { text: 'No room in your storage.' }); return; }
    s.state.coins -= price;
    stock[id]--;
    this.game.events.emit('coins', { coins: s.state.coins, delta: -price });
    this.game.events.emit('trade:buy', { id, coins: price });
    this.game.events.emit('sfx', { name: 'coins' });
    this.refresh();
  }
}
