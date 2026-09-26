// River map: a hand-drawn style chart of the explored river (fog of war beyond),
// discovered places, objectives and the Wren. Drag to pan, wheel to zoom.
// Fast travel to any discovered village dock (time passes on the way).
import { Panel, h } from './shell.js';
import { S_MIN } from '../../world/River.js';
import { formatDistance } from '../../core/math.js';

const W = 960, H = 620;
const toHex = (lin) => `rgb(${lin.map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255)).join(',')})`;

export class MapPanel extends Panel {
  constructor(game, ui) {
    super(game, ui);
    const p = game.player();
    this.view = { x: p.x, z: p.z, scale: 5 }; // metres per pixel
    this.width = 'min(1020px, 96vw)';
    this.selected = null;
  }
  title() { return 'River Chart'; }
  subtitle() {
    const w = this.game.world;
    const r = w.regionAtS(this.game.boat.physics.s);
    return `${r.name} · ${this.game.currentBiome?.name ?? ''} · ${formatDistance(Math.max(0, this.game.boat.physics.s))} downstream from Willowmere`;
  }
  body() {
    this.canvas = h('canvas.map-canvas', { width: W, height: H, style: { width: '100%', aspectRatio: `${W}/${H}`, cursor: 'grab' } });
    this.info = h('div.row', { style: { minHeight: '40px', marginTop: '8px' } });
    this.bindEvents();
    this.terrain = null;
    requestAnimationFrame(() => this.draw(true));
    return [this.canvas, this.info, h('div.muted', { style: { fontSize: '13px' } }, 'Drag to pan · scroll to zoom · click a village you have visited to travel there')];
  }
  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false }; c.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', this.onUp = (e) => {
      if (!drag) return;
      c.style.cursor = 'grab';
      if (!drag.moved) this.click(e);
      drag = null;
      this.draw(true);
    });
    window.addEventListener('mousemove', this.onMove = (e) => {
      if (!drag) return;
      const k = this.view.scale * (W / c.clientWidth);
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.view.x = drag.vx - dx * k;
      this.view.z = drag.vz - dy * k;
      this.draw(false);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.scale = Math.max(0.8, Math.min(40, this.view.scale * (e.deltaY > 0 ? 1.2 : 1 / 1.2)));
      this.draw(false);
      clearTimeout(this.wheelT);
      this.wheelT = setTimeout(() => this.draw(true), 180);
    }, { passive: false });
  }
  dispose() {
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('mousemove', this.onMove);
  }
  toPx(x, z) { return [(x - this.view.x) / this.view.scale + W / 2, (z - this.view.z) / this.view.scale + H / 2]; }
  toWorld(px, py) { return [(px - W / 2) * this.view.scale + this.view.x, (py - H / 2) * this.view.scale + this.view.z]; }

  explored() {
    const st = this.game.session.state.stats;
    return Math.max(st.furthestS, this.game.boat.physics.s) + 450;
  }

  /** Coarse land colour layer (recomputed when the view settles). */
  buildTerrain() {
    const world = this.game.world;
    const cell = 10;
    const cw = Math.ceil(W / cell), ch = Math.ceil(H / cell);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const maxS = this.explored();
    const near = {}, near2 = {};
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const [x, z] = this.toWorld((i + 0.5) * cell, (j + 0.5) * cell);
        const r = world.main.nearest(x, z, near);
        if (r.s > maxS || r.dist > 1400) continue;
        const b = world.biomeAt(x, z).dominant;
        const hgt = world.heightAt(x, z);
        const wl = world.main.sample(Math.max(S_MIN, r.s), near2).wl;
        const rel = Math.max(-5, Math.min(260, hgt - wl));
        const col = rel > b.terrain.snowLine * 0.9 && b.terrain.snowLine > 0 ? b.colors.snow : rel > 60 ? b.colors.rock : b.colors.grass;
        const shade = 0.75 + Math.min(1, rel / 160) * 0.5;
        const fade = 1 - Math.max(0, (r.dist - 1000) / 400);
        g.globalAlpha = 0.9 * fade;
        g.fillStyle = toHex(col.map((v) => v * shade));
        g.fillRect(i * cell, j * cell, cell + 1, cell + 1);
      }
    }
    g.globalAlpha = 1;
    return { canvas: cv, view: { ...this.view } };
  }

  draw(full) {
    const c = this.canvas;
    if (!c || !c.isConnected) return;
    const g = c.getContext('2d');
    const game = this.game;
    const world = game.world;
    if (full) this.terrain = this.buildTerrain();
    g.fillStyle = '#e9dfc6';
    g.fillRect(0, 0, W, H);
    // Paper texture lines.
    g.strokeStyle = 'rgba(120,100,70,0.08)';
    for (let y = 0; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    if (this.terrain) {
      const t = this.terrain;
      const k = t.view.scale / this.view.scale;
      const [ox, oy] = this.toPx(t.view.x - (W / 2) * t.view.scale, t.view.z - (H / 2) * t.view.scale);
      g.drawImage(t.canvas, ox, oy, W * k, H * k);
    }
    // Rivers.
    const maxS = this.explored();
    const s0 = Math.max(S_MIN, 0 - 700);
    const step = Math.max(8, this.view.scale * 4);
    const sample = {};
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const drawPath = (fn, from, to, colour, widthMul) => {
      let prev = null;
      for (let s = from; s <= to; s += step) {
        const r = fn(s, sample);
        const [px, py] = this.toPx(r.x, r.z);
        if (prev) {
          g.strokeStyle = colour;
          g.lineWidth = Math.max(1.5, (r.w * widthMul) / this.view.scale);
          g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(px, py); g.stroke();
        }
        prev = [px, py];
      }
    };
    drawPath((s, o) => world.main.sample(s, o), s0, maxS, '#4f86a0', 1);
    const regionsSeen = Object.keys(game.session.state.discoveries.regions).map(Number);
    for (const i of regionsSeen) {
      const trib = world.regionHydro(i)?.tributary;
      if (!trib || (trib.hidden && !game.session.state.story.flags.includes('veilOpen'))) continue;
      drawPath((s, o) => trib.sample(s, o), 0, trib.length, '#5b90a8', 1);
    }
    // Region names.
    g.font = 'italic 15px "Cormorant Garamond", serif';
    g.fillStyle = 'rgba(70,55,35,0.8)';
    g.textAlign = 'center';
    for (const i of regionsSeen) {
      const reg = world.seq.regions[i];
      if (!reg) continue;
      const mid = world.main.sample(Math.max(S_MIN, (reg.sStart + reg.sEnd) / 2), {});
      const [px, py] = this.toPx(mid.x, mid.z);
      if (px > -100 && px < W + 100 && py > -20 && py < H + 20) g.fillText(reg.name, px, py - 30);
    }
    // Places.
    this.hits = [];
    g.font = '600 12px Nunito, sans-serif';
    for (const f of Object.values(game.session.state.discoveries.features)) {
      const [px, py] = this.toPx(f.x, f.z);
      if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      const isTown = f.kind === 'settlement';
      g.fillStyle = isTown ? '#8a4a2a' : f.rarity === 'unique' || f.rarity === 'rare' || f.rarity === 'story' ? '#8a6a1a' : '#4a5a3a';
      g.beginPath();
      if (isTown) { g.rect(px - 5, py - 5, 10, 10); } else { g.arc(px, py, 4, 0, Math.PI * 2); }
      g.fill();
      if (this.view.scale < 9 || isTown) { g.fillStyle = 'rgba(40,30,20,0.9)'; g.fillText(f.name, px, py - 9); }
      this.hits.push({ f, px, py });
    }
    // Objectives.
    const marks = [];
    const st = game.story?.target();
    if (st) marks.push({ ...st, colour: '#c0392b', icon: '✦' });
    for (const m of game.quests?.markers() ?? []) marks.push({ ...m, colour: '#2a6a9a', icon: '◆' });
    g.font = '18px sans-serif';
    for (const m of marks) {
      let [px, py] = this.toPx(m.x, m.z);
      const off = px < 10 || px > W - 10 || py < 10 || py > H - 10;
      px = Math.max(12, Math.min(W - 12, px)); py = Math.max(14, Math.min(H - 8, py));
      g.fillStyle = m.colour;
      g.globalAlpha = off ? 0.6 : 1;
      g.fillText(m.icon, px, py + 6);
      g.globalAlpha = 1;
    }
    // Player.
    const p = game.player();
    const [bx, by] = this.toPx(p.x, p.z);
    const hd = game.onFoot && game.walker ? game.walker.heading : game.boat.physics.heading;
    g.save();
    g.translate(bx, by);
    g.rotate(hd);
    g.fillStyle = '#1c1c1c';
    g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, 6); g.lineTo(-3, 0); g.lineTo(-6, -6); g.closePath(); g.fill();
    g.restore();
    // Scale bar & north.
    const barM = [50, 100, 250, 500, 1000, 2000, 5000].find((m) => m / this.view.scale > 70) ?? 5000;
    g.fillStyle = '#3a2e20'; g.fillRect(20, H - 24, barM / this.view.scale, 3);
    g.font = '12px Nunito, sans-serif'; g.textAlign = 'left'; g.fillText(formatDistance(barM), 20, H - 30);
    g.textAlign = 'center'; g.font = 'bold 16px "Cormorant Garamond", serif'; g.fillText('N', W - 26, 28);
    g.beginPath(); g.moveTo(W - 26, 34); g.lineTo(W - 31, 48); g.lineTo(W - 21, 48); g.fill();
  }

  click(e) {
    const r = this.canvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    let best = null, bd = 14;
    for (const hit of this.hits ?? []) {
      const d = Math.hypot(hit.px - px, hit.py - py);
      if (d < bd) { bd = d; best = hit.f; }
    }
    const info = this.info;
    info.replaceChildren();
    if (!best) return;
    const p = this.game.player();
    const dist = Math.hypot(best.x - p.x, best.z - p.z);
    info.append(h('div', { style: { flex: 1 } }, h('b', {}, best.name), h('span.muted', {}, ` · ${best.label} · ${formatDistance(dist)} away`), best.desc ? h('div.muted', {}, best.desc) : null));
    if (best.kind === 'settlement') {
      const can = !this.game.onFoot && !this.game.fishing?.active && dist > 150;
      info.append(h('button.btn.primary', { disabled: !can, title: can ? '' : 'Board the Wren and be away from the village first', onclick: () => this.travel(best, dist) }, 'Travel there'));
    }
  }

  travel(f, dist) {
    const game = this.game;
    const it = game.world.findFeature((i) => i.id === f.id, 40);
    if (!it?.moor) return;
    const hours = Math.min(10, dist / 2.2 / 3600 * 1.0 + 0.5);
    this.ui.closeModal();
    game.ui.fadeThrough(() => {
      const r = game.world.main.nearest(it.moor.x, it.moor.z, {});
      const heading = game.world.main.sample(r.s, {}).h;
      game.setOrigin(it.moor.x, it.moor.z);
      game.boat.placeAt(it.moor.x, it.moor.z, heading);
      game.pilot.enabled = false;
      const newH = game.time.hours + hours;
      if (newH >= 24) game.time.day += Math.floor(newH / 24);
      game.time.setHours(newH % 24);
      game.pipeline.updateEnvironment(game.sky.envScene, true);
      game.events.emit('fasttravel', { to: it.id });
      game.events.emit('toast', { title: 'You travel along the river', text: `${Math.round(hours * 10) / 10} hours later you tie up at ${it.name}.`, kind: 'story' });
    }, 1100);
  }
}
