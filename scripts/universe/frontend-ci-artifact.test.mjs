import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifact } from './frontend-ci-artifact.mjs';
test('shared frontend artifact rejects wrong revision, missing, added and changed bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'universe-ci-artifact-'));
  try {
    const browser = join(root, 'mempool/browser'); mkdirSync(browser, { recursive: true });
    const index = join(browser, 'index.html'); writeFileSync(index, '<html>verified build</html>');
    assert.equal(artifact('seal', root, 'a'.repeat(40)), 1);
    assert.equal(artifact('verify', root, 'a'.repeat(40)), 1);
    assert.throws(() => artifact('verify', root, 'b'.repeat(40)));
    writeFileSync(index, '<html>wrong build</html>'); assert.throws(() => artifact('verify', root, 'a'.repeat(40)));
    rmSync(index); assert.throws(() => artifact('verify', root, 'a'.repeat(40)));
    writeFileSync(index, '<html>verified build</html>'); writeFileSync(join(browser, 'extra.js'), 'unreviewed');
    assert.throws(() => artifact('verify', root, 'a'.repeat(40)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
