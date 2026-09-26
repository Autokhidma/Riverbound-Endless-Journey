// Developer tools: F3 performance overlay with a frame-time graph, a `
// console with commands (teleport, time, weather, presets, items, story,
// events, visualisations), debug visualisations and the benchmark runner.
import * as THREE from 'three';
import { h } from '../ui/dom.js';
import { PRESET_ORDER, resolveQuality } from '../render/QualityPresets.js';
import { EVENTS } from '../gameplay/EventDirector.js';
import { ITEMS, FISH } from '../gameplay/GameState.js';

export class DebugTools {
  constructor(game) {
    this.game = game;
    this.perfOn = false;
    this.open = false;
    this.history = [];
    this.vis = { colliders: false, wire: false, flow: false };
    this.visGroup = new THREE.Group();
    this.visGroup.name = 'debugVis';
    game.scene.add(this.visGroup);
    this.frameGraph = new Float32Array(240);
    this.fgIndex = 0;
    this.lastT = performance.now();
    window.addEventListener('keydown', (e) => {
      const b = game.settings.get('controls.bindings');
      if (b.perf?.includes(e.code)) { e.preventDefault(); this.togglePerf(); }
      else if (b.console?.includes(e.code) && !(this.open && e.target === this.input) && this.consoleAllowed()) { e.preventDefault(); this.toggleConsole(); }
      else if (this.open && e.code === 'Escape') { e.stopImmediatePropagation(); this.toggleConsole(false); }
    }, true);
    this.commands = this.buildCommands();
  }

  /** The console is always on in development; in shipping builds it is opt-in (setting or ?debug=1). */
  consoleAllowed() {
    return !!(import.meta.env?.DEV || this.game.settings.get('gameplay.devConsole') || new URLSearchParams(location.search).has('debug'));
  }

  // ------------------------------------------------------------ overlay
  togglePerf(on = !this.perfOn) {
    this.perfOn = on;
    if (on && !this.perfEl) {
      this.perfText = h('div');
      this.graph = h('canvas', { width: 240, height: 48 });
      this.perfEl = h('div.perf', {}, this.perfText, this.graph);
      document.getElementById('ui').append(this.perfEl);
    }
    if (this.perfEl) this.perfEl.style.display = on ? '' : 'none';
  }

  lateUpdate(dt, game) {
    const now = performance.now();
    const ft = now - this.lastT;
    this.lastT = now;
    this.frameGraph[this.fgIndex++ % 240] = ft;
    if (this.bench) this.benchTick(ft);
    if (this.vis.colliders || this.vis.flow) this.drawVis(game);
    if (!this.perfOn) return;
    this.perfTimer = (this.perfTimer ?? 0) - dt;
    if (this.perfTimer > 0 && !game.paused) return;
    this.perfTimer = 0.25;
    const s = game.stats();
    const r = s.render;
    const q = game.quality;
    const mem = s.memory ? `${s.memory.usedMB.toFixed(0)} / ${s.memory.totalMB.toFixed(0)} MB` : 'n/a';
    this.perfText.textContent = [
      `FPS ${s.fps.toFixed(0)}   frame ${s.frameMs.toFixed(1)} ms   1% worst ${s.p99Ms.toFixed(1)} ms`,
      `CPU update ${s.cpuUpdateMs.toFixed(2)} ms   render submit ${s.cpuRenderMs.toFixed(2)} ms   GPU ${r.gpuMs ? `${r.gpuMs.toFixed(2)} ms` : 'n/a'}`,
      `draw calls ${r.drawCalls}   tris ${(r.triangles / 1000).toFixed(0)}k   geos ${r.geometries}   tex ${r.textures}   programs ${r.programs}`,
      `render ${r.width}x${r.height} (${Math.round(r.scale * 100)}%)   dynres ${q.dynamicRes ? `on → ${q.targetFps} fps` : 'off'}`,
      `preset ${q.preset}${q.laptopMode ? ' + laptop' : ''}   ray tracing: unavailable (WebGL2 fallback)`,
      `terrain ${s.terrain.visible} vis / ${s.terrain.loaded} loaded / ${s.terrain.pending} pending   water ${s.water.segments} seg`,
      `vegetation ${s.vegetation.cells ?? '-'} cells / ${s.vegetation.instances ?? '-'} inst   workers q${s.workers.queued} f${s.workers.inFlight} done ${s.workers.done}`,
      `heap ${mem}   audio ${game.audio?.stats().state ?? 'off'}`,
      `${s.region} · ${s.biome} · s=${s.s.toFixed(0)} m · ${game.time.clockString()} · ${game.weather.type ?? ''}`,
    ].join('\n');
    const g = this.graph.getContext('2d');
    g.clearRect(0, 0, 240, 48);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 48 - (16.7 / 50) * 48, 240, 1);
    g.fillRect(0, 48 - (33.3 / 50) * 48, 240, 1);
    for (let i = 0; i < 240; i++) {
      const v = this.frameGraph[(this.fgIndex + i) % 240];
      g.fillStyle = v > 33.4 ? '#ff7a6a' : v > 17.5 ? '#ffd48a' : '#8fe0b0';
      const hgt = Math.min(48, (v / 50) * 48);
      g.fillRect(i, 48 - hgt, 1, hgt);
    }
  }

  // ------------------------------------------------------------ visualisations
  drawVis(game) {
    this.visTimer = (this.visTimer ?? 0) - 1;
    if (this.visTimer > 0) return;
    this.visTimer = 10;
    for (const c of [...this.visGroup.children]) { c.geometry.dispose(); this.visGroup.remove(c); }
    const p = game.player();
    const pts = [];
    if (this.vis.colliders) {
      for (const c of game.collidersNear(p.x, p.z, 120)) {
        const y = game.boat.physics.waterLevel + 0.5;
        if (c.type === 'circle') {
          for (let i = 0; i < 24; i++) {
            const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
            pts.push(c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r);
          }
        } else {
          const ca = Math.cos(c.angle ?? 0), sa = Math.sin(c.angle ?? 0);
          const corner = (u, v) => [c.x + ca * u - sa * v, y, c.z + sa * u + ca * v];
          const k = [corner(-c.hl, -c.hw), corner(c.hl, -c.hw), corner(c.hl, c.hw), corner(-c.hl, c.hw)];
          for (let i = 0; i < 4; i++) pts.push(...k[i], ...k[(i + 1) % 4]);
        }
      }
    }
    if (this.vis.flow) {
      const f = {};
      for (let dx = -60; dx <= 60; dx += 8) for (let dz = -60; dz <= 60; dz += 8) {
        const x = p.x + dx, z = p.z + dz;
        const w = game.world.waterInfo(x, z, {});
        if (w.depth <= 0.1) continue;
        game.world.flowAt(x, z, f);
        pts.push(x, w.level + 0.2, z, x + f.x * 3, w.level + 0.2, z + f.z * 3);
      }
    }
    if (!pts.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.map((v, i) => (i % 3 === 0 ? v - game.origin.x : i % 3 === 2 ? v - game.origin.z : v)), 3));
    const lines = new THREE.LineSegments(geo, this.visMat ??= new THREE.LineBasicMaterial({ color: 0xff40a0, depthTest: false }));
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    this.visGroup.add(lines);
  }

  setWireframe(on) {
    const g = this.game;
    g.terrainMaterial.wireframe = on;
    for (const m of g.water.materials ?? []) m.wireframe = on;
  }

  // ------------------------------------------------------------ console
  toggleConsole(on = !this.open) {
    const g = this.game;
    this.open = on;
    if (on && !this.consoleEl) {
      this.log = h('div.log');
      this.input = h('input', { placeholder: 'type "help" · Enter to run · ↑ history · ` or Esc to close', onkeydown: (e) => this.onInput(e) });
      this.consoleEl = h('div.console', {}, this.log, this.input);
      document.getElementById('ui').append(this.consoleEl);
      this.print('Riverbound console. Type "help".');
    }
    if (this.consoleEl) this.consoleEl.style.display = on ? '' : 'none';
    g.input.enabled = !on && !g.ui?.modal && g.state === 'playing';
    if (on) { g.input.exitPointerLock(); setTimeout(() => this.input.focus(), 0); } else this.input?.blur();
  }

  print(text, colour) {
    const line = h('div', { style: colour ? { color: colour } : {} }, text);
    this.log.append(line);
    this.log.scrollTop = this.log.scrollHeight;
  }

  onInput(e) {
    e.stopPropagation();
    if (e.code === 'Enter') {
      const cmd = this.input.value.trim();
      this.input.value = '';
      if (!cmd) return;
      this.history.push(cmd);
      this.hIndex = this.history.length;
      this.print(`> ${cmd}`, '#8fb');
      try {
        const out = this.run(cmd);
        if (out !== undefined) this.print(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
      } catch (err) { this.print(String(err.message || err), '#f99'); }
    } else if (e.code === 'ArrowUp') { this.hIndex = Math.max(0, (this.hIndex ?? 0) - 1); this.input.value = this.history[this.hIndex] ?? ''; }
    else if (e.code === 'ArrowDown') { this.hIndex = Math.min(this.history.length, (this.hIndex ?? 0) + 1); this.input.value = this.history[this.hIndex] ?? ''; }
    else if (e.code === 'Backquote') { e.preventDefault(); this.toggleConsole(false); }
  }

  /** Run a console command (also used by tests). */
  run(line) {
    const [name, ...args] = line.split(/\s+/);
    const c = this.commands[name.toLowerCase()];
    if (!c) throw new Error(`Unknown command "${name}". Type "help".`);
    return c.fn(...args);
  }

  teleportS(s, t = 0) {
    const g = this.game;
    const p = g.world.riverToWorld(s, t);
    const heading = g.world.main.sample(s, {}).h;
    g.setOrigin(p.x, p.z);
    g.boat.placeAt(p.x, p.z, heading);
    if (g.onFoot) g.onFootSystem.board();
    return `Teleported to s=${s.toFixed(0)} (${g.world.regionAtS(s).name})`;
  }

  buildCommands() {
    const g = this.game;
    const num = (v, d) => (v === undefined ? d : Number(v));
    const cmds = {
      help: { desc: 'list commands', fn: () => Object.entries(this.commands).map(([k, v]) => `${k.padEnd(12)} ${v.desc}`).join('\n') },
      clear: { desc: 'clear the console', fn: () => { this.log.replaceChildren(); } },
      seed: { desc: 'show the world seed', fn: () => `seed ${g.world.seed}` },
      where: { desc: 'position, region, biome', fn: () => { const p = g.player(); const r = g.world.regionAtS(g.boat.physics.s); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), s: +g.boat.physics.s.toFixed(1), region: r.name, regionIndex: r.index, biome: g.currentBiome?.name }; } },
      tp: { desc: 'tp <s metres downstream> [lateral] - teleport along the river', fn: (s, t) => this.teleportS(num(s, 0), num(t, 0)) },
      region: { desc: 'region <n> - teleport to the start of region n', fn: (n) => { const r = g.world.seq.get(num(n, 0)); return this.teleportS(r.sStart + 60); } },
      find: { desc: 'find <type|kind> - teleport near the next landmark/settlement of a type', fn: (type) => {
        const s = g.boat.physics.s;
        const it = g.world.findFeature((i) => (i.type === type || i.kind === type || i.storyKey === type) && (i.s ?? 0) > s + 30, 40);
        if (!it) return 'none found in the next 40 regions';
        this.teleportS(Math.max(-500, (it.s ?? s) - 60));
        return `${it.name ?? it.type} (${it.kind}) at s=${(it.s ?? 0).toFixed(0)}`;
      } },
      time: { desc: 'time <hours> - set the clock', fn: (hh) => { g.time.setHours(num(hh, 12)); g.pipeline.updateEnvironment(g.sky.envScene, true); return g.time.clockString(); } },
      timescale: { desc: 'timescale <x> - clock speed multiplier', fn: (x) => { g.time.timeScale = num(x, 1); return `x${g.time.timeScale}`; } },
      weather: { desc: 'weather <clear|cloudy|lightRain|heavyRain|storm|mist|fog|haze|snow|calmNight>', fn: (w) => (g.weatherSystem.set(w, { instant: true, hold: 600 }) ? `weather ${w}` : 'unknown weather') },
      preset: { desc: `preset <${PRESET_ORDER.join('|')}>`, fn: (p) => { if (!PRESET_ORDER.includes(p)) return 'unknown preset'; g.settings.set('graphics.preset', p); g.applyGraphics(); return `preset ${p}`; } },
      laptop: { desc: 'laptop <on|off>', fn: (v) => { g.settings.set('graphics.laptopMode', v !== 'off'); g.applyGraphics(); return `laptop mode ${v !== 'off' ? 'on' : 'off'}`; } },
      dynres: { desc: 'dynres <on|off> [targetFps]', fn: (v, fps) => { g.settings.set('graphics.dynamicRes', v !== 'off'); if (fps) g.settings.set('graphics.targetFps', Number(fps)); g.applyGraphics(); return `dynamic resolution ${v !== 'off' ? 'on' : 'off'}`; } },
      scale: { desc: 'scale <0.3-1.5> - fixed render scale', fn: (v) => { g.pipeline.setScale(num(v, 1)); return `scale ${g.pipeline.scale}`; } },
      perf: { desc: 'toggle the performance overlay (F3)', fn: () => { this.togglePerf(); } },
      stats: { desc: 'dump renderer/streaming stats', fn: () => g.stats() },
      quality: { desc: 'show the effective quality config', fn: () => resolveQuality(g.settings.get('graphics')) },
      rt: { desc: 'ray tracing status', fn: () => 'Hardware ray tracing: not available in WebGL 2. Using planar reflections, sky probes (PMREM), shadow maps and screen-space god rays.' },
      give: { desc: 'give <item|fish id> [n]', fn: (id, n) => { if (!ITEMS[id] && !FISH[id]) return 'unknown id'; const added = g.session.inventory.add(id, num(n, 1), { size: 30 }); return `added ${added} ${id}`; } },
      coins: { desc: 'coins <n>', fn: (n) => { g.session.inventory.addCoins(num(n, 100)); return `${g.session.state.coins} coins`; } },
      upgrade: { desc: 'upgrade <track> <tier>', fn: (t, n) => { g.upgrades.grant(t, num(n, 1)); return `${t} -> ${g.upgrades.tier(t)}`; } },
      event: { desc: `event <id> - start an event (${EVENTS.map((e) => e.id).join(', ')})`, fn: (id) => (g.eventDirector.trigger(id) ? `started ${id}` : 'could not start') },
      story: { desc: 'story <next|status|chapter n>', fn: (a, n) => {
        if (a === 'next') { g.story.completeStep(); return g.story.objectiveText() ?? 'story complete'; }
        if (a === 'chapter') { g.session.state.story.chapter = num(n, 1); g.session.state.story.step = 0; g.story.announceStep(); return g.story.objectiveText(); }
        return { ...g.session.state.story, objective: g.story.objectiveText(), target: g.story.target() };
      } },
      lamp: { desc: 'light the nearest story lamp (ignores daylight)', fn: () => {
        const lamps = g.content.spawnedOf('landmark').filter((s) => s.item.type === 'lampstone' || s.item.type === 'lighthouse');
        if (!lamps.length) return 'no lamp nearby';
        const hours = g.time.hours; g.time.setHours(22); g.story.lightLamp(lamps[0].item); g.time.setHours(hours);
        return `lit ${lamps[0].item.name}`;
      } },
      cruise: { desc: 'toggle the river pilot', fn: () => (g.pilot.toggle() ? 'cruising' : 'cruise off') },
      colliders: { desc: 'toggle collider visualisation', fn: () => { this.vis.colliders = !this.vis.colliders; this.visTimer = 0; if (!this.vis.colliders && !this.vis.flow) this.clearVis(); return `colliders ${this.vis.colliders}`; } },
      flow: { desc: 'toggle river flow vectors', fn: () => { this.vis.flow = !this.vis.flow; this.visTimer = 0; if (!this.vis.colliders && !this.vis.flow) this.clearVis(); return `flow ${this.vis.flow}`; } },
      wire: { desc: 'toggle terrain/water wireframe', fn: () => { this.vis.wire = !this.vis.wire; this.setWireframe(this.vis.wire); return `wireframe ${this.vis.wire}`; } },
      fog: { desc: 'fog <scale> - multiply fog density', fn: (v) => { g.fogScale = num(v, 1); return `fog x${g.fogScale}`; } },
      hud: { desc: 'toggle the HUD', fn: () => { g.ui.setHUDVisible(!g.ui.hudVisible); } },
      photo: { desc: 'enter photo mode', fn: () => { this.toggleConsole(false); g.photo.enter(); } },
      save: { desc: 'save [slot]', fn: (slot) => { g.session.save(slot ?? 'slot3'); return `saving to ${slot ?? 'slot3'}`; } },
      benchmark: { desc: 'benchmark [seconds] - fly down the river and measure', fn: (sec) => { this.toggleConsole(false); this.runBenchmark({ seconds: num(sec, 30) }); return 'benchmark started'; } },
      audio: { desc: 'audio status', fn: () => g.audio?.stats() },
    };
    return cmds;
  }

  clearVis() {
    for (const c of [...this.visGroup.children]) { c.geometry.dispose(); this.visGroup.remove(c); }
  }

  // ------------------------------------------------------------ benchmark
  /**
   * Benchmark: cruise downstream in golden-hour light with the HUD hidden,
   * record real frame times; returns a report (also stored as last benchmark).
   */
  runBenchmark({ seconds = 30, warmup = 3 } = {}) {
    const g = this.game;
    if (this.bench) return this.bench.promise;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    g.ui.closeModal?.(true);
    this.bench = { t: 0, seconds, warmup, frames: [], samples: [], resolve, promise, hud: g.ui.hudVisible, mode: g.cameraRig.mode, timeScale: g.time.timeScale };
    g.ui.setHUDVisible(false);
    g.time.setHours(17.2);
    g.time.timeScale = 20;
    g.cameraRig.setMode('cinematic');
    if (!g.pilot.enabled) g.pilot.toggle();
    g.pilot.hurry = true;
    g.events.emit('toast', { text: `Benchmark: ${seconds} s`, kind: 'camera' });
    return promise;
  }

  benchTick(ft) {
    const b = this.bench;
    const g = this.game;
    b.t += ft / 1000;
    if (b.t < b.warmup) return;
    b.frames.push(ft);
    if (b.frames.length % 30 === 0 || b.t - (b.lastSample ?? 0) > 1) {
      b.lastSample = b.t;
      const s = g.stats();
      b.samples.push({ t: b.t, drawCalls: s.render.drawCalls, triangles: s.render.triangles, scale: s.render.scale, cpu: s.cpuUpdateMs, biome: s.biome });
    }
    if (b.t >= b.warmup + b.seconds) this.finishBench();
  }

  finishBench() {
    const g = this.game;
    const b = this.bench;
    this.bench = null;
    const f = [...b.frames].sort((a, c) => a - c);
    const avg = f.reduce((a, c) => a + c, 0) / Math.max(1, f.length);
    const pct = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0;
    const worst1 = f.slice(Math.floor(f.length * 0.99));
    const low1 = worst1.length ? 1000 / (worst1.reduce((a, c) => a + c, 0) / worst1.length) : 0;
    const mean = (k) => b.samples.reduce((a, s) => a + s[k], 0) / Math.max(1, b.samples.length);
    const report = {
      preset: g.quality.preset, laptopMode: !!g.quality.laptopMode, gpu: g.pipeline.gpuInfo.renderer, seconds: b.seconds, frames: f.length,
      avgFps: 1000 / avg, avgFrameMs: avg, p50Ms: pct(0.5), p95Ms: pct(0.95), p99Ms: pct(0.99), onePercentLowFps: low1, maxMs: f[f.length - 1] ?? 0,
      avgDrawCalls: mean('drawCalls'), avgTriangles: mean('triangles'), avgRenderScale: mean('scale'), avgCpuUpdateMs: mean('cpu'),
      biomes: [...new Set(b.samples.map((s) => s.biome))], date: new Date().toISOString(),
    };
    g.ui.setHUDVisible(b.hud);
    g.time.timeScale = b.timeScale;
    g.cameraRig.setMode(b.mode);
    g.pilot.hurry = false;
    g.storage.writeJSON('benchmark_last', report).catch(() => {});
    window.__RB__.benchmark = report;
    g.events.emit('benchmark:done', report);
    g.ui.showBenchmark?.(report);
    b.resolve(report);
  }
}
