import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const gateSource = readFileSync(new URL('./check-text.mjs', import.meta.url), 'utf8');
const scope = 'canonical-public-blocks-and-parent-peg-evidence';
const prefix = 'frontend/src/app/universe/liquid-observatory/';
const approved = ['liquid-evidence.ts', 'liquid-fixtures.ts', 'liquid-observatory.types.ts'];

function check(path, content) {
  const root = mkdtempSync(join(tmpdir(), 'universe-text-contract-'));
  try {
    const script = join(root, 'scripts/universe/check-text.mjs');
    const file = join(root, path);
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(script, gateSource);
    writeFileSync(file, content);
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(result.error, undefined);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the exact quoted Liquid wire enum remains unchanged in all three contract files', () => {
  for (const file of approved) {
    assert.equal(check(prefix + file, `scope: '${scope}';`).status, 0);
    assert.equal(check(prefix + file, `scope: "${scope}";`).status, 0);
  }
});

test('the same enum in any other authored file is rejected', () => {
  assert.equal(check(prefix + 'other-contract.ts', `scope: '${scope}';`).status, 1);
});

test('ordinary vocabulary beside an allowed enum is still rejected', () => {
  for (const file of approved) {
    const result = check(prefix + file, `scope: '${scope}'; // canonical prose`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /canonical/);
  }
});

test('unquoted or changed Liquid enum values are rejected', () => {
  assert.equal(check(prefix + approved[0], `// ${scope}`).status, 1);
  assert.equal(check(prefix + approved[0], `scope: '${scope}-other';`).status, 1);
});

test('em dash remains rejected in an approved contract file', () => {
  const result = check(prefix + approved[0], `scope: '${scope}'; // ${String.fromCharCode(0x2014)}`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /em dash/);
});
