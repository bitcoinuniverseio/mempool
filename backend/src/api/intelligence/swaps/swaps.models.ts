export type SwapType = 'submarine' | 'reverse' | 'chain' | 'vhtlc' | 'generic_htlc';

export type SwapState =
  | 'created'
  | 'invoice_verified'
  | 'awaiting_lockup'
  | 'lockup_seen'
  | 'lockup_confirming'
  | 'claimable'
  | 'claim_seen'
  | 'claimed'
  | 'refundable'
  | 'refund_seen'
  | 'refunded'
  | 'cooperative_resolution'
  | 'expired'
  | 'reorged'
  | 'conflicting'
  | 'invalid'
  | 'unknown';

export type ReconciliationState =
  | 'fully_reconciled'
  | 'waiting_on_bitcoin'
  | 'waiting_on_liquid'
  | 'waiting_on_lightning'
  | 'waiting_on_ark'
  | 'source_lag'
  | 'source_disagreement'
  | 'insufficient_private_evidence'
  | 'invalid'
  | 'unknown';

export type RecoveryAction =
  | 'claimable_now'
  | 'refundable_now'
  | 'claimable_after_height'
  | 'refundable_after_height'
  | 'requires_provider'
  | 'requires_lightning_evidence'
  | 'requires_blinding_data'
  | 'already_claimed'
  | 'already_refunded'
  | 'unsafe'
  | 'insufficient_artifacts'
  | 'unknown';

export interface SwapProtocolDefinition {
  protocol_id: string;
  protocol_name: string;
  protocol_revision: string;
  supported_networks: string[];
  supported_swap_types: SwapType[];
  taproot_support: boolean;
  liquid_support: boolean;
  ark_support: boolean;
  specification_url: string;
}

export interface SwapProvider {
  provider_id: string;
  identity_key: string;
  name: string;
  protocols: string[];
  protocol_versions: string[];
  networks: string[];
  swap_types: SwapType[];
  minimum_amount_sats: number;
  maximum_amount_sats: number;
  fee_percentage: number;
  miner_fee_estimate_sats: number;
  timeout_policy_blocks: number;
  cooperative_claim_support: boolean;
  cooperative_refund_support: boolean;
  taproot_support: boolean;
  liquid_support: boolean;
  ark_support: boolean;
  status_endpoint: string;
  health_status: 'online' | 'degraded' | 'offline';
  effective_from: string;
  expires_at: string;
  provider_signature: string;
}

export interface SwapPackage {
  schema_version: string;
  swap_type: SwapType;
  protocol_id: string;
  protocol_revision: string;
  network: string;
  secondary_network?: string;
  swap_id: string;
  provider_id: string;
  created_at: string;
  expires_at: string;
  invoice?: string;
  invoice_hash?: string;
  preimage_hash: string;
  timeout_height: number;
  timeout_timestamp?: number;
  expected_amount_sats: number;
  expected_secondary_amount?: string;
  provider_fee_sats: number;
  miner_fee_sats: number;
  lockup_address: string;
  lockup_transaction?: string;
  claim_transaction?: string;
  refund_transaction?: string;
  internal_keys?: {
    user_pubkey?: string;
    provider_pubkey?: string;
  };
  cooperative_keys?: string[];
  claim_keys?: string[];
  refund_keys?: string[];
  blinding_data?: string;
  provider_signature?: string;
  status: SwapState;
}

export interface SwapLockupVerification {
  verified: boolean;
  script_matches: boolean;
  amount_matches: boolean;
  timeout_valid: boolean;
  preimage_hash_committed: boolean;
  current_confirmations: number;
  required_confirmations: number;
  lockup_txid?: string;
  output_index?: number;
  errors: string[];
}

export interface SwapClaimVerification {
  verified: boolean;
  claim_path_valid: boolean;
  preimage_matches: boolean;
  witness_valid: boolean;
  destinations_valid: boolean;
  fee_sats: number;
  errors: string[];
}

export interface SwapRefundVerification {
  verified: boolean;
  timeout_matured: boolean;
  blocks_remaining: number;
  sequence_valid: boolean;
  locktime_valid: boolean;
  witness_valid: boolean;
  errors: string[];
}

export interface SwapRecoveryPlan {
  swap_id: string;
  current_state: SwapState;
  recommended_action: RecoveryAction;
  recoverable_value_sats: number;
  estimated_miner_fee_sats: number;
  timeout_height: number;
  current_block_height: number;
  blocks_until_refund: number;
  unsigned_recovery_psbt?: string;
  notes: string[];
}

export interface SwapsOverview {
  total_swaps_observed: number;
  active_providers_count: number;
  total_volume_sats: number;
  supported_protocols_count: number;
  recent_swaps: SwapPackage[];
  active_providers: SwapProvider[];
  protocols: SwapProtocolDefinition[];
}
