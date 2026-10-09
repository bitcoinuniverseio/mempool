import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validatorModuleClosure } from './release-fixture-modules.mjs';

test('fixture closure parses transitive imports, reexports and cycles without execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'module-closure-'));
  try {
    writeFileSync(join(root, 'entry.mjs'), "import './helper.mjs'; import 'node:fs'; throw Error('must not execute');");
    writeFileSync(join(root, 'helper.mjs'), "export { value } from './leaf.mjs';");
    writeFileSync(join(root, 'leaf.mjs'), "import './entry.mjs'; export const value = 1;");
    assert.deepEqual(validatorModuleClosure(['entry.mjs'], root), ['entry.mjs', 'helper.mjs', 'leaf.mjs']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fixture closure rejects missing, external, escaped and linked dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'module-closure-')), outside = mkdtempSync(join(tmpdir(), 'module-outside-'));
  try {
    for (const [source, message] of [["import './missing.mjs';", /ENOENT/], ["import 'external-package';", /Unsupported fixture import/], ["import '../outside.mjs';", /Unsafe fixture module path/]]) {
      writeFileSync(join(root, 'entry.mjs'), source);
      assert.throws(() => validatorModuleClosure(['entry.mjs'], root), message);
    }
    writeFileSync(join(outside, 'leaf.mjs'), 'export const value = 1;');
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(root, 'entry.mjs'), "import './linked/leaf.mjs';");
    assert.throws(() => validatorModuleClosure(['entry.mjs'], root), /must not follow a link/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
