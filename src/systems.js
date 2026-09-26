// Installs gameplay systems and UI on top of the core Game. Order matters:
// the session owns the save state that every other system reads.
import { ContentStreamer } from './world/ContentStreamer.js';
import { WeatherSystem } from './weather/WeatherSystem.js';
import { Wildlife } from './wildlife/Wildlife.js';
import { Session } from './gameplay/Session.js';
import { Interaction } from './gameplay/Interaction.js';
import { NPCSystem } from './gameplay/NPCs.js';
import { Fishing } from './gameplay/Fishing.js';
import { Journal } from './gameplay/Journal.js';
import { QuestSystem } from './gameplay/Quests.js';
import { StorySystem } from './gameplay/Story.js';
import { UpgradeSystem } from './gameplay/Upgrades.js';
import { Dialogue } from './gameplay/Dialogue.js';
import { EventDirector } from './gameplay/EventDirector.js';
import { OnFoot } from './gameplay/OnFoot.js';
import { UI } from './ui/UI.js';
import { PhotoMode } from './ui/PhotoMode.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { DebugTools } from './debug/DebugTools.js';

export function installSystems(game) {
  game.weatherSystem = game.addSystem(new WeatherSystem(game));
  game.weatherSystem.setQuality(game.quality);
  game.session = new Session(game);
  game.addSystem(game.session);
  game.content = game.addSystem(new ContentStreamer(game));
  game.wildlife = game.addSystem(new Wildlife(game));
  game.wildlife.setQuality(game.quality);
  game.upgrades = new UpgradeSystem(game);
  game.journal = game.addSystem(new Journal(game));
  game.quests = new QuestSystem(game);
  game.story = game.addSystem(new StorySystem(game));
  game.dialogue = new Dialogue(game);
  game.npcs = game.addSystem(new NPCSystem(game));
  game.eventDirector = game.addSystem(new EventDirector(game));
  game.onFootSystem = game.addSystem(new OnFoot(game));
  game.fishing = game.addSystem(new Fishing(game));
  game.interaction = game.addSystem(new Interaction(game));
  const ix = game.interaction;
  ix.addProvider((g, p) => g.npcs.interactables(g, p));
  ix.addProvider((g) => g.session.interactables(g));
  ix.addProvider((g) => g.story.interactables(g));
  ix.addProvider((g) => g.quests.interactables(g));
  ix.addProvider(() => game.eventDirector.interactables());
  ix.addProvider((g) => g.onFootSystem.interactables(g));
  // The closed veil blocks the hidden river until it is opened.
  game.addSystem({ colliders: (x, z, r) => game.story.colliders(x, z, r) });

  game.ui = new UI(game);
  game.addSystem({ lateUpdate: (dt, g) => g.ui.update(dt, g) });
  game.photo = game.addSystem(new PhotoMode(game));
  game.audio = game.addSystem(new AudioSystem(game));
  game.debug = game.addSystem(new DebugTools(game));
  game.console = game.debug;

  // Compass hint for the navigation upgrade: nearest undiscovered wonder ahead.
  game.findNearestUndiscovered = () => {
    const p = game.player();
    const s = game.boat.physics.s;
    const list = game.world.featuresNear(p.x, p.z, 1800, ['landmark', 'settlement']);
    let best = null, bd = Infinity;
    for (const it of list) {
      if (game.session.state.discoveries.features[it.id] || it.s < s - 50) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  };

  // Live settings.
  game.settings.on('change', ({ path, value }) => {
    if (path === 'gameplay.dayLengthMinutes') game.time.dayLengthMinutes = value;
    if (path === 'graphics.fullscreen') game.setFullscreen(value);
  });
  game.events.on('session:new', () => { game.onFoot && game.onFootSystem.board(); });
  game.events.on('session:loaded', () => { game.onFoot && game.onFootSystem.board(); });
}
