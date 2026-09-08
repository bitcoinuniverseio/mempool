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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const productionSmokeWorkflow = readFileSync(
  join(here, '..', '..', '.github', 'workflows', 'universe-production-smoke.yml'),
  'utf8',
).replaceAll('\r\n', '\n');
const testPython = process.env.UNIVERSE_TEST_PYTHON || 'python3';
const pythonProbe = spawnSync(testPython, ['-c', 'import sys; print(sys.version_info.major)'], {
  encoding: 'utf8',
  timeout: 10_000,
});
const pythonAvailable = pythonProbe.status === 0 && String(pythonProbe.stdout ?? '').trim() === '3';

function bash(source, env = {}) {
  const result = spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    input: source,
    timeout: 60_000,
  });
  assert.equal(result.error, undefined, `bash did not run: ${result.error}`);
  return result;
}

function bashAsync(source, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', source], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function bashPath(path) {
  const slashes = path.replaceAll('\\', '/');
  return slashes.replace(/^([A-Za-z]):/, (_match, drive) => `/${drive.toLowerCase()}`);
}

function shellFunction(name) {
  const match = script.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}$`, 'm'));
  assert.ok(match, `release.sh no longer contains ${name}`);
  return match[0];
}

function pythonFromHeredoc(marker) {
  const match = script.match(new RegExp(`<<'${marker}'[^\\n]*\\n([\\s\\S]*?)\\n${marker}$`, 'm'));
  assert.ok(match, `release.sh no longer contains the ${marker} program`);
  return match[1];
}

function runPython(source, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(testPython, ['-', ...args], {
      env: process.env,
      timeout: 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(source);
  });
}

test('the release artifact carries its exact production dependency tree', () => {
  assert.match(artifactWorkflow, /npm prune --omit=dev/);
  assert.match(artifactWorkflow, /git diff --exit-code -- package\.json package-lock\.json/);
  assert.match(artifactWorkflow, /node --test \\\n\s*scripts\/universe\/release-gates\.test\.mjs/);
  assert.match(artifactWorkflow, /scripts\/universe\/gateway-overlay-handoff\.test\.mjs/);
  assert.match(artifactWorkflow, /test "\$\(node --version\)" = v24\.19\.0/);
  assert.match(artifactWorkflow, /test "\$\(npm --version\)" = 11\.17\.0/);
  assert.match(artifactWorkflow, /cp -a backend\/node_modules/);
  assert.match(artifactWorkflow, /bitcoin-api\.rpc-cache\.test\.ts/);
  assert.match(artifactWorkflow, /jsonrpc\.pool\.test\.ts/);
  assert.match(artifactWorkflow, /dist\/api\/bitcoin\/bitcoin-api\.js/);
  assert.match(artifactWorkflow, /dist\/rpc-api\/jsonrpc\.js/);
  assert.match(artifactWorkflow, /cp -a backend\/vendor/);
  assert.match(artifactWorkflow, /cp -a backend\/rust-gbt/);
  assert.match(artifactWorkflow, /stage\/backend\/rust-gbt\/package\.json/);
  assert.match(artifactWorkflow, /out="mempool-\$sha\.tar\.gz"/);
  assert.match(artifactWorkflow, /sha='\$\{\{ steps\.sha\.outputs\.sha \}\}'/);
  assert.match(artifactWorkflow, /universe-explorer-gateway\.service\.d\/10-socket\.conf/);
  assert.doesNotMatch(artifactWorkflow, /out="\$PWD\//);
});

test('release artifacts use the protected release runner class', () => {
  assert.match(artifactWorkflow, /runs-on: \[[^\n]*universe-gcp-release[^\n]*\]/);
  assert.doesNotMatch(artifactWorkflow, /universe-gcp-large/);
});

test('production smoke runs both full acceptance and live browser checks', () => {
  assert.match(productionSmokeWorkflow, /node acceptance\.mjs/);
  assert.match(productionSmokeWorkflow, /node live-e2e\.mjs/);
});

test('install rejects changed artifact bytes before unpacking them', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'release-checksum-'));
  const artifact = join(fixture, 'release.tar.gz');
  writeFileSync(artifact, 'original artifact');
  let result = bash(
    [
      'set -euo pipefail',
      'log() { printf "%s\\n" "$*"; }',
      'fail() { printf "FAILED: %s\\n" "$*" >&2; exit 1; }',
      'source scripts/universe/release.sh',
      'sha256sum "$ARTIFACT" > "$ARTIFACT.sha256"',
      'verify_artifact_checksum "$ARTIFACT"',
    ].join('\n'),
    { ARTIFACT: artifact },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /artifact checksum verified/);

  writeFileSync(artifact, 'changed artifact');
  result = bash(
    [
      'set -euo pipefail',
      'log() { printf "%s\\n" "$*"; }',
      'fail() { printf "FAILED: %s\\n" "$*" >&2; exit 1; }',
      'source scripts/universe/release.sh',
      'verify_artifact_checksum "$ARTIFACT"',
    ].join('\n'),
    { ARTIFACT: artifact },
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /checksum does not match/);
});

test('install stages a complete artifact and never builds on production', () => {
  const install = shellFunction('cmd_install');
  const checksum = install.indexOf('verify_artifact_checksum "$tarball"');
  const stage = install.indexOf('stage=$(mktemp -d');
  const unpack = install.indexOf('tar --no-same-owner --no-same-permissions -xzf');
  const exactIdentity = install.indexOf('gate_manifest_exact "$stage" "$sha"');
  const promote = install.indexOf('mv "$stage" "$dir"');
  assert.ok(checksum >= 0 && stage > checksum, 'install stages before checking the bytes');
  assert.ok(unpack > stage, 'install does not unpack into its private staging directory');
  assert.ok(exactIdentity > unpack, 'install does not check the staged commit identity');
  assert.ok(promote > exactIdentity, 'install promotes before the exact identity gate');
  assert.doesNotMatch(install, /npm ci|cp -al/);
});

test('new releases and rollback require the socket pair and dynamic overlay routing', () => {
  const present = shellFunction('gate_release_present');
  const rollback = shellFunction('cmd_rollback');
  assert.match(present, /mode=\$\{2:-current\}/);
  assert.match(present, /if \[ "\$mode" != legacy \]/);
  assert.match(present, /universe-explorer-gateway\.socket/);
  assert.match(present, /universe-explorer-gateway\.service\.d\/10-socket\.conf/);
  assert.match(rollback, /gate_release_present "\$dir"/);
  assert.doesNotMatch(rollback, /gate_release_present "\$dir" legacy/);
  assert.match(rollback, /universe-overlay-route-v1/);
  assert.match(rollback, /gateway socket is not active/);
});

function minimalArtifact(commit) {
  const fixture = mkdtempSync(join(tmpdir(), 'release-artifact-'));
  const stage = join(fixture, 'stage');
  const files = [
    'backend/dist/index.js',
    'backend/dist/tasks/pools/pools-v2.json',
    'backend/node_modules/@nestjs/core/package.json',
    'backend/node_modules/rust-gbt/package.json',
    'frontend/build/index.html',
    'scripts/universe/gateway.mjs',
    'production/linux/universe-explorer-gateway.socket',
    'production/linux/universe-explorer-gateway.service.d/10-socket.conf',
  ];
  for (const relative of files) {
    const path = join(stage, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{}\n');
  }
  writeFileSync(
    join(stage, 'RELEASE-MANIFEST.json'),
    `${JSON.stringify({ commit, shortCommit: commit.slice(0, 9) })}\n`,
  );
  const artifact = join(fixture, 'release.tar.gz');
  const packed = bash('tar -czf "$ARTIFACT" -C "$STAGE" .', {
    ARTIFACT: bashPath(artifact),
    STAGE: bashPath(stage),
  });
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  const summed = bash('sha256sum "$ARTIFACT" > "$ARTIFACT.sha256"', {
    ARTIFACT: bashPath(artifact),
  });
  assert.equal(summed.status, 0, summed.stdout + summed.stderr);
  return { artifact, fixture };
}

test('install promotes only a staged artifact with the exact full commit', () => {
  const commit = 'c'.repeat(40);
  const { artifact, fixture } = minimalArtifact(commit);
  const root = join(fixture, 'root');
  const result = bash(
    [
      'set -euo pipefail',
      'source scripts/universe/release.sh',
      'chown() { :; }',
      'python3() { "$TEST_PYTHON" "$@"; }',
      'cmd_install "$SHA" "$ARTIFACT"',
    ].join('\n'),
    {
      ARTIFACT: bashPath(artifact),
      SHA: commit,
      TEST_PYTHON: testPython,
      UNIVERSE_EXPLORER_ROOT: bashPath(root),
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    readFileSync(join(root, 'releases', `mempool-${commit}`, 'RELEASE-SHA'), 'utf8'),
    `${commit}\n`,
  );
  assert.deepEqual(
    readdirSync(join(root, 'releases')).filter((name) => name.startsWith('.mempool-')),
    [],
  );
});

test('install removes staging and leaves no final release on identity mismatch', () => {
  const requested = 'd'.repeat(40);
  const { artifact, fixture } = minimalArtifact('e'.repeat(40));
  const root = join(fixture, 'root');
  const result = bash(
    [
      'set -euo pipefail',
      'source scripts/universe/release.sh',
      'chown() { :; }',
      'python3() { "$TEST_PYTHON" "$@"; }',
      'cmd_install "$SHA" "$ARTIFACT"',
    ].join('\n'),
    {
      ARTIFACT: bashPath(artifact),
      SHA: requested,
      TEST_PYTHON: testPython,
      UNIVERSE_EXPLORER_ROOT: bashPath(root),
    },
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /instead of the requested commit/);
  const entries = readdirSync(join(root, 'releases'));
  assert.equal(entries.includes(`mempool-${requested}`), false);
  assert.deepEqual(
    entries.filter((name) => name.startsWith('.mempool-')),
    [],
  );
});

test('paired cutover requires the exact overlay through the new gateway', () => {
  const preflight = shellFunction('cmd_preflight');
  const live = shellFunction('verify_live');
  assert.match(cutoverFunction, /set UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA/);
  assert.match(preflight, /gate_required_overlay_direct/);
  assert.match(live, /verify_overlay_v2 "\$GATEWAY" "\$required_overlay_sha"/);
  assert.match(script, /networks\.releaseSha !== expectedSha/);
  assert.match(script, /universe-portfolio-v2-networks-v1/);
  assert.match(script, /UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA/);
});

test('gateway route writes fail closed before replacing persistent state', () => {
  const writer = shellFunction('write_gateway_overlay_route');
  const setter = shellFunction('set_gateway_portfolio_v2');
  assert.match(writer, /if ! node[\s\S]*?then[\s\S]*?return 1/);
  assert.match(writer, /mv -f "\$temp" "\$GATEWAY_ROUTE_FILE" \\\n\s*\|\|/);
  assert.match(setter, /gate_gateway_overlay_control \|\| return 1/);
});

test('paired overlay gate accepts only the required full release identity', async (t) => {
  const expected = 'f'.repeat(40);
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/v2/universe/portfolio/networks') {
      response.end(
        JSON.stringify({
          schemaVersion: 'universe-portfolio-v2-networks-v1',
          contractVersion: '2',
          releaseSha: expected,
          networks: [{ chain: 'bitcoin', network: 'mainnet' }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const port = await listen(server);
  t.after(() => server.close());
  const start = script.indexOf('verify_overlay_v2() {');
  const end = script.indexOf('\n\ngate_required_overlay_direct()', start);
  assert.ok(start >= 0 && end > start, 'verify_overlay_v2 is missing');
  const verifier = script.slice(start, end);
  const source = [
    'set -euo pipefail',
    'log() { printf "%s\\n" "$*"; }',
    verifier,
    'verify_overlay_v2 "$ORIGIN" "$SHA"',
  ].join('\n');

  let result = await bashAsync(source, {
    ORIGIN: `http://127.0.0.1:${port}`,
    SHA: expected,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /reports required overlay/);

  result = await bashAsync(source, {
    ORIGIN: `http://127.0.0.1:${port}`,
    SHA: '0'.repeat(40),
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /instead of/);
});

// --------------------------------------------- required release inputs ----

const readableProtocolGate = shellFunction('gate_readable_protocols_have_authorities');

test('the unavailable-overlay branches exit nonzero rather than skipping', () => {
  assert.doesNotMatch(readableProtocolGate, /skipping this gate/);
  assert.match(readableProtocolGate, /\['curl', '-fsS'/);
  assert.match(
    readableProtocolGate,
    /if out\.returncode != 0:[\s\S]*?sys\.exit\(1\)[\s\S]*?if not out\.stdout\.strip\(\):[\s\S]*?sys\.exit\(1\)/,
  );
});

test(
  'an unavailable overlay fails the readable-protocol authority gate',
  {
    skip: pythonAvailable ? false : 'set UNIVERSE_TEST_PYTHON to a working Python 3 interpreter',
  },
  async () => {
    const conf = mkdtempSync(join(tmpdir(), 'release-overlay-conf-'));
    writeFileSync(
      join(conf, 'overlay.env'),
      'UNIVERSE_EXPLORER_SOURCES_JSON=[{"authorityId":"first-party"}]\n',
    );

    const closed = createTcpServer();
    const port = await listen(closed);
    await new Promise((resolve) => closed.close(resolve));

    const result = bash(
      [
        'set -euo pipefail',
        'fail() { printf "FAILED: %s\\n" "$*" >&2; exit 1; }',
        'log() { printf "%s\\n" "$*"; }',
        'python3() { "$TEST_PYTHON" "$@"; }',
        readableProtocolGate,
        'gate_readable_protocols_have_authorities ignored-release',
      ].join('\n'),
      {
        CONF: conf,
        OVERLAY: `http://127.0.0.1:${port}`,
        TEST_PYTHON: testPython,
      },
    );

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /overlay protocol manifest could not be read/);
    assert.doesNotMatch(result.stdout + result.stderr, /skipping this gate/);
  },
);

// ------------------------------------------------------- safe cutover ----

const cutoverFunction = shellFunction('cmd_cutover');
const rollbackFunction = shellFunction('cmd_rollback');
const restoreCutoverPrevious = shellFunction('restore_cutover_previous');
const gatewayBaselineTree = shellFunction('gate_gateway_baseline_tree');
const validateReleaseId = shellFunction('validate_release_id');
const validateFullSha = shellFunction('validate_full_sha');

function cutoverFixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-cutover-'));
  const releases = join(root, 'releases').replaceAll('\\', '/');
  const previousSha = 'a'.repeat(40);
  const nextSha = 'b'.repeat(40);
  const previous = join(releases, `mempool-${previousSha}`).replaceAll('\\', '/');
  const next = join(releases, `mempool-${nextSha}`).replaceAll('\\', '/');
  mkdirSync(join(previous, 'scripts', 'universe'), { recursive: true });
  mkdirSync(join(next, 'scripts', 'universe'), { recursive: true });
  writeFileSync(
    join(previous, 'scripts', 'universe', 'gateway.mjs'),
    'inheritedListenerFd universe-overlay-route-v1 previous\n',
  );
  writeFileSync(
    join(next, 'scripts', 'universe', 'gateway.mjs'),
    'inheritedListenerFd universe-overlay-route-v1 next\n',
  );
  for (const [directory, releaseSha] of [
    [previous, previousSha],
    [next, nextSha],
  ]) {
    mkdirSync(join(directory, 'frontend', 'build', 'resources'), {
      recursive: true,
    });
    mkdirSync(join(directory, 'backend', 'dist'), { recursive: true });
    mkdirSync(join(directory, 'backend', 'node_modules', 'production-package'), {
      recursive: true,
    });
    writeFileSync(join(directory, 'frontend', 'build', 'index.html'), 'same frontend\n');
    writeFileSync(
      join(directory, 'frontend', 'build', 'resources', 'config.js'),
      `release=${releaseSha}\n`,
    );
    writeFileSync(join(directory, 'backend', 'dist', 'index.js'), 'same backend\n');
    writeFileSync(join(directory, 'backend', 'package-lock.json'), '{"lockfileVersion":3}\n');
    writeFileSync(
      join(directory, 'backend', 'node_modules', 'production-package', 'index.js'),
      'same dependency\n',
    );
  }

  const linkState = join(root, 'current-target.txt');
  const pendingLink = join(root, 'pending-target.txt');
  const calls = join(root, 'systemctl-calls.txt');
  const routeCalls = join(root, 'route-calls.txt');
  writeFileSync(linkState, previous);
  writeFileSync(calls, '');
  writeFileSync(routeCalls, '');
  return {
    root,
    releases,
    previousSha,
    nextSha,
    previous,
    next,
    linkState,
    pendingLink,
    calls,
    routeCalls,
  };
}

function runCutover(
  fixture,
  {
    socketActive = 'yes',
    gatewayChanged = 'yes',
    gatewayRestartFails = 'no',
    backendRestartFails = 'no',
    healthFails = 'no',
    previousPortfolio = 'true',
    requiredOverlaySha = 'f'.repeat(40),
    mode = '',
  } = {},
) {
  const source = [
    'set -euo pipefail',
    'log() { printf "%s\\n" "$*"; }',
    'fail() { printf "FAILED: %s\\n" "$*" >&2; exit 1; }',
    'release_dir() { printf "%s/mempool-%s" "$RELEASES" "$1"; }',
    'cmd_preflight() { :; }',
    'readlink() { cat "$LINK_STATE"; }',
    'cmp() {',
    '  if [[ "$1" == */scripts/universe/gateway.mjs ]]; then [ "$GATEWAY_CHANGED" = no ]; else command cmp "$@"; fi',
    '}',
    'ln() { printf "%s" "$2" > "$PENDING_LINK"; }',
    'mv() { cat "$PENDING_LINK" > "$LINK_STATE"; }',
    'systemctl() {',
    '  printf "%s | target=%s\\n" "$*" "$(cat "$LINK_STATE")" >> "$SYSTEMCTL_CALLS"',
    '  if [ "$1" = is-active ]; then [ "$SOCKET_ACTIVE" = yes ]; return; fi',
    '  if [ "$1" = restart ] && [ "$#" -eq 2 ] && [ "$2" = universe-explorer-gateway ] && [ "$GATEWAY_RESTART_FAILS" = yes ] && [ "$(cat "$LINK_STATE")" = "$FAIL_TARGET" ]; then return 1; fi',
    '  if [ "$1" = restart ] && [ "$#" -eq 2 ] && [ "$2" = universe-explorer-backend ] && [ "$BACKEND_RESTART_FAILS" = yes ] && [ "$(cat "$LINK_STATE")" = "$FAIL_TARGET" ]; then return 1; fi',
    '  return 0',
    '}',
    'wait_for() { [ "$HEALTH_FAILS" != yes ]; }',
    'verify_live() { return 0; }',
    'gateway_portfolio_v2() { printf "%s" "$PREVIOUS_PORTFOLIO"; }',
    'set_gateway_portfolio_v2() { printf "set %s %s\\n" "$1" "$2" >> "$ROUTE_CALLS"; }',
    'write_gateway_overlay_route() { printf "write %s %s\\n" "$1" "$2" >> "$ROUTE_CALLS"; }',
    'verify_gateway_overlay_route() { :; }',
    'verify_overlay_identity() { :; }',
    'verify_overlay_v2_hidden() { :; }',
    'gate_release_present() { :; }',
    'gate_manifest_exact() { :; }',
    validateReleaseId,
    validateFullSha,
    rollbackFunction,
    restoreCutoverPrevious,
    gatewayBaselineTree,
    cutoverFunction,
    `cmd_cutover ${fixture.nextSha}${mode ? ` ${mode}` : ''}`,
  ].join('\n');

  return bash(source, {
    RELEASES: fixture.releases,
    CURRENT: join(fixture.root, 'current'),
    LINK_STATE: fixture.linkState,
    PENDING_LINK: fixture.pendingLink,
    SYSTEMCTL_CALLS: fixture.calls,
    ROUTE_CALLS: fixture.routeCalls,
    SOCKET_ACTIVE: socketActive,
    GATEWAY_CHANGED: gatewayChanged,
    GATEWAY_RESTART_FAILS: gatewayRestartFails,
    BACKEND_RESTART_FAILS: backendRestartFails,
    HEALTH_FAILS: healthFails,
    PREVIOUS_PORTFOLIO: previousPortfolio,
    FAIL_TARGET: fixture.next,
    GATEWAY: 'http://127.0.0.1:8099',
    OVERLAY: 'http://127.0.0.1:3400',
    REQUIRED_OVERLAY_SHA: requiredOverlaySha,
  });
}

test('cutover refuses a missing required overlay SHA before moving the link', () => {
  const fixture = cutoverFixture();
  const result = runCutover(fixture, { requiredOverlaySha: '' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA/);
  assert.equal(readFileSync(fixture.linkState, 'utf8'), fixture.previous);
});

test('a changed gateway cannot cut over without an active socket', () => {
  const fixture = cutoverFixture();
  const result = runCutover(fixture, { socketActive: 'no' });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /gateway\.socket is not active/);
  assert.equal(readFileSync(fixture.linkState, 'utf8'), fixture.previous);
  assert.doesNotMatch(result.stdout, /current now points/);
  assert.doesNotMatch(readFileSync(fixture.calls, 'utf8'), /^restart /m);
});

test('an unchanged gateway still requires the socket before cutover', () => {
  const fixture = cutoverFixture();
  const result = runCutover(fixture, {
    socketActive: 'no',
    gatewayChanged: 'no',
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(readFileSync(fixture.linkState, 'utf8'), fixture.previous);
  assert.doesNotMatch(result.stdout, /current now points/);
});

for (const scenario of [
  { name: 'gateway restart failure', options: { gatewayRestartFails: 'yes' } },
  { name: 'backend restart failure', options: { backendRestartFails: 'yes' } },
  {
    name: 'health failure from a hidden route',
    options: { healthFails: 'yes', previousPortfolio: 'false' },
  },
]) {
  test(`a changed gateway ${scenario.name} restores the prior release and services`, () => {
    const fixture = cutoverFixture();
    const result = runCutover(fixture, scenario.options);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /rolling back/);
    assert.equal(
      readFileSync(fixture.linkState, 'utf8').replaceAll('\\', '/'),
      fixture.previous.replaceAll('\\', '/'),
    );
    const serviceRestart = readFileSync(fixture.calls, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('restart ') && line.includes(`target=${fixture.previous}`));
    assert.deepEqual(
      serviceRestart.map((line) => line.split(' | target=')[0]),
      ['restart universe-explorer-backend', 'restart universe-explorer-gateway'],
      'recovery did not restart the exact prior Explorer services in safe order',
    );
    assert.match(
      readFileSync(fixture.routeCalls, 'utf8'),
      new RegExp(`write ${'f'.repeat(40)} ${scenario.options.previousPortfolio ?? 'true'}`),
    );
  });
}

test('Explorer cutover never restarts the independently released overlay', () => {
  const fixture = cutoverFixture();
  const result = runCutover(fixture);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(
    readFileSync(fixture.calls, 'utf8'),
    /restart[^\n]*universe-explorer-overlay/,
  );
});

test('forward exposes v2 first and rollback hides it only after the target is proven', () => {
  const forwardRoute = cutoverFunction.indexOf(
    'set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" true',
  );
  const forwardLink = cutoverFunction.indexOf('ln -sfn "$dir" "$CURRENT.new"');
  const rollbackRoute = rollbackFunction.indexOf(
    'set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" false',
  );
  const rollbackLink = rollbackFunction.indexOf('ln -sfn "$dir" "$CURRENT.new"');
  const rollbackVerify = rollbackFunction.indexOf('verify_live "$dir" "$verify_overlay_sha"');
  assert.ok(forwardRoute >= 0 && forwardLink > forwardRoute);
  assert.ok(rollbackLink >= 0 && rollbackVerify > rollbackLink && rollbackRoute > rollbackVerify);
  assert.doesNotMatch(restoreCutoverPrevious, /cmd_rollback/);
  assert.match(
    restoreCutoverPrevious,
    /write_gateway_overlay_route "\$REQUIRED_OVERLAY_SHA" "\$previous_portfolio"/,
  );
});

function runRollback(fixture, { failTargetVerification = 'no', previousPortfolio = 'true' } = {}) {
  writeFileSync(fixture.linkState, fixture.next);
  const failedVerification = join(fixture.root, 'failed-verification.txt');
  const source = [
    'set -euo pipefail',
    'log() { printf "%s\\n" "$*"; }',
    'fail() { printf "FAILED: %s\\n" "$*" >&2; exit 1; }',
    'release_dir() { printf "%s/mempool-%s" "$RELEASES" "$1"; }',
    'readlink() { cat "$LINK_STATE"; }',
    'ln() { printf "%s" "$2" > "$PENDING_LINK"; }',
    'mv() { cat "$PENDING_LINK" > "$LINK_STATE"; }',
    'systemctl() {',
    '  printf "%s | target=%s\\n" "$*" "$(cat "$LINK_STATE")" >> "$SYSTEMCTL_CALLS"',
    '  if [ "$1" = is-active ]; then return 0; fi',
    '  return 0',
    '}',
    'wait_for() { return 0; }',
    'verify_live() {',
    '  printf "verify %s %s\\n" "$1" "$2" >> "$ROUTE_CALLS"',
    '  if [ "$FAIL_TARGET_VERIFICATION" = yes ] && [ "$1" = "$ROLLBACK_TARGET" ] && [ ! -f "$FAILED_VERIFICATION" ]; then',
    '    : > "$FAILED_VERIFICATION"',
    '    return 1',
    '  fi',
    '  return 0',
    '}',
    'gateway_portfolio_v2() { printf "%s" "$PREVIOUS_PORTFOLIO"; }',
    'set_gateway_portfolio_v2() { printf "set %s %s\\n" "$1" "$2" >> "$ROUTE_CALLS"; }',
    'write_gateway_overlay_route() { printf "write %s %s\\n" "$1" "$2" >> "$ROUTE_CALLS"; }',
    'verify_gateway_overlay_route() { return 0; }',
    'verify_overlay_identity() { return 0; }',
    'verify_overlay_v2_hidden() { return 0; }',
    'gate_release_present() { return 0; }',
    'gate_manifest_exact() { return 0; }',
    validateReleaseId,
    validateFullSha,
    restoreCutoverPrevious,
    rollbackFunction,
    `cmd_rollback ${fixture.previousSha}`,
  ].join('\n');

  return bash(source, {
    RELEASES: fixture.releases,
    CURRENT: join(fixture.root, 'current'),
    LINK_STATE: fixture.linkState,
    PENDING_LINK: fixture.pendingLink,
    SYSTEMCTL_CALLS: fixture.calls,
    ROUTE_CALLS: fixture.routeCalls,
    FAIL_TARGET_VERIFICATION: failTargetVerification,
    FAILED_VERIFICATION: failedVerification,
    ROLLBACK_TARGET: fixture.previous,
    PREVIOUS_PORTFOLIO: previousPortfolio,
    GATEWAY: 'http://127.0.0.1:8099',
    OVERLAY: 'http://127.0.0.1:3400',
    REQUIRED_OVERLAY_SHA: 'f'.repeat(40),
  });
}

test('rollback preserves v2 until the rollback Explorer is healthy', () => {
  const fixture = cutoverFixture();
  const result = runRollback(fixture);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(fixture.linkState, 'utf8').replaceAll('\\', '/'), fixture.previous);
  const events = readFileSync(fixture.routeCalls, 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(events, [
    `verify ${fixture.previous} ${'f'.repeat(40)}`,
    `set ${'f'.repeat(40)} false`,
  ]);
  const restarts = readFileSync(fixture.calls, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith('restart '));
  assert.deepEqual(
    restarts.map((line) => line.split(' | target=')[0]),
    ['restart universe-explorer-backend', 'restart universe-explorer-gateway'],
  );
});

test('a failed rollback target restores the exact prior tree and v2 state', () => {
  const fixture = cutoverFixture();
  const result = runRollback(fixture, { failTargetVerification: 'yes' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(readFileSync(fixture.linkState, 'utf8').replaceAll('\\', '/'), fixture.next);
  const events = readFileSync(fixture.routeCalls, 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(events, [
    `verify ${fixture.previous} ${'f'.repeat(40)}`,
    `write ${'f'.repeat(40)} true`,
    `verify ${fixture.next} ${'f'.repeat(40)}`,
  ]);
  assert.doesNotMatch(readFileSync(fixture.routeCalls, 'utf8'), /^set .* false$/m);
});

test('first migration admits only unchanged behavior and enables control after gateway health', () => {
  const restart = cutoverFunction.indexOf('systemctl restart universe-explorer-gateway');
  const healthy = cutoverFunction.indexOf('wait_for "$GATEWAY/__gateway/health" gateway', restart);
  const establish = cutoverFunction.indexOf(
    'set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" false',
    healthy,
  );
  assert.match(cutoverFunction, /mode.*--gateway-baseline/);
  assert.match(
    gatewayBaselineTree,
    /expected="Files \$previous\/frontend\/build\/resources\/config\.js and \$target\/frontend\/build\/resources\/config\.js differ"/,
  );
  assert.match(
    gatewayBaselineTree,
    /diff -qr "\$previous\/backend\/dist" "\$target\/backend\/dist"/,
  );
  assert.match(gatewayBaselineTree, /cmp -s "\$previous\/backend\/package-lock\.json"/);
  assert.match(gatewayBaselineTree, /diff -qr "\$previous\/backend\/node_modules"/);
  assert.match(cutoverFunction, /gate_gateway_baseline_tree "\$previous" "\$dir"/);
  assert.match(
    cutoverFunction,
    /gateway baseline target does not implement dynamic overlay routing/,
  );
  assert.ok(restart >= 0 && healthy > restart && establish > healthy);
});

test('gateway baseline permits only the commit marker to differ in an otherwise unchanged release', () => {
  const fixture = cutoverFixture();
  const result = runCutover(fixture, { mode: '--gateway-baseline' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(fixture.linkState, 'utf8').replaceAll('\\', '/'), fixture.next);
});

test('gateway baseline rejects a backend behavior change before moving the link', () => {
  const fixture = cutoverFixture();
  writeFileSync(join(fixture.next, 'backend', 'dist', 'index.js'), 'changed backend\n');
  const result = runCutover(fixture, { mode: '--gateway-baseline' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /gateway baseline target changes backend behavior/);
  assert.equal(readFileSync(fixture.linkState, 'utf8').replaceAll('\\', '/'), fixture.previous);
});

test('preflight, current-tree gates, and rollback use full exact release identities', () => {
  assert.match(shellFunction('cmd_preflight'), /validate_full_sha "\$sha"/);
  assert.match(cutoverFunction, /validate_full_sha "\$previous_sha"/);
  assert.match(cutoverFunction, /gate_manifest_exact "\$previous" "\$previous_sha"/);
  assert.match(rollbackFunction, /validate_full_sha "\$sha"/);
  assert.match(rollbackFunction, /gate_manifest_exact "\$dir" "\$sha"/);
  assert.match(rollbackFunction, /gate_release_present "\$previous"/);
  assert.match(rollbackFunction, /gate_manifest_exact "\$previous" "\$previous_sha"/);
});

test('all Explorer release commands share the deployment lock with the overlay tool', () => {
  const lock = shellFunction('acquire_deploy_lock');
  const main = script.slice(script.indexOf('if [ "${BASH_SOURCE[0]}" = "$0" ]'));
  assert.match(script, /DEPLOY_LOCK=.*universe-explorer-deploy\.lock/);
  assert.match(lock, /command -v flock/);
  assert.match(lock, /flock -n 9/);
  assert.ok(main.indexOf('acquire_deploy_lock') < main.indexOf('case "${1:-}"'));
});

// -------------------------------------------- legacy rollback support ----

const liveAddressPython = pythonFromHeredoc('PYADDRESS');

test('legacy address metadata is guarded before backendKind is read', () => {
  assert.match(
    liveAddressPython,
    /if address is not None and address\.get\('backendKind'\) == 'esplora':/,
  );
});

test(
  'legacy capabilities without address metadata use functional address checks',
  {
    skip: pythonAvailable ? false : 'set UNIVERSE_TEST_PYTHON to a working Python 3 interpreter',
  },
  async (t) => {
    const probe = '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';
    const stats = {
      funded_txo_count: 1,
      funded_txo_sum: 1,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 1,
    };
    let backendAddressHits = 0;
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/v1/capabilities') {
        response.end(JSON.stringify({ features: {} }));
      } else if (request.url === `/api/address/${probe}/txs`) {
        response.end(JSON.stringify([{ txid: 'a'.repeat(64) }]));
      } else if (request.url === `/api/address/${probe}/utxo`) {
        response.end('[]');
      } else if (request.url === `/api/address/${probe}`) {
        response.end(
          JSON.stringify({
            address: probe,
            chain_stats: stats,
            mempool_stats: stats,
          }),
        );
      } else {
        if (request.url?.startsWith('/api/v1/address/')) backendAddressHits++;
        response.statusCode = 404;
        response.end('{}');
      }
    });
    const port = await listen(server);
    t.after(() => server.close());
    const base = `http://127.0.0.1:${port}`;

    const result = await runPython(liveAddressPython, [base, base, probe]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /predates the address capability/);
    assert.match(result.stdout, /summary, history and UTXOs/);
    assert.equal(backendAddressHits, 0);
  },
);

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
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
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
    const result = await runWaitFor(`http://127.0.0.1:${port}/health`, {
      WAIT_FOR_SECONDS: '1',
    });
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
  const server = createTcpServer(() => {
    /* accept and hold */
  });
  const port = await listen(server);
  try {
    const result = await runWaitFor(`http://127.0.0.1:${port}/health`, {
      WAIT_FOR_SECONDS: '1',
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /last observed state: no HTTP response/);
  } finally {
    server.close();
  }
});
