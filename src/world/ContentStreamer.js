// Spawns/despawns world content around the player: landmarks, settlements,
// resource nodes and lore objects. Collects light emitters for the fixed
// point-light pool, waterfall mist disturbances and sound emitters, and fires
// discovery events when the player comes within a feature's radius.
import * as THREE from 'three';
import { buildLandmark } from './LandmarkBuilder.js';
import { buildSettlement } from './SettlementBuilder.js';
import { speciesGeometry } from './Species.js';
import { getFoliageMaterials } from '../render/FoliageMaterials.js';

const SPAWN = { landmark: 1500, settlement: 1100, resource: 140, lore: 140, veil: 600 };
const RESOURCE_MODEL = {
  wild_mint: 'fern', blossom_sprig: 'bush_flower', reeds_bundle: 'reeds', driftwood: 'driftwood', orchid: 'bush_flower', vanilla_pod: 'fern',
  river_clay: 'rock_small', chestnuts: 'bush', amber_resin: 'rock_small', mountain_herb: 'fern', slate_flake: 'rock_flat', clear_quartz: 'crystal',
  blue_lichen: 'rock_small', ochre_pigment: 'rock_small', desert_sage: 'shrub_dry', bamboo_shoot: 'reeds', lotus_seed: 'lilypad', bog_myrtle: 'bush',
  glowcap: 'mushroom_glow', ember_moss: 'rock_small', cloudberries: 'bush_flower', pine_resin: 'rock_small', seashell: 'rock_small', sea_glass: 'crystal',
  frost_lichen: 'rock_small', ice_crystal: 'crystal', lumen_bloom: 'glow_plant', star_shard: 'crystal',
};

export class ContentStreamer {
  constructor(game) {
    this.game = game;
    this.spawned = new Map(); // feature id -> { item, group }
    this.timer = 0;
    this.discovered = new Set();
    this.lightCandidates = [];
    this.sparkle = this.createSparkleMaterial();
  }

  createSparkleMaterial() {
    return new THREE.SpriteMaterial({ color: new THREE.Color(2.2, 2.0, 1.4), transparent: true, opacity: 0.8, depthWrite: false });
  }

  onWorldDispose() {
    for (const [id, s] of this.spawned) this.despawn(id, s);
    this.discovered.clear();
  }

  isCollected(it) {
    return this.game.session?.isCollected(it.id) ?? false;
  }

  update(dt, game) {
    this.timer -= dt;
    const p = game.player();
    if (this.timer <= 0) {
      this.timer = 0.4;
      this.refresh(p);
    }
    const t = game.elapsed;
    const ctxNight = game.time.nightFactor;
    for (const s of this.spawned.values()) {
      const u = s.group?.userData;
      if (u?.update) u.update(dt, t, game);
      if (s.item.kind === 'resource' && s.sprite) {
        s.sprite.material.opacity = 0.35 + 0.35 * Math.sin(t * 3 + s.phase) + ctxNight * 0.3;
      }
    }
    // Discovery checks (cheap distance tests on spawned items).
    for (const s of this.spawned.values()) {
      const it = s.item;
      if (!it.radius || this.discovered.has(it.id)) continue;
      if (it.kind !== 'landmark' && it.kind !== 'settlement' && it.kind !== 'tributary') continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      const r = Math.max(35, it.radius * (it.kind === 'settlement' ? 0.8 : 0.6));
      if (d < r) {
        this.discovered.add(it.id);
        game.events.emit('discover', { item: it });
      }
    }
    // Waterfall mist disturbs the ripple sim when near.
    for (const s of this.spawned.values()) {
      const e = s.group?.userData?.emitters?.mistDrop;
      if (!e) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < 40 && Math.random() < dt * 20) game.water?.splash(e.x + (Math.random() - 0.5) * 4, e.z + (Math.random() - 0.5) * 4, 0.6, 0.6 * e.strength);
    }
    this.collectLights(game, p);
  }

  refresh(p) {
    const game = this.game;
    const near = game.world.featuresNear(p.x, p.z, SPAWN.landmark, ['landmark', 'settlement', 'resource', 'lore', 'veil', 'tributary']);
    const keep = new Set();
    for (const it of near) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      const limit = SPAWN[it.kind] ?? 0;
      if (it.kind === 'tributary') { keep.add(it.id); if (!this.spawned.has(it.id)) this.spawned.set(it.id, { item: it, group: null }); continue; }
      if (d > limit) continue;
      if (it.kind === 'resource' && this.isCollected(it)) continue;
      if (it.kind === 'lore' && this.isCollected(it)) continue;
      keep.add(it.id);
      if (!this.spawned.has(it.id)) this.spawn(it);
    }
    for (const [id, s] of this.spawned) {
      if (keep.has(id)) continue;
      const d = Math.hypot(s.item.x - p.x, s.item.z - p.z);
      const limit = (SPAWN[s.item.kind] ?? 0) + 250;
      if (d > limit || (s.item.kind === 'resource' && this.isCollected(s.item))) this.despawn(id, s);
    }
  }

  spawn(it) {
    const game = this.game;
    let group = null;
    const ctx = { world: game.world, quality: game.quality, biome: game.world.biomeAt(it.x, it.z).dominant };
    try {
      if (it.kind === 'landmark' || it.kind === 'veil') group = buildLandmark(it, ctx);
      else if (it.kind === 'settlement') group = buildSettlement(it, ctx);
      else if (it.kind === 'resource') group = this.buildResource(it);
      else if (it.kind === 'lore') group = this.buildLore(it);
    } catch (e) {
      console.error(`[content] failed to build ${it.kind}/${it.type}`, e);
      group = null;
    }
    const entry = { item: it, group, phase: Math.random() * 6 };
    if (group) {
      game.worldRoot.add(group);
      if (it.kind === 'resource') entry.sprite = group.userData.sprite;
    }
    this.spawned.set(it.id, entry);
    game.events.emit('content:spawn', { item: it, group });
  }

  despawn(id, s) {
    if (s.group) {
      this.game.worldRoot.remove(s.group);
      s.group.traverse((o) => {
        if (o.isMesh || o.isPoints) {
          if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        }
      });
    }
    this.spawned.delete(id);
    this.game.events.emit('content:despawn', { item: s.item });
  }

  buildResource(it) {
    const g = new THREE.Group();
    const y = this.game.world.heightAt(it.x, it.z);
    g.position.set(it.x, y, it.z);
    const model = RESOURCE_MODEL[it.item] ?? 'rock_small';
    const geo = speciesGeometry(model, 1);
    geo.userData.shared = true;
    const mats = getFoliageMaterials();
    const mat = model === 'crystal' ? mats.crystal : model.startsWith('rock') || model === 'driftwood' ? mats.rock : mats.foliage;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(model === 'crystal' ? 0.6 : 0.9);
    mesh.castShadow = true;
    g.add(mesh);
    const sprite = new THREE.Sprite(this.sparkle.clone());
    sprite.scale.set(0.35, 0.35, 0.35);
    sprite.position.y = 1.0;
    g.add(sprite);
    g.userData.sprite = sprite;
    return g;
  }

  buildLore(it) {
    const g = new THREE.Group();
    const w = this.game.world;
    const info = w.waterInfo(it.x, it.z, {});
    if (it.type === 'bottle') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0x6aa89a, roughness: 0.1, transparent: true, opacity: 0.75 }));
      m.rotation.z = Math.PI / 2 - 0.2;
      g.add(m);
      g.position.set(it.x, info.level + 0.04, it.z);
      g.userData.update = (dt, t) => { m.position.y = Math.sin(t * 1.4 + it.x) * 0.04; m.rotation.y = t * 0.2; };
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a867a, roughness: 0.9 }));
      m.position.y = 0.6;
      m.rotation.y = it.x % 3;
      m.castShadow = true;
      g.add(m);
      g.position.set(it.x, Math.max(info.height, info.level + 0.2), it.z);
    }
    const sprite = new THREE.Sprite(this.sparkle.clone());
    sprite.scale.set(0.3, 0.3, 0.3);
    sprite.position.y = 1.4;
    g.add(sprite);
    return g;
  }

  /** Choose the nearest lit emitters for the fixed point-light pool. */
  collectLights(game, p) {
    const night = game.time.nightFactor;
    const list = [];
    for (const s of this.spawned.values()) {
      const u = s.group?.userData;
      if (!u) continue;
      if (u.lights && night > 0.15) for (const L of u.lights) list.push({ ...L, intensity: L.intensity * Math.min(1, night * 1.5) * 6 });
      if (u.lightPoint && u.lightPoint.when()) list.push({ ...u.lightPoint, intensity: 8 });
    }
    for (const L of list) L.d = Math.hypot(L.x - p.x, L.z - p.z);
    list.sort((a, b) => a.d - b.d);
    const pool = game.lighting.pool.length;
    const chosen = list.slice(0, Math.max(pool, 4));
    game.worldLights = chosen;
    game.lighting.assignPoolLights(chosen.slice(0, pool).map((L) => ({ x: L.x - game.origin.x, y: L.y, z: L.z - game.origin.z, color: L.color, intensity: L.intensity, range: L.range })));
  }

  /** Spawned entry for a feature id. */
  get(id) {
    return this.spawned.get(id);
  }

  /** Items of a kind currently spawned. */
  spawnedOf(kind) {
    return [...this.spawned.values()].filter((s) => s.item.kind === kind);
  }
}
