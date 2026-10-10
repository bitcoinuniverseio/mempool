import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/universe-ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const backend = workflow.match(/\n  backend:\n([\s\S]*?)(?=\n  frontend:)/)?.[1];

function hasCodecSetupBeforeTests(source) {
  const setup = source.indexOf('working-directory: rust/arkade-codec\n        run: npm ci');
  const tests = source.indexOf('- name: Unit tests');
  return setup >= 0 && tests > setup;
}

test('the actual backend CI installs the locked Arkade codec before genuine proof tests', () => {
  assert.ok(backend);
  assert.equal(hasCodecSetupBeforeTests(backend), true);
  const pkg = JSON.parse(readFileSync(new URL('../../rust/arkade-codec/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../../rust/arkade-codec/package-lock.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['@arkade-os/sdk'], '0.4.72');
  assert.equal(lock.packages['node_modules/@arkade-os/sdk'].version, '0.4.72');
});

test('a missing, wrong-directory, unlocked or late codec install does not satisfy setup', () => {
  assert.ok(backend);
  const step = 'working-directory: rust/arkade-codec\n        run: npm ci';
  assert.equal(hasCodecSetupBeforeTests(backend.replace(step, '')), false);
  assert.equal(hasCodecSetupBeforeTests(backend.replace(step, step.replace('rust/arkade-codec', 'backend'))), false);
  assert.equal(hasCodecSetupBeforeTests(backend.replace(step, step.replace('npm ci', 'npm install'))), false);
  assert.equal(hasCodecSetupBeforeTests(backend.replace(step, '') + '\n' + step), false);
});
