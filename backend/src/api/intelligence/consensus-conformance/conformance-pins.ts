import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';
import { createRequire } from 'module';
import { digest, ConformanceEvidenceError } from './conformance-evidence';
/** Pin the actual installed transitive JS package bytes, not just an npm version label. */
export function javascriptTreeDigest(): string {
  const seen = new Set<string>(),
    entries: string[] = [];
  let bytes = 0;
  const visit = (entry: string) => {
    let root = dirname(entry);
    while (!require('fs').existsSync(join(root, 'package.json'))) {
      const next = dirname(root);
      if (next === root) throw Error('Package root unavailable');
      root = next;
    }
    if (seen.has(root)) return;
    seen.add(root);
    if (seen.size > 128) throw Error('Dependency bound exceeded');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        if (name === 'node_modules') continue;
        const p = join(dir, name),
          st = statSync(p);
        if (st.isDirectory()) walk(p);
        else {
          bytes += st.size;
          if (bytes > 32 * 1024 * 1024)
            throw new ConformanceEvidenceError('javascript-pin-bound', 'JavaScript dependency tree exceeds32MiB.');
          entries.push(
            pkg.name + '@' + pkg.version + '/' + relative(root, p).replace(/\\/g, '/') + ':' + digest(readFileSync(p))
          );
        }
      }
    };
    walk(root);
    const resolver = createRequire(join(root, 'package.json'));
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) visit(resolver.resolve(name));
  };
  visit(require.resolve('bitcoinjs-lib'));
  visit(require.resolve('varuint-bitcoin'));
  return digest(entries.sort().join('\n'));
}
export function harnessDigest() {
  return digest(
    ['conformance-corpus', 'conformance-runner', 'conformance-node-code', 'consensus-conformance.service']
      .map((name) => digest(readFileSync(require.resolve('./' + name))))
      .join(':')
  );
}
