// Riverbound desktop shell (Electron). Serves the built game from dist/ over a
// privileged app:// protocol (so ES module workers work), prefers the
// discrete GPU, stores saves/settings as JSON in the user-data folder, saves
// photos to Pictures/Riverbound, logs to user-data/logs, and supports a
// --smoke-test mode used by CI to verify the packaged executable.
const { app, BrowserWindow, protocol, ipcMain, net, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const SMOKE = process.argv.includes('--smoke-test');
const BENCH = process.argv.includes('--benchmark');
const DIST = path.join(__dirname, '..', 'dist');

// GPU preferences: discrete GPU on dual-GPU laptops, allow WebGL on older
// blocklisted drivers, no background throttling (the game manages its own).
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (SMOKE && process.env.RB_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------------------------------------------------------------- logging
let logFile = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    if (!logFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'riverbound.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.old`);
    }
    fs.appendFileSync(logFile, line);
  } catch { /* logging must never crash the game */ }
  if (SMOKE || !app.isPackaged) process.stdout.write(line);
}

// ---------------------------------------------------------------- storage
const safeKey = (key) => String(key).replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 120);
const dataDir = () => {
  const d = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

ipcMain.handle('storage:read', (_e, key) => {
  const f = path.join(dataDir(), `${safeKey(key)}.json`);
  try { return fs.readFileSync(f, 'utf8'); } catch {
    try { return fs.readFileSync(`${f}.bak`, 'utf8'); } catch { return null; }
  }
});
ipcMain.handle('storage:write', (_e, key, text) => {
  const f = path.join(dataDir(), `${safeKey(key)}.json`);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak`);
  fs.renameSync(tmp, f); // atomic replace: a crash never leaves a half-written save
  return true;
});
ipcMain.handle('storage:remove', (_e, key) => {
  const f = path.join(dataDir(), `${safeKey(key)}.json`);
  for (const p of [f, `${f}.bak`]) { try { fs.unlinkSync(p); } catch { /* missing */ } }
  return true;
});
ipcMain.handle('storage:list', (_e, prefix = '') => fs.readdirSync(dataDir()).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((k) => k.startsWith(safeKey(prefix))));

ipcMain.handle('photo:save', (_e, name, dataUrl) => {
  const dir = path.join(app.getPath('pictures'), 'Riverbound');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(safeKey(name)));
  const b64 = String(dataUrl).split(',')[1] ?? '';
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  log('photo saved', file);
  return file;
});
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', (e, on) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setFullScreen(!!on);
  return w?.isFullScreen() ?? false;
});
ipcMain.handle('app:openPhotos', () => shell.openPath(path.join(app.getPath('pictures'), 'Riverbound')));
ipcMain.on('log', (_e, level, msg) => log(`[renderer:${level}]`, msg));

// ---------------------------------------------------------------- window
function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    title: 'Riverbound', backgroundColor: '#0b0f16', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  const query = SMOKE ? '?autostart=1&mode=free&quality=veryLow&laptop=1' : BENCH ? '?autostart=1&mode=free' : '';
  win.loadURL(`app://game/index.html${query}`);
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.key === 'Enter' && input.alt) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Never navigate away or open windows from game content.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (event) => {
    const { level, message } = event;
    if (level === 'error' || level === 'warning' || level === 3 || level === 2) log(`[console:${level}]`, message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('renderer gone', details);
    if (SMOKE) { app.exit(3); return; }
    if (details.reason !== 'clean-exit') win.reload();
  });
  win.on('unresponsive', () => log('window unresponsive'));
  if (SMOKE) runSmokeTest(win);
  return win;
}

/** CI check of the packaged build: boots the game, runs a few seconds, reports. */
async function runSmokeTest(win) {
  const started = Date.now();
  const timeout = Number(process.env.RB_SMOKE_TIMEOUT ?? 240) * 1000;
  const out = process.env.RB_SMOKE_OUT ?? path.join(app.getPath('userData'), 'smoke-result.json');
  const finish = (result) => {
    result.seconds = (Date.now() - started) / 1000;
    try { fs.writeFileSync(out, JSON.stringify(result, null, 1)); } catch (e) { log('smoke write failed', String(e)); }
    log('SMOKE RESULT', result);
    app.exit(result.ok ? 0 : 1);
  };
  const poll = async () => {
    if (Date.now() - started > timeout) return finish({ ok: false, error: 'timeout waiting for the game to boot' });
    let st = null;
    try {
      st = await win.webContents.executeJavaScript('(() => { const r = window.__RB__; if (!r) return null; if (r.error) return { error: r.error }; if (!r.ready) return null; const g = r.game; return { ready: true, state: g.state, gpu: g.pipeline.gpuInfo, preset: g.quality.preset, seed: g.world.seed }; })()');
    } catch (e) { log('smoke poll error', String(e)); }
    if (st?.error) return finish({ ok: false, error: st.error });
    if (!st?.ready) { setTimeout(poll, 1000); return; }
    // Let it run, then gather stats and exercise save/load.
    await new Promise((r) => setTimeout(r, 8000));
    const report = await win.webContents.executeJavaScript(`(async () => {
      const g = window.__RB__.game;
      const s = g.stats();
      const meta = await g.session.save('slot3');
      const loaded = await g.session.saves.load('slot3');
      return { state: g.state, fps: s.fps, frameMs: s.frameMs, drawCalls: s.render.drawCalls, triangles: s.render.triangles, terrain: s.terrain.visible, water: s.water.segments, biome: s.biome, region: s.region, saved: !!meta, loaded: !!loaded, native: !!window.riverboundNative };
    })()`).catch((e) => ({ error: String(e) }));
    const ok = !report.error && report.state === 'playing' && report.terrain > 0 && report.water > 0 && report.saved && report.loaded && report.native;
    finish({ ok, ...st, ...report, electron: process.versions.electron, platform: process.platform, arch: process.arch });
  };
  win.webContents.once('did-finish-load', () => setTimeout(poll, 1500));
  win.webContents.on('did-fail-load', (_e, code, desc) => finish({ ok: false, error: `load failed ${code} ${desc}` }));
}

// ---------------------------------------------------------------- app
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    log(`Riverbound ${app.getVersion()} starting (electron ${process.versions.electron}, ${process.platform}-${process.arch})${SMOKE ? ' [smoke test]' : ''}`);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  process.on('uncaughtException', (e) => log('uncaught', String(e?.stack ?? e)));
}
