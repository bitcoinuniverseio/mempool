import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(process.env.UNIVERSE_ACCEPTANCE_BUILD_PROOF || resolve(root, '../.runtime/frontend-build-proof-20260906.json'));
const buildRoot = resolve(process.env.UNIVERSE_ACCEPTANCE_BUILD_ROOT || resolve(root, 'frontend/dist/mempool/browser'));
const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
function fingerprint(paths) {
  const files = [...new Set(paths)].filter(path => existsSync(resolve(root, path))).sort()
    .map(path => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
  return { files, count: files.length, sha256: hash(files.map(file => file.path + '\0' + file.sha256).join('\n')) };
}
const files = (git(['ls-files', '-z', '--', 'frontend']) + '\0' + git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'frontend']))
  .split('\0').filter(path => path && !/\.spec\.[cm]?[jt]sx?$/.test(path));
const source = fingerprint(files);
if (process.argv[2] === '--before') {
  writeFileSync(output, JSON.stringify({ startedAt: new Date().toISOString(), revision: git(['rev-parse','HEAD']), source }, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'before', files: source.count, sha256: source.sha256 }));
} else if (process.argv[2] === '--after') {
  const before = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(source.sha256, before.source.sha256, 'Frontend source changed during the build; rebuild the changed bytes before claiming a match.');
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(resolve(directory, entry.name)) : [relative(root, resolve(directory, entry.name)).replaceAll('\\','/')]);
  }
  const built = fingerprint(walk(buildRoot));
  const result = { ...before, completedAt: new Date().toISOString(), sourceUnchangedDuringBuild: true, buildRoot, built };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'after', sourceFiles: source.count, sourceSha256: source.sha256, builtFiles: built.count, builtSha256: built.sha256 }));
} else throw new Error('Use --before immediately before the build, and --after only after it exits successfully.');
