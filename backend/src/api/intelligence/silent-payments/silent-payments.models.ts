export interface SilentPaymentBlockManifest {
  height: number;
  block_hash: string;
  num_inputs: number;
  num_sp_outputs: number;
  tweaks_hash: string;
  bundle_s3_url?: string;
  created_at: string;
}

export interface SilentPaymentBlockBundle {
  height: number;
  block_hash: string;
  spent_outpoints: { txid: string; vout: number; pubkey?: string }[];
  candidate_outputs: { txid: string; vout: number; pubkey: string; amount_sats: number }[];
  input_tweak_sum: string;
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
}

export interface SilentPaymentCoverageOverview {
  latest_indexed_height: number;
  total_indexed_blocks: number;
  total_sp_outputs_detected: number;
  ecosystem_adoption_count: number;
  support_claims: SilentPaymentSupportClaim[];
  last_updated: string;
}
