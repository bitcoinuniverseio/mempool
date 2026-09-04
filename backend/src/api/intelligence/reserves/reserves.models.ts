export interface ReserveProvider {
  provider_id: string;
  name: string;
  category: 'exchange' | 'custodian' | 'lending' | 'wrapped_token_custody';
  attestation_frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand';
  total_reserve_sats: number;
  total_liability_sats: number;
  solvency_ratio_percentage: number;
  last_attestation_height: number;
  last_attestation_utc: string;
  proof_standard: 'bip127' | 'merkle_sum_tree' | 'zero_knowledge';
  website_url: string;
  status: 'active' | 'under_review' | 'stale';
}

export interface ReserveSnapshot {
  snapshot_id: string;
  provider_id: string;
  block_height: number;
  block_hash: string;
  timestamp_utc: string;
  total_reserve_sats: number;
  total_liability_sats: number;
  solvency_ratio: number;
  merkle_root: string;
  utxo_count: number;
  signature_count: number;
  verified_onchain: boolean;
}

export interface Bip127ProofItem {
  txid: string;
  vout: number;
  amount_sats: number;
  address: string;
  message: string;
  signature: string;
  public_key: string;
}

export interface VerificationRequest {
  proof_type: 'bip127' | 'merkle_inclusion';
  bip127_proof?: {
    expected_message: string;
    items: Bip127ProofItem[];
  };
  merkle_proof?: {
    merkle_root: string;
    leaf_hash: string;
    path: string[];
    index: number;
    expected_liability_sats: number;
  };
}

export interface VerificationResult {
  verified: boolean;
  proof_type: 'bip127' | 'merkle_inclusion';
  total_verified_sats: number;
  verified_items_count: number;
  errors: string[];
  attestation_digest: string;
  evaluated_at: string;
}

export interface ReservesOverview {
  total_tracked_reserve_sats: number;
  total_tracked_liability_sats: number;
  overall_solvency_percentage: number;
  active_providers_count: number;
  recent_snapshots: ReserveSnapshot[];
  providers: ReserveProvider[];
  last_updated: string;
}
