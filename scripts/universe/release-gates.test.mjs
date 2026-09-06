/**
 * Proof that the release script's cutover gates measure what they claim to.
 *
 * Both cases here shipped broken and stayed green, because the only check the
 * script had was `bash -n`:
 *
 * - The private-listener gate parsed ports with a sed that deleted the match
 *   instead of capturing it, so every exposed port compared as an empty
 *   string and the gate could not name a single public listener.
 * - The readiness wait timed out silently, so "gateway did not come back"
 *   was all an operator got, whether the service answered 503 for five
 *   minutes or never accepted a connection at all.
 *
 * These tests run the exact text of release.sh, not a copy of it. The parser
 * pipeline and the wait_for function are extracted from the script at test
 * time, so a regression in the script is a regression here.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, 'release.sh'), 'utf8').replaceAll('\r\n', '\n');
const workdir = mkdtempSync(join(tmpdir(), 'release-gates-'));
const artifactWorkflow = readFileSync(
  join(here, '..', '..', '.github', 'workflows', 'universe-release-artifact.yml'),
  'utf8',
).replaceAll('\r\n', '\n');

function bash(source, env = {}) {
  const result = spawnSync('bash', ['-c', source], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  assert.equal(result.error, undefined, `bash did not run: ${result.error}`);
  return result;
}

test('a changed backend lock can build an independent release dependency tree', () => {
  assert.match(script, /reuse_previous=false/);
  assert.match(script, /npm ci --omit=dev --omit=optional --ignore-scripts/);
  assert.match(artifactWorkflow, /cp -a backend\/vendor/);
  assert.match(artifactWorkflow, /cp -a backend\/rust-gbt/);
  assert.match(artifactWorkflow, /stage\/backend\/rust-gbt\/package\.json/);
});

// Install the real function into a disposable release tree. Package download,
// ownership and archive extraction are host boundaries; Node's require and
// WASM compilation are real. No production configuration or service is used.
function runInstall(mode, reused = false) {
  const fixture = mkdtempSync(join(workdir, 'install-fixture-'));
  const backend = join(fixture, 'artifact', 'backend');
  mkdirSync(join(backend, 'vendor'), { recursive: true });
  mkdirSync(join(backend, 'rust-gbt'), { recursive: true });
  writeFileSync(join(backend, 'package.json'), '{}');
  writeFileSync(join(backend, 'package-lock.json'), 'new-lock');
  for (const [name, code] of [
    ['@bitcoinuniverse/ecosystem-contracts', "console.log('LOADED contracts');"],
    ['rust-gbt', "console.log('LOADED rust-gbt');"],
    ['tiny-secp256k1', `
const fs = require('node:fs');
const path = require('node:path');
new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'secp256k1.wasm')));
console.log('LOADED tiny-secp256k1 WASM');
`],
  ]) {
    if (name === 'tiny-secp256k1' && mode === 'missing-tiny') {continue;}
    const directory = join(fixture, 'dependencies', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'index.js'), code);
    if (name === 'tiny-secp256k1' && mode !== 'missing-wasm') {
      writeFileSync(join(directory, 'secp256k1.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    }
  }
  const install = script.match(/^cmd_install\(\) \{$[\s\S]*?^\}$/m)?.[0];
  assert.ok(install, 'cmd_install must be executable from release.sh');
  const releaseDir = script.match(/^release_dir\(\) \{[^\n]+\}$/m)?.[0];
  const source = `
set -euo pipefail
ROOT=$(mktemp -d)
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
mkdir -p "$RELEASES/mempool-old/backend/node_modules"
command cp -a "$INSTALL_FIXTURE/dependencies/." "$RELEASES/mempool-old/backend/node_modules/"
printf '%s' "$OLD_LOCK" > "$RELEASES/mempool-old/backend/package-lock.json"
printf '%s' "$RELEASES/mempool-old" > "$CURRENT"
touch "$ROOT/artifact.tar.gz"
trap 'status=$?; if [ -f "$RELEASES/mempool-new/RELEASE-SHA" ]; then printf "READY_MARKER=yes\\n"; else printf "READY_MARKER=no\\n"; fi; exit "$status"' EXIT
log() { printf '%s\\n' "$*"; }
fail() { printf 'FAILED: %s\\n' "$*" >&2; exit 1; }
readlink() { cat "$2"; }
tar() {
  [ "$INSTALL_MODE" != archive-failure ] || return 51
  command cp -a "$INSTALL_FIXTURE/artifact/." "$4/"
}
cp() {
  if [ "$INSTALL_MODE" = copy-failure ] && [ "$1" = -al ]; then return 61; fi
  command cp "$@"
}
cd() { [ "$INSTALL_MODE" != directory-failure ] || return 43; builtin cd "$@"; }
npm() {
  printf 'NPM_INSTALL\\n'
  mkdir -p node_modules
  command cp -a "$INSTALL_FIXTURE/dependencies/." node_modules/
  [ "$INSTALL_MODE" != npm-failure ] || return 37
}
chown() { [ "$INSTALL_MODE" != owner-failure ] || return 67; }
chmod() { return 0; }
${releaseDir}
${install}
# Deliberately conditional: every mandatory install step must propagate its
# error even when Bash's implicit errexit is disabled by the caller.
if cmd_install new "$ROOT/artifact.tar.gz"; then exit 0; else exit $?; fi
`;
  return bash(source, {
    INSTALL_FIXTURE: fixture.replaceAll('\\', '/'), INSTALL_MODE: mode,
    OLD_LOCK: reused ? 'new-lock' : 'old-lock',
  });
}

for (const reused of [false, true]) {
  test(`${reused ? 'reused' : 'new'} dependencies are loaded before the release is marked installed`, () => {
    const result = runInstall('ready', reused);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /LOADED contracts[\s\S]*LOADED rust-gbt[\s\S]*LOADED tiny-secp256k1 WASM/);
    assert.match(result.stdout, /installed .*mempool-new/);
    assert.match(result.stdout, /READY_MARKER=yes/);
    assert.equal(result.stdout.includes('NPM_INSTALL'), !reused);
  });
  for (const mode of ['missing-tiny', 'missing-wasm']) {
    test(`${reused ? 'reused' : 'new'} dependencies with ${mode} cannot mark a release installed`, () => {
      const result = runInstall(mode, reused);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /tiny-secp256k1|secp256k1.wasm/);
      assert.match(result.stdout, /READY_MARKER=no/);
      assert.doesNotMatch(result.stdout, /installed .*mempool-new/);
    });
  }
}

for (const [mode, status, reused] of [
  ['npm-failure', 37, false], ['directory-failure', 43, false],
  ['archive-failure', 51, false], ['copy-failure', 61, true],
]) {
  test(`${mode} cannot be masked by a later successful runtime check`, () => {
    const result = runInstall(mode, reused);
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.match(result.stdout, /READY_MARKER=no/);
    assert.doesNotMatch(result.stdout, /LOADED|installed .*mempool-new/);
  });
}

test('failed release ownership prevents reporting installation success', () => {
  const result = runInstall('owner-failure');
  assert.equal(result.status, 67, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /installed .*mempool-new/);
});

// ------------------------------------------------- the listener parser ----

// The exact pipeline the gate runs, with `ss -ltn` swapped for a fixture so
// the test controls what the sockets look like.
const pipelineMatch = script.match(/exposed=\$\(ss -ltn 2>\/dev\/null(.*)\)\n/);
assert.ok(pipelineMatch, 'release.sh no longer contains the listener pipeline this test covers');
const pipeline = `cat "$SS_FIXTURE"${pipelineMatch[1]}`;

const SS_HEADER = 'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process';

function parsePorts(lines) {
  const fixture = join(workdir, 'ss-fixture.txt');
  writeFileSync(fixture, [SS_HEADER, ...lines, ''].join('\n'));
  const result = bash(`printf '%s' "$(${pipeline})"`, { SS_FIXTURE: fixture });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

test('a deployment with only loopback, ::1 and docker-bridge listeners exposes nothing', () => {
  assert.deepEqual(
    parsePorts([
      'LISTEN 0 4096 127.0.0.1:3001      0.0.0.0:*',
      'LISTEN 0 4096 127.0.0.1:8996      0.0.0.0:*',
      'LISTEN 0 4096 [::1]:3400          [::]:*',
      'LISTEN 0 4096 172.17.0.1:8099     0.0.0.0:*',
    ]),
    [],
  );
});

test('a public listener is reported as its port, not as an empty string', () => {
  // The regression this file exists for: the sed wrote '' for every socket,
  // so the gate compared empty strings against the allowlist and passed.
  const ports = parsePorts([
    'LISTEN 0 4096 0.0.0.0:3247        0.0.0.0:*',
    'LISTEN 0 4096 127.0.0.1:3001      0.0.0.0:*',
    'LISTEN 0 4096 [::]:8996           [::]:*',
    'LISTEN 0 511  0.0.0.0:22          0.0.0.0:*',
  ]);
  assert.deepEqual(ports, ['22', '3247', '8996']);
  for (const port of ports) assert.match(port, /^[0-9]+$/);
});

// ------------------------------------------------------------ wait_for ----

const waitForMatch = script.match(/^wait_for\(\) \{$[\s\S]*?^\}$/m);
assert.ok(waitForMatch, 'release.sh no longer contains the wait_for this test covers');

// Async on purpose: the servers these cases talk to live in this process, so
// a synchronous spawn would block the event loop and deadlock the very
// request the test is waiting on.
function runWaitFor(url, env = {}) {
  const source = `log() { printf '%s\\n' "$*"; }\n${waitForMatch[0]}\nwait_for "${url}" service-under-test`;
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', source], {
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('a service that answers 200 passes before the deadline', async () => {
  const server = createServer((_req, res) => res.end('ok'));
  const port = await listen(server);
  try {
    const result = await runWaitFor(`http://127.0.0.1:${port}/health`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /service-under-test is answering/);
  } finally {
    server.close();
  }
});

test('a service that only answers errors fails, and the log names the status it saw', async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end('warming up');
  });
  const port = await listen(server);
  try {
    const result = await runWaitFor(`http://127.0.0.1:${port}/health`, { WAIT_FOR_SECONDS: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /did not answer 200 within 1s/);
    assert.match(result.stdout, /last observed state: HTTP 503/);
  } finally {
    server.close();
  }
});

test('a service that accepts connections and never responds fails as hung, not as healthy', async () => {
  // A genuinely hung service: the socket accepts and then nothing happens.
  // curl has to give up on its own -m budget for this one, so this test
  // spends a few real seconds. That is the behavior under test.
  const server = createTcpServer(() => { /* accept and hold */ });
  const port = await listen(server);
  try {
    const result = await runWaitFor(`http://127.0.0.1:${port}/health`, { WAIT_FOR_SECONDS: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /last observed state: no HTTP response/);
  } finally {
    server.close();
  }
});

// Execute the real cutover and rollback functions. Only host boundaries are
// replaced: services, readiness reads, and the atomic current-pointer update.
// The pointer is represented by a file so this also runs on Windows without
// requiring symlink privileges; release directories and rename are real.
function runCutoverFailure(failure, rollbackFailure = '') {
  const functions = ['release_dir', 'rollback_failed_cutover', 'cmd_cutover', 'cmd_rollback']
    .map((name) => script.match(new RegExp(`^${name}\\(\\) \\{$[\\s\\S]*?^\\}$`, 'm'))?.[0]
      || script.match(new RegExp(`^${name}\\(\\) \\{[^\\n]+\\}$`, 'm'))?.[0] || '')
    .join('\n');
  return bash(`
set -euo pipefail
ROOT=$(mktemp -d)
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
GATEWAY=http://127.0.0.1:8099
UNITS="universe-explorer-backend universe-explorer-overlay universe-explorer-gateway"
mkdir -p "$RELEASES/mempool-old/scripts/universe" "$RELEASES/mempool-new/scripts/universe"
printf 'inheritedListenerFd old' > "$RELEASES/mempool-old/scripts/universe/gateway.mjs"
printf 'inheritedListenerFd new' > "$RELEASES/mempool-new/scripts/universe/gateway.mjs"
printf '%s' "$RELEASES/mempool-old" > "$CURRENT"
trap 'status=$?; printf "FINAL_CURRENT=%s\\n" "$(cat "$CURRENT")"; exit "$status"' EXIT
log() { printf '%s\\n' "$*"; }
fail() { printf 'FAILED: %s\\n' "$*" >&2; exit 1; }
readlink() { cat "$2"; }
ln() { printf '%s' "$2" > "$3"; }
cmd_preflight() { return 0; }
systemctl() {
  [ "$1" != is-active ] || return 1
  printf 'SERVICE %s CURRENT=%s\\n' "$*" "$(cat "$CURRENT")"
  if [[ $(cat "$CURRENT") == */mempool-new ]]; then
    if [ "$FAILURE" = gateway-restart ] && [ "$2" = universe-explorer-gateway ]; then return 17; fi
    if [ "$FAILURE" = backend-restart ] && [ "$2" = universe-explorer-backend ]; then return 23; fi
  elif [ "$ROLLBACK_FAILURE" = restart ]; then
    return 47
  fi
}
wait_for() { [ "$FAILURE" != gateway-health ] || return 19; }
verify_live() {
  printf 'VERIFY %s\\n' "$1"
  if [[ "$1" == */mempool-new ]] && [ "$FAILURE" = verification ]; then return 31; fi
  if [[ "$1" == */mempool-old ]] && [ "$ROLLBACK_FAILURE" = verification ]; then return 53; fi
  return 0
}
${functions}
cmd_cutover new
`, { FAILURE: failure, ROLLBACK_FAILURE: rollbackFailure });
}

for (const [failure, status] of [
  ['gateway-restart', 17], ['backend-restart', 23],
  ['gateway-health', 19], ['verification', 31],
]) {
  test(`post-swap ${failure} restores the previous release and preserves the original exit status`, () => {
    const result = runCutoverFailure(failure);
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.match(result.stdout, /FINAL_CURRENT=.*\/mempool-old\b/);
    assert.match(result.stdout, /SERVICE restart universe-explorer-backend universe-explorer-overlay universe-explorer-gateway CURRENT=.*\/mempool-old\b/);
    assert.match(result.stdout, /VERIFY .*\/mempool-old\b/);
    assert.match(result.stdout + result.stderr, /rolled back to old/);
    assert.doesNotMatch(result.stdout, /cutover to new complete/);
  });
}

for (const [failure, status] of [['restart', 47], ['verification', 53]]) {
  test(`rollback ${failure} failure stays visible without replacing the original cutover error`, () => {
    const result = runCutoverFailure('gateway-restart', failure);
    assert.equal(result.status, 17, result.stdout + result.stderr);
    assert.match(result.stdout, /FINAL_CURRENT=.*\/mempool-old\b/);
    assert.match(result.stdout + result.stderr, new RegExp(`rollback failed.*${status}`));
    assert.match(result.stdout + result.stderr, /gateway restart failed.*17/);
    assert.doesNotMatch(result.stdout, /rolled back to old|cutover to new complete/);
  });
}

const authorityGate = script.match(/^gate_readable_protocols_have_authorities\(\) \{$[\s\S]*?^\}$/m)?.[0];
const authorityPython = authorityGate?.match(/<<'PY'[^\n]*\n([\s\S]*?)\nPY\n/)?.[1];
assert.ok(authorityPython, 'the authority gate must retain an executable Python body');

function runAuthorityGate(answer) {
  const result = spawnSync(process.env.PYTHON_FOR_RELEASE_TESTS || 'python3', ['-c', `
import io,json,sys
from types import SimpleNamespace
from unittest.mock import patch
sys.argv = ['gate', '/unused-release']
answer = json.loads(${JSON.stringify(JSON.stringify(answer))})
source = ${JSON.stringify(authorityPython)}
environment = 'UNIVERSE_EXPLORER_SOURCES_JSON=[{"authorityId":"owned-reader"}]\\n'
with patch('builtins.open', return_value=io.StringIO(environment)), patch('subprocess.run', return_value=SimpleNamespace(**answer)):
    exec(compile(source, 'release.sh authority gate', 'exec'))
`], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined, `Python did not run: ${result.error}`);
  return result;
}

test('the authority preflight refuses an unreachable overlay instead of skipping the gate', () => {
  const result = runAuthorityGate({ returncode: 7, stdout: '', stderr: 'connection refused' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /overlay.*(unavailable|could not|not answer)/i);
});

test('the authority preflight accepts the readable protocol only with its configured authority', () => {
  const protocol = { id: 'sample', releaseStatus: 'VERIFIED', indexerAuthority: 'owned-reader' };
  assert.equal(runAuthorityGate({ returncode: 0, stdout: JSON.stringify({ protocols: [protocol] }) }).status, 0);
  const missing = runAuthorityGate({ returncode: 0, stdout: JSON.stringify({ protocols: [{ ...protocol, indexerAuthority: 'missing' }] }) });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout, /sample/);
});

const databaseGate = script.match(/^gate_database\(\) \{$[\s\S]*?^\}$/m)?.[0];
const databaseNode = databaseGate?.match(/<<'NODE'[^\n]*\n([\s\S]*?)\nNODE\n/)?.[1];

function runDatabaseGate(mode, socket = false) {
  assert.ok(databaseNode, 'the database gate must execute an authenticated query, not only open a TCP socket');
  const release = mkdtempSync(join(workdir, 'database-release-'));
  mkdirSync(join(release, 'backend', 'dist'), { recursive: true });
  mkdirSync(join(release, 'backend', 'node_modules', 'mysql2'), { recursive: true });
  writeFileSync(join(release, 'backend', 'package.json'), '{}');
  const config = join(release, 'backend-config.json');
  writeFileSync(config, JSON.stringify({ DATABASE: {
    ENABLED: true, HOST: '127.0.0.1', PORT: 3307, SOCKET: socket ? '/private/database.sock' : '',
    DATABASE: 'release_schema', USERNAME: 'fixture-user', PASSWORD: 'fixture-password-never-log',
  } }));
  writeFileSync(join(release, 'backend', 'dist', 'config.js'),
    'exports.default = require(process.env.MEMPOOL_CONFIG_FILE);');
  writeFileSync(join(release, 'backend', 'node_modules', 'mysql2', 'promise.js'), `
const assert = require('node:assert/strict');
exports.createConnection = async (options) => {
  assert.equal(options.database, 'release_schema');
  assert.equal(options.user, 'fixture-user');
  assert.equal(options.password, 'fixture-password-never-log');
  assert.equal(options.connectTimeout, 5000);
  if (process.env.DB_SOCKET === 'yes') {
    assert.equal(options.socketPath, '/private/database.sock');
    assert.equal(options.host, undefined);
  } else {
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.port, 3307);
  }
  if (process.env.DB_GATE_MODE === 'auth') {
    throw Object.assign(new Error('fixture-user fixture-password-never-log'), { code: 'ER_ACCESS_DENIED_ERROR' });
  }
  return {
    query: async (query) => {
      assert.deepEqual(query, { sql: 'SELECT 1 AS ready', timeout: 5000 });
      if (process.env.DB_GATE_MODE === 'timeout') {
        throw Object.assign(new Error('fixture-password-never-log'), { code: 'PROTOCOL_SEQUENCE_TIMEOUT' });
      }
      return [[{ ready: process.env.DB_GATE_MODE === 'wrong-result' ? 0 : 1 }]];
    },
    end: async () => {},
    destroy: () => {},
  };
};
`);
  const result = spawnSync(process.execPath, ['-', release], {
    input: databaseNode, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, MEMPOOL_CONFIG_FILE: config, DB_GATE_MODE: mode, DB_SOCKET: socket ? 'yes' : 'no' },
  });
  assert.equal(result.error, undefined, `database probe did not run: ${result.error}`);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-user|fixture-password-never-log/);
  return result;
}

test('database readiness authenticates to the configured schema and executes only a bounded read', () => {
  for (const socket of [false, true]) {
    const result = runDatabaseGate('ready', socket);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /authenticated.*SELECT 1/i);
  }
});

for (const [mode, code] of [
  ['auth', 'ER_ACCESS_DENIED_ERROR'], ['timeout', 'PROTOCOL_SEQUENCE_TIMEOUT'], ['wrong-result', 'CHECK_FAILED'],
]) {
  test(`database readiness refuses ${mode} without exposing connection credentials`, () => {
    const result = runDatabaseGate(mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(code));
    assert.doesNotMatch(result.stdout, /authenticated.*SELECT 1/i);
  });
}
