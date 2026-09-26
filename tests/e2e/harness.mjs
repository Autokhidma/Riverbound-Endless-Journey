// Shared Playwright harness: serves dist/ with a static server and launches
// Chromium with software WebGL (SwiftShader) so the game runs headless in CI.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(ROOT, 'dist');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function serveDist(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(DIST, url === '/' ? 'index.html' : url);
      if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort();
  for (const d of dirs.reverse()) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Viewport override for slow CI machines, e.g. RB_E2E_VIEWPORT=960x540. */
function viewport(width, height) {
  const v = /^(\d+)x(\d+)$/.exec(process.env.RB_E2E_VIEWPORT ?? '');
  return v ? { width: Number(v[1]), height: Number(v[2]) } : { width, height };
}

/** Screenshots of a software-rendered WebGL page can take many seconds on CI. */
export function screenshot(page, file) {
  return page.screenshot({ path: file, timeout: Number(process.env.RB_SHOT_TIMEOUT ?? 180000), animations: 'disabled' });
}

export async function launch({ width = 1280, height = 720, headless = true } = {}) {
  ({ width, height } = viewport(width, height));
  const executablePath = process.env.RB_CHROME || findChromium();
  const browser = await chromium.launch({
    headless,
    executablePath,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', (m) => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e && e.stack || e) }));
  return { browser, page, logs };
}

/** Wait for the game to finish booting. */
export async function waitReady(page, timeout = 180000) {
  await page.waitForFunction(() => window.__RB__ && (window.__RB__.ready || window.__RB__.error), null, { timeout, polling: 500 });
  const err = await page.evaluate(() => window.__RB__.error);
  if (err) throw new Error(`Game failed to boot: ${err}`);
}

export function errorsFrom(logs) {
  return logs.filter((l) => l.type === 'error' || l.type === 'pageerror').map((l) => l.text).filter((t) => !/favicon|GPU stall|WebGL-.*Performance|GL Driver Message/.test(t));
}
