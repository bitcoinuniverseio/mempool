#!/usr/bin/env node
/**
 * The owned deployment adapter the Explorer's Control Center operations talk to.
 *
 * A backend cannot restart or roll back itself: the process that would do it
 * is the one being replaced. This is the small host-side service that does it
 * instead, and it does nothing the release tooling does not already do. A
 * restart is `release.sh cutover <current sha>`: the gates, the symlink, the
 * unit restarts and the live verification, on the release already serving. A
 * rollback is `release.sh rollback <sha>` where the sha is the previous
 * verified release in this adapter's own journal. There is no raw process
 * exit anywhere, and no request field can name a unit, a path or a command.
 *
 * Contract, all JSON, every request signed:
 *
 *   GET  /capabilities        { application, target, currentRelease, journal, supports, reasons, adapterVersion, observedAt }
 *   POST /restart             { operationId, idempotencyKey, target }            -> 202 { jobId, state, replayed }
 *   POST /rollback            { operationId, idempotencyKey, target, release }   -> 202 { jobId, state, replayed }
 *   GET  /jobs/:jobId         { jobId, operation, state, target, releaseBefore, releaseAfter, requestedRelease, startedAt, finishedAt, error, evidence }
 *
 *   X-Deployment-Signature: sha256=<hex HMAC-SHA256(key, method + "\n" + path + "\n" + body)>
 *
 * The journal is a JSON file of { release, verifiedAt, operation } entries.
 * The adapter appends to it when a cutover or rollback it ran passes the
 * release tooling's live verification, and `record <sha>` appends an entry
 * for a cutover run by hand. A release that was never verified is never a
 * rollback target.
 *
 * Usage:
 *   deployment-control-adapter.mjs serve
 *   deployment-control-adapter.mjs record <sha>
 *
 * Environment:
 *   EXPLORER_DEPLOYMENT_CONTROL_KEY       shared HMAC key, at least 32 characters (required)
 *   EXPLORER_DEPLOYMENT_CONTROL_LISTEN    127.0.0.1:8790 (default) or an absolute unix socket path
 *   EXPLORER_DEPLOYMENT_ROOT              /opt/universe-explorer (default)
 *   EXPLORER_DEPLOYMENT_JOURNAL           $ROOT/promotion-journal.json (default)
 *   EXPLORER_DEPLOYMENT_TARGET            fixed target identity; default explorer/<hostname>
 *   EXPLORER_DEPLOYMENT_RELEASE_TOOL      $ROOT/current/scripts/universe/release.sh (default)
 *   EXPLORER_DEPLOYMENT_JOB_TIMEOUT_MS    900000 (default)
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ADAPTER_VERSION = 'deployment-control-adapter/1';
export const SIGNATURE_HEADER = 'x-deployment-signature';
const RELEASE_SHA = /^[0-9a-f]{7,64}$/;
const BODY_LIMIT = 16 * 1024;
const JOURNAL_LIMIT = 500;
const JOBS_LIMIT = 200;
const EVIDENCE_LINES = 40;

export function sign(key, method, path, body) {
  return 'sha256=' + createHmac('sha256', key).update(`${method.toUpperCase()}\n${path}\n${body}`).digest('hex');
}

export function verifySignature(key, method, path, body, header) {
  const expected = Buffer.from(sign(key, method, path, body));
  const presented = Buffer.from(String(header ?? ''));
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

export function readJournal(path) {
  if (!existsSync(path)) { return []; }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) { throw new Error(`journal at ${path} is not a list`); }
  return parsed.filter((entry) => entry && RELEASE_SHA.test(String(entry.release)) && typeof entry.verifiedAt === 'string' && ['cutover', 'rollback', 'record'].includes(entry.operation));
}

export function appendJournal(path, entry) {
  const journal = [...readJournal(path), entry].slice(-JOURNAL_LIMIT);
  const temporary = path + '.new';
  writeFileSync(temporary, JSON.stringify(journal, null, 2) + '\n');
  renameSync(temporary, path);
  return journal;
}

/** The previous verified release: newest journal entry that is not the one serving now. */
export function deriveRollbackTarget(journal, currentRelease) {
  const ordered = [...journal].sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt));
  return ordered.find((entry) => entry.release !== currentRelease) ?? null;
}

/** The sha the `current` symlink points at, from its directory name mempool-<sha>. */
export function readCurrentRelease(root) {
  try {
    const name = basename(readlinkSync(join(root, 'current')));
    const sha = name.replace(/^mempool-/, '');
    return RELEASE_SHA.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Runs the release tool with fixed arguments; never a shell, never a caller-supplied argument. */
export function spawnReleaseTool(tool, args, timeoutMs) {
  return new Promise((resolve) => {
    const lines = [];
    const child = spawn('bash', [tool, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) { lines.push(line.slice(0, 500)); if (lines.length > EVIDENCE_LINES) { lines.shift(); } }
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => { lines.push(`adapter: release tool exceeded ${timeoutMs} ms and was terminated`); child.kill('SIGTERM'); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, lines: [...lines, 'adapter: ' + error.message] }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, lines }); });
  });
}

/**
 * The adapter's behaviour with its side effects injectable, so the request
 * verification, journal derivation and job lifecycle can be tested with the
 * release tooling stubbed.
 */
export function createAdapter(options) {
  const {
    key,
    target,
    journalPath,
    runRelease,
    currentRelease,
    now = () => Date.now(),
    jobTimeoutMs = 900_000,
    nextJobId = () => randomUUID(),
  } = options;
  if (typeof key !== 'string' || key.length < 32) { throw new Error('EXPLORER_DEPLOYMENT_CONTROL_KEY must be at least 32 characters'); }
  const jobs = new Map();
  const byIdempotencyKey = new Map();
  let active = null;

  const capabilities = () => {
    const current = currentRelease();
    const journal = readJournal(journalPath);
    const rollbackTarget = deriveRollbackTarget(journal, current);
    return {
      application: 'explorer',
      target,
      currentRelease: current,
      journal,
      supports: { restart: current !== null, rollback: current !== null && rollbackTarget !== null },
      reasons: {
        restart: current === null ? 'No current release: the current symlink does not name a mempool-<sha> release directory.' : null,
        rollback: current === null ? 'No current release.' : rollbackTarget === null ? 'The journal holds no verified release other than the one serving.' : null,
      },
      adapterVersion: ADAPTER_VERSION,
      observedAt: new Date(now()).toISOString(),
    };
  };

  const remember = (job) => {
    jobs.set(job.jobId, job);
    if (jobs.size > JOBS_LIMIT) { jobs.delete(jobs.keys().next().value); }
  };

  const run = async (job, args) => {
    job.state = 'running';
    job.startedAt = new Date(now()).toISOString();
    const outcome = await runRelease(args, jobTimeoutMs);
    job.evidence = outcome.lines;
    job.finishedAt = new Date(now()).toISOString();
    const after = currentRelease();
    job.releaseAfter = after;
    if (outcome.code === 0 && after !== null) {
      job.state = 'succeeded';
      appendJournal(journalPath, { release: after, verifiedAt: job.finishedAt, operation: job.operation === 'restart' ? 'cutover' : 'rollback' });
    } else {
      job.state = 'failed';
      job.error = outcome.code === 0 ? 'the release tool exited 0 but no current release could be read' : `the release tool exited ${outcome.code ?? 'without a code'}`;
    }
    active = null;
  };

  const submit = (operation, body) => {
    const errors = [];
    if (typeof body?.operationId !== 'string' || !body.operationId || body.operationId.length > 128) { errors.push('operationId is required'); }
    if (typeof body?.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 200) { errors.push('idempotencyKey is required'); }
    if (body?.target !== target) { errors.push(`target must be ${target}`); }
    if (errors.length) { return { status: 400, body: { error: errors.join('; ') } }; }
    const replay = byIdempotencyKey.get(`${operation}:${body.idempotencyKey}`);
    if (replay && jobs.has(replay)) {
      const job = jobs.get(replay);
      return { status: 202, body: { jobId: job.jobId, state: job.state, replayed: true } };
    }
    const caps = capabilities();
    if (!caps.supports[operation]) { return { status: 409, body: { error: caps.reasons[operation] ?? `${operation} is not supported` } }; }
    let args;
    let requestedRelease = null;
    if (operation === 'restart') {
      args = ['cutover', caps.currentRelease];
    } else {
      const journalTarget = deriveRollbackTarget(caps.journal, caps.currentRelease);
      if (body.release !== journalTarget.release) {
        return { status: 409, body: { error: `release must be the previous verified release in the journal (${journalTarget.release}); a release not in the journal is never a rollback target` } };
      }
      requestedRelease = journalTarget.release;
      args = ['rollback', journalTarget.release];
    }
    if (active) { return { status: 409, body: { error: `job ${active} is still running` } }; }
    const job = {
      jobId: nextJobId(), operation, state: 'queued', target, releaseBefore: caps.currentRelease, releaseAfter: null, requestedRelease,
      startedAt: null, finishedAt: null, error: null, evidence: [], operationId: body.operationId,
    };
    remember(job);
    byIdempotencyKey.set(`${operation}:${body.idempotencyKey}`, job.jobId);
    if (byIdempotencyKey.size > JOBS_LIMIT) { byIdempotencyKey.delete(byIdempotencyKey.keys().next().value); }
    active = job.jobId;
    job.promise = run(job, args).catch((error) => { job.state = 'failed'; job.error = error.message; job.finishedAt = new Date(now()).toISOString(); active = null; });
    return { status: 202, body: { jobId: job.jobId, state: job.state, replayed: false } };
  };

  const view = (job) => {
    const { promise, operationId, ...rest } = job;
    void promise; void operationId;
    return rest;
  };

  /** One request, already read: returns { status, body }. */
  const handle = (method, path, body, signature) => {
    if (!verifySignature(key, method, path, body, signature)) { return { status: 401, body: { error: 'signature does not verify' } }; }
    let parsed = null;
    if (body) {
      try { parsed = JSON.parse(body); } catch { return { status: 400, body: { error: 'body is not JSON' } }; }
    }
    if (method === 'GET' && path === '/capabilities') { return { status: 200, body: capabilities() }; }
    if (method === 'POST' && (path === '/restart' || path === '/rollback')) { return submit(path.slice(1), parsed); }
    const jobMatch = /^\/jobs\/([A-Za-z0-9_-]{1,128})$/.exec(path);
    if (method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job ? { status: 200, body: view(job) } : { status: 404, body: { error: 'no such job' } };
    }
    return { status: 404, body: { error: 'no such route' } };
  };

  return { handle, capabilities, jobs, whenIdle: async () => { for (const job of jobs.values()) { await job.promise; } } };
}

export function serve(adapter, listen) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) { request.destroy(); }
      else { chunks.push(chunk); }
    });
    request.on('end', () => {
      const path = (request.url ?? '/').split('?')[0];
      const body = Buffer.concat(chunks).toString('utf8');
      const answer = adapter.handle(request.method ?? 'GET', path, body, request.headers[SIGNATURE_HEADER]);
      const text = JSON.stringify(answer.body);
      response.writeHead(answer.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      response.end(text);
    });
  });
  if (listen.startsWith('/')) {
    server.listen(listen);
  } else {
    const [host, port] = listen.split(':');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) { throw new Error('EXPLORER_DEPLOYMENT_CONTROL_LISTEN must be loopback or a unix socket path'); }
    server.listen(Number(port), host);
  }
  return server;
}

function main(argv, env) {
  const root = env.EXPLORER_DEPLOYMENT_ROOT || '/opt/universe-explorer';
  const journalPath = env.EXPLORER_DEPLOYMENT_JOURNAL || join(root, 'promotion-journal.json');
  const command = argv[2];
  if (command === 'record') {
    const sha = String(argv[3] ?? '');
    if (!RELEASE_SHA.test(sha)) { throw new Error('usage: deployment-control-adapter.mjs record <sha>'); }
    const journal = appendJournal(journalPath, { release: sha, verifiedAt: new Date().toISOString(), operation: 'record' });
    console.log(`recorded ${sha}; journal holds ${journal.length} entries`);
    return;
  }
  if (command !== 'serve') { throw new Error('usage: deployment-control-adapter.mjs {serve|record <sha>}'); }
  const tool = env.EXPLORER_DEPLOYMENT_RELEASE_TOOL || join(root, 'current', 'scripts', 'universe', 'release.sh');
  const adapter = createAdapter({
    key: env.EXPLORER_DEPLOYMENT_CONTROL_KEY ?? '',
    target: env.EXPLORER_DEPLOYMENT_TARGET || `explorer/${hostname()}`,
    journalPath,
    currentRelease: () => readCurrentRelease(root),
    runRelease: (args, timeoutMs) => spawnReleaseTool(tool, args, timeoutMs),
    jobTimeoutMs: Number(env.EXPLORER_DEPLOYMENT_JOB_TIMEOUT_MS || 900_000),
  });
  const listen = env.EXPLORER_DEPLOYMENT_CONTROL_LISTEN || '127.0.0.1:8790';
  serve(adapter, listen);
  console.log(`${ADAPTER_VERSION} listening on ${listen}; root ${root}; journal ${journalPath}; tool ${tool}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv, process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
