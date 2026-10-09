// Test packaging only. Parse ESM dependencies without executing source modules.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const worker = String.raw`
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(process.argv[1]), pending = JSON.parse(process.argv[2]), files = new Set();
while (pending.length) {
  const name = pending.pop(), absolute = path.resolve(root, name), relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.mjs')) throw Error('Unsafe fixture module path: ' + name);
  let checked = root;
  for (const part of relative.split(path.sep)) {
    checked = path.join(checked, part);
    if (fs.lstatSync(checked).isSymbolicLink()) throw Error('Fixture module must not follow a link: ' + name);
  }
  if (!fs.statSync(absolute).isFile()) throw Error('Fixture module is not a file: ' + name);
  if (files.has(relative)) continue;
  files.add(relative);
  const module = new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'));
  for (const specifier of module.dependencySpecifiers) {
    if (specifier.startsWith('node:')) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw Error('Unsupported fixture import: ' + specifier);
    pending.push(path.relative(root, path.resolve(path.dirname(absolute), specifier)));
  }
}
process.stdout.write(JSON.stringify([...files].map(name => name.split(path.sep).join('/')).sort()));
`;
export function validatorModuleClosure(entries = ['protocol-contract.mjs', 'reconciled-release.mjs', 'protocol-functional-projection.mjs'], root = dirname(fileURLToPath(import.meta.url))) {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '-e', worker, root, JSON.stringify(entries)], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }));
}
