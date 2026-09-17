import express from 'express';
import { AddressInfo } from 'net';
import { Transaction } from 'bitcoinjs-lib';
import routes from './private-submission.routes';
import { PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER } from './private-submission.models';
import { parsePrivateRelayEndpoints } from './private-relay.config';
import { PrivateRelayRuntime, setPrivateRelayRuntime } from './private-relay.runtime';
import {
  PrivateRelayUnavailableError,
  abortPrivateRelaySubmission,
  hashToken,
  privateRelayCapabilities,
  privateRelayOverview,
  readPrivateRelaySubmission,
  submitPrivateRelay,
} from './private-relay.submissions';
import {
  PrivateRelayEndpoint,
  PrivateRelayOutcome,
  PrivateRelayQueueDepth,
  PrivateRelayState,
  PrivateRelayStore,
  PrivateRelaySubmissionRow,
  PrivateRelayTransportAdapter,
  PrivateSubmissionAuthorizationError,
  PrivateSubmissionNotFoundError,
} from './private-relay.types';
import { validatePrivateRelayTransaction } from './private-relay.validation';
import { PrivateRelayWorker } from './private-relay.worker';
import privateSubmissionService from './private-submission.service';
import { SubmissionInputError } from './submission-input';

/**
 * The relay path with a fake durable store and a fake transport. The store
 * keeps the compare-and-set semantics of the MySQL one (claim by state and
 * lease, settle by holder, cancel by state) so the races the worker and the
 * abort route can run into are exercised here rather than only in production.
 */
const NETWORK = 'signet';
const ENDPOINTS_JSON = JSON.stringify([
  { id: 'tor-a', transport: 'tor', proxy: 'socks5h://127.0.0.1:9050', submitUrl: 'http://explorerabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu.onion/api/tx', network: NETWORK, timeoutMs: 5000 },
  { id: 'i2p-a', transport: 'i2p', proxy: 'socks5h://127.0.0.1:4447', submitUrl: 'http://explorer.b32.i2p/api/tx', network: NETWORK },
]);

function signedLookingTx(nonce = 1): string {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, nonce), 0);
  tx.addOutput(Buffer.from('0014' + '11'.repeat(20), 'hex'), 1000);
  return tx.toHex();
}

function coinbaseTx(): string {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff, Buffer.from('0102', 'hex'));
  tx.addOutput(Buffer.from('0014' + '22'.repeat(20), 'hex'), 5000);
  return tx.toHex();
}

class FakeStore implements PrivateRelayStore {
  public rows = new Map<string, PrivateRelaySubmissionRow>();
  public failNext: Error | null = null;

  private guard(): void {
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
  }
  public async insertOrExisting(row: PrivateRelaySubmissionRow): Promise<{ row: PrivateRelaySubmissionRow; created: boolean }> {
    this.guard();
    for (const existing of this.rows.values()) {
      if (existing.network === row.network && existing.txid === row.txid) return { row: { ...existing }, created: false };
    }
    this.rows.set(row.submission_id, { ...row });
    return { row: { ...row }, created: true };
  }
  public async getById(submissionId: string): Promise<PrivateRelaySubmissionRow | null> {
    this.guard();
    const row = this.rows.get(submissionId);
    return row ? { ...row } : null;
  }
  public async claimNext(args: { network: string; states: PrivateRelayState[]; workerId: string; nowIso: string; leaseUntilIso: string; maxAttempts: number }): Promise<PrivateRelaySubmissionRow | null> {
    this.guard();
    const candidates = [...this.rows.values()]
      .filter(row => row.network === args.network && args.states.includes(row.state) && row.attempts <= args.maxAttempts && (row.lease_until === null || row.lease_until <= args.nowIso))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const row = candidates[0];
    if (!row) return null;
    Object.assign(row, { state: 'relaying', lease_owner: args.workerId, lease_until: args.leaseUntilIso, attempts: row.attempts + 1, updated_at: args.nowIso });
    return { ...row };
  }
  public async settle(args: { submissionId: string; workerId: string; fromState: PrivateRelayState; toState: PrivateRelayState; nowIso: string; leaseUntilIso: string | null; relayEndpointId?: string | null; relayedAtIso?: string | null; confirmedBlockHeight?: number | null; lastError?: string | null }): Promise<boolean> {
    this.guard();
    const row = this.rows.get(args.submissionId);
    if (!row || row.state !== args.fromState || row.lease_owner !== args.workerId) return false;
    row.state = args.toState; row.lease_until = args.leaseUntilIso; row.lease_owner = null; row.updated_at = args.nowIso;
    if (args.relayEndpointId !== undefined) row.relay_endpoint_id = args.relayEndpointId;
    if (args.relayedAtIso !== undefined) row.relayed_at = args.relayedAtIso;
    if (args.confirmedBlockHeight !== undefined) row.confirmed_block_height = args.confirmedBlockHeight;
    if (args.lastError !== undefined) row.last_error = args.lastError;
    return true;
  }
  public async advanceTracking(args: { submissionId: string; expectedUpdatedAtIso: string; toState: 'submitted' | 'confirmed'; nowIso: string; leaseUntilIso: string | null; confirmedBlockHeight?: number | null; lastError?: string | null }): Promise<boolean> {
    this.guard();
    const row = this.rows.get(args.submissionId);
    if (!row || row.state !== 'submitted' || row.updated_at !== args.expectedUpdatedAtIso) return false;
    row.state = args.toState; row.lease_until = args.leaseUntilIso; row.updated_at = args.nowIso;
    if (args.confirmedBlockHeight !== undefined) row.confirmed_block_height = args.confirmedBlockHeight;
    if (args.lastError !== undefined) row.last_error = args.lastError;
    return true;
  }
  public async cancelIfQueued(submissionId: string, nowIso: string): Promise<boolean> {
    this.guard();
    const row = this.rows.get(submissionId);
    if (!row || row.state !== 'queued') return false;
    row.state = 'cancelled'; row.lease_until = null; row.lease_owner = null; row.updated_at = nowIso;
    return true;
  }
  public async dueForTracking(network: string, nowIso: string, limit: number): Promise<PrivateRelaySubmissionRow[]> {
    this.guard();
    return [...this.rows.values()].filter(row => row.network === network && row.state === 'submitted' && row.lease_until !== null && row.lease_until <= nowIso).slice(0, limit).map(row => ({ ...row }));
  }
  public async queueDepth(network: string): Promise<PrivateRelayQueueDepth> {
    this.guard();
    const depth: PrivateRelayQueueDepth = { queued: 0, relaying: 0, submitted: 0, confirmed: 0, rejected: 0, cancelled: 0 };
    for (const row of this.rows.values()) if (row.network === network && row.state in depth) depth[row.state as keyof PrivateRelayQueueDepth]++;
    return depth;
  }
}

class FakeTransport implements PrivateRelayTransportAdapter {
  public calls: { endpoint: string; rawTx: string; txid: string }[] = [];
  public outcomes: PrivateRelayOutcome[] = [];
  public reachable = true;
  public async submit(endpoint: PrivateRelayEndpoint, rawTx: string, expectedTxid: string): Promise<PrivateRelayOutcome> {
    this.calls.push({ endpoint: endpoint.id, rawTx, txid: expectedTxid });
    return this.outcomes.shift() ?? { kind: 'submitted', txid: expectedTxid, httpStatus: 200 };
  }
  public async probeProxy(): Promise<boolean> { return this.reachable; }
}

interface Harness {
  runtime: PrivateRelayRuntime;
  store: FakeStore;
  transport: FakeTransport;
  worker: PrivateRelayWorker;
  clock: { now: number };
  confirmations: Map<string, { confirmed: boolean; block_height?: number }>;
}

function harness(options: { endpointsJson?: string; database?: boolean; workerId?: string; store?: FakeStore; maxAttempts?: number } = {}): Harness {
  const store = options.store ?? new FakeStore();
  const transport = new FakeTransport();
  const clock = { now: Date.parse('2026-09-17T12:00:00.000Z') };
  const confirmations = new Map<string, { confirmed: boolean; block_height?: number }>();
  const endpoints = parsePrivateRelayEndpoints(options.endpointsJson ?? ENDPOINTS_JSON, NETWORK);
  const worker = new PrivateRelayWorker({
    store, transport, endpoints: endpoints.endpoints, network: NETWORK,
    confirmation: async (txid) => confirmations.get(txid) ?? null,
    now: () => clock.now, workerId: options.workerId ?? 'worker-1', maxAttempts: options.maxAttempts ?? 3,
    leaseMs: 60_000, retryBackoffMs: 30_000, trackingIntervalMs: 10_000, trackingWindowMs: 3600_000, probeIntervalMs: 0,
  });
  const runtime: PrivateRelayRuntime = {
    network: NETWORK, endpoints,
    store: options.database === false ? null : store,
    worker: options.database === false || !endpoints.endpoints.length ? null : worker,
    coreVersion: () => 'v29.0-test',
  };
  return { runtime, store, transport, worker, clock, confirmations };
}

describe('private relay transaction validation', () => {
  it('rejects non-hex, oversized, undersized, coinbase and trailing-byte transactions', () => {
    expect(() => validatePrivateRelayTransaction('zz')).toThrow(SubmissionInputError);
    expect(() => validatePrivateRelayTransaction('ab'.repeat(400_001))).toThrow(/exceeds/);
    expect(() => validatePrivateRelayTransaction('ab'.repeat(10))).toThrow(/smaller/);
    expect(() => validatePrivateRelayTransaction(coinbaseTx())).toThrow(/coinbase/);
    expect(() => validatePrivateRelayTransaction(signedLookingTx() + '00')).toThrow(/malformed|trailing/);
    expect(() => validatePrivateRelayTransaction('ab'.repeat(80))).toThrow(SubmissionInputError);
  });

  it('yields the txid bitcoinjs computes for a well-formed transaction', () => {
    const hex = signedLookingTx();
    const validated = validatePrivateRelayTransaction(hex.toUpperCase());
    expect(validated.txid).toBe(Transaction.fromHex(hex).getId());
    expect(validated.raw_tx).toBe(hex);
  });
});

describe('private relay endpoint configuration', () => {
  it('reports unconfigured when the variable is absent', () => {
    expect(parsePrivateRelayEndpoints(undefined, NETWORK)).toEqual({ endpoints: [], issues: [], unconfigured: true });
    expect(parsePrivateRelayEndpoints('   ', NETWORK).unconfigured).toBe(true);
  });

  it('rejects endpoints on another network, clearnet submit hosts, bad proxies and duplicates by id', () => {
    const parsed = parsePrivateRelayEndpoints(JSON.stringify([
      { id: 'mainnet-tor', transport: 'tor', proxy: 'socks5h://127.0.0.1:9050', submitUrl: 'http://abc.onion/api/tx', network: 'mainnet' },
      { id: 'clearnet', transport: 'tor', proxy: 'socks5h://127.0.0.1:9050', submitUrl: 'https://example.com/api/tx', network: NETWORK }, // a clearnet submit host (not .onion) must be refused
      { id: 'http-proxy', transport: 'tor', proxy: 'http://127.0.0.1:8118', submitUrl: 'http://abc.onion/api/tx', network: NETWORK },
      { id: 'ok', transport: 'i2p', proxy: 'socks5h://127.0.0.1:4447', submitUrl: 'http://abc.b32.i2p/api/tx', network: NETWORK },
      { id: 'ok', transport: 'i2p', proxy: 'socks5h://127.0.0.1:4447', submitUrl: 'http://def.b32.i2p/api/tx', network: NETWORK },
      { id: 'slow', transport: 'tor', proxy: 'socks5h://127.0.0.1:9050', submitUrl: 'http://abc.onion/api/tx', network: NETWORK, timeoutMs: 999_999 },
    ]), NETWORK);
    expect(parsed.endpoints.map(endpoint => endpoint.id)).toEqual(['ok']);
    expect(parsed.issues).toEqual([
      { id: 'mainnet-tor', reason: 'network-mismatch' },
      { id: 'clearnet', reason: 'submit-host-not-tor' },
      { id: 'http-proxy', reason: 'invalid-proxy' },
      { id: 'ok', reason: 'duplicate-id' },
      { id: 'slow', reason: 'invalid-timeout' },
    ]);
    expect(parsePrivateRelayEndpoints('{not json', NETWORK).issues).toEqual([{ id: '*', reason: 'not-json' }]);
  });
});

describe('private relay submission', () => {
  it('reports the durable store unavailable when the database is disabled', async () => {
    const { runtime } = harness({ database: false });
    await expect(submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime)).rejects.toMatchObject({ code: 'durable-store-unavailable' });
    await expect(privateRelayOverview(runtime)).rejects.toMatchObject({ code: 'durable-store-unavailable' });
    await expect(privateRelayCapabilities(runtime)).rejects.toMatchObject({ code: 'durable-store-unavailable' });
    await expect(readPrivateRelaySubmission('any', 'ab'.repeat(32), runtime)).rejects.toBeInstanceOf(PrivateRelayUnavailableError);
  });

  it('reports the relay unavailable when no endpoint is configured, while the overview still answers with the reason', async () => {
    const { runtime, store } = harness({ endpointsJson: '' });
    await expect(submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime)).rejects.toMatchObject({ code: 'unavailable-relay' });
    expect(store.rows.size).toBe(0);
    const overview = await privateRelayOverview(runtime);
    expect(overview.relay).toMatchObject({ configured: false, reason: 'UNIVERSE_PRIVATE_RELAY_ENDPOINTS is not set', endpoints: [] });
    expect(overview.worker.running).toBe(false);
    const capabilities = await privateRelayCapabilities(runtime);
    expect(capabilities).toMatchObject({ privatebroadcast_tor_enabled: false, privatebroadcast_i2p_enabled: false, tor_active: false, i2p_active: false, current_queue_count: 0 });
  });

  it('refuses a transport that has no endpoint and a method the private relay does not serve', async () => {
    const { runtime, store } = harness({ endpointsJson: JSON.stringify([JSON.parse(ENDPOINTS_JSON)[0]]) });
    await expect(submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_i2p' }, runtime)).rejects.toMatchObject({ code: 'unavailable-relay' });
    await expect(submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'public_p2p' }, runtime)).rejects.toBeInstanceOf(SubmissionInputError);
    expect(store.rows.size).toBe(0);
  });

  it('rejects an invalid transaction before anything is queued', async () => {
    const { runtime, store } = harness();
    await expect(submitPrivateRelay({ raw_tx: coinbaseTx(), method: 'privatebroadcast_tor' }, runtime)).rejects.toBeInstanceOf(SubmissionInputError);
    expect(store.rows.size).toBe(0);
  });

  it('queues a durable record and returns the owner token exactly once, without the raw transaction', async () => {
    const { runtime, store } = harness();
    const hex = signedLookingTx();
    const record = await submitPrivateRelay({ raw_tx: hex, method: 'privatebroadcast_tor' }, runtime);
    expect(record.owner_token).toMatch(/^[0-9a-f]{64}$/);
    expect(record).toMatchObject({ status: 'queued', can_abort: true, retry_count: 0, network: NETWORK, txid: Transaction.fromHex(hex).getId() });
    expect(JSON.stringify(record)).not.toContain(hex);
    const stored = store.rows.get(record.submission_token)!;
    expect(stored.raw_tx).toBe(hex);
    expect(stored.owner_token_hash).toBe(hashToken(record.owner_token!));
    expect(stored.owner_token_hash).not.toBe(record.owner_token);
  });

  it('answers a duplicate submission with the existing record and no new token', async () => {
    const { runtime, store } = harness();
    const hex = signedLookingTx();
    const first = await submitPrivateRelay({ raw_tx: hex, method: 'privatebroadcast_tor' }, runtime);
    const second = await submitPrivateRelay({ raw_tx: hex, method: 'privatebroadcast_i2p' }, runtime);
    expect(second.submission_token).toBe(first.submission_token);
    expect(second.duplicate).toBe(true);
    expect(second.owner_token).toBeUndefined();
    expect(second.method).toBe('privatebroadcast_tor');
    expect(store.rows.size).toBe(1);
  });

  it('requires the owner token for readback and abort, and never discloses the record to a wrong or missing token', async () => {
    const { runtime } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    await expect(readPrivateRelaySubmission(record.submission_token, undefined, runtime)).rejects.toBeInstanceOf(PrivateSubmissionAuthorizationError);
    await expect(readPrivateRelaySubmission(record.submission_token, 'ff'.repeat(32), runtime)).rejects.toBeInstanceOf(PrivateSubmissionAuthorizationError);
    await expect(readPrivateRelaySubmission(record.submission_token, record.submission_token, runtime)).rejects.toBeInstanceOf(PrivateSubmissionAuthorizationError);
    await expect(abortPrivateRelaySubmission(record.submission_token, 'ff'.repeat(32), runtime)).rejects.toBeInstanceOf(PrivateSubmissionAuthorizationError);
    await expect(readPrivateRelaySubmission('00000000-0000-4000-8000-000000000000', record.owner_token, runtime)).rejects.toBeInstanceOf(PrivateSubmissionNotFoundError);
    const readback = await readPrivateRelaySubmission(record.submission_token, record.owner_token, runtime);
    expect(readback.status).toBe('queued');
    expect(readback.owner_token).toBeUndefined();
    expect(readback).not.toHaveProperty('raw_tx');
    expect(readback).not.toHaveProperty('owner_token_hash');
    const stillQueued = await readPrivateRelaySubmission(record.submission_token, record.owner_token, runtime);
    expect(stillQueued.status).toBe('queued');
  });
});

describe('private relay worker', () => {
  it('claims the queued row, relays it through the endpoint for its transport, and tracks it to confirmation', async () => {
    const { runtime, store, transport, worker, clock, confirmations } = harness();
    const hex = signedLookingTx();
    const record = await submitPrivateRelay({ raw_tx: hex, method: 'privatebroadcast_i2p' }, runtime);

    await worker.tick();
    expect(transport.calls).toEqual([{ endpoint: 'i2p-a', rawTx: hex, txid: record.txid }]);
    let row = store.rows.get(record.submission_token)!;
    expect(row).toMatchObject({ state: 'submitted', attempts: 1, relay_endpoint_id: 'i2p-a', lease_owner: null });
    expect(row.relayed_at).not.toBeNull();
    expect(worker.status().last_relay).toMatchObject({ endpoint_id: 'i2p-a', transport: 'i2p', outcome: 'submitted' });

    // Not due yet: no confirmation poll, no state change.
    await worker.tick();
    expect(transport.calls).toHaveLength(1);
    expect(store.rows.get(record.submission_token)!.state).toBe('submitted');

    clock.now += 11_000;
    await worker.tick();
    expect(store.rows.get(record.submission_token)!.state).toBe('submitted');

    confirmations.set(record.txid, { confirmed: true, block_height: 260_000 });
    clock.now += 11_000;
    await worker.tick();
    row = store.rows.get(record.submission_token)!;
    expect(row).toMatchObject({ state: 'confirmed', confirmed_block_height: 260_000, lease_until: null });

    const readback = await readPrivateRelaySubmission(record.submission_token, record.owner_token, runtime);
    expect(readback).toMatchObject({ status: 'confirmed', confirmed_block_height: 260_000, relay_endpoint_id: 'i2p-a', can_abort: false });
    expect(transport.calls).toHaveLength(1);
  });

  it('returns an unreachable relay to the queue with a backoff, and rejects after the bounded attempts', async () => {
    const { runtime, store, transport, worker, clock } = harness({ maxAttempts: 2 });
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    transport.outcomes.push({ kind: 'unreachable', reason: 'econnrefused' }, { kind: 'unreachable', reason: 'etimedout' });

    await worker.tick();
    let row = store.rows.get(record.submission_token)!;
    expect(row).toMatchObject({ state: 'queued', attempts: 1, last_error: 'econnrefused' });
    expect(row.lease_until! > new Date(clock.now).toISOString()).toBe(true);

    await worker.tick();
    expect(transport.calls).toHaveLength(1);

    clock.now += 31_000;
    await worker.tick();
    row = store.rows.get(record.submission_token)!;
    expect(row).toMatchObject({ state: 'rejected', attempts: 2 });
    expect(row.last_error).toContain('relay-attempts-exhausted');
    expect(transport.calls).toHaveLength(2);
  });

  it('records a node rejection without retrying', async () => {
    const { runtime, store, transport, worker } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    transport.outcomes.push({ kind: 'rejected', reason: 'sendrawtransaction RPC error: bad-txns-inputs-missingorspent', httpStatus: 400 });
    await worker.tick();
    expect(store.rows.get(record.submission_token)).toMatchObject({ state: 'rejected', attempts: 1, last_error: expect.stringContaining('missingorspent') });
    const readback = await readPrivateRelaySubmission(record.submission_token, record.owner_token, runtime);
    expect(readback).toMatchObject({ status: 'rejected', can_abort: false });
  });

  it('reclaims a row whose lease a crashed worker left behind and relays it once more', async () => {
    const store = new FakeStore();
    const crashed = harness({ store, workerId: 'worker-crashed' });
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, crashed.runtime);
    // The crashed worker claimed the row and died before the transport answered.
    const claimed = await store.claimNext({ network: NETWORK, states: ['queued'], workerId: 'worker-crashed', nowIso: new Date(crashed.clock.now).toISOString(), leaseUntilIso: new Date(crashed.clock.now + 60_000).toISOString(), maxAttempts: 3 });
    expect(claimed?.state).toBe('relaying');

    const restarted = harness({ store, workerId: 'worker-restarted' });
    await restarted.worker.tick();
    expect(restarted.transport.calls).toHaveLength(0);
    expect(store.rows.get(record.submission_token)!.state).toBe('relaying');

    restarted.clock.now += 61_000;
    await restarted.worker.tick();
    expect(restarted.transport.calls).toHaveLength(1);
    expect(store.rows.get(record.submission_token)).toMatchObject({ state: 'submitted', attempts: 2, lease_owner: null });
  });

  it('keeps the transport away from a row that failed to settle under a stolen lease', async () => {
    const { runtime, store, worker } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    store.failNext = new Error('connection lost');
    await expect(worker.tick()).rejects.toThrow('connection lost');
    expect(worker.status().last_error).toBe('connection lost');
    expect(store.rows.get(record.submission_token)!.state).toBe('queued');
    await worker.tick();
    expect(worker.status().last_error).toBeNull();
    expect(store.rows.get(record.submission_token)!.state).toBe('submitted');
  });

  it('closes the confirmation tracking window without inventing a confirmation', async () => {
    const { runtime, store, worker, clock } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    await worker.tick();
    clock.now += 3600_000 + 11_000;
    await worker.tick();
    expect(store.rows.get(record.submission_token)).toMatchObject({ state: 'submitted', lease_until: null, last_error: 'confirmation-tracking-window-closed' });
  });
});

describe('private relay abort', () => {
  it('cancels a queued submission before the relay starts, so the transport never sees it', async () => {
    const { runtime, store, transport, worker } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    expect(await abortPrivateRelaySubmission(record.submission_token, record.owner_token, runtime)).toEqual({ success: true, status: 'cancelled' });
    await worker.tick();
    expect(transport.calls).toHaveLength(0);
    expect(store.rows.get(record.submission_token)!.state).toBe('cancelled');
    expect(await readPrivateRelaySubmission(record.submission_token, record.owner_token, runtime)).toMatchObject({ status: 'cancelled', can_abort: false });
    expect(await abortPrivateRelaySubmission(record.submission_token, record.owner_token, runtime)).toEqual({ success: true, status: 'cancelled' });
  });

  it('answers abort-too-late once relay has started or completed, and does not claim a reversal', async () => {
    const { runtime, store, worker, clock } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    await store.claimNext({ network: NETWORK, states: ['queued'], workerId: 'worker-1', nowIso: new Date(clock.now).toISOString(), leaseUntilIso: new Date(clock.now + 60_000).toISOString(), maxAttempts: 3 });
    expect(await abortPrivateRelaySubmission(record.submission_token, record.owner_token, runtime)).toEqual({ success: false, status: 'abort-too-late' });
    expect(store.rows.get(record.submission_token)!.state).toBe('relaying');

    const later = await submitPrivateRelay({ raw_tx: signedLookingTx(2), method: 'privatebroadcast_tor' }, runtime);
    await worker.tick();
    await worker.tick();
    expect(store.rows.get(later.submission_token)!.state).toBe('submitted');
    expect(await abortPrivateRelaySubmission(later.submission_token, later.owner_token, runtime)).toEqual({ success: false, status: 'abort-too-late' });
    expect(store.rows.get(later.submission_token)!.state).toBe('submitted');
  });

  it('loses the race to a claim that landed between the read and the cancel', async () => {
    const { runtime, store, clock } = harness();
    const record = await submitPrivateRelay({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }, runtime);
    const getById = store.getById.bind(store);
    store.getById = async (id) => {
      const row = await getById(id);
      await store.claimNext({ network: NETWORK, states: ['queued'], workerId: 'worker-1', nowIso: new Date(clock.now).toISOString(), leaseUntilIso: new Date(clock.now + 60_000).toISOString(), maxAttempts: 3 });
      return row;
    };
    expect(await abortPrivateRelaySubmission(record.submission_token, record.owner_token, runtime)).toEqual({ success: false, status: 'abort-too-late' });
    expect(store.rows.get(record.submission_token)!.state).toBe('relaying');
  });
});

describe('private relay overview and capabilities', () => {
  it('reports configured endpoints by transport, queue depth by state, worker liveness and the last relay outcome', async () => {
    const { runtime, worker, transport } = harness();
    await submitPrivateRelay({ raw_tx: signedLookingTx(1), method: 'privatebroadcast_tor' }, runtime);
    await submitPrivateRelay({ raw_tx: signedLookingTx(2), method: 'privatebroadcast_tor' }, runtime);
    await worker.tick();
    worker.start(60_000);
    try {
      const overview = await privateRelayOverview(runtime);
      expect(overview.relay.configured).toBe(true);
      expect(overview.relay.endpoints).toEqual([
        { id: 'tor-a', transport: 'tor', submit_host: 'explorerabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu.onion', proxy_reachable: true },
        { id: 'i2p-a', transport: 'i2p', submit_host: 'explorer.b32.i2p', proxy_reachable: true },
      ]);
      expect(overview.queue).toEqual({ queued: 1, relaying: 0, submitted: 1, confirmed: 0, rejected: 0, cancelled: 0 });
      expect(overview.worker).toMatchObject({ running: true, last_error: null, last_relay: { endpoint_id: 'tor-a', outcome: 'submitted' } });
      expect(JSON.stringify(overview)).not.toMatch(/[0-9a-f]{120,}/);

      const capabilities = await privateRelayCapabilities(runtime);
      expect(capabilities).toEqual({
        public_p2p_enabled: false, privatebroadcast_tor_enabled: true, privatebroadcast_i2p_enabled: true, core_version: 'v29.0-test',
        tor_active: true, i2p_active: true, queue_limit: 1000, current_queue_count: 1,
      });

      transport.reachable = false;
      await worker.probeProxies(true);
      expect((await privateRelayCapabilities(runtime)).tor_active).toBe(false);
      expect((await privateRelayOverview(runtime)).relay.endpoints[0].proxy_reachable).toBe(false);
    } finally {
      worker.stop();
    }
  });
});

describe('PrivateSubmissionService private relay methods', () => {
  afterEach(() => setPrivateRelayRuntime(null));

  it('delegates to the installed runtime and returns its typed errors', async () => {
    const { runtime } = harness();
    setPrivateRelayRuntime(runtime);
    const record = await privateSubmissionService.submitPrivate({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' });
    expect(record.owner_token).toBeDefined();
    expect((await privateSubmissionService.getPrivateSubmission(record.submission_token, record.owner_token)).status).toBe('queued');
    await expect(privateSubmissionService.getPrivateSubmission(record.submission_token, 'ee'.repeat(32))).rejects.toBeInstanceOf(PrivateSubmissionAuthorizationError);
    expect(await privateSubmissionService.abortPrivateSubmission(record.submission_token, record.owner_token)).toEqual({ success: true, status: 'cancelled' });
    expect((await privateSubmissionService.getOverview()).queue.cancelled).toBe(1);
    expect((await privateSubmissionService.getCapabilities()).privatebroadcast_tor_enabled).toBe(true);
  });

  it('reports the durable store unavailable through the service when the database is disabled', async () => {
    setPrivateRelayRuntime(harness({ database: false }).runtime);
    await expect(privateSubmissionService.submitPrivate({ raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' })).rejects.toMatchObject({ code: 'durable-store-unavailable' });
  });
});

describe('private relay HTTP contract', () => {
  afterEach(() => setPrivateRelayRuntime(null));

  it('returns the token once on 201, authenticates readback by header and abort by header or body, and answers 403/404 otherwise', async () => {
    const { runtime } = harness();
    setPrivateRelayRuntime(runtime);
    const app = express();
    app.use(express.json());
    routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1/intelligence/submission';
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> =>
      fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
      const hex = signedLookingTx(7);
      const created = await call('POST', '/private', { raw_tx: hex, method: 'privatebroadcast_tor' });
      expect(created.status).toBe(201);
      const record: any = await created.json();
      expect(record.owner_token).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(record)).not.toContain(hex);

      const again = await call('POST', '/private', { raw_tx: hex, method: 'privatebroadcast_tor' });
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ submission_token: record.submission_token, duplicate: true });

      expect((await call('GET', '/private/' + record.submission_token)).status).toBe(403);
      expect((await call('GET', '/private/' + record.submission_token, undefined, { [PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER]: 'ff'.repeat(32) })).status).toBe(403);
      expect((await call('GET', '/private/00000000-0000-4000-8000-000000000000', undefined, { [PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER]: record.owner_token })).status).toBe(404);
      const read = await call('GET', '/private/' + record.submission_token, undefined, { [PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER]: record.owner_token });
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ status: 'queued', can_abort: true });

      expect((await call('POST', '/private/' + record.submission_token + '/abort', { owner_token: 'ff'.repeat(32) })).status).toBe(403);
      const aborted = await call('POST', '/private/' + record.submission_token + '/abort', { owner_token: record.owner_token });
      expect(aborted.status).toBe(200);
      expect(await aborted.json()).toEqual({ success: true, status: 'cancelled' });

      const overview = await call('GET', '/overview');
      expect(overview.status).toBe(200);
      expect(((await overview.json()) as any).queue.cancelled).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('answers 503 durable-store-unavailable on every private relay route without a database', async () => {
    setPrivateRelayRuntime(harness({ database: false }).runtime);
    const app = express();
    app.use(express.json());
    routes.initRoutes(app);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', r));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1/intelligence/submission';
    try {
      for (const [method, path, body] of [['GET', '/overview'], ['GET', '/capabilities'], ['POST', '/private', { raw_tx: signedLookingTx(), method: 'privatebroadcast_tor' }], ['GET', '/private/x'], ['POST', '/private/x/abort', {}]] as [string, string, unknown?][]) {
        const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        expect(res.status).toBe(503);
        expect(((await res.json()) as any).stage).toBe('durable-store-unavailable');
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
