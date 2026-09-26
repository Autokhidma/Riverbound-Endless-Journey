// The traveller's journal: places, fish, wildlife, flora, lore & letters,
// photographs and journey statistics.
import { Panel, h } from './shell.js';
import { FISH, ITEMS } from '../../gameplay/GameState.js';
import { SPECIES_INFO } from '../../wildlife/Wildlife.js';
import { BIOME_BY_ID, BIOMES } from '../../world/biomes.js';
import { LETTERS } from '../../gameplay/Story.js';
import { formatDistance } from '../../core/math.js';
import { fmtTime } from '../dom.js';

const TIME_LABEL = { any: 'any time', day: 'daytime', night: 'at night', dawn: 'at dawn', dusk: 'at dusk', morning: 'in the morning', evening: 'in the evening', golden: 'in golden hour', twilight: 'at twilight' };

export class JournalPanel extends Panel {
  constructor(game, ui) {
    super(game, ui);
    this.width = 'min(1100px, 95vw)';
  }
  title() { return 'Journal'; }
  subtitle() {
    const c = this.game.journal.counts();
    return `${c.places} places · ${c.fish}/${c.fishTotal} fish · ${c.wildlife}/${c.wildlifeTotal} wildlife · ${c.flora} plants · ${c.biomes} lands`;
  }
  tabs() {
    return [{ id: 'places', label: 'Places' }, { id: 'fish', label: 'Fish' }, { id: 'wildlife', label: 'Wildlife' }, { id: 'flora', label: 'Flora & Finds' }, { id: 'lore', label: 'Lore & Letters' }, { id: 'photos', label: 'Photographs' }, { id: 'journey', label: 'Journey' }];
  }
  body(tab) {
    const st = this.game.session.state;
    const d = st.discoveries;
    if (tab === 'places') {
      const list = Object.values(d.features);
      if (!list.length) return h('div.muted', {}, 'Your pages are still empty. Follow the river; there is always something around the next bend.');
      const byRegion = new Map();
      for (const f of list) { if (!byRegion.has(f.region)) byRegion.set(f.region, []); byRegion.get(f.region).push(f); }
      const out = [];
      for (const [r, fs] of [...byRegion.entries()].sort((a, b) => a[0] - b[0])) {
        const reg = this.game.world.seq.regions[r];
        out.push(h('div.section-title', {}, `${reg?.name ?? 'Somewhere'} · ${BIOME_BY_ID[reg?.biome]?.name ?? ''}`));
        out.push(h('div.grid', {}, ...fs.map((f) => h(`div.card.rarity-${f.rarity === 'story' ? 'legendary' : f.rarity ?? 'common'}`, {},
          h('div.name', {}, f.name), h('div.meta', {}, `${f.label}${f.rarity && f.rarity !== 'common' ? ` · ${f.rarity}` : ''} · day ${f.day + 1}`), h('div.desc', {}, f.desc ?? '')))));
      }
      return out;
    }
    if (tab === 'fish') {
      const cards = Object.values(FISH).map((f) => {
        const rec = d.fish[f.id];
        if (!rec) {
          const where = f.biomes.includes('any') ? 'anywhere' : f.biomes.map((b) => BIOME_BY_ID[b]?.name ?? b).join(', ');
          return h(`div.card.locked.rarity-${f.rarity}`, {}, h('div.name', {}, '???'), h('div.meta', {}, `${f.rarity}`), h('div.desc', {}, `Rumoured: ${where}, ${TIME_LABEL[f.time] ?? f.time}${f.weather !== 'any' ? `, in ${f.weather} weather` : ''}${f.habitats?.length ? `, near ${f.habitats.join(' / ')}` : ''}.`));
        }
        return h(`div.card.rarity-${f.rarity}`, {}, h('div.row', {}, h('div.name', {}, f.name), h('div.spacer'), h('div.count', {}, `×${rec.count}`)), h('div.meta', {}, `${f.rarity} · best ${rec.best} cm`), h('div.desc', {}, f.desc));
      });
      return h('div.grid', {}, ...cards);
    }
    if (tab === 'wildlife') {
      return h('div.grid', {}, ...Object.entries(SPECIES_INFO).map(([id, info]) => {
        const rec = d.wildlife[id];
        if (!rec) return h('div.card.locked', {}, h('div.name', {}, '???'), h('div.desc', {}, 'Not yet seen.'));
        return h('div.card', {}, h('div.name', {}, info.name), h('div.meta', {}, [rec.spotted ? 'spotted' : null, rec.photographed ? '📷 photographed' : null].filter(Boolean).join(' · ')), h('div.desc', {}, info.desc));
      }));
    }
    if (tab === 'flora') {
      const res = Object.entries(ITEMS).filter(([, v]) => v.category === 'resource' || v.category === 'curio');
      return h('div.grid', {}, ...res.map(([id, v]) => {
        const n = d.flora[id];
        if (!n) return h('div.card.locked', {}, h('div.name', {}, '???'), h('div.desc', {}, 'Not yet found.'));
        return h('div.card', {}, h('div.row', {}, h('div.name', {}, v.name), h('div.spacer'), h('div.count', {}, `×${n}`)), h('div.desc', {}, v.desc));
      }));
    }
    if (tab === 'lore') {
      const out = [];
      if (st.story.letters.length) {
        out.push(h('div.section-title', {}, 'Letters'));
        out.push(h('div.list', {}, ...st.story.letters.map((id) => LETTERS[id] && h('div.list-item', { style: { cursor: 'pointer' }, onclick: () => this.ui.showLetter(LETTERS[id]) }, h('b', {}, LETTERS[id].title)))));
      }
      const lore = Object.entries(d.lore);
      out.push(h('div.section-title', {}, 'Carvings & messages'));
      if (!lore.length) out.push(h('div.muted', {}, 'Look for sparkling stones on the banks and bottles bobbing in the current.'));
      else out.push(h('div.list', {}, ...lore.map(([, l]) => h('div.list-item', { style: { cursor: 'pointer' }, onclick: () => this.ui.showLetter(l) }, h('b', {}, l.title), h('div.muted', {}, `${l.text.slice(0, 110)}…`)))));
      return out;
    }
    if (tab === 'photos') {
      if (!st.photos.length) return h('div.muted', {}, 'Press P to enter photo mode. Your best shots are kept here.');
      return h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } }, ...[...st.photos].reverse().map((p) => h('div.card', {},
        h('img.photo-thumb', { src: p.thumb, alt: 'photo' }),
        h('div.meta', {}, `Day ${p.day + 1} · ${p.region ?? ''}`), p.subjects?.length ? h('div.desc', {}, p.subjects.map((s) => SPECIES_INFO[s]?.name ?? s).join(', ')) : null)));
    }
    const s = st.stats;
    const regions = Object.keys(d.regions).length;
    const biomes = Object.keys(d.biomes).map((b) => BIOME_BY_ID[b]?.name ?? b);
    const row = (k, v) => h('div.list-item.row', {}, h('div', { style: { flex: 1 } }, k), h('b', {}, String(v)));
    return [
      h('div.list', {},
        row('Mode', st.mode === 'story' ? 'Story' : 'Free Exploration'),
        row('World seed', st.seed),
        row('Time on the river', fmtTime(st.playTime)),
        row('Days passed', this.game.time.day + 1),
        row('Distance travelled', formatDistance(s.distance)),
        row('Furthest downstream', formatDistance(Math.max(0, s.furthestS))),
        row('Regions visited', regions),
        row('Fish caught', s.fishCaught),
        row('Things gathered', s.itemsGathered),
        row('Lamps lit', s.lampsLit),
        row('Requests completed', s.questsDone),
        row('Photographs', s.photos),
        row('Coins earned', s.coinsEarned)),
      h('div.section-title', {}, `Lands seen (${biomes.length}/${BIOMES.filter((b) => !b.hidden).length})`),
      h('div', {}, biomes.length ? biomes.join(' · ') : '—'),
    ];
  }
}
