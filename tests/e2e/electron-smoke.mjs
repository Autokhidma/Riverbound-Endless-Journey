// Smoke-tests a packaged Riverbound executable (the real Shipping build):
// launches it with --smoke-test, which boots the game, runs it, saves and
// loads through the native file storage, and writes a JSON result.
// Usage: node tests/e2e/electron-smoke.mjs [path/to/Riverbound(.exe)]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const win = process.platform === 'win32';
const exe = process.argv[2] ?? path.join(ROOT, 'release', `Riverbound-${process.platform}-x64`, win ? 'Riverbound.exe' : 'Riverbound');
if (!fs.existsSync(exe)) { console.error(`executable not found: ${exe}`); process.exit(2); }
const out = path.join(os.tmpdir(), `rb-smoke-${Date.now()}.json`);
const env = { ...process.env, RB_SMOKE_OUT: out, RB_SMOKE_TIMEOUT: process.env.RB_SMOKE_TIMEOUT ?? '300' };
const args = ['--smoke-test'];
let cmd = exe;
if (!win && !process.env.DISPLAY) { args.unshift('-a', exe); cmd = 'xvfb-run'; } // headless Linux
if (!win) args.push('--no-sandbox');
console.log(`> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { env, stdio: 'inherit' });
const killer = setTimeout(() => { console.error('smoke test timed out'); child.kill('SIGKILL'); }, 360000);
child.on('exit', (code) => {
  clearTimeout(killer);
  let result = null;
  try { result = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* no result */ }
  console.log(JSON.stringify({ exitCode: code, result }, null, 1));
  const ok = code === 0 && result?.ok;
  if (process.env.GITHUB_STEP_SUMMARY && result) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Packaged build smoke test\n\n| | |\n|-|-|\n${Object.entries(result).map(([k, v]) => `| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : v} |`).join('\n')}\n`);
  process.exit(ok ? 0 : 1);
});
