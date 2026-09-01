import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const destination = resolve(sourceDirectory, process.env.FD || '../../backend/rust-gbt');
const nativeModules = readdirSync(sourceDirectory).filter((name) => name.endsWith('.node'));

if (nativeModules.length === 0) {
  throw new Error('No built .node module was found. Run the Rust build before copying to backend.');
}

rmSync(destination, { force: true, recursive: true });
mkdirSync(destination, { recursive: true });

for (const name of ['index.js', 'index.d.ts', 'package.json', ...nativeModules]) {
  copyFileSync(resolve(sourceDirectory, name), resolve(destination, name));
}
