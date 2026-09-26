// Installs gameplay systems and UI on top of the core Game.
import { ContentStreamer } from './world/ContentStreamer.js';

export function installSystems(game) {
  game.content = game.addSystem(new ContentStreamer(game));
  game.state = game.state === 'boot' ? 'boot' : game.state;
  game.ui = {
    showMainMenu() {
      game.state = 'menu';
      game.cameraRig.setMode('cinematic');
    },
    startJourney() {
      game.state = 'playing';
      game.cameraRig.setMode('third');
    },
  };
}
