/**
 * AssumeUTXO and Node Bootstrap Snapshot Models.
 */

export type NodeBootstrapChainstatePhase =
  | 'traditional_ibd'
  | 'snapshot_loading'
  | 'snapshot_active_syncing_to_tip'
  | 'snapshot_at_tip'
  | 'background_validation'
  | 'snapshot_validated_pending_cleanup'
  | 'fully_validated'
  | 'snapshot_failed'
  | 'unknown';

export interface NodeBootstrapCapability {
  node_id: string;
  node_software: string;
  exact_version: string;
  network: string;
  supports_dumptxoutset: boolean;
  supports_loadtxoutset: boolean;
  supports_getchainstates: boolean;
  compiled_assumeutxo_heights: number[];
  current_phase: NodeBootstrapChainstatePhase;
  last_probe_at: string;
}

export interface NodeBootstrapSnapshotManifest {
  schema_version: string;
  snapshot_id: string;
  network: string;
  producer_id: string;
  producer_software: string;
  producer_version: string;
  base_height: number;
  base_block_hash: string;
  base_block_time: number;
  coins_count: number;
  txoutset_hash_type: 'muhash' | 'sha256';
  txoutset_hash: string;
  snapshot_file_sha256: string;
  snapshot_file_size_bytes: number;
  compressed_file_sha256: string;
  compressed_file_size_bytes: number;
  created_at: string;
  assumeutxo_parameter_source: string;
  distribution_locations: string[];
  signature: string;
  manifest_hash: string;
}

/**
 * Trusted catalogue file named by UNIVERSE_BOOTSTRAP_SNAPSHOT_CATALOGUE.
 *
 * pinnedCommitments are typed in by the operator from Bitcoin Core's
 * src/kernel/chainparams.cpp (m_assumeutxo_data: height, blockhash and
 * hash_serialized for the exact release the node runs). They are the
 * independent authority: a snapshot whose bytes hash to a commitment that is
 * not pinned for the node's exact version cannot be loaded by that node,
 * however well signed its manifest is. Catalogue metadata is never proof of
 * the bytes; only a verification run over the bytes is.
 */
export interface BootstrapCatalogueProducer {
  id: string;
  algorithm: 'ed25519';
  /** 32 byte raw ed25519 public key, hex. */
  publicKey: string;
}

export interface BootstrapPinnedCommitment {
  network: string;
  /** Exact Core release, for example 28.0.0 or 29.0.0. */
  coreVersion: string;
  height: number;
  blockHash: string;
  /** Core hash_serialized_3, display byte order. */
  utxoCommitment: string;
  coinCount: number | null;
}

export interface BootstrapCatalogueSnapshot {
  id: string;
  network: string;
  coreVersion: string;
  height: number;
  blockHash: string;
  sizeBytes: number;
  sha256: string;
  /** Allowlisted https URL or local path; never taken from a request. */
  source: string;
  manifest: {
    producerId: string;
    /** ed25519 signature, hex, over deterministicSnapshotJson(snapshot). */
    signature: string;
  };
}

export interface BootstrapCatalogue {
  producers: BootstrapCatalogueProducer[];
  pinnedCommitments: BootstrapPinnedCommitment[];
  snapshots: BootstrapCatalogueSnapshot[];
}

export type NodeBootstrapVerificationState =
  | 'pending'
  | 'verifying'
  | 'valid'
  | 'invalid'
  | 'unavailable';
export type NodeBootstrapCheckStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'not-evaluated';

export interface NodeBootstrapCheck {
  status: NodeBootstrapCheckStatus;
  expected?: string | number | null;
  observed?: string | number | null;
  reason?: string;
}

export interface NodeBootstrapCheckpoint {
  at: string;
  stage: string;
  detail?: string;
}

/**
 * One verification run over the actual snapshot bytes. Every check is
 * independent: sha256 of the bytes against the signed manifest, the ed25519
 * manifest signature against the producer key, network magic, base block hash
 * and height against the catalogue and the owned Core node, and the streamed
 * hash_serialized_3 against the operator-pinned Core commitment. Caller
 * supplied checksums are compared and reported in caller_inputs; they never
 * decide the state.
 */
export interface NodeBootstrapVerification {
  verification_id: string;
  snapshot_id: string;
  network: string;
  state: NodeBootstrapVerificationState;
  valid: boolean;
  status: string;
  requested_at: string;
  started_at?: string;
  finished_at?: string;
  checks: {
    file_size: NodeBootstrapCheck;
    sha256: NodeBootstrapCheck;
    manifest_signature: NodeBootstrapCheck;
    network_magic: NodeBootstrapCheck;
    base_block_hash: NodeBootstrapCheck;
    base_height: NodeBootstrapCheck;
    coins_count: NodeBootstrapCheck;
    utxo_commitment: NodeBootstrapCheck;
  };
  evidence: {
    source_kind: 'file' | 'https' | null;
    source_ref: string | null;
    bytes_read: number;
    header_format: 'versioned' | 'legacy' | null;
    snapshot_version: number | null;
    core_node_id: string | null;
    core_block_hash_at_height: string | null;
    pinned_commitment_source: string | null;
  };
  checkpoints: NodeBootstrapCheckpoint[];
  caller_inputs: {
    sha256: string | null;
    utxo_hash: string | null;
    height: number | null;
    matched: boolean | null;
  };
  reason?: string;
  // Fields kept from the earlier response shape.
  file_size_valid: boolean;
  sha256_valid: boolean;
  manifest_hash_valid: boolean;
  signature_valid: boolean;
  expected_metadata_match: boolean;
  overall_verified: boolean;
  details: string;
  verified_at: string;
}

export type NodeBootstrapSnapshotStatus =
  | 'pinned_core'
  | 'unverified'
  | 'pending'
  | 'verifying'
  | 'invalid'
  | 'unavailable';

/** A catalogue entry joined with its pinned commitment and latest verification. */
export interface NodeBootstrapSnapshot {
  snapshot_id: string;
  network: string;
  height: number;
  block_hash: string;
  coins_count: number | null;
  base_utxo_hash: string | null;
  sha256_checksum: string;
  file_size_bytes: number;
  release_version: string;
  /** pinned_core only after a verification run over the bytes reached valid. */
  status: NodeBootstrapSnapshotStatus;
  download_url?: string;
  producer_id: string;
  pinned_commitment: boolean;
  latest_verification_id: string | null;
  latest_verification_state: NodeBootstrapVerificationState | null;
  // Fields kept from the earlier response shape.
  name: string;
  base_height: number;
  base_block_hash: string;
  txoutset_hash: string | null;
  size_gb: number;
  is_verified: boolean;
  verification_status: 'verified' | 'unverified' | 'hash_mismatch';
}

export interface NodeBootstrapChainstateObservation {
  node_id: string;
  active_chainstate: {
    type: 'snapshot' | 'ibd';
    height: number;
    best_block_hash: string;
    progress: number;
    validated: boolean;
  };
  background_chainstate?: {
    height: number;
    best_block_hash: string;
    progress: number;
    target_height: number;
  };
  current_phase: NodeBootstrapChainstatePhase;
  coins_cache_size_mb: number;
  disk_used_gb: number;
  estimated_remaining_blocks: number;
  observed_at: string;
}

export type NodeBootstrapPlanRejection =
  | 'unsupported-network'
  | 'unsupported-version'
  | 'node-capability-missing'
  | 'capacity-not-measured'
  | 'stale-measurement'
  | 'insufficient-capacity'
  | 'no-compatible-snapshot'
  | 'snapshot-not-verified'
  | 'chainstate-not-eligible';

/**
 * A feasibility statement. Nothing in it has been executed; every number is
 * either measured (and says where it was measured) or a stated assumption.
 */
export interface NodeBootstrapPlan {
  plan_id: string;
  network: string;
  node_id: string;
  node_version: string;
  target_height: number;
  measurement_status: 'measured';
  measured: {
    node_observed_at: string;
    current_phase: NodeBootstrapChainstatePhase;
    tip_height: number;
    headers: number;
    blocks_on_disk_bytes: number;
    capacity: {
      method: 'statfs' | 'configured';
      measured_at: string;
      free_bytes: number;
      total_bytes: number | null;
    };
    supports_loadtxoutset: boolean;
  };
  selected_snapshot: {
    snapshot_id: string;
    height: number;
    block_hash: string;
    core_version: string;
    size_bytes: number;
    sha256: string;
    utxo_commitment: string;
    verification_id: string;
    verified_at: string;
  };
  requirements: {
    snapshot_file_bytes: number;
    chainstate_estimate_bytes: number;
    headroom_bytes: number;
    required_bytes: number;
    free_bytes: number;
    feasible: true;
  };
  assumptions: string[];
  caller_declared: {
    available_disk_gb: number | null;
    bandwidth_mbps: number | null;
    matches_measurement: boolean | null;
  };
  estimates: {
    snapshot_download_hours: number | null;
    ibd_download_hours: number | null;
    basis: string;
  };
  expected_transitions: NodeBootstrapChainstatePhase[];
  actions_not_executed: string[];
  rollback_instructions: string[];
  created_at: string;
}

export type NodeBootstrapJobState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'needs-review';

/**
 * A durable operator job. Queued means accepted, nothing more; only Core's own
 * RPC result and the chainstate observation that follows count as completion
 * evidence.
 */
export interface NodeBootstrapJob {
  job_id: string;
  job_type: 'generate_snapshot' | 'load_snapshot';
  network: string;
  node_id: string;
  snapshot_id?: string;
  idempotency_key: string;
  state: NodeBootstrapJobState;
  status: NodeBootstrapJobState;
  progress_pct: number;
  message: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
  attempts: number;
  lease: { owner: string; expires_at: string } | null;
  rpc: {
    method: 'dumptxoutset' | 'loadtxoutset';
    started_at?: string;
    finished_at?: string;
  } | null;
  preconditions: Record<string, string | number | boolean | null>;
  evidence: Record<string, string | number | boolean | null>;
  checkpoints: NodeBootstrapCheckpoint[];
  reason?: string;
}

export interface BootstrapOverviewResponse {
  total_nodes: number;
  nodes: NodeBootstrapCapability[];
  snapshots: NodeBootstrapSnapshot[];
  active_chainstates: NodeBootstrapChainstateObservation[];
}
