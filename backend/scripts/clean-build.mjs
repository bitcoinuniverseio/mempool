import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const name of ['dist', 'node_modules', 'package', 'rust-gbt']) {
  rmSync(resolve(backend, name), { force: true, recursive: true });
}
