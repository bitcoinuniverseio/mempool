import logger from '../../../logger';
import { WorkbenchCoreReader } from '../workbench/workbench-core';
import { BootstrapEnvironment } from './bootstrap-config';
import { BootstrapEvidenceError } from './bootstrap-errors';
import { evaluateLoadEligibility, NodeObservation, requireSupportedNode } from './bootstrap-preconditions';
import { BootstrapStore } from './bootstrap-store';
import { BootstrapCatalogue, NodeBootstrapJob, NodeBootstrapJobState } from './bootstrap.models';
import { BootstrapNodeReader } from './node-reader';
import { measureCapacity, StatfsReader } from './bootstrap-capacity';
import { classifySource } from './snapshot-catalogue';

/** The owned Core, reached with a timeout long enough for a snapshot RPC. */
export interface OperatorCore {
  call(method: 'dumptxoutset' | 'loadtxoutset', params: unknown[]): Promise<any>;
}

export interface ExecutorDependencies {
  env: BootstrapEnvironment;
  network: string;
  store: BootstrapStore;
  nodes: BootstrapNodeReader;
  core: WorkbenchCoreReader;
  operatorCore: OperatorCore;
  catalogue: () => BootstrapCatalogue;
  owner: string;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  statfs?: StatfsReader;
  /** How many chainstate observations to take after loadtxoutset returns. */
  loadObservationAttempts?: number;
}

const hash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;

/**
 * Bounded worker for operator jobs. It claims one job at a time under a
 * lease, re-checks every precondition against the live node, issues exactly
 * one Core RPC with a fixed path derived from configuration, and records what
 * Core answered. A lapsed lease (worker crash) lets another worker reclaim
 * the job; a job whose RPC was already issued is reconciled from the node,
 * never re-issued.
 */
export class BootstrapJobExecutor {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ExecutorDependencies) {
    this.clock = deps.clock ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.runOnce().catch((e) => logger.warn('[bootstrap-executor] poll failed: ' + (e instanceof Error ? e.message : e)));
    }, this.deps.env.jobPollMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Claims and executes at most one job; returns it, or null when nothing was claimable. */
  /** @asyncUnsafe The caller logs a rejection; the job itself is written before rethrowing. */
  public async runOnce(): Promise<NodeBootstrapJob | null> {
    if (this.busy) {
      return null;
    }
    this.busy = true;
    try {
      const job = await this.deps.store.claimJob(this.deps.network, this.deps.owner, this.iso(), this.deps.env.jobLeaseMs);
      if (!job) {
        return null;
      }
      await this.execute(job);
      return job;
    } finally {
      this.busy = false;
    }
  }

  private iso(): string {
    return new Date(this.clock()).toISOString();
  }

  /** @asyncUnsafe Every branch ends by writing the job; a lost lease stops writes. */
  private async execute(job: NodeBootstrapJob): Promise<void> {
    const owner = this.deps.owner;
    let leaseHeld = true;
    /** @asyncUnsafe A failed write rejects into execute(), which records it. */
    const write = async (): Promise<void> => {
      if (!leaseHeld) {
        return;
      }
      job.updated_at = this.iso();
      job.status = job.state;
      leaseHeld = await this.deps.store.updateJob(job, owner);
    };
    const checkpoint = (stage: string, detail?: string): void => {
      job.checkpoints.push({ at: this.iso(), stage, ...(detail ? { detail } : {}) });
    };
    /** @asyncUnsafe Rejections are typed for execute(). */
    const finish = async (state: Exclude<NodeBootstrapJobState, 'queued' | 'running'>, message: string, reason?: string): Promise<void> => {
      job.state = state;
      job.message = message;
      job.reason = reason;
      job.finished_at = this.iso();
      job.lease = null;
      checkpoint(state, message);
      await write();
    };
    const heartbeat = setInterval(() => {
      if (!leaseHeld || !job.lease) {
        return;
      }
      job.lease = { owner, expires_at: new Date(this.clock() + this.deps.env.jobLeaseMs).toISOString() };
      write().catch((e) => logger.warn('[bootstrap-executor] lease renewal failed: ' + (e instanceof Error ? e.message : e)));
    }, Math.max(1000, Math.floor(this.deps.env.jobLeaseMs / 3)));
    heartbeat.unref();

    try {
      job.attempts += 1;
      job.started_at = job.started_at ?? this.iso();
      checkpoint('claimed', `${owner} attempt ${job.attempts}`);
      await write();

      if (job.rpc?.started_at && !job.rpc.finished_at) {
        await this.reconcile(job, finish, checkpoint);
        return;
      }

      let observation: NodeObservation;
      try {
        observation = await this.deps.nodes.read();
      } catch (e) {
        await finish('failed', 'The owned node could not be observed before execution: ' + (e instanceof Error ? e.message : String(e)), 'unavailable-node-source');
        return;
      }
      if (observation.capability.node_id !== job.node_id) {
        await finish('failed', `The observed node is ${observation.capability.node_id}, not ${job.node_id}.`, 'node-not-observed');
        return;
      }

      if (job.job_type === 'generate_snapshot') {
        await this.generate(job, observation, finish, checkpoint, write);
      } else {
        await this.load(job, observation, finish, checkpoint, write);
      }
    } catch (e) {
      if (e instanceof BootstrapEvidenceError) {
        await finish('failed', e.message, e.code);
      } else {
        await finish('failed', 'The executor failed: ' + (e instanceof Error ? e.message : String(e)), 'executor-error');
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** @asyncUnsafe Rejections are typed for execute(). */
  private async generate(
    job: NodeBootstrapJob,
    observation: NodeObservation,
    finish: (state: 'completed' | 'failed' | 'needs-review', message: string, reason?: string) => Promise<void>,
    checkpoint: (stage: string, detail?: string) => void,
    write: () => Promise<void>
  ): Promise<void> {
    const version = requireSupportedNode(observation, this.deps.network);
    if (!observation.capability.supports_dumptxoutset) {
      throw new BootstrapEvidenceError('node-capability-missing', 'The owned node does not expose dumptxoutset.', 409);
    }
    const chain = observation.observation;
    if (chain.current_phase !== 'fully_validated') {
      throw new BootstrapEvidenceError('chainstate-not-eligible', `A snapshot is only generated from a fully validated chainstate; the node is in ${chain.current_phase}.`, 409);
    }
    if (!this.deps.env.snapshotDir) {
      throw new BootstrapEvidenceError('unavailable-operator', 'No allowlisted snapshot output directory is configured (UNIVERSE_BOOTSTRAP_SNAPSHOT_DIR).');
    }
    const capacity = await measureCapacity(this.deps.env, Math.round(chain.disk_used_gb * 1073741824), this.clock(), this.deps.statfs);
    const path = this.deps.env.snapshotDir.replace(/[\\/]+$/, '') + `/utxo-${this.deps.network}-${chain.tip_height}-${job.job_id}.dat`;
    job.preconditions = {
      core_version: version.version,
      phase: chain.current_phase,
      tip_height: chain.tip_height,
      tip_hash: chain.active_chainstate.best_block_hash,
      capacity_method: capacity.method,
      capacity_free_bytes: capacity.free_bytes,
      output_path: path,
    };
    const params = version.major >= 29 ? [path, 'latest'] : [path];
    const result = await this.issue(job, 'dumptxoutset', params, checkpoint, write);
    if (result === undefined) {
      return;
    }
    if (!integer(result?.coins_written) || !hash(result?.base_hash) || !integer(result?.base_height) || !hash(result?.txoutset_hash)) {
      await finish('needs-review', 'dumptxoutset returned without the expected fields; inspect the node.', 'core-result-malformed');
      return;
    }
    const hashAtHeight = await this.deps.core.call('getblockhash', [result.base_height]);
    job.evidence = {
      coins_written: result.coins_written,
      base_hash: result.base_hash,
      base_height: result.base_height,
      txoutset_hash: result.txoutset_hash,
      path: typeof result.path === 'string' ? result.path : path,
      core_block_hash_at_base_height: typeof hashAtHeight === 'string' ? hashAtHeight : null,
    };
    if (hashAtHeight !== result.base_hash) {
      await finish('needs-review', 'The snapshot base hash is not on the owned node active chain at its height.', 'base-hash-not-on-chain');
      return;
    }
    job.progress_pct = 100;
    await finish('completed', `Core wrote ${result.coins_written} coins at height ${result.base_height} (${result.txoutset_hash}). The file is not catalogued or verified by this job.`);
  }

  /** @asyncUnsafe Rejections are typed for execute(). */
  private async load(
    job: NodeBootstrapJob,
    observation: NodeObservation,
    finish: (state: 'completed' | 'failed' | 'needs-review', message: string, reason?: string) => Promise<void>,
    checkpoint: (stage: string, detail?: string) => void,
    write: () => Promise<void>
  ): Promise<void> {
    const catalogue = this.deps.catalogue();
    const snapshot = catalogue.snapshots.find((s) => s.id === job.snapshot_id);
    if (!snapshot) {
      throw new BootstrapEvidenceError('snapshot-not-in-catalogue', `Snapshot ${job.snapshot_id} is not in the trusted catalogue.`, 409);
    }
    const eligibility = await evaluateLoadEligibility({
      observation, network: this.deps.network, snapshot, catalogue, store: this.deps.store, env: this.deps.env, now: this.clock(), statfs: this.deps.statfs,
    });
    const source = classifySource(snapshot.source, this.deps.env.sourceAllowlist);
    if (source.kind !== 'file') {
      throw new BootstrapEvidenceError('snapshot-source-not-local', 'loadtxoutset reads a path on the Core host; the catalogue source for this snapshot is not a local path.', 409);
    }
    job.preconditions = {
      core_version: eligibility.version.version,
      phase: observation.observation.current_phase,
      tip_height: observation.observation.tip_height,
      snapshot_height: snapshot.height,
      snapshot_block_hash: snapshot.blockHash,
      pinned_commitment: eligibility.pinned.utxoCommitment,
      verification_id: eligibility.verification.verification_id,
      capacity_method: eligibility.capacity.method,
      capacity_free_bytes: eligibility.capacity.free_bytes,
      required_bytes: eligibility.required.required_bytes,
    };
    const result = await this.issue(job, 'loadtxoutset', [snapshot.source], checkpoint, write);
    if (result === undefined) {
      return;
    }
    if (!integer(result?.coins_loaded) || !hash(result?.tip_hash) || !integer(result?.base_height)) {
      await finish('needs-review', 'loadtxoutset returned without the expected fields; inspect the node.', 'core-result-malformed');
      return;
    }
    job.evidence = { coins_loaded: result.coins_loaded, tip_hash: result.tip_hash, base_height: result.base_height };
    if (result.tip_hash !== snapshot.blockHash || result.base_height !== snapshot.height) {
      await finish('needs-review', 'Core activated a snapshot whose base is not the catalogue block.', 'base-mismatch');
      return;
    }
    await this.observeLoadedChainstate(job, snapshot.height, finish, checkpoint, write);
  }

  /** Issues the single RPC under the job deadline; undefined means the job was already finished. */
  /** @asyncUnsafe A Core rejection is recorded as the job outcome. */
  private async issue(
    job: NodeBootstrapJob,
    method: 'dumptxoutset' | 'loadtxoutset',
    params: unknown[],
    checkpoint: (stage: string, detail?: string) => void,
    write: () => Promise<void>
  ): Promise<any> {
    const rpc: NonNullable<NodeBootstrapJob['rpc']> = { method, started_at: this.iso() };
    job.rpc = rpc;
    checkpoint('rpc-issued', method);
    await write();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ExecutorTimeout()), this.deps.env.jobTimeoutMs);
      timer.unref();
    });
    try {
      const result = await Promise.race([this.deps.operatorCore.call(method, params), timeout]);
      rpc.finished_at = this.iso();
      checkpoint('rpc-returned', method);
      return result;
    } catch (e) {
      if (e instanceof ExecutorTimeout) {
        job.state = 'needs-review';
        job.message = `${method} did not return within ${this.deps.env.jobTimeoutMs} ms; Core may still be running it. Inspect the node before retrying.`;
        job.reason = 'executor-timeout';
      } else {
        rpc.finished_at = this.iso();
        job.state = 'failed';
        job.message = `${method} failed: ` + (e instanceof Error ? e.message : String(e));
        job.reason = 'core-rpc-error';
      }
      job.finished_at = this.iso();
      job.lease = null;
      checkpoint(job.state, job.message);
      await write();
      return undefined;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** @asyncUnsafe Rejections are typed for execute(). */
  private async observeLoadedChainstate(
    job: NodeBootstrapJob,
    height: number,
    finish: (state: 'completed' | 'failed' | 'needs-review', message: string, reason?: string) => Promise<void>,
    checkpoint: (stage: string, detail?: string) => void,
    write: () => Promise<void>
  ): Promise<void> {
    const attempts = this.deps.loadObservationAttempts ?? 20;
    for (let i = 0; i < attempts; i++) {
      let observed: NodeObservation | undefined;
      try {
        observed = await this.deps.nodes.read();
      } catch (e) {
        checkpoint('chainstate-observation', 'unavailable: ' + (e instanceof Error ? e.message : String(e)));
      }
      if (observed) {
        const chain = observed.observation;
        job.evidence = {
          ...job.evidence,
          observed_phase: chain.current_phase,
          active_chainstate_type: chain.active_chainstate.type,
          snapshot_chainstate_height: chain.snapshot_chainstate_height,
          background_ibd_height: chain.background_ibd_height,
          sync_percent: chain.sync_percent,
          observed_at: chain.observed_at,
        };
        checkpoint('chainstate-observation', `${chain.current_phase} at ${chain.tip_height}`);
        if (chain.active_chainstate.type === 'snapshot' && chain.snapshot_chainstate_height !== null && chain.snapshot_chainstate_height >= height) {
          job.progress_pct = 100;
          await finish('completed', `Core activated the snapshot chainstate; background validation continues (${chain.current_phase}).`);
          return;
        }
        await write();
      }
      await this.sleep(this.deps.env.jobPollMs);
    }
    await finish('needs-review', 'loadtxoutset returned but no snapshot chainstate was observed on the node afterwards.', 'chainstate-not-observed');
  }

  /** After a crash mid-RPC the outcome is read from the node, never re-issued. */
  /** @asyncUnsafe Rejections are typed for execute(). */
  private async reconcile(
    job: NodeBootstrapJob,
    finish: (state: 'completed' | 'failed' | 'needs-review', message: string, reason?: string) => Promise<void>,
    checkpoint: (stage: string, detail?: string) => void
  ): Promise<void> {
    checkpoint('reconcile', `${job.rpc?.method} was issued by a previous attempt`);
    if (job.job_type === 'generate_snapshot') {
      await finish('needs-review', 'dumptxoutset was issued before this worker restarted; whether Core finished writing the file is unknown. Inspect the node and the output path before retrying.', 'rpc-outcome-unknown-after-restart');
      return;
    }
    let observed: NodeObservation;
    try {
      observed = await this.deps.nodes.read();
    } catch (e) {
      await finish('needs-review', 'loadtxoutset was issued before this worker restarted and the node cannot be observed: ' + (e instanceof Error ? e.message : String(e)), 'rpc-outcome-unknown-after-restart');
      return;
    }
    const chain = observed.observation;
    const height = typeof job.preconditions.snapshot_height === 'number' ? job.preconditions.snapshot_height : -1;
    job.evidence = {
      ...job.evidence,
      observed_phase: chain.current_phase,
      active_chainstate_type: chain.active_chainstate.type,
      snapshot_chainstate_height: chain.snapshot_chainstate_height,
      background_ibd_height: chain.background_ibd_height,
      observed_at: chain.observed_at,
    };
    if (chain.active_chainstate.type === 'snapshot' && chain.snapshot_chainstate_height !== null && chain.snapshot_chainstate_height >= height && height >= 0) {
      job.progress_pct = 100;
      await finish('completed', 'The node shows the snapshot chainstate active after a worker restart; background validation continues.');
      return;
    }
    await finish('needs-review', 'loadtxoutset was issued before this worker restarted and the node shows no snapshot chainstate. Inspect the node before retrying.', 'rpc-outcome-unknown-after-restart');
  }
}

class ExecutorTimeout extends Error {}
