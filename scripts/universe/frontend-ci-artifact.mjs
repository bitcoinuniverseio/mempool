import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const manifestName = 'universe-ci-artifact.json';
export function inventory(root) {
  const files = {};
  let bytes = 0;
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      assert(!/[\\\r\n]/.test(name) && name !== '.' && name !== '..');
      const path = join(directory, name), relative = prefix + name;
      const before = lstatSync(path);
      assert(!before.isSymbolicLink(), 'Linked artifact member');
      if (before.isDirectory()) { walk(path, relative + '/'); continue; }
      assert(before.isFile(), 'Nonregular artifact member');
      if (relative === manifestName) { continue; }
      assert(before.size <= 128 * 1024 * 1024, 'Artifact member too large');
      bytes += before.size;
      assert(bytes <= 1024 * 1024 * 1024 && Object.keys(files).length < 10000, 'Artifact budget exceeded');
      const data = readFileSync(path), after = lstatSync(path);
      assert(before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && data.length === before.size, 'Artifact changed');
      files[relative] = createHash('sha256').update(data).digest('hex');
    }
  }
  assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  walk(root);
  assert(files['mempool/browser/index.html'], 'Missing frontend entry');
  return files;
}
export function artifact(mode, root, revision) {
  assert(/^[0-9a-f]{40}$/.test(revision), 'Exact source revision required');
  const files = inventory(root), path = join(root, manifestName);
  if (mode === 'seal') {
    writeFileSync(path, JSON.stringify({ schemaVersion: 'universe-frontend-ci-v1', revision, files }), { flag: 'wx' });
  } else {
    assert(mode === 'verify');
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    assert(manifest.schemaVersion === 'universe-frontend-ci-v1' && manifest.revision === revision, 'Artifact source mismatch');
    assert.deepEqual(files, manifest.files, 'Artifact bytes or roster mismatch');
  }
  return Object.keys(files).length;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify({ mode: process.argv[2], files: artifact(process.argv[2], resolve('frontend/dist'), process.env.GITHUB_SHA) }));
}
