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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  assert.match(script, /dependencies_changed=yes/);
  assert.match(script, /npm ci --omit=dev/);
  assert.match(artifactWorkflow, /git archive HEAD backend\/vendor rust\/gbt/);
  assert.match(artifactWorkflow, /stage\/rust\/gbt\/Cargo\.toml/);
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
