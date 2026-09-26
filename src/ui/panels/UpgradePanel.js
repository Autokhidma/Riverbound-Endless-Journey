// Shipwright: boat upgrades by track, costs in coins and gathered materials.
import { Panel, h } from './shell.js';
import { UPGRADES, itemName } from '../../gameplay/GameState.js';

export class UpgradePanel extends Panel {
  constructor(game, ui, npc, settlement) {
    super(game, ui);
    this.npc = npc;
    this.settlement = settlement;
    this.width = 'min(1040px, 95vw)';
  }
  title() { return `${this.npc?.name ?? 'The shipwright'}'s workshop`; }
  subtitle() { return 'Improve the Wren. Materials come from the river banks; better ones from farther away.'; }
  headerExtra() { return h('span.coins', {}, `${this.game.session.state.coins} coins`); }
  body() {
    const up = this.game.upgrades;
    const inv = this.game.session.inventory;
    const cards = Object.entries(UPGRADES).map(([track, def]) => {
      const tier = up.tier(track);
      const cur = def.tiers[tier];
      const next = up.next(track);
      const av = up.available(track);
      const cost = next?.cost ? Object.entries(next.cost).map(([k, v]) => {
        const have = k === 'coins' ? this.game.session.state.coins : inv.count(k);
        return h('span.pill', { style: { opacity: have >= v ? 1 : 0.55, marginRight: '4px' } }, `${k === 'coins' ? `${v} coins` : `${v} ${itemName(k)}`}${k !== 'coins' ? ` (${have})` : ''}`);
      }) : [];
      return h('div.card', {},
        h('div.row', {}, h('div.name', {}, def.label), h('div.spacer'), h('div.count', {}, `${tier + 1}/${def.tiers.length}`)),
        h('div.meta', {}, `Now: ${cur?.name ?? '—'}`),
        next ? h('div', { style: { margin: '8px 0 4px' } }, h('b', {}, next.name)) : h('div.muted', { style: { margin: '8px 0' } }, 'Fully upgraded.'),
        next ? h('div.desc', {}, next.desc) : null,
        next ? h('div', { style: { margin: '6px 0' } }, ...cost) : null,
        next ? h('button.btn' + (av.ok ? '.primary' : ''), { disabled: !av.ok, title: av.reason ?? '', onclick: () => { if (up.buy(track)) this.refresh(); } }, av.ok ? 'Build it' : av.reason) : null);
    });
    return h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' } }, ...cards);
  }
}
