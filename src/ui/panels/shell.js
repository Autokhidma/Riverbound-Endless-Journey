// Shared panel chrome: title bar, optional tabs, close button.
import { h, clear } from '../dom.js';

export class Panel {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.tab = null;
  }

  /** Build the frame; subclasses implement title(), tabs() and body(tab). */
  render() {
    this.el = h('div.panel', { style: { width: this.width ?? 'min(980px, 94vw)' } });
    this.refresh();
    return this.el;
  }

  refresh() {
    if (!this.el) return;
    const scroll = this.bodyEl?.scrollTop ?? 0;
    clear(this.el);
    const tabs = this.tabs?.() ?? null;
    if (tabs && !this.tab) this.tab = tabs[0].id;
    const header = h('div.panel-header', {}, h('div', {}, h('div.panel-title', {}, this.title()), this.subtitle ? h('div.panel-sub', {}, this.subtitle()) : null), h('div.spacer'), this.headerExtra?.() ?? null, h('button.close-x', { onclick: () => this.ui.closeModal(), title: 'Close (Esc)' }, '×'));
    this.el.append(header);
    if (tabs) {
      this.el.append(h('div.tabs', {}, ...tabs.map((t) => h('button.tab' + (t.id === this.tab ? '.active' : ''), { onclick: () => { this.tab = t.id; this.refresh(); } }, t.label))));
    }
    this.bodyEl = h('div.panel-body');
    const content = this.body(this.tab);
    if (Array.isArray(content)) this.bodyEl.append(...content.filter(Boolean));
    else if (content) this.bodyEl.append(content);
    this.el.append(this.bodyEl);
    this.bodyEl.scrollTop = scroll;
  }
}

export { h, clear };
