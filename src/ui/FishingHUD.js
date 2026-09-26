// Fishing overlay: cast power, bite cue, relaxed reel bar and catch card.
import { h, clear } from './dom.js';

const HINTS = {
  ready: 'Aim with the camera · hold click / Space to charge a cast · F or right-click to put the rod away',
  charging: 'Release to cast',
  casting: '',
  waiting: 'Waiting for a bite…',
  bite: 'A bite! Click / Space / E now!',
  reeling: 'Hold to lift the green band · keep the fish inside it',
};

export class FishingHUD {
  constructor(game, root) {
    this.game = game;
    this.label = h('div.fishing-label');
    this.zone = h('div.zone');
    this.fish = h('div.fish', {}, '🐟');
    this.progress = h('div.progress');
    this.bar = h('div.fishing', { style: { display: 'none' } }, h('div.track', {}, this.zone, this.fish), this.progress);
    this.power = h('div', { style: { position: 'fixed', left: '50%', top: '66%', width: '220px', height: '10px', transform: 'translateX(-50%)', borderRadius: '5px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.4)', display: 'none', zIndex: 15 } });
    this.powerFill = h('div', { style: { height: '100%', width: '0%', borderRadius: '5px', background: 'linear-gradient(90deg,#9fe0c0,#ffd48a,#ff9a6a)' } });
    this.power.append(this.powerFill);
    this.card = h('div.panel', { style: { position: 'fixed', left: '50%', bottom: '14vh', transform: 'translateX(-50%)', width: 'min(420px,90vw)', display: 'none', zIndex: 16, pointerEvents: 'none' } });
    root.append(this.label, this.bar, this.power, this.card);
    this.lastState = null;
  }

  update() {
    const f = this.game.fishing;
    if (!f) return;
    const ui = f.uiState();
    const st = this.game.state === 'playing' ? ui.state : 'idle';
    const hidden = st === 'idle' || this.game.cameraRig.mode === 'photo';
    this.label.textContent = hidden ? '' : HINTS[st] ?? '';
    this.label.style.display = hidden || !this.label.textContent ? 'none' : '';
    this.label.style.color = st === 'bite' ? '#ffd48a' : '#fff';
    this.label.style.fontSize = st === 'bite' ? '26px' : '16px';
    this.bar.style.display = st === 'reeling' && ui.reel ? '' : 'none';
    if (st === 'reeling' && ui.reel) {
      const r = ui.reel;
      this.zone.style.bottom = `${r.zone * 100}%`;
      this.zone.style.height = `${r.zoneSize * 100}%`;
      this.fish.style.bottom = `${r.fish * 100}%`;
      this.progress.style.height = `${Math.max(0, Math.min(1, r.progress)) * 100}%`;
      this.zone.style.background = r.inZone ? 'rgba(120,220,180,0.55)' : 'rgba(220,160,120,0.35)';
    }
    this.power.style.display = st === 'charging' ? '' : 'none';
    this.powerFill.style.width = `${ui.power * 100}%`;
    if (st === 'result' && ui.catchInfo) {
      if (this.lastState !== 'result') this.showCard(ui.catchInfo);
    } else this.card.style.display = 'none';
    this.lastState = st;
  }

  showCard(c) {
    clear(this.card);
    this.card.style.display = '';
    if (c.junk) {
      this.card.append(h('div.panel-body', {}, h('div.panel-title', { style: { fontSize: '24px' } }, c.name), h('div.muted', {}, c.kept ? 'Well, it\'s something.' : 'No room for it, so back it goes.')));
      return;
    }
    this.card.append(h('div.panel-body', {},
      h('div.row', {}, h('div.panel-title', { style: { fontSize: '26px' } }, c.name), h('div.spacer'), h(`span.pill.rarity-${c.rarity}`, {}, c.rarity)),
      h('div', { style: { margin: '6px 0' } }, `${c.size} cm · worth about ${c.value} coins`),
      h('div.muted', {}, c.desc ?? ''),
      c.kept ? null : h('div.muted', {}, 'Released: your storage is full.')));
  }
}
