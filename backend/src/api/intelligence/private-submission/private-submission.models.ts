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
  status:
    | 'queued'
    | 'acknowledged'
    | 'aborted'
    | 'broadcast_completed'
    | 'failed'
    | 'relaying'
    | 'submitted'
    | 'confirmed'
    | 'rejected'
    | 'cancelled'
    | 'abort-too-late';
  retry_count: number;
  can_abort: boolean;
  last_error?: string;
  /** Present exactly once, on the response that created the record. */
  owner_token?: string;
  /** True when this submission matched an existing record for the same txid. */
  duplicate?: boolean;
  relay_endpoint_id?: string;
  relayed_at_utc?: string;
  confirmed_block_height?: number;
  updated_at_utc?: string;
}

/**
 * Owner authentication for private submission readback and abort. The token is
 * returned once by POST /submission/private and is presented either in this
 * header or, for the abort POST, as the owner_token body field.
 */
export const PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER = 'x-submission-owner-token';

export interface PrivateRelayEndpointFact {
  id: string;
  transport: 'tor' | 'i2p';
  submit_host: string;
  proxy_reachable: boolean | null;
}

export interface PrivateRelayOverview {
  network: string;
  relay: {
    configured: boolean;
    reason: string | null;
    endpoints: PrivateRelayEndpointFact[];
    rejected_endpoints: { id: string; reason: string }[];
  };
  queue: {
    queued: number;
    relaying: number;
    submitted: number;
    confirmed: number;
    rejected: number;
    cancelled: number;
  };
  worker: {
    running: boolean;
    last_tick_at: string | null;
    last_error: string | null;
    last_relay: { endpoint_id: string; transport: 'tor' | 'i2p'; outcome: string; at: string } | null;
  };
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
