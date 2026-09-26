// Requests (side quests) and story progress.
import { Panel, h } from './shell.js';
import { CHAPTERS, LETTERS } from '../../gameplay/Story.js';
import { formatDistance } from '../../core/math.js';

export class QuestPanel extends Panel {
  title() { return 'Requests & Story'; }
  tabs() {
    const t = [{ id: 'requests', label: 'Requests' }];
    if (this.game.session.storyEnabled || this.game.session.state.story.started) t.unshift({ id: 'story', label: 'Story' });
    t.push({ id: 'done', label: 'Completed' });
    return t;
  }
  body(tab) {
    const game = this.game;
    const st = game.session.state;
    if (tab === 'story') {
      const story = st.story;
      const out = [];
      CHAPTERS.forEach((ch, i) => {
        const cur = i === story.chapter && !story.completed;
        const done = i < story.chapter || story.completed;
        if (!done && !cur) { out.push(h('div.list-item', { style: { opacity: 0.45 } }, h('div', {}, h('b', {}, `${ch.number}`), ' · ???'))); return; }
        const steps = cur ? ch.steps.map((s, j) => h('div', { style: { opacity: j < story.step ? 0.55 : 1, marginLeft: '12px' } }, `${j < story.step ? '✓' : j === story.step ? '➤' : '·'} ${j <= story.step ? s.objective : '…'}`)) : [];
        out.push(h('div.list-item', {}, h('div', {}, h('b', {}, `${ch.number}: ${ch.title}`), done ? h('span.pill', { style: { marginLeft: '8px' } }, 'complete') : null), cur && ch.intro ? h('div.muted', {}, ch.intro) : null, ...steps));
      });
      if (story.letters.length) {
        out.push(h('div.section-title', {}, 'Letters from Oona'));
        for (const id of story.letters) {
          const L = LETTERS[id];
          if (L) out.push(h('button.btn.ghost', { style: { margin: '4px' }, onclick: () => this.ui.showLetter({ title: L.title, text: L.text }) }, L.title));
        }
      }
      return h('div.list', {}, ...out);
    }
    if (tab === 'requests') {
      const q = game.quests.active();
      if (!q.length) return h('div.muted', {}, 'No open requests. Villagers along the river sometimes need a hand; talk to them.');
      const p = game.player();
      return h('div.list', {}, ...q.map((x) => h('div.list-item', {},
        h('div.row', {}, h('b', {}, x.title), h('div.spacer'), x.ready ? h('span.pill', {}, 'ready to hand over') : null),
        h('div', {}, x.objective.label),
        h('div.muted', {}, `From ${x.giverName} of ${x.settlementName} · reward ${x.reward.coins} coins${x.objective.x !== undefined ? ` · ${formatDistance(Math.hypot(x.objective.x - p.x, x.objective.z - p.z))} away` : ''}`),
        h('div.row', { style: { marginTop: '6px' } }, h('button.btn.ghost', { onclick: () => { game.quests.abandon(x); this.refresh(); } }, 'Let it go')))));
    }
    const c = st.quests.completed;
    if (!c.length) return h('div.muted', {}, 'Nothing completed yet.');
    return h('div.list', {}, ...[...c].reverse().map((x) => h('div.list-item', {}, h('b', {}, x.title), h('div.muted', {}, `${x.giverName ?? ''} · ${x.settlementName ?? ''} · day ${x.day + 1}`))));
  }
}
