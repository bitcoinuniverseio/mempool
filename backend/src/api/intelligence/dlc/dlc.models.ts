/**
 * Discreet Log Contract and Oracle Verification Models and Interfaces.
 */

export type DlcConflictState =
  | 'suspected_conflict'
  | 'cryptographically_verified_conflict'
  | 'insufficient_evidence'
  | 'invalid_evidence';

export type DlcSourceVerificationState =
  | 'verified'
  | 'reported'
  | 'observed'
  | 'inferred'
  | 'estimated'
  | 'partial'
  | 'stale'
  | 'unsupported'
  | 'unavailable'
  | 'unknown'
  | 'invalid'
  | 'conflicting';

export interface DlcOracleEndpoint {
  endpoint_id: string;
  url: string;
  endpoint_type: 'direct_rpc' | 'rest' | 'tor_onion' | 'signed_feed';
  protocol_revision: string;
  is_active: boolean;
  last_probe_at: string;
  latency_ms: number;
  status: 'healthy' | 'degraded' | 'unreachable';
}

export interface DlcOracle {
  oracle_id: string;
  oracle_public_key: string;
  display_name: string;
  endpoint: string;
  endpoint_type: string;
  protocol_revision: string;
  registration_source: string;
  registration_signature: string;
  first_observed_at: string;
  last_observed_at: string;
  last_success_at: string;
  health: 'healthy' | 'degraded' | 'inactive';
  coverage: {
    total_events: number;
    total_attestations: number;
    announced_events: number;
    active_conflicts: number;
    last_block_height: number;
  };
  provenance: {
    registered_in_knowledge_registry: boolean;
    identity_ref?: string;
    verified_by_universe: boolean;
  };
}

export interface DlcOracleRevision {
  revision_id: string;
  oracle_id: string;
  effective_date: string;
  supported_tlv_versions: string[];
  public_key: string;
  notes: string;
}

export interface DlcOracleAnnouncement {
  announcement_id: string;
  oracle_id: string;
  oracle_public_key: string;
  event_id: string;
  event_descriptor: {
    type: 'enumerated' | 'numeric';
    outcomes?: string[];
    base?: number;
    num_digits?: number;
    unit?: string;
    min_value?: number;
    max_value?: number;
  };
  event_maturity_epoch: number;
  maturity_formatted: string;
  nonce_count: number;
  nonces: string[];
  announcement_signature: string;
  original_bytes_hex: string;
  payload_hash: string;
  verified: boolean;
  verification_message?: string;
  observed_at: string;
}

export interface DlcOracleAttestation {
  attestation_id: string;
  announcement_id: string;
  oracle_id: string;
  oracle_public_key: string;
  event_id: string;
  outcomes: string[];
  signatures: string[];
  attested_at: string;
  delay_seconds: number;
  verified: boolean;
  has_conflict: boolean;
}

export interface DlcOracleConflictEvidence {
  evidence_id: string;
  oracle_id: string;
  oracle_public_key: string;
  conflict_type: 'nonce_reuse' | 'equivocation' | 'inconsistent_attestation';
  state: DlcConflictState;
  announcement_id_a: string;
  announcement_id_b?: string;
  event_id_a: string;
  event_id_b?: string;
  reused_nonce?: string;
  attested_outcome_a: string;
  attested_outcome_b?: string;
  signature_a: string;
  signature_b?: string;
  proof_package_hash: string;
  discovered_at: string;
  resolution_status: 'open' | 'confirmed' | 'disputed' | 'resolved';
}

export interface DlcCet {
  cet_id: string;
  outcome: string;
  local_payout_sats: number;
  remote_payout_sats: number;
  fee_sats: number;
  adaptor_signature: string;
  locktime: number;
  txid?: string;
}

export interface DlcContractParty {
  role: 'local' | 'remote';
  public_key: string;
  collateral_sats: number;
  payout_address: string;
  funding_input: {
    txid: string;
    vout: number;
    value_sats: number;
  };
}

export interface DlcContractPackage {
  contract_id: string;
  temporary_contract_id: string;
  state: 'offered' | 'accepted' | 'signed' | 'funded' | 'closed' | 'refunded';
  total_collateral_sats: number;
  fee_rate_sats_per_vb: number;
  oracle_ids: string[];
  multi_oracle_type: 'single' | 'n_of_n' | 't_of_n';
  threshold?: number;
  total_oracles?: number;
  parties: DlcContractParty[];
  cets: DlcCet[];
  refund: {
    locktime: number;
    local_payout_sats: number;
    remote_payout_sats: number;
    txid?: string;
  };
  funding_txid?: string;
  is_verified: boolean;
  validation_errors: string[];
}

export interface DlcSimulationResult {
  simulation_id: string;
  scenario: 'settlement' | 'oracle_outage' | 'conflicting_attestations' | 'refund_timeout' | 'reorg';
  contract_id: string;
  oracle_ids: string[];
  settlement_outcome?: string;
  payout_local_sats: number;
  payout_remote_sats: number;
  fees_sats: number;
  funding_tx_hex: string;
  closing_tx_hex: string;
  adaptor_signatures_valid: boolean;
  status: 'simulated_success' | 'simulated_refund' | 'simulated_conflict';
  message: string;
  created_at: string;
}

export interface DlcOverviewResponse {
  total_oracles: number;
  healthy_oracles: number;
  active_events: number;
  total_attestations: number;
  verified_conflicts: number;
  recent_events: DlcOracleAnnouncement[];
  recent_attestations: DlcOracleAttestation[];
  active_conflicts: DlcOracleConflictEvidence[];
}
