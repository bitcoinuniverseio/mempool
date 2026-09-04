export type RelayMechanism = 'bip152_high_bandwidth' | 'bip152_low_bandwidth' | 'legacy_inv' | 'fibre';

export type ForkRaceStatus =
  | 'competing_header_observed'
  | 'competing_block_observed'
  | 'valid_stale_branch'
  | 'invalid_branch'
  | 'sensor_disagreement'
  | 'node_lag'
  | 'source_gap'
  | 'resolved_to_most_work'
  | 'unresolved'
  | 'unknown';

export interface PropagationSensor {
  sensor_id: string;
  sensor_name: string;
  region: 'us-east' | 'us-west' | 'eu-central' | 'eu-north' | 'ap-southeast';
  software: string;
  software_version: string;
  clock_offset_ms: number;
  clock_uncertainty_ms: number;
  bip152_mode: 'high_bandwidth' | 'low_bandwidth';
  bip152_version: 1 | 2;
  health_status: 'healthy' | 'degraded' | 'offline';
  last_heartbeat: string;
}

export interface BlockRelayStageTimestamps {
  header_first_seen_ms: number;
  cmpctblock_first_seen_ms: number;
  reconstruction_started_ms: number;
  missing_txs_requested_ms?: number;
  missing_txs_received_ms?: number;
  reconstruction_complete_ms: number;
  validation_started_ms: number;
  validation_complete_ms: number;
  block_connected_ms: number;
}

export interface BlockPropagationObservation {
  block_hash: string;
  height: number;
  previous_block_hash: string;
  timestamp_utc: string;
  block_size_bytes: number;
  tx_count: number;
  time_to_25_pct_sensors_ms: number;
  time_to_50_pct_sensors_ms: number;
  time_to_75_pct_sensors_ms: number;
  time_to_90_pct_sensors_ms: number;
  time_to_100_pct_sensors_ms: number;
  header_first_propagation_ms: number;
  compact_block_propagation_ms: number;
  average_reconstruction_duration_ms: number;
  average_validation_duration_ms: number;
  average_connection_duration_ms: number;
  fallback_to_full_block_count: number;
  short_id_collision_count: number;
  missing_transaction_ratio: number;
  sensor_observations: {
    sensor_id: string;
    region: string;
    relay_mechanism: RelayMechanism;
    stages: BlockRelayStageTimestamps;
  }[];
}

export interface CompactBlockDetail {
  block_hash: string;
  height: number;
  bip152_version: number;
  prefilled_tx_count: number;
  short_id_count: number;
  missing_tx_count: number;
  collision_count: number;
  reconstruction_success: boolean;
  merkle_root_verified: boolean;
  witness_commitment_verified: boolean;
  full_block_fallback: boolean;
}

export interface ForkRaceBranch {
  branch_id: string;
  tip_block_hash: string;
  tip_height: number;
  first_observed_sensor_id: string;
  first_observed_utc: string;
  block_count: number;
  accumulated_work: string;
  status: ForkRaceStatus;
  mined_by_pool?: string;
  tx_divergence_count: number;
}

export interface ForkRaceRecord {
  race_id: string;
  divergence_height: number;
  discovered_at_utc: string;
  resolved_at_utc?: string;
  resolution_status: ForkRaceStatus;
  winning_tip_hash?: string;
  branches: ForkRaceBranch[];
  staletip_negotiated_via_bip434: boolean;
  notes: string[];
}

export interface FibreObservation {
  block_hash: string;
  height: number;
  fibre_delivery_time_ms: number;
  bip152_delivery_time_ms: number;
  chunk_count: number;
  chunk_loss_pct: number;
  fec_recovery_succeeded: boolean;
  time_saved_ms: number;
}

export interface BlockPropagationOverview {
  latest_block_hash: string;
  latest_block_height: number;
  average_propagation_time_50_pct_ms: number;
  average_propagation_time_90_pct_ms: number;
  reconstruction_success_rate_pct: number;
  active_sensors_count: number;
  recent_fork_races_count: number;
  sensors: PropagationSensor[];
  recent_blocks: BlockPropagationObservation[];
  recent_fork_races: ForkRaceRecord[];
}
