export type SubmissionMethod =
  | 'public_p2p'
  | 'privatebroadcast_tor'
  | 'privatebroadcast_i2p'
  | 'privatebroadcast_tor_exit'
  | 'configured_private_relay'
  | 'configured_accelerator'
  | 'direct_miner_submission'
  | 'unknown';

export type OrderingEvidenceState =
  | 'publicly_observed_before_inclusion'
  | 'not_observed_by_our_sensors'
  | 'observed_only_in_template'
  | 'provider_receipt_precedes_inclusion'
  | 'included_without_public_observation'
  | 'ordering_changed_between_template_and_block'
  | 'dependency_required_order'
  | 'fee_consistent_order'
  | 'protocol_sensitive_order'
  | 'insufficient_coverage'
  | 'unknown';

export interface SubmissionCapabilities {
  public_p2p_enabled: boolean;
  privatebroadcast_tor_enabled: boolean;
  privatebroadcast_i2p_enabled: boolean;
  core_version: string;
  tor_active: boolean;
  i2p_active: boolean;
  queue_limit: number;
  current_queue_count: number;
}

export interface SubmissionDiagnosisResult {
  txid: string;
  vsize: number;
  feerate_sats_vb: number;
  is_mempool_present: boolean;
  is_policy_compliant: boolean;
  rbf_eligible: boolean;
  cpfp_eligible: boolean;
  has_conflicts: boolean;
  acceleration_recommended: boolean;
  privacy_advisory: string;
  available_methods: SubmissionMethod[];
}

export interface PrivateBroadcastRecord {
  submission_token: string;
  txid: string;
  method: SubmissionMethod;
  network: string;
  queued_at_utc: string;
  status: 'queued' | 'acknowledged' | 'aborted' | 'broadcast_completed' | 'failed';
  retry_count: number;
  can_abort: boolean;
  last_error?: string;
}

export interface AcceleratorProvider {
  provider_id: string;
  identity_key: string;
  name: string;
  supported_networks: string[];
  submission_modes: SubmissionMethod[];
  minimum_fee_sats: number;
  maximum_tx_vsize: number;
  payment_methods: string[];
  partner_mining_claims: string[];
  status_endpoint: string;
  health_status: 'online' | 'degraded' | 'offline';
  effective_from: string;
  expires_at: string;
  provider_signature: string;
}

export interface AcceleratorReceipt {
  schema_version: string;
  provider_id: string;
  receipt_id: string;
  txid: string;
  wtxid?: string;
  submitted_at_utc: string;
  expires_at_utc: string;
  target_feerate_sats_vb: number;
  provider_fee_sats: number;
  claimed_mining_coverage_pct: number;
  claimed_partner_pools: string[];
  status: 'active' | 'included' | 'expired' | 'refunded';
  provider_signature: string;
}

export interface TransactionOrderingEvidence {
  txid: string;
  block_hash: string;
  block_height: number;
  block_position: number;
  first_sensor_seen_utc?: string;
  first_template_seen_utc?: string;
  private_receipt_timestamp_utc?: string;
  mined_timestamp_utc: string;
  evidence_state: OrderingEvidenceState;
  fee_sats_vb: number;
  package_feerate_sats_vb: number;
  dependency_txids: string[];
  is_ordering_sensitive: boolean;
  protocol_impact_description?: string;
  confidence_rating: 'high' | 'medium' | 'low';
}

export interface SubmissionOverview {
  capabilities: SubmissionCapabilities;
  active_accelerator_providers: AcceleratorProvider[];
  recent_ordering_findings_count: number;
  total_private_broadcasts_24h: number;
  average_queue_duration_seconds: number;
}
