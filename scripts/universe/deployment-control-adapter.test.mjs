/**
 * The deployment adapter with the release tooling stubbed: request
 * verification, journal derivation and the job lifecycle around a cutover
 * that passes, one that fails, and a rollback whose target is the journal's.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appendJournal, createAdapter, deriveRollbackTarget, readJournal, sign } from './deployment-control-adapter.mjs';

const KEY = 'k'.repeat(48);
const TARGET = 'explorer/test-host';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

function harness({ journal = [], current = NEW, release = async () => ({ code: 0, lines: ['cutover complete'] }) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deployment-adapter-'));
  const journalPath = join(dir, 'journal.json');
  writeFileSync(journalPath, JSON.stringify(journal));
  let serving = current;
  const calls = [];
  let clock = Date.parse('2026-09-17T12:00:00.000Z');
  let ids = 0;
  const adapter = createAdapter({
    key: KEY,
    target: TARGET,
    journalPath,
    currentRelease: () => serving,
    runRelease: async (args, timeoutMs) => { calls.push(args); const outcome = await release(args, timeoutMs); if (outcome.serving !== undefined) { serving = outcome.serving; } return outcome; },
    now: () => (clock += 1000),
    nextJobId: () => `job-${++ids}`,
  });
  const request = (method, path, body = '') => adapter.handle(method, path, body, sign(KEY, method, path, body));
  return { adapter, request, calls, journalPath, setServing: (sha) => { serving = sha; } };
}

test('refuses requests whose signature does not verify', () => {
  const { adapter, request } = harness();
  assert.equal(adapter.handle('GET', '/capabilities', '', undefined).status, 401);
  assert.equal(adapter.handle('GET', '/capabilities', '', sign('x'.repeat(48), 'GET', '/capabilities', '')).status, 401);
  assert.equal(adapter.handle('GET', '/capabilities', '', sign(KEY, 'POST', '/capabilities', '')).status, 401);
  const body = JSON.stringify({ operationId: 'op', idempotencyKey: 'k', target: TARGET });
  assert.equal(adapter.handle('POST', '/restart', body.replace('op', 'other'), sign(KEY, 'POST', '/restart', body)).status, 401);
  assert.equal(request('GET', '/capabilities').status, 200);
});

test('derives the rollback target from the journal, never from the request', () => {
  const journal = [
    { release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'cutover' },
    { release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' },
  ];
  assert.equal(deriveRollbackTarget(journal, NEW).release, OLD);
  assert.equal(deriveRollbackTarget(journal, OLD).release, NEW);
  assert.equal(deriveRollbackTarget([journal[1]], NEW), null);
  assert.equal(deriveRollbackTarget([], NEW), null);
});

test('capabilities report the fixed target, the current release and what the journal allows', () => {
  const empty = harness();
  const caps = empty.request('GET', '/capabilities').body;
  assert.equal(caps.application, 'explorer');
  assert.equal(caps.target, TARGET);
  assert.equal(caps.currentRelease, NEW);
  assert.deepEqual(caps.supports, { restart: true, rollback: false });
  assert.match(caps.reasons.rollback, /no verified release/);

  const none = harness({ current: null });
  assert.deepEqual(none.request('GET', '/capabilities').body.supports, { restart: false, rollback: false });

  const withJournal = harness({ journal: [{ release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'record' }] });
  assert.deepEqual(withJournal.request('GET', '/capabilities').body.supports, { restart: true, rollback: true });
});

test('a restart runs the health-checked cutover of the current release and journals the verified result', async () => {
  const h = harness();
  const body = JSON.stringify({ operationId: 'run-1', idempotencyKey: 'idem-1', target: TARGET });
  const accepted = h.request('POST', '/restart', body);
  assert.equal(accepted.status, 202);
  assert.deepEqual(accepted.body, { jobId: 'job-1', state: 'running', replayed: false });
  await h.adapter.whenIdle();
  assert.deepEqual(h.calls, [['cutover', NEW]]);
  const job = h.request('GET', '/jobs/job-1').body;
  assert.equal(job.state, 'succeeded');
  assert.equal(job.releaseBefore, NEW);
  assert.equal(job.releaseAfter, NEW);
  assert.deepEqual(job.evidence, ['cutover complete']);
  assert.equal(job.operationId, undefined);
  const journal = readJournal(h.journalPath);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].release, NEW);
  assert.equal(journal[0].operation, 'cutover');
});

test('the same idempotency key replays the job instead of running a second cutover', async () => {
  const h = harness();
  const body = JSON.stringify({ operationId: 'run-1', idempotencyKey: 'idem-1', target: TARGET });
  assert.equal(h.request('POST', '/restart', body).body.replayed, false);
  const again = h.request('POST', '/restart', body);
  assert.equal(again.status, 202);
  assert.equal(again.body.jobId, 'job-1');
  assert.equal(again.body.replayed, true);
  await h.adapter.whenIdle();
  assert.equal(h.calls.length, 1);
});

test('a failed release tool leaves the journal alone and reports the failure', async () => {
  const h = harness({ release: async () => ({ code: 1, lines: ['FAILED: cutover verification failed', 'rolling back'] }) });
  h.request('POST', '/restart', JSON.stringify({ operationId: 'run-2', idempotencyKey: 'idem-2', target: TARGET }));
  await h.adapter.whenIdle();
  const job = h.request('GET', '/jobs/job-1').body;
  assert.equal(job.state, 'failed');
  assert.match(job.error, /exited 1/);
  assert.deepEqual(readJournal(h.journalPath), []);
});

test('a rollback accepts only the journal target and records the release that came back', async () => {
  const h = harness({
    journal: [{ release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'cutover' }, { release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' }],
    release: async () => ({ code: 0, lines: ['rolled back'], serving: OLD }),
  });
  const wrong = h.request('POST', '/rollback', JSON.stringify({ operationId: 'run-3', idempotencyKey: 'idem-3', target: TARGET, release: 'c'.repeat(40) }));
  assert.equal(wrong.status, 409);
  assert.match(wrong.body.error, /never a rollback target/);
  const sameAsCurrent = h.request('POST', '/rollback', JSON.stringify({ operationId: 'run-3', idempotencyKey: 'idem-3', target: TARGET, release: NEW }));
  assert.equal(sameAsCurrent.status, 409);
  const accepted = h.request('POST', '/rollback', JSON.stringify({ operationId: 'run-3', idempotencyKey: 'idem-3', target: TARGET, release: OLD }));
  assert.equal(accepted.status, 202);
  await h.adapter.whenIdle();
  assert.deepEqual(h.calls, [['rollback', OLD]]);
  const job = h.request('GET', `/jobs/${accepted.body.jobId}`).body;
  assert.equal(job.state, 'succeeded');
  assert.equal(job.releaseBefore, NEW);
  assert.equal(job.releaseAfter, OLD);
  assert.equal(job.requestedRelease, OLD);
  const journal = readJournal(h.journalPath);
  assert.equal(journal[journal.length - 1].release, OLD);
  assert.equal(journal[journal.length - 1].operation, 'rollback');
});

test('rejects a wrong target, missing identifiers, unknown routes and a second concurrent job', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ release: async () => { await gate; return { code: 0, lines: [] }; } });
  assert.equal(h.request('POST', '/restart', JSON.stringify({ operationId: 'x', idempotencyKey: 'y', target: 'explorer/other' })).status, 400);
  assert.equal(h.request('POST', '/restart', JSON.stringify({ target: TARGET })).status, 400);
  assert.equal(h.request('POST', '/restart', 'not json').status, 400);
  assert.equal(h.request('GET', '/jobs/nope').status, 404);
  assert.equal(h.request('DELETE', '/capabilities').status, 404);
  assert.equal(h.request('POST', '/restart', JSON.stringify({ operationId: 'a', idempotencyKey: 'a', target: TARGET })).status, 202);
  const busy = h.request('POST', '/restart', JSON.stringify({ operationId: 'b', idempotencyKey: 'b', target: TARGET }));
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /still running/);
  release();
  await h.adapter.whenIdle();
});

test('the journal file is appended atomically and bounded to verified entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deployment-journal-'));
  const path = join(dir, 'journal.json');
  appendJournal(path, { release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'record' });
  appendJournal(path, { release: NEW, verifiedAt: '2026-09-15T00:00:00.000Z', operation: 'cutover' });
  assert.equal(readJournal(path).length, 2);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).length, 2);
  writeFileSync(path, JSON.stringify([{ release: 'not-a-sha', verifiedAt: 'x', operation: 'cutover' }, { release: OLD, verifiedAt: '2026-09-10T00:00:00.000Z', operation: 'cutover' }]));
  assert.equal(readJournal(path).length, 1);
});
