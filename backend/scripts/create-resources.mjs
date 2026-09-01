import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasks = resolve(backend, 'dist/tasks');
const pools = resolve(tasks, 'pools');

mkdirSync(pools, { recursive: true });
copyFileSync(resolve(backend, 'src/tasks/price-feeds/mtgox-weekly.json'), resolve(tasks, 'mtgox-weekly.json'));
copyFileSync(resolve(backend, 'src/tasks/pools/pools-v2.json'), resolve(pools, 'pools-v2.json'));

const version = spawnSync(process.execPath, [resolve(backend, 'dist/api/fetch-version.js')], {
  cwd: backend,
  stdio: 'inherit',
});

if (version.status !== 0) {
  process.exit(version.status ?? 1);
}
