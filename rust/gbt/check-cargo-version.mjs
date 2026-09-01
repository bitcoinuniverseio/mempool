import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const expected = readFileSync(new URL('./rust-toolchain', import.meta.url), 'utf8').trim();

let actual;
try {
  actual = execFileSync('cargo', ['version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
} catch {
  console.error('Cargo is required to build rust/gbt, but `cargo version` failed.');
  process.exit(1);
}

const match = /^cargo\s+(\d+\.\d+(?:\.\d+)?)(?:\s|$)/.exec(actual);
const actualVersion = match?.[1] ?? '';
const matchesPin = actualVersion === expected || actualVersion.startsWith(`${expected}.`);

if (!matchesPin) {
  console.warn(
    `WARNING: cargo version ${actualVersion || actual} does not match rust-toolchain ${expected}.`,
  );
}
