// Runs the browser end-to-end suites against dist/ (build first).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const suites = [
  ['gameplay.mjs'],
  ['features.mjs'],
  ['drive.mjs', process.env.RB_DRIVE_SECONDS ?? '120', 'low'],
];
let failed = 0;
for (const [file, ...args] of suites) {
  console.log(`\n=== ${file} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/e2e', file), ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) { failed++; console.log(`=== ${file} FAILED (${r.status})`); }
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall e2e suites passed');
process.exit(failed ? 1 : 0);
