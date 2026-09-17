import { randomUUID } from 'crypto';
import { hostname } from 'os';
import config from '../../../config';
import logger from '../../../logger';
import { ownedWorkbenchCore, WorkbenchCoreReader } from '../workbench/workbench-core';
import { BootstrapNodeReader } from './node-reader';
import { BootstrapEnvironment, readBootstrapEnvironment } from './bootstrap-config';
import { BootstrapEvidenceError, unavailable } from './bootstrap-errors';
import { BootstrapStore, MysqlBootstrapStore } from './bootstrap-store';
import { BootstrapJobExecutor, OperatorCore } from './bootstrap-executor';
import {
  compatibleSnapshots,
  evaluateLoadEligibility,
  NodeObservation,
  requireFreshObservation,
  requireSupportedNode,
} from './bootstrap-preconditions';
import { StatfsReader } from './bootstrap-capacity';
import {
  BootstrapCatalogue,
  BootstrapCatalogueSnapshot,
  NodeBootstrapChainstatePhase,
  NodeBootstrapJob,
  NodeBootstrapPlan,
  NodeBootstrapSnapshot,
  NodeBootstrapVerification,
} from './bootstrap.models';
import { classifySource, deterministicSnapshotJson, loadCatalogue, pinnedCommitmentFor, producerFor } from './snapshot-catalogue';
import { newVerificationRecord, SnapshotByteSource, SnapshotVerifier } from './snapshot-verifier';

export { BootstrapEvidenceError } from './bootstrap-errors';

const hex64 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);

/** Signed control-plane identity the routes verified before calling the service. */
export interface OperatorAuthorization {
  keyId: string;
  elevated: boolean;
}

export interface BootstrapServiceDependencies {
  nodes?: BootstrapNodeReader;
  core?: WorkbenchCoreReader;
  operatorCore?: OperatorCore;
  env?: BootstrapEnvironment;
  store?: BootstrapStore | null;
  bytes?: SnapshotByteSource;
  network?: string;
  clock?: () => number;
  statfs?: StatfsReader;
  catalogue?: () => BootstrapCatalogue;
  workerOwner?: string;
}

function longTimeoutOperatorCore(env: BootstrapEnvironment): OperatorCore {
  // The shared client keeps a short timeout that suits reads; a snapshot RPC
  // runs for a long time against the same fixed node identity.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bitcoin = require('../../../rpc-api/index');
  const client = new bitcoin.Client({
    host: config.CORE_RPC.HOST,
    port: config.CORE_RPC.PORT,
    user: config.CORE_RPC.USERNAME,
    pass: config.CORE_RPC.PASSWORD,
    timeout: env.jobTimeoutMs,
    cookie: config.CORE_RPC.COOKIE ? config.CORE_RPC.COOKIE_PATH : undefined,
  });
  return { call: (method, params) => client.rpc.call(method, params) };
}

/**
 * Read-only node observation is always real. The catalogue, verification,
 * planning and operator subfeatures each report their own availability and
 * never invent a snapshot, a verification or a job.
 */
export class BootstrapService {
  private readonly nodes: BootstrapNodeReader;
  private readonly core: WorkbenchCoreReader;
  private readonly env: BootstrapEnvironment;
  private readonly store: BootstrapStore | null;
  private readonly network: string;
  private readonly clock: () => number;
  private readonly verifier: SnapshotVerifier;
  private readonly readCatalogue: () => BootstrapCatalogue;
  private readonly statfs?: StatfsReader;
  private operatorCore?: OperatorCore;
  private readonly workerOwner: string;
  private executor?: BootstrapJobExecutor;
  private readonly inflight = new Map<string, Promise<NodeBootstrapVerification>>();

  constructor(deps: BootstrapServiceDependencies = {}) {
    this.nodes = deps.nodes ?? new BootstrapNodeReader();
    this.core = deps.core ?? ownedWorkbenchCore;
    this.env = deps.env ?? readBootstrapEnvironment();
    this.network = deps.network ?? config.MEMPOOL.NETWORK;
    this.store = deps.store === undefined ? (config.DATABASE.ENABLED ? new MysqlBootstrapStore() : null) : deps.store;
    this.clock = deps.clock ?? (() => Date.now());
    this.statfs = deps.statfs;
    this.readCatalogue = deps.catalogue ?? ((): BootstrapCatalogue => loadCatalogue(this.env.catalogueFile));
    this.operatorCore = deps.operatorCore;
    this.workerOwner = deps.workerOwner ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.verifier = new SnapshotVerifier(this.env, this.nodes, this.core, deps.bytes, () => new Date(this.clock()).toISOString());
  }

  private requireStore(): BootstrapStore {
    if (!this.store) {
      throw new BootstrapEvidenceError(
        'durable-store-unavailable',
        'Bootstrap evidence is unavailable. Verification runs and operator jobs need the durable MySQL store (DATABASE.ENABLED).'
      );
    }
    return this.store;
  }

  private now(): string {
    return new Date(this.clock()).toISOString();
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  private async observation(): Promise<NodeObservation> {
    try {
      return await this.nodes.read();
    } catch {
      return unavailable(
        'unavailable-node-source',
        'A fresh, consistent owned Core chainstate and network observation could not be obtained.'
      );
    }
  }

  private catalogueStatus(): { status: 'available' | 'unavailable'; reason: string | null; catalogue: BootstrapCatalogue | null } {
    try {
      return { status: 'available', reason: null, catalogue: this.readCatalogue() };
    } catch (e) {
      return { status: 'unavailable', reason: e instanceof Error ? e.message : String(e), catalogue: null };
    }
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getOverview(): Promise<Record<string, unknown>> {
    const { capability, observation } = await this.observation();
    const catalogue = this.catalogueStatus();
    let snapshots: NodeBootstrapSnapshot[] = [];
    let snapshotReason = catalogue.reason;
    if (catalogue.catalogue) {
      try {
        snapshots = await this.joinSnapshots(catalogue.catalogue);
      } catch (e) {
        snapshotReason = e instanceof Error ? e.message : String(e);
      }
    }
    const verified = snapshots.filter((s) => s.status === 'pinned_core');
    return {
      total_nodes: 1,
      nodes: [capability],
      active_chainstates: [observation],
      snapshots,
      total_snapshots: catalogue.catalogue ? snapshots.length : null,
      configured_nodes_count: 1,
      dual_chainstate_nodes_count: observation.dual_chainstate_active ? 1 : 0,
      recommended_snapshot_height: verified.length ? Math.max(...verified.map((s) => s.height)) : null,
      featured_snapshots: verified,
      observed_nodes: [observation],
      snapshot_catalogue_status: catalogue.catalogue && !snapshotReason ? 'available' : 'unavailable',
      snapshot_catalogue_reason: snapshotReason,
      verification_store_status: this.store ? 'available' : 'unavailable',
      verification_store_reason: this.store ? null : 'Verification runs and operator jobs need the durable MySQL store (DATABASE.ENABLED).',
      planning_status: catalogue.catalogue && this.store ? 'available' : 'unavailable',
      operator_status: this.store && this.env.snapshotDir ? 'available' : 'unavailable',
      operator_reason: !this.store
        ? 'The durable job store is not connected.'
        : !this.env.snapshotDir
          ? 'No allowlisted snapshot directory is configured (UNIVERSE_BOOTSTRAP_SNAPSHOT_DIR).'
          : null,
    };
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async listNodes() {
    return [(await this.observation()).capability];
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async listNodeChainstates() {
    return [(await this.observation()).observation];
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getNodeChainstates(nodeId: string) {
    const observation = (await this.observation()).observation;
    return observation.node_id === nodeId ? observation : undefined;
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  private async joinSnapshots(catalogue: BootstrapCatalogue): Promise<NodeBootstrapSnapshot[]> {
    const out: NodeBootstrapSnapshot[] = [];
    for (const snapshot of catalogue.snapshots.filter((s) => s.network === this.network)) {
      const pinned = pinnedCommitmentFor(catalogue, snapshot);
      let latest: NodeBootstrapVerification | null = null;
      let storeUnavailable = false;
      if (this.store) {
        try {
          latest = await this.store.latestVerification(snapshot.id, this.network);
        } catch {
          storeUnavailable = true;
        }
      } else {
        storeUnavailable = true;
      }
      const state = latest?.state ?? null;
      const status: NodeBootstrapSnapshot['status'] = storeUnavailable
        ? 'unavailable'
        : state === 'valid'
          ? 'pinned_core'
          : state === 'invalid'
            ? 'invalid'
            : state === 'pending' || state === 'verifying'
              ? state
              : 'unverified';
      let downloadUrl: string | undefined;
      try {
        const source = classifySource(snapshot.source, this.env.sourceAllowlist);
        downloadUrl = source.kind === 'https' ? snapshot.source : undefined;
      } catch {
        downloadUrl = undefined;
      }
      out.push({
        snapshot_id: snapshot.id,
        network: snapshot.network,
        height: snapshot.height,
        block_hash: snapshot.blockHash,
        coins_count: pinned?.coinCount ?? null,
        base_utxo_hash: pinned?.utxoCommitment ?? null,
        sha256_checksum: snapshot.sha256,
        file_size_bytes: snapshot.sizeBytes,
        release_version: snapshot.coreVersion,
        status,
        ...(downloadUrl ? { download_url: downloadUrl } : {}),
        producer_id: snapshot.manifest.producerId,
        pinned_commitment: !!pinned,
        latest_verification_id: latest?.verification_id ?? null,
        latest_verification_state: state,
        name: `${snapshot.network} ${snapshot.height} (Bitcoin Core ${snapshot.coreVersion})`,
        base_height: snapshot.height,
        base_block_hash: snapshot.blockHash,
        txoutset_hash: pinned?.utxoCommitment ?? null,
        size_gb: snapshot.sizeBytes / 1073741824,
        is_verified: status === 'pinned_core',
        verification_status: status === 'pinned_core' ? 'verified' : status === 'invalid' ? 'hash_mismatch' : 'unverified',
      });
    }
    return out.sort((a, b) => b.height - a.height);
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async listSnapshots(): Promise<NodeBootstrapSnapshot[]> {
    return this.joinSnapshots(this.readCatalogue());
  }

  /** Looks a snapshot up by id, height or block hash on this network. */
  private resolveSnapshot(catalogue: BootstrapCatalogue, reference: string): BootstrapCatalogueSnapshot | undefined {
    const ref = String(reference ?? '').trim();
    return catalogue.snapshots.find(
      (s) => s.network === this.network && (s.id === ref || String(s.height) === ref || s.blockHash === ref.toLowerCase())
    );
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getSnapshot(reference: string): Promise<NodeBootstrapSnapshot | undefined> {
    const catalogue = this.readCatalogue();
    const snapshot = this.resolveSnapshot(catalogue, reference);
    if (!snapshot) {
      return undefined;
    }
    return (await this.joinSnapshots(catalogue)).find((s) => s.snapshot_id === snapshot.id);
  }

  /** The signed manifest of a catalogue snapshot: who signed which fields, and what Core pins for it. */
  public getSnapshotManifest(reference: string): Record<string, unknown> | undefined {
    const catalogue = this.readCatalogue();
    const snapshot = this.resolveSnapshot(catalogue, reference);
    if (!snapshot) {
      return undefined;
    }
    const producer = producerFor(catalogue, snapshot);
    const pinned = pinnedCommitmentFor(catalogue, snapshot);
    return {
      snapshot_id: snapshot.id,
      network: snapshot.network,
      core_version: snapshot.coreVersion,
      height: snapshot.height,
      block_hash: snapshot.blockHash,
      size_bytes: snapshot.sizeBytes,
      sha256: snapshot.sha256,
      producer_id: snapshot.manifest.producerId,
      algorithm: producer?.algorithm ?? null,
      public_key: producer?.publicKey ?? null,
      signature: snapshot.manifest.signature,
      signed_fields: deterministicSnapshotJson(snapshot).toString('utf8'),
      pinned_commitment: pinned ? { utxo_commitment: pinned.utxoCommitment, coin_count: pinned.coinCount, source: 'operator-pinned Bitcoin Core chainparams for ' + pinned.coreVersion } : null,
      note: 'A signed manifest identifies bytes; it is not evidence the bytes are valid. See the verification runs.',
    };
  }

  /**
   * Starts (or reuses) a verification run over the actual bytes. The answer is
   * the durable record, which is pending until the run reaches a final state;
   * poll getVerification. Caller checksums are recorded and compared, never
   * trusted.
   */
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async verifySnapshot(data: {
    snapshot_id?: string;
    file_sha256?: string;
    base_height?: number;
    expected_txoutset_hash?: string;
    height?: number;
    sha256?: string;
    utxo_hash?: string;
  }): Promise<NodeBootstrapVerification> {
    const height = data?.base_height ?? data?.height;
    const sha256 = data?.file_sha256 ?? data?.sha256;
    const utxoHash = data?.expected_txoutset_hash ?? data?.utxo_hash;
    if (
      (height !== undefined && (!Number.isSafeInteger(height) || Number(height) < 0)) ||
      (sha256 !== undefined && !hex64(sha256)) ||
      (utxoHash !== undefined && !hex64(utxoHash)) ||
      (data?.snapshot_id !== undefined && typeof data.snapshot_id !== 'string') ||
      (data?.snapshot_id === undefined && height === undefined)
    ) {
      throw new BootstrapEvidenceError(
        'invalid-input',
        'A snapshot_id or a nonnegative base height is required; checksums, when given, are 32-byte hexadecimal.',
        400
      );
    }
    const catalogue = this.readCatalogue();
    const store = this.requireStore();
    const snapshot = this.resolveSnapshot(catalogue, data.snapshot_id ?? String(height));
    if (!snapshot) {
      throw new BootstrapEvidenceError('snapshot-not-in-catalogue', 'No trusted catalogue snapshot matches that reference on this network.', 404);
    }
    if (height !== undefined && height !== snapshot.height) {
      throw new BootstrapEvidenceError('invalid-input', `Snapshot ${snapshot.id} is at height ${snapshot.height}, not ${height}.`, 400);
    }
    const active = await store.activeVerification(snapshot.id, this.network);
    if (active) {
      return active;
    }
    const record = newVerificationRecord(
      randomUUID(),
      snapshot,
      { sha256: sha256 ? sha256.toLowerCase() : null, utxo_hash: utxoHash ? utxoHash.toLowerCase() : null, height: height ?? null },
      this.now()
    );
    await store.insertVerification(record);
    const run = this.verifier
      .run(JSON.parse(JSON.stringify(record)), catalogue, snapshot, store)
      .catch(async (e) => {
        logger.err('[bootstrap] verification run failed: ' + (e instanceof Error ? e.message : e));
        record.state = 'unavailable';
        record.status = 'unavailable';
        record.reason = 'run-failed';
        record.details = 'The verification run stopped before recording an outcome: ' + (e instanceof Error ? e.message : String(e));
        record.finished_at = this.now();
        try {
          await store.updateVerification(record);
        } catch (storeError) {
          logger.err('[bootstrap] verification outcome could not be stored: ' + (storeError instanceof Error ? storeError.message : storeError));
        }
        return record;
      })
      .finally(() => this.inflight.delete(record.verification_id));
    this.inflight.set(record.verification_id, run);
    return record;
  }

  /** Resolves once the named run has a final state; for tests and callers that can wait. */
  public awaitVerification(verificationId: string): Promise<NodeBootstrapVerification | undefined> {
    return this.inflight.get(verificationId) ?? Promise.resolve(undefined);
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getVerification(verificationId: string): Promise<NodeBootstrapVerification | undefined> {
    const store = this.requireStore();
    try {
      return (await store.getVerification(verificationId, this.network)) ?? undefined;
    } catch (e) {
      throw new BootstrapEvidenceError(
        'durable-store-unavailable',
        'The durable verification store did not answer; absence of the run cannot be established: ' + (e instanceof Error ? e.message : String(e))
      );
    }
  }

  /**
   * A feasibility statement from measurements: the observed node, the
   * measured capacity and a verified, pinned, compatible snapshot. Nothing is
   * executed. Caller values are recorded as declarations or assumptions.
   */
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async createBootstrapPlan(params: {
    node_id?: string;
    node_version?: string;
    network?: string;
    target_height?: number;
    snapshot_id?: string;
    available_disk_gb?: number;
    bandwidth_mbps?: number;
  }): Promise<NodeBootstrapPlan> {
    const p = params ?? {};
    if (p.network !== undefined && p.network !== this.network) {
      throw new BootstrapEvidenceError('unsupported-network', `This backend plans for ${this.network}, not ${p.network}.`, 409);
    }
    const catalogue = this.readCatalogue();
    const store = this.requireStore();
    const observation = await this.observation();
    const nowMs = this.clock();
    requireFreshObservation(observation, nowMs, 60000);
    const version = requireSupportedNode(observation, this.network);
    if (p.node_id !== undefined && p.node_id !== observation.capability.node_id) {
      throw new BootstrapEvidenceError('node-not-observed', `The owned node is ${observation.capability.node_id}, not ${p.node_id}.`, 404);
    }
    if (p.node_version !== undefined && String(p.node_version).replace(/^v/, '') !== version.version) {
      throw new BootstrapEvidenceError('unsupported-version', `The owned node runs Bitcoin Core ${version.version}, not ${p.node_version}; plans are made for the measured version.`, 409);
    }
    const candidates = compatibleSnapshots(catalogue, this.network, version);
    let chosen = candidates;
    if (p.snapshot_id !== undefined) {
      chosen = candidates.filter((c) => c.snapshot.id === p.snapshot_id);
    } else if (p.target_height !== undefined) {
      chosen = candidates.filter((c) => c.snapshot.height === p.target_height);
    }
    if (!chosen.length) {
      throw new BootstrapEvidenceError('no-compatible-snapshot', `No catalogue snapshot on ${this.network} has a commitment pinned for Bitcoin Core ${version.version}` + (p.target_height !== undefined ? ` at height ${p.target_height}.` : '.'), 409);
    }
    let selected: Awaited<ReturnType<typeof evaluateLoadEligibility>> | undefined;
    let snapshot: BootstrapCatalogueSnapshot | undefined;
    let lastError: BootstrapEvidenceError | undefined;
    for (const candidate of chosen) {
      try {
        selected = await evaluateLoadEligibility({ observation, network: this.network, snapshot: candidate.snapshot, catalogue, store, env: this.env, now: nowMs, statfs: this.statfs });
        snapshot = candidate.snapshot;
        break;
      } catch (e) {
        if (!(e instanceof BootstrapEvidenceError)) {
          throw e;
        }
        lastError = e;
        // Capacity and chainstate rejections hold for every candidate; only an
        // unverified snapshot lets the next newest one be considered.
        if (e.code !== 'snapshot-not-verified') {
          throw e;
        }
      }
    }
    if (!selected || !snapshot) {
      throw lastError ?? new BootstrapEvidenceError('no-compatible-snapshot', 'No compatible snapshot could be selected.', 409);
    }
    const chain = observation.observation;
    const blocksOnDisk = Math.round(chain.disk_used_gb * 1073741824);
    const declaredDisk = typeof p.available_disk_gb === 'number' && Number.isFinite(p.available_disk_gb) ? p.available_disk_gb : null;
    const bandwidth = typeof p.bandwidth_mbps === 'number' && Number.isFinite(p.bandwidth_mbps) && p.bandwidth_mbps > 0 ? p.bandwidth_mbps : null;
    const hours = (bytes: number): number | null => (bandwidth ? Math.round(((bytes * 8) / (bandwidth * 1e6) / 3600) * 100) / 100 : null);
    const assumptions = [
      'The chainstate built from the snapshot is assumed to need as much disk as the snapshot file; a tenth of both is added as headroom.',
      'Core reports size_on_disk for block and undo data only; chainstate and indexes are not in the measured usage.',
      bandwidth ? `Download estimates assume the caller-declared ${bandwidth} Mbps and nothing else.` : 'No bandwidth was declared, so no download time is estimated.',
      'Validation durations are not estimated: this backend has no measurement of the node CPU or disk throughput.',
    ];
    return {
      plan_id: randomUUID(),
      network: this.network,
      node_id: observation.capability.node_id,
      node_version: version.version,
      target_height: snapshot.height,
      measurement_status: 'measured',
      measured: {
        node_observed_at: chain.observed_at,
        current_phase: chain.current_phase as NodeBootstrapChainstatePhase,
        tip_height: chain.tip_height,
        headers: chain.tip_height + chain.estimated_remaining_blocks,
        blocks_on_disk_bytes: blocksOnDisk,
        capacity: selected.capacity,
        supports_loadtxoutset: observation.capability.supports_loadtxoutset,
      },
      selected_snapshot: {
        snapshot_id: snapshot.id,
        height: snapshot.height,
        block_hash: snapshot.blockHash,
        core_version: snapshot.coreVersion,
        size_bytes: snapshot.sizeBytes,
        sha256: snapshot.sha256,
        utxo_commitment: selected.pinned.utxoCommitment,
        verification_id: selected.verification.verification_id,
        verified_at: selected.verification.verified_at,
      },
      requirements: {
        snapshot_file_bytes: snapshot.sizeBytes,
        chainstate_estimate_bytes: selected.required.chainstate_estimate_bytes,
        headroom_bytes: selected.required.headroom_bytes,
        required_bytes: selected.required.required_bytes,
        free_bytes: selected.capacity.free_bytes,
        feasible: true,
      },
      assumptions,
      caller_declared: {
        available_disk_gb: declaredDisk,
        bandwidth_mbps: bandwidth,
        matches_measurement: declaredDisk === null ? null : Math.abs(declaredDisk * 1073741824 - selected.capacity.free_bytes) <= selected.capacity.free_bytes * 0.1,
      },
      estimates: {
        snapshot_download_hours: hours(snapshot.sizeBytes),
        ibd_download_hours: hours(blocksOnDisk),
        basis: bandwidth ? 'bytes over the caller-declared bandwidth; no validation time is included' : 'not estimated',
      },
      expected_transitions: ['snapshot_loading', 'snapshot_active_syncing_to_tip', 'background_validation', 'fully_validated'],
      actions_not_executed: [
        `loadtxoutset ${snapshot.source.replace(/.*[\\/]/, '')} on ${observation.capability.node_id} through an authorized operator job`,
        'Core validates the pinned hash_serialized_3 itself before activating the snapshot chainstate.',
      ],
      rollback_instructions: [
        'Stop the node and remove the chainstate_snapshot directory to return to the validated chainstate.',
        'A snapshot chainstate that finished background validation replaces the original and needs no rollback.',
      ],
      created_at: this.now(),
    };
  }

  /**
   * Accepts a job for the owned node after the route verified the signed
   * control-plane request. Queued is all this promises; the bounded worker
   * runs it and records what Core answered.
   */
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async createOperatorJob(
    params: {
      job_type: 'generate_snapshot' | 'load_snapshot';
      node_id?: string;
      snapshot_id?: string;
      idempotency_key?: string;
      confirm?: string;
    },
    authorization: OperatorAuthorization | undefined
  ): Promise<NodeBootstrapJob> {
    if (!authorization || typeof authorization.keyId !== 'string' || !authorization.keyId) {
      throw new BootstrapEvidenceError('UNAUTHORIZED', 'Operator jobs need a verified signed control-plane request.', 401);
    }
    if (params?.job_type !== 'generate_snapshot' && params?.job_type !== 'load_snapshot') {
      throw new BootstrapEvidenceError('invalid-input', 'job_type must be generate_snapshot or load_snapshot.', 400);
    }
    if (params.job_type === 'load_snapshot' && !authorization.elevated) {
      throw new BootstrapEvidenceError('ELEVATION_REQUIRED', 'Loading a snapshot replaces the active chainstate; it requires adminAuthorization.elevated=true in the signed body.', 403);
    }
    if (params.job_type === 'load_snapshot' && params.confirm !== 'load_snapshot') {
      throw new BootstrapEvidenceError('invalid-input', 'A load needs the typed confirmation confirm="load_snapshot".', 400);
    }
    const idempotencyKey = params.idempotency_key;
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new BootstrapEvidenceError('invalid-input', 'idempotency_key (8 to 128 characters of [A-Za-z0-9._:-]) is required.', 400);
    }
    const store = this.requireStore();
    if (!this.env.snapshotDir) {
      throw new BootstrapEvidenceError('unavailable-operator', 'Bootstrap evidence is unavailable. No allowlisted snapshot directory is configured (UNIVERSE_BOOTSTRAP_SNAPSHOT_DIR); no node operation was started.');
    }
    const observation = await this.observation();
    const nodeId = observation.capability.node_id;
    if (params.node_id !== undefined && params.node_id !== nodeId) {
      throw new BootstrapEvidenceError('node-not-observed', `The owned node is ${nodeId}, not ${params.node_id}.`, 404);
    }
    const catalogue = this.readCatalogue();
    if (params.job_type === 'generate_snapshot') {
      requireSupportedNode(observation, this.network);
      if (!observation.capability.supports_dumptxoutset) {
        throw new BootstrapEvidenceError('node-capability-missing', 'The owned node does not expose dumptxoutset.', 409);
      }
      if (observation.observation.current_phase !== 'fully_validated') {
        throw new BootstrapEvidenceError('chainstate-not-eligible', `A snapshot is only generated from a fully validated chainstate; the node is in ${observation.observation.current_phase}.`, 409);
      }
    } else {
      const snapshot = catalogue.snapshots.find((s) => s.id === params.snapshot_id && s.network === this.network);
      if (!snapshot) {
        throw new BootstrapEvidenceError('snapshot-not-in-catalogue', 'No trusted catalogue snapshot matches snapshot_id on this network.', 404);
      }
      await evaluateLoadEligibility({ observation, network: this.network, snapshot, catalogue, store, env: this.env, now: this.clock(), statfs: this.statfs });
    }
    const existing = await store.activeJob(this.network, nodeId);
    if (existing && existing.idempotency_key !== idempotencyKey) {
      throw new BootstrapEvidenceError('job-already-active', `Job ${existing.job_id} (${existing.job_type}) is ${existing.state} on ${nodeId}; one node runs one operator job at a time.`, 409);
    }
    const now = this.now();
    const job: NodeBootstrapJob = {
      job_id: randomUUID(),
      job_type: params.job_type,
      network: this.network,
      node_id: nodeId,
      ...(params.snapshot_id ? { snapshot_id: params.snapshot_id } : {}),
      idempotency_key: idempotencyKey,
      state: 'queued',
      status: 'queued',
      progress_pct: 0,
      message: 'Queued. No node operation has started; the worker re-checks every precondition before issuing the RPC.',
      requested_by: authorization.keyId,
      created_at: now,
      updated_at: now,
      attempts: 0,
      lease: null,
      rpc: null,
      preconditions: {},
      evidence: {},
      checkpoints: [{ at: now, stage: 'queued', detail: 'requested by ' + authorization.keyId }],
    };
    const stored = await store.insertJob(job);
    this.startWorker();
    return stored.job;
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getJob(jobId: string): Promise<NodeBootstrapJob | undefined> {
    const store = this.requireStore();
    try {
      return (await store.getJob(jobId, this.network)) ?? undefined;
    } catch (e) {
      throw new BootstrapEvidenceError('durable-store-unavailable', 'The durable job store did not answer: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** Starts the bounded worker once the durable store and output directory exist; idle otherwise. */
  public startWorker(): BootstrapJobExecutor | undefined {
    if (!this.store || !this.env.snapshotDir) {
      return undefined;
    }
    if (!this.executor) {
      this.executor = new BootstrapJobExecutor({
        env: this.env,
        network: this.network,
        store: this.store,
        nodes: this.nodes,
        core: this.core,
        operatorCore: this.operatorCore ?? longTimeoutOperatorCore(this.env),
        catalogue: this.readCatalogue,
        owner: this.workerOwner,
        clock: this.clock,
        statfs: this.statfs,
      });
      this.executor.start();
    }
    return this.executor;
  }

  public stopWorker(): void {
    this.executor?.stop();
    this.executor = undefined;
  }
}

export default new BootstrapService();
