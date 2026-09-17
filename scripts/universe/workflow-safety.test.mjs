import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const payload = 'literal-$(printf INJECTED)-`printf INJECTED`-"; printf INJECTED; #';

test('smoke origin remains one literal argument in every actual smoke command', () => {
  const source = workflow('universe-production-smoke');
  const commands = source.split('\n').filter(line => /run: node .*\$SMOKE_ORIGIN/.test(line)).map(line => line.trim().slice(5));
  for (const match of source.matchAll(/run: >-\n\s+(node [^\n]+)\n\s+(--origin=[^\n]+)/g)) {
    commands.push(`${match[1]} ${match[2]}`);
  }
  assert.equal(commands.length, 4);
  for (const command of commands) {
    assert.doesNotMatch(command, /\$\{\{/);
    const result = spawnSync('bash', ['-c', `node() { printf '%s\\0' "$@"; }; ${command}`], {
      encoding: 'utf8', env: { ...process.env, SMOKE_ORIGIN: payload }, timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const args = result.stdout.split('\0').filter(Boolean);
    assert.ok(args.includes(payload) || args.includes(`--origin=${payload}`), JSON.stringify(args));
    assert.ok(args.length <= 3, JSON.stringify(args));
  }
});

test('parameterized workflow only checks out the dispatched ref with read permission', () => {
  const source = workflow('e2e_parameterized');
  assert.doesNotMatch(source, /REF_INPUT|refs\/pull|determine-ref|github\.event\.inputs\.ref/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.equal((source.match(/persist-credentials: false/g) ?? []).length, 2);
});

test('database wait fails when every authenticated read fails', () => {
  const source = workflow('backend-integration');
  const block = source.match(/- name: Wait for an authenticated database query[\s\S]*?run: \|\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.ok(block);
  for (const [answer, success] of [['1', true], ['', false], ['0', false]]) {
    const result = spawnSync('bash', ['-c', 'docker() { printf "%s" "$DB_ANSWER"; }; timeout() { shift; "$@"; }; sleep() { :; };\n'+block], {
      encoding: 'utf8', env: { ...process.env, DB_ANSWER: answer }, timeout: 10_000,
    });
    assert.equal(result.status === 0, success, result.stdout + result.stderr);
  }
});

test('shared runner Rust remains provisioned and Docker tests reserve their own resources', () => {
  assert.doesNotMatch(workflow('universe-ci'), /rustup toolchain uninstall|rustup default|sh \/tmp\/rustup/);
  const source = workflow('docker');
  assert.match(source, /COMPOSE_PROJECT_NAME: mempool-images-/);
  assert.match(source, /127\.0\.0\.1::8080/);
  assert.doesNotMatch(source, /\/tmp\/modify_compose\.py/);
});

test('actual Docker compose preparation assigns database tmpfs to the database and reserves a private port', () => {
  const source = workflow('docker');
  const python = source.match(/<< 'SCRIPT_END'\n([\s\S]*?)          SCRIPT_END/)?.[1].replace(/^          /gm, '');
  assert.ok(python);
  const directory = mkdtempSync(join(tmpdir(), 'compose-test-'));
  try {
    mkdirSync(join(directory, 'docker'));
    writeFileSync(join(directory, 'docker', 'docker-compose.yml'), readFileSync(new URL('../../docker/docker-compose.yml', import.meta.url)));
    const result = spawnSync(process.env.PYTHON_FOR_RELEASE_TESTS || 'python3', ['-c', python], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, TAG: 'local-check' }, timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const generated = readFileSync(join(directory, 'docker-compose.test.yml'), 'utf8').replaceAll('\r\n', '\n');
    const web = generated.split('  web:\n')[1].split('  api:\n')[0];
    const db = generated.split('  db:\n')[1].split('  nats:\n')[0];
    assert.match(web, /127\.0\.0\.1::8080/);
    assert.doesNotMatch(web, /tmpfs:/);
    assert.match(db, /tmpfs:\n      - \/var\/lib\/mysql/);
    assert.doesNotMatch(db, /\.\/mysql\/data/);
    assert.match(generated, /image: test-backend:local-check/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('container gate: develop and main pull requests touching the templates build without publishing', () => {
  const source = workflow('docker');
  const [before, after] = source.split('\njobs:\n');
  // Triggers: pull requests to the fork's integration branches, scoped to the
  // container templates and the runtime configuration they render, plus an
  // explicit dispatch. No tag push, no upstream master, no label shortcut.
  assert.match(before, /pull_request:\n    branches: \[develop, main\]/);
  assert.doesNotMatch(before, /^\s+push:\n\s+tags:/m);
  assert.doesNotMatch(source, /master|docker-push|labeled/);
  for (const path of ["'docker/**'", "'backend/mempool-config.sample.json'", "'frontend/mempool-frontend-config.sample.json'", "'production/mempool-config.*.json'", "'rust/gbt/rust-toolchain'"]) {
    assert.ok(before.includes(`      - ${path}`), path);
  }
  assert.match(before, /workflow_dispatch:\n    inputs:\n      tag:/);
  assert.match(before, /publish:\n[\s\S]*?type: boolean\n\s+default: false/);
  // The gate job builds locally and never pushes; only the dispatched
  // publication job does, and only when asked.
  const gate = after.split('\n  build:\n')[0];
  const publish = after.split('\n  build:\n')[1].split('\n  tag-latest:\n')[0];
  const latest = after.split('\n  tag-latest:\n')[1];
  assert.match(gate, /--load/);
  assert.doesNotMatch(gate, /push=true|login-action|DOCKER_PASSWORD/);
  assert.match(publish, /if: \|\n\s+needs\.test-images\.result == 'success' &&\n\s+github\.event_name == 'workflow_dispatch' &&\n\s+github\.event\.inputs\.publish == 'true'/);
  assert.match(latest, /github\.event\.inputs\.publish == 'true' && github\.event\.inputs\.latest == 'true'/);
  assert.doesNotMatch(source, /github\.ref_name|GITHUB_REF\//);
  // Every job keeps the shared runner labels used elsewhere.
  assert.equal((source.match(/runs-on: \[self-hosted, linux, x64, universe-super\]/g) ?? []).length, 3);
  // The dispatched tag is validated before it reaches a shell or a registry.
  for (const block of [gate, publish, latest]) {
    assert.match(block, /case "\$DISPATCH_TAG" in\n\s+''\|\*\[!A-Za-z0-9\._-\]\*\)/);
  }
});

test('Docker build cannot mutate global swap or restart the shared daemon', () => {
  const source = workflow('docker');
  assert.doesNotMatch(source, /sudo\s+(?:swapoff|swapon|mkswap|mount)|sudo\s+systemctl\s+restart\s+docker|\/mnt\/swapfile/);
  assert.match(source, /docker buildx build/);
  assert.match(source, /type=registry,push=true/);
});
