import { BootstrapService, BootstrapEvidenceError } from './bootstrap.service';
import { BootstrapNodeReader } from './node-reader';
import { MemoryBootstrapStore } from './bootstrap-store';
import { BootstrapCatalogue, NodeBootstrapVerification } from './bootstrap.models';
import { parseCatalogue, classifySource, verifyManifestSignature } from './snapshot-catalogue';
import { NETWORK_MAGIC } from './snapshot-format';
import { byteSource, catalogueFor, fakeCore, FIXTURE, FIXTURE_BYTES, producerKeys, testEnvironment } from './__fixtures__/support';

const keys = producerKeys();
const statfsPlenty = async (): Promise<{ bsize: number; bavail: number; blocks: number }> => ({ bsize: 4096, bavail: 1 << 20, blocks: 1 << 21 });

function service(options: {
  catalogue?: BootstrapCatalogue | (() => BootstrapCatalogue);
  store?: MemoryBootstrapStore | null;
  bytes?: Buffer;
  core?: ReturnType<typeof fakeCore>;
  env?: Parameters<typeof testEnvironment>[0];
  byteOptions?: { chunk?: number; stall?: boolean };
  statfs?: typeof statfsPlenty;
  clock?: () => number;
} = {}): { service: BootstrapService; store: MemoryBootstrapStore | null; core: ReturnType<typeof fakeCore>; source: ReturnType<typeof byteSource> } {
  const core = options.core ?? fakeCore();
  const store = options.store === undefined ? new MemoryBootstrapStore() : options.store;
  const source = byteSource(options.bytes ?? FIXTURE_BYTES, options.byteOptions);
  const catalogue = options.catalogue ?? catalogueFor(keys.privateKey, keys.publicKeyHex);
  return {
    service: new BootstrapService({
      nodes: new BootstrapNodeReader(core),
      core,
      env: testEnvironment(options.env),
      store,
      bytes: source,
      network: 'regtest',
      statfs: options.statfs ?? statfsPlenty,
      clock: options.clock,
      catalogue: typeof catalogue === 'function' ? catalogue : () => catalogue,
      operatorCore: { call: async () => { throw new Error('operator core must not be reached by verification'); } },
    }),
    store,
    core,
    source,
  };
}

async function verified(s: BootstrapService, data: Record<string, unknown> = { snapshot_id: 'regtest-105' }): Promise<NodeBootstrapVerification> {
  const pending = await s.verifySnapshot(data);
  expect(pending.state).toBe('pending');
  expect(pending.valid).toBe(false);
  const done = await s.awaitVerification(pending.verification_id);
  expect(done).toBeDefined();
  return done as NodeBootstrapVerification;
}

describe('BootstrapService catalogue', () => {
  it('parses a signed catalogue and rejects malformed ones with a typed reason', () => {
    const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex);
    const parsed = parseCatalogue(JSON.stringify(catalogue));
    expect(parsed.snapshots[0].id).toBe('regtest-105');
    expect(verifyManifestSignature(parsed.snapshots[0], parsed.producers[0])).toBe(true);
    expect(verifyManifestSignature({ ...parsed.snapshots[0], height: 104 }, parsed.producers[0])).toBe(false);
    for (const broken of [
      'not json',
      '[]',
      JSON.stringify({ ...catalogue, producers: [{ id: 'lab', algorithm: 'rsa', publicKey: keys.publicKeyHex }] }),
      JSON.stringify({ ...catalogue, pinnedCommitments: [{ network: 'mainnet', coreVersion: '28', height: 1, blockHash: 'x', utxoCommitment: 'y' }] }),
      JSON.stringify({ ...catalogue, snapshots: [{ ...catalogue.snapshots[0], manifest: { producerId: 'nobody', signature: 'ab'.repeat(64) } }] }),
      JSON.stringify({ ...catalogue, snapshots: [catalogue.snapshots[0], catalogue.snapshots[0]] }),
    ]) {
      expect(() => parseCatalogue(broken)).toThrow(expect.objectContaining({ code: 'invalid-catalogue' }));
    }
  });

  it('only accepts sources under the operator allowlist', () => {
    expect(classifySource('/allowed/x.dat', ['/allowed'])).toEqual({ kind: 'file', ref: 'x.dat' });
    expect(classifySource('https://snapshots.example/regtest/x.dat', ['https://snapshots.example/regtest'])).toEqual({ kind: 'https', ref: 'https://snapshots.example/x.dat' });
    for (const [source, allow] of [['/allowed/../etc/passwd', ['/allowed']], ['/other/x.dat', ['/allowed']], ['https://evil.example/x.dat', ['https://snapshots.example']], ['http://snapshots.example/x.dat', ['http://snapshots.example']], ['ftp://x/y', ['ftp://x']]] as const) {
      expect(() => classifySource(source, [...allow])).toThrow(expect.objectContaining({ code: 'source-not-allowlisted' }));
    }
  });

  it('keeps node and chainstate reads working and reports subfeatures truthfully without a catalogue', async () => {
    const { service: s } = service({ catalogue: () => { throw new BootstrapEvidenceError('unavailable-manifest', 'no catalogue'); }, store: null });
    expect((await s.listNodes())[0].node_id).toBe('owned-core-regtest');
    expect((await s.listNodeChainstates())[0].current_phase).toBe('fully_validated');
    expect((await s.getNodeChainstates('owned-core-regtest'))?.tip_height).toBe(FIXTURE.height);
    const overview = await s.getOverview();
    expect(overview.snapshot_catalogue_status).toBe('unavailable');
    expect(overview.verification_store_status).toBe('unavailable');
    expect(overview.operator_status).toBe('unavailable');
    expect(overview.snapshots).toEqual([]);
    await expect(s.listSnapshots()).rejects.toThrow(expect.objectContaining({ code: 'unavailable-manifest' }));
    await expect(s.getSnapshot('105')).rejects.toThrow(BootstrapEvidenceError);
  });

  it('lists catalogue snapshots as unverified until a run over the bytes reaches valid', async () => {
    const { service: s } = service();
    const before = await s.listSnapshots();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ snapshot_id: 'regtest-105', network: 'regtest', height: 105, status: 'unverified', pinned_commitment: true, base_utxo_hash: FIXTURE.hashSerialized3, is_verified: false });
    expect(before[0].download_url).toBeUndefined();
    await verified(s);
    const after = await s.getSnapshot(FIXTURE.baseHash);
    expect(after?.status).toBe('pinned_core');
    expect(after?.is_verified).toBe(true);
    expect((await s.getOverview()).recommended_snapshot_height).toBe(105);
    expect(s.getSnapshotManifest('105')).toMatchObject({ producer_id: 'lab', algorithm: 'ed25519', pinned_commitment: { utxo_commitment: FIXTURE.hashSerialized3 } });
  });
});

describe('BootstrapService verification', () => {
  it('needs the durable store and tells a missing record from a missing store', async () => {
    const { service: s } = service({ store: null });
    await expect(s.verifySnapshot({ snapshot_id: 'regtest-105' })).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable', status: 503 }));
    await expect(s.getVerification('missing')).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable', status: 503 }));
    const { service: withStore, store } = service();
    expect(await withStore.getVerification('missing')).toBeUndefined();
    (store as MemoryBootstrapStore).getVerification = async () => { throw new Error('connection lost'); };
    await expect(withStore.getVerification('missing')).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable' }));
  });

  it('rejects malformed input and unknown snapshots before touching the store', async () => {
    const { service: s } = service();
    for (const data of [{}, { height: -1 }, { height: 105, sha256: 'z'.repeat(64) }, { snapshot_id: 5 }]) {
      await expect(s.verifySnapshot(data as any)).rejects.toThrow(expect.objectContaining({ code: 'invalid-input', status: 400 }));
    }
    await expect(s.verifySnapshot({ height: 840000 })).rejects.toThrow(expect.objectContaining({ code: 'snapshot-not-in-catalogue', status: 404 }));
    await expect(s.verifySnapshot({ snapshot_id: 'regtest-105', height: 104 })).rejects.toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('verifies real bytes against the signed manifest, the owned node and the pinned Core commitment', async () => {
    const { service: s, source, core } = service();
    const record = await verified(s, { height: 105, sha256: FIXTURE.sha256.toUpperCase(), utxo_hash: FIXTURE.hashSerialized3 });
    expect(record.state).toBe('valid');
    expect(record.valid).toBe(true);
    expect(Object.values(record.checks).map((c) => c.status)).toEqual(Array(8).fill('valid'));
    expect(record.checks.utxo_commitment).toEqual({ status: 'valid', expected: FIXTURE.hashSerialized3, observed: FIXTURE.hashSerialized3 });
    expect(record.evidence).toMatchObject({ source_kind: 'file', source_ref: 'regtest-105.dat', bytes_read: FIXTURE_BYTES.length, header_format: 'versioned', snapshot_version: 2, core_node_id: 'owned-core-regtest', core_block_hash_at_height: FIXTURE.baseHash });
    expect(record.caller_inputs).toEqual({ sha256: FIXTURE.sha256, utxo_hash: FIXTURE.hashSerialized3, height: 105, matched: true });
    expect(record.checkpoints.map((c) => c.stage)).toEqual(['queued', 'started', 'manifest-signature', 'core-base-block', 'bytes', 'bytes', 'finished']);
    expect(source.opened).toEqual(['/allowed/regtest-105.dat']);
    expect(core.calls).toContain('getblockhash');
    expect(await s.getVerification(record.verification_id)).toEqual(record);
  });

  it('fails on altered bytes while the signature check still passes', async () => {
    const altered = Buffer.from(FIXTURE_BYTES);
    altered[altered.length - 1] ^= 0x01;
    const record = await verified(service({ bytes: altered }).service);
    expect(record.state).toBe('invalid');
    expect(record.checks.sha256.status).toBe('invalid');
    expect(record.checks.manifest_signature.status).toBe('valid');
    expect(record.checks.utxo_commitment.status).toBe('invalid');
    expect(record.checks.base_block_hash.status).toBe('valid');
  });

  it('fails on a bad manifest signature while the bytes still verify', async () => {
    const other = producerKeys();
    const catalogue = catalogueFor(other.privateKey, keys.publicKeyHex);
    const record = await verified(service({ catalogue }).service);
    expect(record.state).toBe('invalid');
    expect(record.checks.manifest_signature.status).toBe('invalid');
    expect(record.checks.sha256.status).toBe('valid');
    expect(record.checks.utxo_commitment.status).toBe('valid');
  });

  it('fails on the wrong network magic independently of the file hash', async () => {
    const signet = Buffer.from(FIXTURE_BYTES);
    Buffer.from(NETWORK_MAGIC.signet, 'hex').copy(signet, 7);
    const sha256 = require('crypto').createHash('sha256').update(signet).digest('hex');
    const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex, { sha256 });
    const record = await verified(service({ catalogue, bytes: signet }).service);
    expect(record.state).toBe('invalid');
    expect(record.checks.network_magic.status).toBe('invalid');
    expect(record.checks.sha256.status).toBe('valid');
    expect(record.checks.manifest_signature.status).toBe('valid');
  });

  it('fails when the owned node has another block at the catalogue height', async () => {
    const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex, { height: 104 }, { height: 104 });
    const record = await verified(service({ catalogue }).service, { snapshot_id: 'regtest-105' });
    expect(record.state).toBe('invalid');
    expect(record.checks.base_height).toMatchObject({ status: 'invalid', expected: 104, observed: 104 });
    expect(record.checks.sha256.status).toBe('valid');
  });

  it('fails when the pinned Core commitment differs from the streamed hash_serialized_3', async () => {
    const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex, {}, { utxoCommitment: 'ab'.repeat(32) });
    const record = await verified(service({ catalogue }).service);
    expect(record.state).toBe('invalid');
    expect(record.checks.utxo_commitment).toMatchObject({ status: 'invalid', expected: 'ab'.repeat(32), observed: FIXTURE.hashSerialized3 });
    expect(record.checks.sha256.status).toBe('valid');
  });

  it('is unavailable, never valid, without a pinned commitment for the release', async () => {
    const catalogue = catalogueFor(keys.privateKey, keys.publicKeyHex, {}, { coreVersion: '29.0.0' });
    const record = await verified(service({ catalogue }).service);
    expect(record.state).toBe('unavailable');
    expect(record.valid).toBe(false);
    expect(record.reason).toBe('no-pinned-commitment');
    expect(record.checks.utxo_commitment.status).toBe('not-evaluated');
    expect(record.checks.sha256.status).toBe('valid');
  });

  it('is unavailable when the source exceeds the bounded size or the deadline', async () => {
    const big = await verified(service({ env: { maxSnapshotBytes: 1000 } }).service);
    expect(big.state).toBe('unavailable');
    expect(big.reason).toBe('size-exceeded');
    expect(big.checks.sha256.status).toBe('not-evaluated');
    expect(big.evidence.bytes_read).toBeGreaterThan(1000);
    const slow = await verified(service({ env: { verifyDeadlineMs: 30 }, byteOptions: { stall: true } }).service);
    expect(slow.state).toBe('unavailable');
    expect(slow.reason).toBe('deadline-exceeded');
    expect(slow.evidence.bytes_read).toBe(FIXTURE_BYTES.length);
    const denied = await verified(service({ env: { sourceAllowlist: ['/elsewhere'] } }).service);
    expect(denied.state).toBe('unavailable');
    expect(denied.reason).toBe('source-not-allowlisted');
  });

  it('reuses the running record for a duplicate request and persists both states', async () => {
    const { service: s, store } = service({ byteOptions: { chunk: 64 } });
    const first = await s.verifySnapshot({ snapshot_id: 'regtest-105' });
    const second = await s.verifySnapshot({ height: 105 });
    expect(second.verification_id).toBe(first.verification_id);
    expect(['pending', 'verifying']).toContain(second.state);
    const done = await s.awaitVerification(first.verification_id);
    expect(done?.state).toBe('valid');
    expect((store as MemoryBootstrapStore).verifications.size).toBe(1);
    const third = await s.verifySnapshot({ snapshot_id: 'regtest-105' });
    expect(third.verification_id).not.toBe(first.verification_id);
    await s.awaitVerification(third.verification_id);
  });
});

describe('BootstrapService planning', () => {
  const ibdCore = (): ReturnType<typeof fakeCore> => fakeCore({ blocks: 10, headers: 200, ibd: true });

  async function ready(options: Parameters<typeof service>[0] = {}): Promise<ReturnType<typeof service>> {
    const built = service({ core: ibdCore(), ...options });
    await verified(built.service);
    return built;
  }

  it('emits a measured, feasible plan with nothing executed', async () => {
    const { service: s } = await ready();
    const plan = await s.createBootstrapPlan({ network: 'regtest', target_height: 105, available_disk_gb: 4, bandwidth_mbps: 100 });
    expect(plan).toMatchObject({
      network: 'regtest', node_id: 'owned-core-regtest', node_version: '28.0.0', target_height: 105, measurement_status: 'measured',
      measured: { current_phase: 'traditional_ibd', tip_height: 10, headers: 200, capacity: { method: 'statfs', free_bytes: 4096 * (1 << 20) }, supports_loadtxoutset: true },
      selected_snapshot: { snapshot_id: 'regtest-105', utxo_commitment: FIXTURE.hashSerialized3 },
      requirements: { snapshot_file_bytes: FIXTURE_BYTES.length, feasible: true },
      caller_declared: { available_disk_gb: 4, bandwidth_mbps: 100, matches_measurement: true },
      expected_transitions: ['snapshot_loading', 'snapshot_active_syncing_to_tip', 'background_validation', 'fully_validated'],
    });
    expect(plan.selected_snapshot.verification_id).toHaveLength(36);
    expect(plan.requirements.required_bytes).toBe(FIXTURE_BYTES.length * 2 + Math.ceil(FIXTURE_BYTES.length * 2 * 0.1));
    expect(plan.estimates.snapshot_download_hours).not.toBeNull();
    expect(plan.actions_not_executed[0]).toMatch(/loadtxoutset regtest-105.dat on owned-core-regtest/);
    expect(plan.assumptions.length).toBeGreaterThan(2);
  });

  it('rejects every unmeasured or incompatible precondition with a typed reason', async () => {
    const { service: s } = await ready();
    await expect(s.createBootstrapPlan({ network: 'signet' })).rejects.toThrow(expect.objectContaining({ code: 'unsupported-network', status: 409 }));
    await expect(s.createBootstrapPlan({ node_version: '27.0.0' })).rejects.toThrow(expect.objectContaining({ code: 'unsupported-version' }));
    await expect(s.createBootstrapPlan({ node_id: 'other' })).rejects.toThrow(expect.objectContaining({ code: 'node-not-observed', status: 404 }));
    await expect(s.createBootstrapPlan({ target_height: 840000 })).rejects.toThrow(expect.objectContaining({ code: 'no-compatible-snapshot' }));

    const old = await ready({ core: fakeCore({ blocks: 10, headers: 200, ibd: true, subversion: '/Satoshi:25.1.0/' }) });
    await expect(old.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'unsupported-version' }));

    const noLoad = await ready({ core: fakeCore({ blocks: 10, headers: 200, ibd: true, help: 'getchainstates\n' }) });
    await expect(noLoad.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'node-capability-missing' }));

    const v29 = await ready({ core: fakeCore({ blocks: 10, headers: 200, ibd: true, subversion: '/Satoshi:29.0.0/' }) });
    await expect(v29.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'no-compatible-snapshot' }));

    const unverified = service({ core: ibdCore() }).service;
    await expect(unverified.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'snapshot-not-verified' }));

    const noCapacity = await ready({ env: { datadir: undefined } });
    await expect(noCapacity.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'capacity-not-measured' }));

    const stale = await ready({ env: { datadir: undefined, capacityBytes: 10 ** 12, capacityMeasuredAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() } });
    await expect(stale.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'stale-measurement', status: 409 }));

    const fresh = await ready({ env: { datadir: undefined, capacityBytes: 10 ** 12, capacityMeasuredAt: new Date().toISOString() } });
    expect((await fresh.service.createBootstrapPlan({})).measured.capacity.method).toBe('configured');

    const small = await ready({ statfs: async () => ({ bsize: 512, bavail: 4, blocks: 8 }) });
    await expect(small.service.createBootstrapPlan({ available_disk_gb: 1000 })).rejects.toThrow(expect.objectContaining({ code: 'insufficient-capacity' }));

    const validated = await ready({ core: fakeCore() });
    await expect(validated.service.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'chainstate-not-eligible' }));
  });

  it('needs the catalogue and the durable store', async () => {
    const { service: noStore } = service({ core: ibdCore(), store: null });
    await expect(noStore.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'durable-store-unavailable' }));
    const { service: noCatalogue } = service({ core: ibdCore(), catalogue: () => { throw new BootstrapEvidenceError('unavailable-manifest', 'none'); } });
    await expect(noCatalogue.createBootstrapPlan({})).rejects.toThrow(expect.objectContaining({ code: 'unavailable-manifest' }));
  });
});
