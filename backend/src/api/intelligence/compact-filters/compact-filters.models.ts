/**
 * Compact Filter and Light-Client Verification Models.
 */

export interface CompactFilterProvider {
  provider_id: string;
  endpoint: string;
  peer_address: string;
  service_flags: string[];
  supports_compact_filters: boolean; // NODE_COMPACT_FILTERS (1 << 6)
  tip_height: number;
  filter_tip_height: number;
  response_latency_ms: number;
  reliability_score: number;
  last_checkpoint_hash: string;
  has_conflicting_headers: boolean;
  software_version: string;
  last_observed_at: string;
}

export interface CompactFilterCheckpoint {
  checkpoint_id: string;
  block_height: number;
  block_hash: string;
  filter_header: string;
  filter_hash: string;
  provider_agreement_ratio: number;
  agreeing_providers_count: number;
  disagreeing_providers_count: number;
}

export interface CompactFilterHeader {
  height: number;
  block_hash: string;
  filter_header: string;
  prev_filter_header: string;
  filter_hash: string;
  is_verified_link: boolean;
}

export interface CompactFilter {
  block_hash: string;
  block_height: number;
  filter_type: 'basic_0x00';
  element_count: number;
  filter_bytes_hex: string;
  filter_hash: string;
  filter_header: string;
  false_positive_rate: number;
  includes_spent_prevouts: boolean;
  includes_outputs: boolean;
  excludes_op_return: boolean;
}

export interface CompactFilterConflict {
  conflict_id: string;
  block_height: number;
  block_hash: string;
  reported_filter_hash_a: string;
  provider_a: string;
  reported_filter_hash_b: string;
  provider_b: string;
  canonical_recomputed_hash: string;
  disagreeing_provider: string;
  detected_at: string;
  evidence_retained: boolean;
}

export interface CompactFilterVerificationRun {
  verification_id: string;
  start_height: number;
  end_height: number;
  total_blocks: number;
  checked_providers: string[];
  all_agree: boolean;
  conflicts_found: number;
  status: 'completed' | 'in_progress' | 'discrepancy_detected';
  verified_at: string;
  manifest_hash: string;
}

export interface CompactFilterOverviewResponse {
  total_providers: number;
  healthy_providers: number;
  filter_tip_height: number;
  total_checkpoints: number;
  recent_checkpoints: CompactFilterCheckpoint[];
  active_conflicts: CompactFilterConflict[];
  providers: CompactFilterProvider[];
}
