import { readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const generated = ['target', 'node_modules', 'package-lock.json'];
const nativeModules = readdirSync(directory).filter((name) => name.endsWith('.node'));

for (const name of [...generated, ...nativeModules]) {
  rmSync(resolve(directory, name), { force: true, recursive: true });
}
