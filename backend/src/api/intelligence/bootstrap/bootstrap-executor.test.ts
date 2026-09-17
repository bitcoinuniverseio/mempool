import { BootstrapJobExecutor } from './bootstrap-executor';
import { MemoryBootstrapStore } from './bootstrap-store';
import { BootstrapService } from './bootstrap.service';
import { BootstrapNodeReader } from './node-reader';
import { NodeBootstrapJob } from './bootstrap.models';
import { byteSource, catalogueFor, fakeCore, FIXTURE, FIXTURE_BYTES, producerKeys, testEnvironment } from './__fixtures__/support';

const keys = producerKeys();
const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex);
const statfsPlenty = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 4096, bavail: 1 << 20, blocks: 1 << 21 });
const auth = { keyId: 'control-plane', elevated: true };
const key = (suffix: string): string => 'idem-' + suffix + '-' + Math.random().toString(16).slice(2, 10);

/** A Core whose chainstates can be swapped after loadtxoutset, as the real node does. */
function switchableCore(): { current: ReturnType<typeof fakeCore>; reader: BootstrapNodeReader; calls: string[]; swap: (next: ReturnType<typeof fakeCore>) => void } {
  const calls: string[] = [];
  const holder = { current: fakeCore({ blocks: 10, headers: 200, ibd: true, calls }) };
  const proxy = { network: 'regtest', call: (m: string, p: unknown[]) => holder.current.call(m, p) };
  return { get current() { return holder.current; }, reader: new BootstrapNodeReader(proxy), calls, swap: (next) => { holder.current = next; } };
}

function operatorCore(handler: (method: string, params: unknown[]) => Promise<any>): { calls: Array<{ method: string; params: unknown[] }>; call: (method: 'dumptxoutset' | 'loadtxoutset', params: unknown[]) => Promise<any> } {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  return { calls, call: (method, params) => { calls.push({ method, params }); return handler(method, params); } };
}

function build(options: { core?: ReturnType<typeof switchableCore>; store?: MemoryBootstrapStore | null; env?: Parameters<typeof testEnvironment>[0]; handler?: (method: string, params: unknown[]) => Promise<any> } = {}): {
  service: BootstrapService; store: MemoryBootstrapStore; core: ReturnType<typeof switchableCore>; operator: ReturnType<typeof operatorCore>; env: ReturnType<typeof testEnvironment>;
} {
  const core = options.core ?? switchableCore();
  const store = options.store === undefined ? new MemoryBootstrapStore() : (options.store as MemoryBootstrapStore);
  const env = testEnvironment(options.env);
  const operator = operatorCore(options.handler ?? (async () => { throw new Error('no handler'); }));
  const service = new BootstrapService({
    nodes: core.reader, core: { network: 'regtest', call: (m, p) => core.current.call(m, p) }, env, store, bytes: byteSource(FIXTURE_BYTES), network: 'regtest',
    statfs: statfsPlenty, catalogue: () => catalogue, operatorCore: operator, workerOwner: 'worker-a',
  });
  return { service, store, core, operator, env };
}

async function verifyFixture(service: BootstrapService): Promise<void> {
  const pending = await service.verifySnapshot({ snapshot_id: 'regtest-105' });
  const done = await service.awaitVerification(pending.verification_id);
  expect(done?.state).toBe('valid');
}

function executor(built: ReturnType<typeof build>, overrides: Partial<ConstructorParameters<typeof BootstrapJobExecutor>[0]> = {}): BootstrapJobExecutor {
  return new BootstrapJobExecutor({
    env: built.env, network: 'regtest', store: built.store, nodes: built.core.reader, core: { network: 'regtest', call: (m, p) => built.core.current.call(m, p) },
    operatorCore: built.operator, catalogue: () => catalogue, owner: 'worker-a', sleep: async () => undefined, statfs: statfsPlenty, loadObservationAttempts: 3, ...overrides,
  });
}

const loadedCore = (): ReturnType<typeof fakeCore> => fakeCore({
  blocks: FIXTURE.height, headers: 200, ibd: true,
  chainstates: [
    { blocks: 10, bestblockhash: require('crypto').createHash('sha256').update('block10').digest('hex'), verificationprogress: 0.1, validated: true, coins_db_cache_bytes: 1, coins_tip_cache_bytes: 1 },
    { blocks: FIXTURE.height, bestblockhash: FIXTURE.baseHash, verificationprogress: 0.5, validated: false, coins_db_cache_bytes: 1, coins_tip_cache_bytes: 1, snapshot_blockhash: FIXTURE.baseHash },
  ],
});

describe('Bootstrap operator jobs', () => {
  it('rejects unauthorized and unelevated requests before observing the node or touching the store', async () => {
    const built = build();
    await expect(built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('a') }, undefined)).rejects.toThrow(expect.objectContaining({ code: 'UNAUTHORIZED', status: 401 }));
    await expect(built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('b'), confirm: 'load_snapshot' }, { keyId: 'k', elevated: false })).rejects.toThrow(expect.objectContaining({ code: 'ELEVATION_REQUIRED', status: 403 }));
    await expect(built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('c') }, auth)).rejects.toThrow(expect.objectContaining({ code: 'invalid-input', status: 400 }));
    await expect(built.service.createOperatorJob({ job_type: 'generate_snapshot' }, auth)).rejects.toThrow(expect.objectContaining({ code: 'invalid-input' }));
    await expect(built.service.createOperatorJob({ job_type: 'reindex' as any, idempotency_key: key('d') }, auth)).rejects.toThrow(expect.objectContaining({ code: 'invalid-input' }));
    expect(built.core.calls).toEqual([]);
    expect(built.store.jobs.size).toBe(0);
    expect(built.operator.calls).toEqual([]);
  });

  it('needs the durable store and an allowlisted output directory', async () => {
    const noStore = build({ store: null });
    await expect(noStore.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('e') }, auth)).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable' }));
    await expect(noStore.service.getJob('x')).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable' }));
    const noDir = build({ env: { snapshotDir: undefined } });
    await expect(noDir.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('f') }, auth)).rejects.toThrow(expect.objectContaining({ code: 'unavailable-operator' }));
    expect(noDir.service.startWorker()).toBeUndefined();
    expect(await build().service.getJob('missing')).toBeUndefined();
  });

  it('generates a snapshot through dumptxoutset at a configured path and records what Core answered', async () => {
    const core = switchableCore();
    core.swap(fakeCore({ calls: core.calls }));
    const built = build({
      core,
      handler: async (method, params) => ({ coins_written: 107, base_hash: FIXTURE.baseHash, base_height: FIXTURE.height, txoutset_hash: FIXTURE.hashSerialized3, path: params[0], nchaintx: 107 }),
    });
    const idem = key('gen');
    const job = await built.service.createOperatorJob({ job_type: 'generate_snapshot', node_id: 'owned-core-regtest', idempotency_key: idem }, auth);
    expect(job).toMatchObject({ state: 'queued', status: 'queued', job_type: 'generate_snapshot', node_id: 'owned-core-regtest', requested_by: 'control-plane', attempts: 0, rpc: null });
    expect(built.operator.calls).toEqual([]);
    built.service.stopWorker();

    const worker = executor(built);
    const ran = await worker.runOnce();
    expect(ran?.job_id).toBe(job.job_id);
    const stored = await built.service.getJob(job.job_id);
    expect(stored).toMatchObject({ state: 'completed', attempts: 1, progress_pct: 100, lease: null, rpc: { method: 'dumptxoutset' } });
    expect(stored?.evidence).toMatchObject({ coins_written: 107, base_hash: FIXTURE.baseHash, base_height: FIXTURE.height, txoutset_hash: FIXTURE.hashSerialized3, core_block_hash_at_base_height: FIXTURE.baseHash });
    expect(stored?.preconditions).toMatchObject({ core_version: '28.0.0', phase: 'fully_validated', capacity_method: 'statfs' });
    expect(built.operator.calls).toHaveLength(1);
    expect(built.operator.calls[0].method).toBe('dumptxoutset');
    expect(built.operator.calls[0].params).toEqual([`/var/lib/bitcoin/snapshots/utxo-regtest-${FIXTURE.height}-${job.job_id}.dat`]);
    expect(stored?.checkpoints.map((c) => c.stage)).toEqual(['queued', 'claimed', 'rpc-issued', 'rpc-returned', 'completed']);
    expect(await worker.runOnce()).toBeNull();
  });

  it('refuses to generate from a node that is not fully validated', async () => {
    const built = build();
    await expect(built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('ibd') }, auth)).rejects.toThrow(expect.objectContaining({ code: 'chainstate-not-eligible', status: 409 }));
  });

  it('loads a verified snapshot through loadtxoutset and completes only after the node shows the snapshot chainstate', async () => {
    const core = switchableCore();
    const built = build({
      core,
      handler: async (method) => {
        if (method === 'loadtxoutset') {
          core.swap(loadedCore());
          return { coins_loaded: 107, tip_hash: FIXTURE.baseHash, base_height: FIXTURE.height, path: '/allowed/regtest-105.dat' };
        }
        throw new Error('unexpected ' + method);
      },
    });
    await expect(built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('l0'), confirm: 'load_snapshot' }, auth)).rejects.toThrow(expect.objectContaining({ code: 'snapshot-not-verified' }));
    await verifyFixture(built.service);
    await expect(built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'unknown', idempotency_key: key('l1'), confirm: 'load_snapshot' }, auth)).rejects.toThrow(expect.objectContaining({ code: 'snapshot-not-in-catalogue', status: 404 }));
    const job = await built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('l2'), confirm: 'load_snapshot' }, auth);
    built.service.stopWorker();
    expect(job.state).toBe('queued');
    await expect(built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('l3'), confirm: 'load_snapshot' }, auth)).rejects.toThrow(expect.objectContaining({ code: 'job-already-active', status: 409 }));

    await executor(built).runOnce();
    const stored = await built.service.getJob(job.job_id) as NodeBootstrapJob;
    expect(stored.state).toBe('completed');
    expect(stored.evidence).toMatchObject({ coins_loaded: 107, tip_hash: FIXTURE.baseHash, base_height: FIXTURE.height, observed_phase: 'background_validation', active_chainstate_type: 'snapshot', snapshot_chainstate_height: FIXTURE.height, background_ibd_height: 10 });
    expect(stored.preconditions).toMatchObject({ pinned_commitment: FIXTURE.hashSerialized3, snapshot_height: FIXTURE.height, phase: 'traditional_ibd' });
    expect(built.operator.calls).toEqual([{ method: 'loadtxoutset', params: ['/allowed/regtest-105.dat'] }]);
    expect(stored.checkpoints.map((c) => c.stage)).toContain('chainstate-observation');
  });

  it('leaves a load in needs-review when Core answers but no snapshot chainstate appears', async () => {
    const built = build({ handler: async () => ({ coins_loaded: 107, tip_hash: FIXTURE.baseHash, base_height: FIXTURE.height }) });
    await verifyFixture(built.service);
    const job = await built.service.createOperatorJob({ job_type: 'load_snapshot', snapshot_id: 'regtest-105', idempotency_key: key('nr'), confirm: 'load_snapshot' }, auth);
    built.service.stopWorker();
    await executor(built).runOnce();
    expect(await built.service.getJob(job.job_id)).toMatchObject({ state: 'needs-review', reason: 'chainstate-not-observed' });
  });

  it('returns the same job for a duplicate idempotency key and never runs Core twice', async () => {
    const core = switchableCore();
    core.swap(fakeCore({ calls: core.calls }));
    const built = build({ core, handler: async (_m, params) => ({ coins_written: 1, base_hash: FIXTURE.baseHash, base_height: FIXTURE.height, txoutset_hash: FIXTURE.hashSerialized3, path: params[0] }) });
    const idem = key('dup');
    const first = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: idem }, auth);
    const second = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: idem }, auth);
    built.service.stopWorker();
    expect(second.job_id).toBe(first.job_id);
    expect(built.store.jobs.size).toBe(1);
    const worker = executor(built);
    await worker.runOnce();
    await worker.runOnce();
    expect(built.operator.calls).toHaveLength(1);
    const again = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: idem }, auth);
    built.service.stopWorker();
    expect(again).toMatchObject({ job_id: first.job_id, state: 'completed' });
  });

  it('reclaims a job whose worker died before issuing the RPC, and reconciles one that died after', async () => {
    const core = switchableCore();
    core.swap(fakeCore({ calls: core.calls }));
    const built = build({ core, handler: async (_m, params) => ({ coins_written: 1, base_hash: FIXTURE.baseHash, base_height: FIXTURE.height, txoutset_hash: FIXTURE.hashSerialized3, path: params[0] }) });
    const crashedBefore = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('cb') }, auth);
    built.service.stopWorker();
    const past = new Date(Date.now() - 1000).toISOString();
    const stale = built.store.jobs.get(crashedBefore.job_id) as NodeBootstrapJob;
    Object.assign(stale, { state: 'running', status: 'running', attempts: 1, lease: { owner: 'worker-dead', expires_at: past } });
    const other = executor(built, { owner: 'worker-b', clock: () => Date.now() });
    expect((await other.runOnce())?.job_id).toBe(crashedBefore.job_id);
    expect(await built.service.getJob(crashedBefore.job_id)).toMatchObject({ state: 'completed', attempts: 2 });
    expect(built.operator.calls).toHaveLength(1);

    const crashedAfter: NodeBootstrapJob = { ...(await built.service.getJob(crashedBefore.job_id) as NodeBootstrapJob), job_id: 'crashed-after', idempotency_key: key('ca'), state: 'running', status: 'running', attempts: 1, evidence: {}, checkpoints: [], finished_at: undefined, lease: { owner: 'worker-dead', expires_at: past }, rpc: { method: 'dumptxoutset', started_at: past } };
    built.store.jobs.set(crashedAfter.job_id, crashedAfter);
    expect((await other.runOnce())?.job_id).toBe('crashed-after');
    expect(await built.service.getJob('crashed-after')).toMatchObject({ state: 'needs-review', reason: 'rpc-outcome-unknown-after-restart', attempts: 2 });
    expect(built.operator.calls).toHaveLength(1);
    const held = built.store.jobs.get(crashedAfter.job_id) as NodeBootstrapJob;
    Object.assign(held, { state: 'running', lease: { owner: 'worker-live', expires_at: new Date(Date.now() + 60000).toISOString() } });
    expect(await other.runOnce()).toBeNull();
  });

  it('marks a job needs-review when Core does not answer within the deadline', async () => {
    const core = switchableCore();
    core.swap(fakeCore({ calls: core.calls }));
    const built = build({ core, env: { jobTimeoutMs: 20 }, handler: () => new Promise(() => undefined) });
    const job = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('to') }, auth);
    built.service.stopWorker();
    await executor(built).runOnce();
    const stored = await built.service.getJob(job.job_id);
    expect(stored).toMatchObject({ state: 'needs-review', reason: 'executor-timeout', lease: null });
    expect(stored?.rpc?.finished_at).toBeUndefined();
    expect(stored?.message).toMatch(/Core may still be running it/);
  });

  it('records a Core RPC error as a failed job', async () => {
    const core = switchableCore();
    core.swap(fakeCore({ calls: core.calls }));
    const built = build({ core, handler: async () => { throw new Error('already exists. If you are sure this is what you want, move it out of the way first'); } });
    const job = await built.service.createOperatorJob({ job_type: 'generate_snapshot', idempotency_key: key('err') }, auth);
    built.service.stopWorker();
    await executor(built).runOnce();
    expect(await built.service.getJob(job.job_id)).toMatchObject({ state: 'failed', reason: 'core-rpc-error' });
  });
});
