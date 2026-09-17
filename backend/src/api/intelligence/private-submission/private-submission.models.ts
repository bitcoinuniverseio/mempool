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
  /** Owned mempool package facts for the entry. */
  package?: {
    effective_feerate_sats_vb: number;
    ancestor_count: number;
    descendant_count: number;
    ancestor_fee_sats: number;
    ancestor_weight: number;
    cpfp_boosted: boolean;
    cpfp_checked: boolean;
    best_descendant_txid: string | null;
    projected_block_index: number | null;
  };
  policy?: {
    source: string;
    mempool_min_fee_sats_vb: number | null;
    min_relay_fee_sats_vb: number | null;
    mempool_loaded: boolean | null;
  };
  replacement?: {
    signals_rbf: boolean;
    replaces_txids: string[];
    replaced_by_txid: string | null;
    is_replacement: boolean;
  };
  observed_at_utc?: string;
  first_seen_utc?: string | null;
  scope?: string;
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
  /** Null: the owned directory names no health endpoint and none is probed. */
  status_endpoint: string | null;
  health_status: 'online' | 'degraded' | 'offline' | 'unmeasured';
  effective_from: string;
  /** Null when a directory key has no end of validity. */
  expires_at: string | null;
  /** Null: the directory file is the trust root; entries carry no separate signature. */
  provider_signature: string | null;
  issuer?: string;
  protocol_version?: string;
  keys?: AcceleratorProviderKey[];
  directory?: { source: string; revision: string; loaded_at_utc: string };
}

/**
 * A provider's signed acceleration receipt.
 *
 * Signed payload encoding (schema_version 'universe-accelerator-receipt-v1'):
 * the receipt object without `provider_signature` and `key_id`, serialised
 * as JSON with object keys sorted lexicographically at every level, no
 * whitespace, strings as JSON strings, numbers as JSON numbers, arrays in
 * their given order. The message signed is the UTF-8 bytes of the string
 * `universe-accelerator-receipt-v1\n` followed by that JSON. The
 * signature is hex: 64 bytes for ed25519, 64 bytes for secp256k1 BIP-340
 * Schnorr (over the SHA-256 of the message). `key_id` names the provider
 * key in the owned directory that must be valid at `submitted_at_utc`.
 * The payload binds provider_id, receipt_id, txid, network, submitted_at_utc,
 * expires_at_utc and the acceleration terms (target feerate, provider fee,
 * claimed coverage and pools, status); altering any of them invalidates the
 * signature.
 */
export interface AcceleratorReceipt {
  schema_version: string;
  provider_id: string;
  receipt_id: string;
  txid: string;
  wtxid?: string;
  network: string;
  submitted_at_utc: string;
  expires_at_utc: string;
  target_feerate_sats_vb: number;
  provider_fee_sats: number;
  claimed_mining_coverage_pct: number;
  claimed_partner_pools: string[];
  status: 'active' | 'included' | 'expired' | 'refunded';
  key_id: string;
  provider_signature: string;
}

/**
 * invalid: structure, completeness or signature failed (an altered field
 * fails here); unsupported: an encoding this deployment cannot verify;
 * unavailable-trust: no directory, or the provider or key is not in it or
 * not valid at issue; wrong-network; expired; duplicate: a replay of a
 * receipt already verified here; verified.
 */
export type ReceiptVerificationStage =
  | 'invalid'
  | 'unsupported'
  | 'unavailable-trust'
  | 'wrong-network'
  | 'expired'
  | 'duplicate'
  | 'verified';

export interface ReceiptVerificationResult {
  verified: boolean;
  stage: ReceiptVerificationStage;
  errors: string[];
  provider_id?: string;
  receipt_id?: string;
  key_id?: string;
  algorithm?: string;
  verified_at_utc?: string;
  directory?: { source: string; revision: string; loaded_at_utc: string };
  replay?: { first_verified_at_utc: string; seen_count: number };
  scope?: string;
}

export interface AcceleratorProviderKey {
  kid: string;
  algorithm: 'ed25519' | 'secp256k1-schnorr';
  publicKey: string;
  validFrom: string;
  validUntil: string | null;
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
  template_coverage?: 'template-observed' | 'no-template-observed';
  template_ids?: string[];
  template_position?: number | null;
  sensor_observer_id?: string | null;
}

export interface SubmissionOverview {
  capabilities: SubmissionCapabilities;
  active_accelerator_providers: AcceleratorProvider[];
  recent_ordering_findings_count: number;
  total_private_broadcasts_24h: number;
  average_queue_duration_seconds: number;
}
