export interface SilentPaymentBlockManifest {
  schema_version: 1;
  chain: 'bitcoin';
  network: string;
  height: number;
  block_hash: string;
  previous_block_hash: string;
  num_inputs: number;
  candidate_output_count: number;
  bundle_hash: string;
  bundle_url: string;
  created_at: string;
}

export interface SilentPaymentScanTransaction {
  txid: string;
  spent_outpoints: { txid: string; vout: number }[];
  input_pubkeys: string[];
  candidate_outputs: { vout: number; pubkey: string; amount_sats: string }[];
}

export interface SilentPaymentBlockBundle {
  schema_version: 1;
  chain: 'bitcoin';
  network: string;
  height: number;
  block_hash: string;
  previous_block_hash: string;
  transactions: SilentPaymentScanTransaction[];
}

export interface SilentPaymentSupportClaim {
  wallet_id: string;
  name: string;
  send_supported: boolean;
  receive_supported: boolean;
  bip352_compliance: boolean;
  bip375_send_psbt: boolean;
  bip376_spend_psbt: boolean;
  verified_version: string;
  updated_at: string;
  status: 'documented' | 'tested';
  evidence_url: string;
}

export interface SilentPaymentCoverageOverview {
  chain: 'bitcoin';
  network: string;
  status: 'current' | 'stale' | 'empty' | 'unavailable';
  reason?: string;
  latest_indexed_height: number | null;
  total_indexed_blocks: number | null;
  total_candidate_outputs: number | null;
  total_sp_outputs_detected: null;
  ecosystem_adoption_count: null;
  support_claims: SilentPaymentSupportClaim[];
  last_updated: string | null;
  recent_manifests: SilentPaymentBlockManifest[];
}
