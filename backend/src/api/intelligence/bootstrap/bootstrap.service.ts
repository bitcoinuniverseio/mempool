import { BootstrapNodeReader } from './node-reader';
import {
  NodeBootstrapCapability,
  NodeBootstrapSnapshot,
  NodeBootstrapVerification,
  NodeBootstrapChainstateObservation,
  NodeBootstrapPlan,
  NodeBootstrapJob,
  BootstrapOverviewResponse,
} from './bootstrap.models';

export class BootstrapEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503
  ) {
    super(message);
  }
}

const unavailable = (code: string, prerequisite: string): never => {
  throw new BootstrapEvidenceError(
    code,
    'Bootstrap evidence is unavailable. ' + prerequisite
  );
};

// These routes remain offered. Seeded nodes, manifests and in-memory jobs are
// not observations or operator execution; require their actual authorities.
export class BootstrapService {
  constructor(private nodes = new BootstrapNodeReader()) {}
  private async observation() {
    try {
      return await this.nodes.read();
    } catch {
      return unavailable(
        'unavailable-node-source',
        'A fresh, consistent owned Core chainstate and network observation could not be obtained.'
      );
    }
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getOverview() {
    const { capability, observation } = await this.observation();
    return {
      total_nodes: 1,
      nodes: [capability],
      active_chainstates: [observation],
      snapshots: [],
      total_snapshots: null,
      configured_nodes_count: 1,
      dual_chainstate_nodes_count: observation.dual_chainstate_active ? 1 : 0,
      recommended_snapshot_height: null,
      featured_snapshots: [],
      observed_nodes: [observation],
      snapshot_catalogue_status: 'unavailable',
      snapshot_catalogue_reason:
        'A trusted signed snapshot catalogue and independently pinned Core commitments are not configured.',
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

  public listSnapshots(): NodeBootstrapSnapshot[] {
    return unavailable(
      'unavailable-manifest',
      'A trusted signed snapshot catalogue, producer keys and pinned Bitcoin Core commitments are required.'
    );
  }

  public getSnapshot(_snapshotId: string): NodeBootstrapSnapshot | undefined {
    return unavailable(
      'unavailable-manifest',
      'A trusted signed snapshot catalogue, producer keys and pinned Bitcoin Core commitments are required.'
    );
  }

  public verifySnapshot(data: {
    snapshot_id?: string;
    file_sha256?: string;
    base_height?: number;
    expected_txoutset_hash?: string;
    height?: number;
    sha256?: string;
    utxo_hash?: string;
  }): NodeBootstrapVerification {
    const height = data?.base_height ?? data?.height;
    const sha256 = data?.file_sha256 ?? data?.sha256;
    const utxoHash = data?.expected_txoutset_hash ?? data?.utxo_hash;
    if (
      !Number.isSafeInteger(height) ||
      Number(height) < 0 ||
      typeof sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(sha256) ||
      typeof utxoHash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(utxoHash)
    ) {
      throw new BootstrapEvidenceError(
        'invalid-input',
        'A nonnegative base height and two 32-byte hexadecimal checksums are required.',
        400
      );
    }
    return unavailable(
      'unavailable-manifest',
      'No trusted manifest, producer-key verification, snapshot bytes or pinned Core UTXO commitment were checked. Caller-supplied checksums alone cannot verify a snapshot.'
    );
  }

  public getVerification(
    _verificationId: string
  ): NodeBootstrapVerification | undefined {
    return unavailable(
      'unavailable-verification-store',
      'No durable verification authority is connected; absence of a run cannot be established.'
    );
  }

  public createBootstrapPlan(_params: {
    node_version: string;
    network: string;
    available_disk_gb: number;
  }): NodeBootstrapPlan {
    return unavailable(
      'unavailable-node-source',
      'Planning requires measured node capabilities, disk capacity and a compatible trusted snapshot.'
    );
  }

  public createOperatorJob(_params: {
    job_type: 'generate_snapshot' | 'verify_snapshot' | 'load_snapshot';
    node_id: string;
    snapshot_id?: string;
  }): NodeBootstrapJob {
    return unavailable(
      'unavailable-operator',
      'The authorized node executor and durable job store are not connected. No node operation was started.'
    );
  }

  public getJob(_jobId: string): NodeBootstrapJob | undefined {
    return unavailable(
      'unavailable-operator',
      'The durable operator job store is not connected.'
    );
  }
}

export default new BootstrapService();
