// Packages Riverbound as a desktop application with Electron.
//   node scripts/package.mjs win32   -> release/Riverbound-win32-x64/Riverbound.exe (+ .zip)
//   node scripts/package.mjs linux   -> release/Riverbound-linux-x64/Riverbound (+ .zip/.tar.gz)
// Steps: production ("Shipping") Vite build -> icon -> @electron/packager
// (asar, only dist/ + electron/ + icons) -> archive -> build-info.json.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2] ?? process.platform;
const arch = process.argv[3] ?? 'x64';
const skipBuild = process.argv.includes('--no-build');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

if (!skipBuild) {
  console.log('> vite build (shipping)');
  run('npx', ['vite', 'build', '--mode', 'production']);
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ is missing; run the build first');
if (!fs.existsSync(path.join(ROOT, 'build', 'icon.ico')) || !fs.existsSync(path.join(ROOT, 'build', 'icon.png'))) run(process.execPath, ['scripts/make-icon.mjs']);

const keep = (p) => p === '' || p === '/package.json' || p.startsWith('/dist') || p.startsWith('/electron') || p === '/build' || p.startsWith('/build/icon');
console.log(`> packaging ${platform}-${arch}`);
const [outDir] = await packager({
  dir: ROOT,
  name: 'Riverbound',
  executableName: 'Riverbound',
  platform,
  arch,
  out: path.join(ROOT, 'release'),
  overwrite: true,
  asar: true,
  prune: true,
  icon: path.join(ROOT, 'build', platform === 'win32' ? 'icon.ico' : 'icon.png'),
  appVersion: pkg.version,
  buildVersion: pkg.version,
  appCopyright: 'Riverbound. All game assets are procedurally generated.',
  ignore: (p) => !keep(p),
  win32metadata: { CompanyName: 'Riverbound', FileDescription: 'Riverbound', ProductName: 'Riverbound', InternalName: 'Riverbound', OriginalFilename: 'Riverbound.exe' },
});
console.log(`> packaged to ${outDir}`);

const exe = path.join(outDir, platform === 'win32' ? 'Riverbound.exe' : 'Riverbound');
if (!fs.existsSync(exe)) throw new Error(`executable not found: ${exe}`);
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const info = { name: 'Riverbound', version: pkg.version, platform, arch, electron: pkg.devDependencies.electron.replace(/^\^/, ''), executable: path.relative(ROOT, exe), sizeMB: +(size(outDir) / 1048576).toFixed(1), builtAt: new Date().toISOString(), buildType: 'Shipping (production Vite build, asar, no dev server)' };
fs.writeFileSync(path.join(outDir, 'build-info.json'), JSON.stringify(info, null, 1));

// Archive.
const base = path.basename(outDir);
const zipPath = path.join(ROOT, 'release', `${base}.zip`);
try {
  fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${outDir}" -DestinationPath "${zipPath}" -Force`]);
  else run('zip', ['-qry', zipPath, base], { cwd: path.join(ROOT, 'release') });
  info.archive = path.relative(ROOT, zipPath);
  console.log(`> archive ${info.archive} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB)`);
} catch (e) {
  const tgz = path.join(ROOT, 'release', `${base}.tar.gz`);
  run('tar', ['-czf', tgz, base], { cwd: path.join(ROOT, 'release') });
  info.archive = path.relative(ROOT, tgz);
  console.log(`> zip unavailable, wrote ${info.archive}`);
}
console.log(JSON.stringify(info, null, 1));
