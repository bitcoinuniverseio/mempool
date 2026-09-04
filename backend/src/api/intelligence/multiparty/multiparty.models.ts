/**
 * MuSig2, Multisig Setup, and Wallet Policy Interoperability Models.
 */

export interface SigningCapabilityClaim {
  psbt_v0: boolean;
  psbt_v2: boolean;
  musig2_bip327: boolean;
  musig2_psbt_bip373: boolean;
  musig_descriptor_bip390: boolean;
  wallet_policy_bip388: boolean;
  bsms_bip129: boolean;
  labels_bip329: boolean;
  frost_rfc9591_compatible: boolean;
  frost_bip340_ready: boolean;
}

export interface SigningProduct {
  product_id: string;
  vendor_name: string;
  product_name: string;
  firmware_version: string;
  capabilities: SigningCapabilityClaim;
  test_vector_results: {
    passed_count: number;
    failed_count: number;
    total_count: number;
  };
  last_verified_at: string;
}

export interface MuSig2PublicSessionSchema {
  session_id: string;
  network: string;
  psbt_version: string;
  unsigned_transaction_hash: string;
  input_index: number;
  message_hash: string;
  participant_public_keys: string[];
  aggregate_public_key: string;
  public_nonces: string[];
  aggregate_nonce?: string;
  partial_signatures: string[];
  final_signature?: string;
  is_round_one_complete: boolean;
  is_round_two_complete: boolean;
  has_duplicate_nonces: boolean;
  session_hash: string;
  created_at: string;
}

export interface WalletPolicyFixture {
  policy_id: string;
  name: string;
  policy_template: string;
  keys_vector: string[];
  descriptor_checksum: string;
  first_receive_address: string;
  first_change_address: string;
  is_valid: boolean;
}

export interface BsmsFixture {
  record_id: string;
  bip_version: string;
  token_mode: 'plain' | 'encrypted';
  descriptor_record: string;
  participants_count: number;
  threshold_m: number;
  total_n: number;
  first_address_verified: boolean;
  mac_valid: boolean;
}

export interface MultipartyOverviewResponse {
  total_products: number;
  bip373_ready_count: number;
  bip388_ready_count: number;
  bsms_ready_count: number;
  active_sessions_count: number;
  products: SigningProduct[];
  sample_policies: WalletPolicyFixture[];
}
