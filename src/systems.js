// Installs gameplay systems and UI on top of the core Game.
export function installSystems(game) {
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
