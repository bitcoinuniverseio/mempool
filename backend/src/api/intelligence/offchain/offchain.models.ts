/**
 * Statechain, CoinSwap, and Off-Chain UTXO Recovery Models.
 */

export type OffchainRecoveryState =
  | 'recoverable_now'
  | 'recoverable_after_height'
  | 'requires_counterparty'
  | 'requires_operator'
  | 'insufficient_artifacts'
  | 'unsafe_package'
  | 'already_spent'
  | 'unknown';

export interface OffchainOperator {
  operator_id: string;
  protocol: 'mercury_statechain' | 'teleport_coinswap';
  operator_public_key: string;
  display_name: string;
  networks: string[];
  endpoints: {
    clearnet: string;
    tor_onion?: string;
    i2p?: string;
  };
  supported_versions: string[];
  signature_count_endpoint?: string;
  transfer_capabilities: string[];
  recovery_capabilities: string[];
  health: 'healthy' | 'degraded' | 'unreachable';
  effective_from: string;
  expires_at: string;
  provenance: {
    registered_in_knowledge_registry: boolean;
    identity_ref?: string;
    verified_signature: boolean;
  };
}

export interface StatechainPublicManifest {
  schema_version: string;
  protocol: string;
  operator_public_key: string;
  display_name: string;
  networks: string[];
  endpoints: Record<string, string>;
  supported_versions: string[];
  backup_transaction_policy: string;
  signature_count_endpoint: string;
  effective_from: string;
  expires_at: string;
  nonce: string;
  signature: string;
}

export interface StatechainBackupTransaction {
  statechain_id: string;
  iteration: number;
  locktime: number;
  txid: string;
  input_outpoint: string;
  output_address: string;
  output_value_sats: number;
  fee_sats: number;
  server_signature: string;
  is_valid_locktime_decrement: boolean;
}

export interface StatechainTransferVerification {
  statechain_id: string;
  is_valid: boolean;
  deposit_outpoint?: string;
  deposit_amount_sats: number;
  backup_transactions_count: number;
  server_signature_count: number;
  signatures_reconciled: boolean;
  earliest_unilateral_exit_height: number;
  current_block_height: number;
  recoverable_state: OffchainRecoveryState;
  errors: string[];
  warnings: string[];
}

export interface CoinswapPublicOffer {
  offer_id: string;
  maker_id: string;
  maker_name: string;
  protocol_version: string;
  network: string;
  min_amount_sats: number;
  max_amount_sats: number;
  base_fee_sats: number;
  fee_rate_bps: number;
  supported_timelock_deltas: number[];
  endpoint: string;
  endpoint_type: 'clearnet' | 'tor_onion';
  last_seen_at: string;
}

export interface CoinswapContractTransaction {
  role: 'funding' | 'forward_contract' | 'backward_contract' | 'settlement' | 'timeout_refund';
  txid: string;
  timelock: number;
  hashlock: string;
  value_sats: number;
  is_valid_timeout_order: boolean;
}

export interface CoinswapPackageVerification {
  package_id: string;
  is_valid: boolean;
  maker_id: string;
  total_hops: number;
  swap_amount_sats: number;
  contract_transactions: CoinswapContractTransaction[];
  watchtower_coverage_verified: boolean;
  recovery_state: OffchainRecoveryState;
  errors: string[];
}

export interface OffchainRecoveryPlan {
  plan_id: string;
  protocol: 'statechain' | 'coinswap';
  entity_id: string;
  current_stage: string;
  earliest_broadcast_height: number;
  requires_fee_bump: boolean;
  suggested_fee_rate_sats_vb: number;
  recovery_state: OffchainRecoveryState;
  unsigned_psbt_hex: string;
  action_guidance: string;
}

export interface OffchainOverviewResponse {
  total_operators: number;
  active_statechains_count: number;
  active_coinswap_makers: number;
  operators: OffchainOperator[];
  public_offers: CoinswapPublicOffer[];
}
