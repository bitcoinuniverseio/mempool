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

export interface NodeBootstrapSnapshot {
  snapshot_id: string;
  name: string;
  network: string;
  base_height: number;
  base_block_hash: string;
  coins_count: number;
  txoutset_hash: string;
  size_gb: number;
  download_url: string;
  manifest: NodeBootstrapSnapshotManifest;
  is_verified: boolean;
  verification_status: 'verified' | 'unverified' | 'hash_mismatch';
}

export interface NodeBootstrapVerification {
  verification_id: string;
  snapshot_id: string;
  file_size_valid: boolean;
  sha256_valid: boolean;
  manifest_hash_valid: boolean;
  signature_valid: boolean;
  expected_metadata_match: boolean;
  overall_verified: boolean;
  details: string;
  verified_at: string;
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

export interface NodeBootstrapPlan {
  plan_id: string;
  node_version: string;
  network: string;
  traditional_ibd: {
    estimated_download_gb: number;
    estimated_disk_gb: number;
    estimated_duration_hours_range: [number, number];
    requires_background_validation: false;
  };
  assumeutxo: {
    snapshot_download_gb: number;
    temporary_disk_extra_gb: number;
    time_to_tip_minutes_range: [number, number];
    background_validation_duration_hours_range: [number, number];
    requires_background_validation: true;
  };
  selected_snapshot_id?: string;
  index_compatibility_warning?: string;
  rollback_instructions: string[];
  created_at: string;
}

export interface NodeBootstrapJob {
  job_id: string;
  job_type: 'generate_snapshot' | 'verify_snapshot' | 'load_snapshot';
  node_id: string;
  snapshot_id?: string;
  progress_pct: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  message: string;
  started_at: string;
  finished_at?: string;
}

export interface BootstrapOverviewResponse {
  total_nodes: number;
  nodes: NodeBootstrapCapability[];
  snapshots: NodeBootstrapSnapshot[];
  active_chainstates: NodeBootstrapChainstateObservation[];
}
