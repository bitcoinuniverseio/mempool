import {
  NodeBootstrapCapability, NodeBootstrapSnapshot, NodeBootstrapVerification,
  NodeBootstrapChainstateObservation, NodeBootstrapPlan, NodeBootstrapJob, BootstrapOverviewResponse,
} from './bootstrap.models';

export class BootstrapEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const unavailable = (code: string, prerequisite: string): never => {
  throw new BootstrapEvidenceError(code, 'Bootstrap evidence is unavailable. ' + prerequisite);
};

// These routes remain offered. Seeded nodes, manifests and in-memory jobs are
// not observations or operator execution; require their actual authorities.
export class BootstrapService {
  public getOverview(): BootstrapOverviewResponse {
    return unavailable('unavailable-node-source', 'The owned node capability reader and trusted snapshot catalogue are not connected.');
  }

  public listNodes(): NodeBootstrapCapability[] {
    return unavailable('unavailable-node-source', 'The owned node capability reader is not connected.');
  }

  public listNodeChainstates(): NodeBootstrapChainstateObservation[] {
    return unavailable('unavailable-node-source', 'The owned Bitcoin Core chainstate reader is not connected.');
  }

  public getNodeChainstates(_nodeId: string): NodeBootstrapChainstateObservation | undefined {
    return unavailable('unavailable-node-source', 'The owned Bitcoin Core chainstate reader is not connected.');
  }

  public listSnapshots(): NodeBootstrapSnapshot[] {
    return unavailable('unavailable-manifest', 'A trusted signed snapshot catalogue, producer keys and pinned Bitcoin Core commitments are required.');
  }

  public getSnapshot(_snapshotId: string): NodeBootstrapSnapshot | undefined {
    return unavailable('unavailable-manifest', 'A trusted signed snapshot catalogue, producer keys and pinned Bitcoin Core commitments are required.');
  }

  public verifySnapshot(data: {
    snapshot_id?: string; file_sha256?: string; base_height?: number; expected_txoutset_hash?: string;
    height?: number; sha256?: string; utxo_hash?: string;
  }): NodeBootstrapVerification {
    const height = data?.base_height ?? data?.height;
    const sha256 = data?.file_sha256 ?? data?.sha256;
    const utxoHash = data?.expected_txoutset_hash ?? data?.utxo_hash;
    if (!Number.isSafeInteger(height) || Number(height) < 0 ||
      typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256) ||
      typeof utxoHash !== 'string' || !/^[0-9a-f]{64}$/i.test(utxoHash)) {
      throw new BootstrapEvidenceError('invalid-input', 'A nonnegative base height and two 32-byte hexadecimal checksums are required.', 400);
    }
    return unavailable('unavailable-manifest', 'No trusted manifest, producer-key verification, snapshot bytes or pinned Core UTXO commitment were checked. Caller-supplied checksums alone cannot verify a snapshot.');
  }

  public getVerification(_verificationId: string): NodeBootstrapVerification | undefined {
    return unavailable('unavailable-verification-store', 'No durable verification authority is connected; absence of a run cannot be established.');
  }

  public createBootstrapPlan(_params: { node_version: string; network: string; available_disk_gb: number }): NodeBootstrapPlan {
    return unavailable('unavailable-node-source', 'Planning requires measured node capabilities, disk capacity and a compatible trusted snapshot.');
  }

  public createOperatorJob(_params: {
    job_type: 'generate_snapshot' | 'verify_snapshot' | 'load_snapshot'; node_id: string; snapshot_id?: string;
  }): NodeBootstrapJob {
    return unavailable('unavailable-operator', 'The authorized node executor and durable job store are not connected. No node operation was started.');
  }

  public getJob(_jobId: string): NodeBootstrapJob | undefined {
    return unavailable('unavailable-operator', 'The durable operator job store is not connected.');
  }
}

export default new BootstrapService();
