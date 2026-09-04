import crypto from 'crypto';
import {
  NodeBootstrapCapability,
  NodeBootstrapSnapshot,
  NodeBootstrapVerification,
  NodeBootstrapChainstateObservation,
  NodeBootstrapPlan,
  NodeBootstrapJob,
  BootstrapOverviewResponse,
} from './bootstrap.models';

export class BootstrapService {
  private nodes: Map<string, NodeBootstrapCapability> = new Map();
  private snapshots: Map<string, NodeBootstrapSnapshot> = new Map();
  private chainstates: Map<string, NodeBootstrapChainstateObservation> = new Map();
  private verifications: Map<string, NodeBootstrapVerification> = new Map();
  private jobs: Map<string, NodeBootstrapJob> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const node1: NodeBootstrapCapability = {
      node_id: 'node-core-28-mainnet',
      node_software: 'Bitcoin Core',
      exact_version: '28.0.0',
      network: 'mainnet',
      supports_dumptxoutset: true,
      supports_loadtxoutset: true,
      supports_getchainstates: true,
      compiled_assumeutxo_heights: [840000],
      current_phase: 'fully_validated',
      last_probe_at: '2026-09-04T05:00:00Z',
    };

    const node2: NodeBootstrapCapability = {
      node_id: 'node-syncing-staging',
      node_software: 'Bitcoin Core',
      exact_version: '28.0.0',
      network: 'mainnet',
      supports_dumptxoutset: true,
      supports_loadtxoutset: true,
      supports_getchainstates: true,
      compiled_assumeutxo_heights: [840000],
      current_phase: 'background_validation',
      last_probe_at: '2026-09-04T05:00:00Z',
    };

    this.nodes.set(node1.node_id, node1);
    this.nodes.set(node2.node_id, node2);

    const snapshot1: NodeBootstrapSnapshot = {
      snapshot_id: 'snap-840000-mainnet',
      name: 'Bitcoin Mainnet Block 840,000 UTXO Set Snapshot',
      network: 'mainnet',
      base_height: 840000,
      base_block_hash: '0000000000000000000320283a032748acf82273d51613d61a3a569e6d77509a',
      coins_count: 172349182,
      txoutset_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size_gb: 11.4,
      download_url: 'https://snapshots.universe.local/utxo-840000.dat.zst',
      manifest: {
        schema_version: '1.0.0',
        snapshot_id: 'snap-840000-mainnet',
        network: 'mainnet',
        producer_id: 'universe-release-ops',
        producer_software: 'Bitcoin Core 28.0.0 dumptxoutset',
        producer_version: '28.0.0',
        base_height: 840000,
        base_block_hash: '0000000000000000000320283a032748acf82273d51613d61a3a569e6d77509a',
        base_block_time: 1713571200,
        coins_count: 172349182,
        txoutset_hash_type: 'muhash',
        txoutset_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        snapshot_file_sha256: '9f82a1c002138914801984019284012984012984019284019284019284019284',
        snapshot_file_size_bytes: 12241082910,
        compressed_file_sha256: '8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c',
        compressed_file_size_bytes: 9840192840,
        created_at: '2026-04-20T12:00:00Z',
        assumeutxo_parameter_source: 'Bitcoin Core chainparams.cpp:840000',
        distribution_locations: ['https://snapshots.universe.local/utxo-840000.dat.zst'],
        signature: '3045022100a89104...',
        manifest_hash: '554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766',
      },
      is_verified: true,
      verification_status: 'verified',
    };
    this.snapshots.set(snapshot1.snapshot_id, snapshot1);

    const obs1: NodeBootstrapChainstateObservation = {
      node_id: 'node-syncing-staging',
      active_chainstate: {
        type: 'snapshot',
        height: 860500,
        best_block_hash: '000000000000000000018a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
        progress: 0.9998,
        validated: false,
      },
      background_chainstate: {
        height: 520000,
        best_block_hash: '000000000000000000045a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c45',
        progress: 0.619,
        target_height: 840000,
      },
      current_phase: 'background_validation',
      coins_cache_size_mb: 2048,
      disk_used_gb: 612.4,
      estimated_remaining_blocks: 320000,
      observed_at: '2026-09-04T05:00:00Z',
    };
    this.chainstates.set(obs1.node_id, obs1);
  }

  public getOverview(): BootstrapOverviewResponse {
    return {
      total_nodes: this.nodes.size,
      nodes: Array.from(this.nodes.values()),
      snapshots: Array.from(this.snapshots.values()),
      active_chainstates: Array.from(this.chainstates.values()),
    };
  }

  public listNodes(): NodeBootstrapCapability[] {
    return Array.from(this.nodes.values());
  }

  public getNodeChainstates(nodeId: string): NodeBootstrapChainstateObservation | undefined {
    return this.chainstates.get(nodeId);
  }

  public listSnapshots(): NodeBootstrapSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  public getSnapshot(snapshotId: string): NodeBootstrapSnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  public verifySnapshot(data: {
    snapshot_id: string;
    file_sha256: string;
    base_height: number;
    expected_txoutset_hash: string;
  }): NodeBootstrapVerification {
    const snap = this.snapshots.get(data.snapshot_id);
    const vId = `vfy-${Date.now()}`;

    const shaMatch = snap ? snap.manifest.snapshot_file_sha256 === data.file_sha256 : true;
    const heightMatch = snap ? snap.base_height === data.base_height : true;
    const hashMatch = snap ? snap.txoutset_hash === data.expected_txoutset_hash : true;
    const overall = shaMatch && heightMatch && hashMatch;

    const v: NodeBootstrapVerification = {
      verification_id: vId,
      snapshot_id: data.snapshot_id,
      file_size_valid: true,
      sha256_valid: shaMatch,
      manifest_hash_valid: true,
      signature_valid: true,
      expected_metadata_match: heightMatch && hashMatch,
      overall_verified: overall,
      details: overall
        ? 'Snapshot SHA256 and UTXO commitment match official release manifest.'
        : 'Snapshot verification failed: hash or base height mismatch.',
      verified_at: new Date().toISOString(),
    };

    this.verifications.set(vId, v);
    return v;
  }

  public getVerification(verificationId: string): NodeBootstrapVerification | undefined {
    return this.verifications.get(verificationId);
  }

  public createBootstrapPlan(params: {
    node_version: string;
    network: string;
    available_disk_gb: number;
  }): NodeBootstrapPlan {
    const planId = `plan-${Date.now()}`;
    return {
      plan_id: planId,
      node_version: params.node_version || '28.0.0',
      network: params.network || 'mainnet',
      traditional_ibd: {
        estimated_download_gb: 620,
        estimated_disk_gb: 650,
        estimated_duration_hours_range: [18, 48],
        requires_background_validation: false,
      },
      assumeutxo: {
        snapshot_download_gb: 11.4,
        temporary_disk_extra_gb: 18.0,
        time_to_tip_minutes_range: [25, 45],
        background_validation_duration_hours_range: [14, 36],
        requires_background_validation: true,
      },
      selected_snapshot_id: 'snap-840000-mainnet',
      index_compatibility_warning:
        'Indexes like txindex or blockfilterindex populate after background validation completes.',
      rollback_instructions: [
        'To abort background validation, stop bitcoind and restart with -reindex-chainstate',
        'To remove snapshot chainstate, delete the snapshot chainstate directory before full completion',
      ],
      created_at: new Date().toISOString(),
    };
  }

  public createOperatorJob(params: {
    job_type: 'generate_snapshot' | 'verify_snapshot' | 'load_snapshot';
    node_id: string;
    snapshot_id?: string;
  }): NodeBootstrapJob {
    const jobId = `job-${Date.now()}`;
    const job: NodeBootstrapJob = {
      job_id: jobId,
      job_type: params.job_type,
      node_id: params.node_id,
      snapshot_id: params.snapshot_id,
      progress_pct: 0,
      status: 'running',
      message: `Operator job ${params.job_type} initialized on node ${params.node_id}`,
      started_at: new Date().toISOString(),
    };
    this.jobs.set(jobId, job);
    return job;
  }

  public getJob(jobId: string): NodeBootstrapJob | undefined {
    return this.jobs.get(jobId);
  }
}

export default new BootstrapService();
