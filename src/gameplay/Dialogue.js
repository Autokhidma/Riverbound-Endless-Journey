// Conversations with residents. Builds a small tree of lines and choices:
// story lines for story characters, idle chatter, trading, the shipwright,
// request offers and turn-ins, and gifts.
import { NPCSystem, npcData } from './NPCs.js';
import { STORY_NPCS, CHAPTERS } from './Story.js';

export class Dialogue {
  constructor(game) {
    this.game = game;
    this.npc = null;
    this.node = null;
  }

  settlementOf(npc) {
    const s = this.game.content.get(npc.settlementId);
    return s?.item ?? this.game.world.findFeature((i) => i.id === npc.settlementId, 30);
  }

  open(npc) {
    const game = this.game;
    this.npc = npc;
    this.settlement = this.settlementOf(npc);
    const st = game.session.state;
    const rec = (st.npcs[npc.id] ??= { met: false, talks: 0, friendship: 0 });
    const first = !rec.met;
    rec.met = true;
    rec.talks++;
    game.events.emit('dialogue:open', { npc });
    const story = this.storyLines(npc);
    if (story) this.showSequence(story, () => this.menu(first));
    else this.menu(first);
  }

  /** Story lines if this NPC's story step is current. */
  storyLines(npc) {
    if (!npc.storyKey || !this.game.session.storyEnabled) return null;
    const story = this.game.story;
    const step = story.step;
    if (step?.type === 'talk' && `${step.settlement}.${step.role}` === npc.storyKey) return STORY_NPCS[npc.storyKey]?.lines ?? null;
    return null;
  }

  showSequence(lines, then) {
    let i = 0;
    const next = () => {
      if (i >= lines.length) { then(); return; }
      const line = lines[i++];
      this.show({ speaker: this.npc.name, text: line, choices: [{ label: i < lines.length ? 'Continue' : 'Thank you', action: next }] });
    };
    next();
  }

  menu(first) {
    const game = this.game;
    const npc = this.npc;
    const settlement = this.settlement;
    const choices = [];
    const quests = game.quests;
    // Turn-ins first.
    for (const q of quests.turnInsFor(npc, settlement ?? {})) {
      choices.push({ label: `Hand over: ${q.title}`, highlight: true, action: () => {
        if (quests.complete(q)) this.say(npc.name, npcData.thanks[Math.floor(Math.random() * npcData.thanks.length)], () => this.menu(false));
      } });
    }
    if (npc.role === 'trader') choices.push({ label: 'Let me see your wares', action: () => { this.close(); game.ui.openTrade(npc, settlement); } });
    if (npc.role === 'shipwright') choices.push({ label: 'Could you work on my boat?', action: () => { this.close(); game.ui.openUpgrades(npc, settlement); } });
    const offer = settlement ? quests.offerFor(npc, settlement) : null;
    if (offer) choices.push({ label: 'Is there anything I can help with?', action: () => this.offerQuest(offer) });
    choices.push({ label: 'Tell me about this place', action: () => this.say(npc.name, NPCSystem.idleLine(npc), () => this.menu(false)) });
    if (game.session.inventory.has('honey_cake')) choices.push({ label: 'Offer a honey cake', action: () => this.gift() });
    choices.push({ label: 'Goodbye', action: () => this.close() });
    const greet = first && npc.storyKey && STORY_NPCS[npc.storyKey] ? `I'm ${npc.name}. ${NPCSystem.greeting(npc, { settlementName: settlement?.name })}` : NPCSystem.greeting(npc, { settlementName: settlement?.name });
    this.show({ speaker: npc.name, subtitle: npcData.roles[npc.role]?.title, text: greet, choices });
  }

  offerQuest(q) {
    this.show({
      speaker: this.npc.name,
      text: q.text,
      note: `Reward: ${q.reward.coins} coins${q.reward.items ? ' and a gift' : ''}`,
      choices: [
        { label: 'Of course.', highlight: true, action: () => { this.game.quests.accept(q); this.say(this.npc.name, 'Thank you! Safe travels.', () => this.close()); } },
        { label: 'Not right now.', action: () => { this.game.quests.decline(q); this.menu(false); } },
      ],
    });
  }

  gift() {
    const g = this.game;
    g.session.inventory.remove('honey_cake', 1);
    const rec = g.session.state.npcs[this.npc.id];
    rec.friendship = (rec.friendship ?? 0) + 2;
    const set = g.session.state.settlements[this.npc.settlementId] ??= { supply: {}, friendship: 0 };
    set.friendship = Math.min(10, (set.friendship ?? 0) + 1);
    const reward = 10 + Math.floor(Math.random() * 20);
    g.session.inventory.addCoins(reward);
    this.say(this.npc.name, `For me? Oh, that's lovely. Here, take this for your travels. (+${reward} coins)`, () => this.menu(false));
  }

  say(speaker, text, then) {
    this.show({ speaker, text, choices: [{ label: 'Continue', action: then }] });
  }

  show(node) {
    this.node = node;
    this.game.events.emit('dialogue:show', node);
  }

  close() {
    const npc = this.npc;
    this.node = null;
    this.npc = null;
    this.game.events.emit('dialogue:show', null);
    if (npc) this.game.events.emit('dialogue:closed', { npc });
  }
}

export { CHAPTERS };
