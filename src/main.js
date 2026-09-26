// Riverbound entry point: settings, renderer, world, UI, then the main menu.
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './ui/styles.css';
import { Storage } from './save/Storage.js';
import { Settings } from './core/Settings.js';
import { Game } from './Game.js';
import { resolveQuality, suggestPreset } from './render/QualityPresets.js';
import { installSystems } from './systems.js';

const params = new URLSearchParams(location.search);
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const loadingFill = document.getElementById('loading-fill');

function setLoading(text, frac) {
  if (text) loadingText.textContent = text;
  if (frac !== undefined) loadingFill.style.width = `${Math.round(frac * 100)}%`;
}

// Forward uncaught errors to the desktop log file.
window.addEventListener('error', (e) => window.riverboundNative?.log?.('error', e.error?.stack ?? e.message));
window.addEventListener('unhandledrejection', (e) => window.riverboundNative?.log?.('error', String(e.reason?.stack ?? e.reason)));

async function boot() {
  const storage = new Storage();
  const settings = new Settings(storage);
  await settings.load();
  if (params.get('quality')) settings.data.graphics.preset = params.get('quality');
  if (params.get('laptop')) settings.data.graphics.laptopMode = params.get('laptop') === '1';
  const canvas = document.getElementById('game');
  const game = new Game({ canvas, settings, storage, hooks: { useWorkers: params.get('workers') !== '0' } });
  window.__RB__ = { game };
  setLoading('Charting the river…', 0.1);
  const seed = params.get('seed') ?? 'RIVERBOUND';
  // Provisional quality until the GPU is known.
  const provisional = resolveQuality({ ...settings.get('graphics'), preset: settings.get('graphics.preset') ?? 'medium' });
  await game.init({ seed, quality: provisional });
  // First run: pick a preset from the detected GPU (laptops get Laptop Mode).
  if (!settings.get('graphics.preset')) {
    const s = suggestPreset(game.pipeline.gpuInfo);
    settings.data.graphics.preset = s.preset;
    if (settings.data.graphics.laptopMode === null) settings.data.graphics.laptopMode = s.laptopMode;
    await settings.save();
    game.setQuality(resolveQuality(settings.get('graphics')));
  } else if (settings.get('graphics.laptopMode') !== null || params.get('quality')) {
    game.setQuality(resolveQuality(settings.get('graphics')));
  }
  installSystems(game);
  game.pipeline.updateEnvironment(game.sky.envScene, true);
  game.start();
  // Wait for the first terrain/water around the player.
  const t0 = performance.now();
  await new Promise((resolve) => {
    const check = () => {
      const st = game.terrain.stats;
      const frac = Math.min(1, st.visible / Math.max(8, st.desired));
      setLoading('Growing the forests…', 0.2 + frac * 0.75);
      if ((st.visible >= st.desired * 0.9 && game.water.stats.segments > 3) || performance.now() - t0 > 25000) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  setLoading('Ready', 1);
  loadingEl.classList.add('hidden');
  setTimeout(() => loadingEl.remove(), 1400);
  game.events.emit('boot:ready', {});
  if (params.get('autostart') === '1') game.ui?.startJourney?.({ mode: params.get('mode') ?? 'story', skipIntro: true });
  else game.ui?.showMainMenu?.();
  window.__RB__.ready = true;
}

boot().catch((err) => {
  console.error(err);
  setLoading(`Something went wrong: ${err.message}`, 1);
  window.__RB__ = { ...(window.__RB__ || {}), error: String(err && err.stack || err) };
});
