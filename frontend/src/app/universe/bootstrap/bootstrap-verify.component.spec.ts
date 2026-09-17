import { ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOTSTRAP_VERIFY_MAX_POLLS, BOOTSTRAP_VERIFY_POLL_MS, BootstrapVerifyComponent } from './bootstrap-verify.component';
import { BootstrapApiService, NodeBootstrapVerification } from './bootstrap.service';

const check = (status: NodeBootstrapVerification['checks']['sha256']['status'], extra: Partial<NodeBootstrapVerification['checks']['sha256']> = {}) => ({ status, ...extra });

function run(state: NodeBootstrapVerification['state'], overrides: Partial<NodeBootstrapVerification> = {}): NodeBootstrapVerification {
  const pending = state === 'pending' || state === 'verifying';
  return {
    verification_id: 'run-1',
    snapshot_id: 'signet-10',
    network: 'signet',
    state,
    valid: state === 'valid',
    status: state,
    requested_at: '2026-09-17T00:00:00.000Z',
    checks: {
      file_size: check(pending ? 'pending' : 'valid', { expected: 10, observed: pending ? null : 10 }),
      sha256: check(pending ? 'pending' : 'valid'),
      manifest_signature: check(pending ? 'pending' : 'valid'),
      network_magic: check(pending ? 'pending' : 'valid'),
      base_block_hash: check(pending ? 'pending' : 'valid'),
      base_height: check(pending ? 'pending' : 'valid'),
      coins_count: check(pending ? 'pending' : 'not-evaluated', { reason: 'No coin count is pinned.' }),
      utxo_commitment: check(pending ? 'pending' : state === 'invalid' ? 'invalid' : 'valid', state === 'invalid' ? { expected: 'aa', observed: 'bb', reason: 'hash_serialized_3 differs from the pinned commitment.' } : {}),
    },
    evidence: { source_kind: 'file', source_ref: 'utxo-10.dat', bytes_read: pending ? 0 : 10, header_format: null, snapshot_version: null, core_node_id: null, core_block_hash_at_height: null, pinned_commitment_source: null },
    checkpoints: [],
    caller_inputs: { sha256: 'ab'.repeat(32), utxo_hash: null, height: 10, matched: pending ? null : true },
    details: pending ? 'queued' : 'done',
    ...overrides,
  };
}

function component(api: Partial<BootstrapApiService>): BootstrapVerifyComponent {
  const c = new BootstrapVerifyComponent({ network: 'signet', networkChanged$: new BehaviorSubject('signet'), ...api } as unknown as BootstrapApiService, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef);
  c.snapshotHeight = 10;
  c.computedSha256 = 'ab'.repeat(32);
  return c;
}

describe('bootstrap verification runs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends only the given inputs and renders a run that is already terminal without polling', () => {
    const verifySnapshotChecksum$ = vi.fn(() => of(run('valid')));
    const getVerification$ = vi.fn();
    const c = component({ verifySnapshotChecksum$, getVerification$ });
    c.verifyChecksum();
    expect(verifySnapshotChecksum$).toHaveBeenCalledWith({ height: 10, sha256: 'ab'.repeat(32) });
    expect(c.report?.state).toBe('valid');
    expect(c.polling).toBe(false);
    expect(c.failure).toBeNull();
    expect(c.checks(c.report!).map((x) => x.name)).toEqual(['file_size', 'sha256', 'manifest_signature', 'network_magic', 'base_block_hash', 'base_height', 'coins_count', 'utxo_commitment']);
    expect(c.checks(c.report!).find((x) => x.name === 'coins_count')?.check.status).toBe('not-evaluated');
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS * 3);
    expect(getVerification$).not.toHaveBeenCalled();
  });

  it('polls a pending run until it is valid and stops', () => {
    const getVerification$ = vi.fn()
      .mockReturnValueOnce(of(run('verifying')))
      .mockReturnValueOnce(of(run('valid')));
    const c = component({ verifySnapshotChecksum$: () => of(run('pending')), getVerification$ });
    c.verifyChecksum();
    expect(c.report?.state).toBe('pending');
    expect(c.polling).toBe(true);
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(c.report?.state).toBe('verifying');
    expect(c.polling).toBe(true);
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(c.report?.state).toBe('valid');
    expect(c.polling).toBe(false);
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS * 5);
    expect(getVerification$).toHaveBeenCalledTimes(2);
    expect(getVerification$).toHaveBeenCalledWith('run-1');
  });

  it('renders an invalid outcome with the failing check and never as valid', () => {
    const c = component({ verifySnapshotChecksum$: () => of(run('pending')), getVerification$: () => of(run('invalid')) });
    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(c.report?.state).toBe('invalid');
    expect(c.report?.valid).toBe(false);
    expect(c.stateClass('invalid')).toBe('alert-danger');
    expect(c.checks(c.report!).find((x) => x.name === 'utxo_commitment')?.check.reason).toContain('pinned commitment');
    expect(c.polling).toBe(false);
  });

  it('stops after the readback bound and says the run may still be running', () => {
    const getVerification$ = vi.fn(() => of(run('verifying')));
    const c = component({ verifySnapshotChecksum$: () => of(run('pending')), getVerification$ });
    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS * (BOOTSTRAP_VERIFY_MAX_POLLS + 5));
    expect(getVerification$).toHaveBeenCalledTimes(BOOTSTRAP_VERIFY_MAX_POLLS);
    expect(c.polling).toBe(false);
    expect(c.pollExhausted).toBe(true);
    expect(c.report?.state).toBe('verifying');
  });

  it('cancels the readback on a network switch, on clear and on destroy', () => {
    const networks = new BehaviorSubject('signet');
    const getVerification$ = vi.fn(() => of(run('verifying')));
    const c = component({ networkChanged$: networks, verifySnapshotChecksum$: () => of(run('pending')), getVerification$ });
    c.ngOnInit();
    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(getVerification$).toHaveBeenCalledTimes(1);
    networks.next('regtest');
    expect(c.report).toBeNull();
    expect(c.polling).toBe(false);
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS * 3);
    expect(getVerification$).toHaveBeenCalledTimes(1);

    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(getVerification$).toHaveBeenCalledTimes(2);
    c.ngOnDestroy();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS * 3);
    expect(getVerification$).toHaveBeenCalledTimes(2);
  });

  it('ignores a late readback for a different run', () => {
    const pending = new Subject<NodeBootstrapVerification>();
    const c = component({ verifySnapshotChecksum$: () => of(run('pending')), getVerification$: () => pending });
    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    pending.next(run('valid', { verification_id: 'run-9' }));
    expect(c.report?.state).toBe('pending');
    expect(c.polling).toBe(true);
  });

  it('distinguishes a 404 from a 503 and keeps the reason code', () => {
    const notFound = component({ verifySnapshotChecksum$: () => throwError(() => ({ status: 404, error: { stage: 'snapshot-not-in-catalogue', error: 'No trusted catalogue snapshot matches that reference on this network.' } })) });
    notFound.verifyChecksum();
    expect(notFound.report).toBeNull();
    expect(notFound.failure?.kind).toBe('not-found');
    expect(notFound.failure?.stage).toBe('snapshot-not-in-catalogue');
    expect(notFound.failureTitle(notFound.failure!)).toContain('No catalogue snapshot');

    const unavailable = component({ verifySnapshotChecksum$: () => throwError(() => ({ status: 503, error: { stage: 'durable-store-unavailable', error: 'Bootstrap evidence is unavailable. Verification runs need the durable MySQL store.' } })) });
    unavailable.verifyChecksum();
    expect(unavailable.failure?.kind).toBe('unavailable');
    expect(unavailable.failure?.stage).toBe('durable-store-unavailable');
    expect(unavailable.failureTitle(unavailable.failure!)).toContain('unavailable');
  });

  it('reports a readback failure while polling as that failure, not as a verdict', () => {
    const c = component({ verifySnapshotChecksum$: () => of(run('pending')), getVerification$: () => throwError(() => ({ status: 404, error: { error: 'Verification run not found' } })) });
    c.verifyChecksum();
    vi.advanceTimersByTime(BOOTSTRAP_VERIFY_POLL_MS);
    expect(c.polling).toBe(false);
    expect(c.failure?.kind).toBe('not-found');
    expect(c.report?.state).toBe('pending');
  });

  it('rejects unusable inputs before any request', () => {
    const verifySnapshotChecksum$ = vi.fn();
    const c = component({ verifySnapshotChecksum$ });
    c.snapshotHeight = null;
    c.verifyChecksum();
    expect(c.failure?.kind).toBe('rejected');
    c.snapshotHeight = 10;
    c.computedSha256 = 'nothex';
    c.verifyChecksum();
    expect(c.failure?.message).toContain('hexadecimal');
    expect(verifySnapshotChecksum$).not.toHaveBeenCalled();
  });
});
