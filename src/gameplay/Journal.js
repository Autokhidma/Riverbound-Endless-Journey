// The traveller's journal: records discovered places, fish, wildlife, flora,
// lore, letters and photographs, plus journey statistics and region arrivals.
import { FISH, ITEMS } from './GameState.js';
import { SPECIES_INFO } from '../wildlife/Wildlife.js';
import { LANDMARKS } from '../world/Features.js';

export class Journal {
  constructor(game) {
    this.game = game;
    this.lastRegion = -1;
    this.lastBiome = null;
    this.lastPos = null;
    const ev = game.events;
    ev.on('discover', ({ item }) => this.onDiscover(item));
    ev.on('fish:caught', (e) => this.onFish(e));
    ev.on('wildlife:spotted', ({ species }) => this.onWildlife(species, 'spotted'));
    ev.on('inventory:add', ({ id, count }) => {
      if (ITEMS[id]?.category === 'resource') {
        const f = this.d.flora;
        const first = !f[id];
        f[id] = (f[id] ?? 0) + count;
        if (first) ev.emit('toast', { title: 'New in your journal', text: ITEMS[id].name, kind: 'discovery' });
      }
    });
  }

  get d() {
    return this.game.session.state.discoveries;
  }

  onDiscover(item) {
    const s = this.game.session.state;
    if (s.discoveries.features[item.id]) return;
    const def = LANDMARKS[item.type];
    s.discoveries.features[item.id] = {
      id: item.id, kind: item.kind, type: item.type, name: item.name, x: item.x, z: item.z, region: item.region, biome: item.biome,
      rarity: item.rarity, day: this.game.time.day, label: item.kind === 'settlement' ? 'Settlement' : def?.label ?? 'Place', desc: item.kind === 'settlement' ? `A ${item.style} village on the ${this.regionName(item.region)}.` : def?.desc,
    };
    const kind = item.rarity === 'unique' || item.rarity === 'rare' ? 'story' : 'discovery';
    const title = item.kind === 'settlement' ? 'Settlement discovered' : item.rarity === 'unique' ? 'A unique wonder' : item.rarity === 'rare' ? 'A rare discovery' : 'Discovered';
    this.game.events.emit('toast', { title, text: item.name, kind });
    this.game.events.emit('music:moment', { kind: item.rarity === 'unique' || item.rarity === 'rare' ? 'wonder' : 'discovery' });
  }

  regionName(i) {
    return this.game.world.seq.regions[i]?.name ?? 'river';
  }

  onFish({ id, size }) {
    const f = this.d.fish;
    const rec = f[id];
    if (!rec) {
      f[id] = { count: 1, best: size, firstDay: this.game.time.day };
      this.game.events.emit('toast', { title: 'New species!', text: `${FISH[id].name} (${size} cm)`, kind: 'discovery' });
      if (FISH[id].rarity === 'legendary') this.game.events.emit('music:moment', { kind: 'wonder' });
    } else {
      rec.count++;
      if (size > rec.best) {
        rec.best = size;
        this.game.events.emit('toast', { title: 'Personal best', text: `${FISH[id].name}: ${size} cm`, kind: 'discovery' });
      }
    }
  }

  onWildlife(species, how) {
    const w = this.d.wildlife;
    const rec = (w[species] ??= { spotted: false, photographed: false });
    const was = rec[how];
    rec[how] = true;
    if (!was) this.game.events.emit('toast', { title: how === 'photographed' ? 'Photographed' : 'Wildlife spotted', text: SPECIES_INFO[species]?.name ?? species, kind: 'discovery' });
  }

  addLore(id, text, title) {
    const l = this.d.lore;
    if (l[id]) return false;
    l[id] = { text, title, day: this.game.time.day };
    return true;
  }

  update(dt, game) {
    if (game.state !== 'playing') return;
    const s = game.session.state;
    const p = game.player();
    if (this.lastPos) {
      const d = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (d < 50) s.stats.distance += d;
    }
    this.lastPos = { x: p.x, z: p.z };
    s.stats.furthestS = Math.max(s.stats.furthestS, game.boat.physics.s);
    // Region and biome arrivals.
    const region = game.world.regionAtS(game.boat.physics.s);
    if (region.index !== this.lastRegion) {
      const first = !s.discoveries.regions[region.index];
      s.discoveries.regions[region.index] = { name: region.name, biome: region.biome, day: game.time.day };
      if (this.lastRegion !== -1 || first) game.events.emit('region:enter', { region, first });
      this.lastRegion = region.index;
    }
    const biome = game.currentBiome?.id;
    if (biome && biome !== this.lastBiome) {
      if (!s.discoveries.biomes[biome]) {
        s.discoveries.biomes[biome] = { day: game.time.day };
        if (this.lastBiome) game.events.emit('music:moment', { kind: 'biome' });
      }
      this.lastBiome = biome;
    }
  }

  counts() {
    const d = this.d;
    return {
      places: Object.keys(d.features).length,
      fish: Object.keys(d.fish).length,
      fishTotal: Object.keys(FISH).length,
      wildlife: Object.keys(d.wildlife).length,
      wildlifeTotal: Object.keys(SPECIES_INFO).length,
      flora: Object.keys(d.flora).length,
      lore: Object.keys(d.lore).length,
      biomes: Object.keys(d.biomes).length,
    };
  }
}
