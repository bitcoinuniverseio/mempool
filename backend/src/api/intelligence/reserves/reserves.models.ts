export interface ReserveProvider {
  provider_id: string;
  name: string;
  category: 'exchange' | 'custodian' | 'lending' | 'wrapped_token_custody' | 'unclassified';
  attestation_frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand' | 'unknown';
  total_reserve_sats: number | null;
  total_liability_sats: number | null;
  solvency_ratio_percentage: number | null;
  last_attestation_height: number | null;
  last_attestation_utc: string | null;
  proof_standard: 'bip127' | 'merkle_sum_tree' | 'zero_knowledge' | 'signed_liability_root';
  website_url: string;
  status: 'active' | 'under_review' | 'stale' | 'key_configured';
}

export interface ReserveSnapshot {
  snapshot_id: string;
  provider_id: string;
  block_height: number | null;
  block_hash: string | null;
  timestamp_utc: string;
  total_reserve_sats: number | null;
  total_liability_sats: number | null;
  solvency_ratio: number | null;
  merkle_root: string;
  utxo_count: number | null;
  signature_count: number;
  verified_onchain: boolean;
  authenticated_root?: boolean;
  attested_liability_sats?: number;
  evidence_scope?: string;
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
    transaction_hex?: string;
    expected_message: string;
    items?: Bip127ProofItem[];
  };
  merkle_proof?: {
    scheme?: string;
    leaf?: { account_id: string; nonce: string; liability_sats: number };
    attestation?: import('./liability-proof').RootAttestation;
    merkle_root: string;
    leaf_hash?: string;
    path: string[];
    index: number;
    expected_liability_sats?: number;
  };
}

export interface VerificationResult {
  inclusion_verified?: boolean;
  authenticated_root?: boolean;
  solvency_verified?: boolean;
  included_liability_sats?: number;
  warnings?: string[];
  scope?: string;
  verified: boolean;
  proof_type: 'bip127' | 'merkle_inclusion';
  total_verified_sats: number;
  verified_items_count: number;
  errors: string[];
  attestation_digest: string;
  evaluated_at: string;
}

export interface ReservesOverview {
  attestation_source_status?: 'validated' | 'unconfigured';
  total_tracked_reserve_sats: number | null;
  total_tracked_liability_sats: number | null;
  overall_solvency_percentage: number | null;
  active_providers_count: number;
  recent_snapshots: ReserveSnapshot[];
  providers: ReserveProvider[];
  last_updated: string;
}
