export type StakingDelegationState =
  | 'registered'
  | 'submitted'
  | 'active'
  | 'unbonding_requested'
  | 'unbonding_active'
  | 'unbonded'
  | 'withdrawn'
  | 'expired'
  | 'slashed_pending'
  | 'slashed'
  | 'overflow_rejected'
  | 'under_min_stake'
  | 'over_max_stake'
  | 'invalid_script'
  | 'invalid_covenant_sigs'
  | 'reorg_rolled_back'
  | 'conflicting_eots'
  | 'unknown_orphan';

export interface StakingProtocolParameters {
  version_id: string;
  activation_height: number;
  min_staking_time_blocks: number;
  max_staking_time_blocks: number;
  unbonding_time_blocks: number;
  min_staking_amount_sat: number;
  max_staking_amount_sat: number;
  confirmation_depth: number;
  covenant_quorum: {
    required: number;
    total: number;
    public_keys: string[];
  };
  slashing_burn_script: string;
  is_active: boolean;
}

export interface StakingDelegation {
  delegation_id: string;
  staker_pk: string;
  finality_provider_pks: string[];
  staking_amount_sat: number;
  state: StakingDelegationState;
  staking_txid: string;
  staking_vout: number;
  staking_timelock_blocks: number;
  start_height: number;
  end_height: number;
  unbonding_txid?: string;
  unbonding_timelock_blocks?: number;
  slashing_txid?: string;
  withdrawn_txid?: string;
  covenant_signatures_count: number;
  covenant_signatures_required: number;
  last_updated_at: string;
  discrepancy_flags: string[];
}

export interface FinalityProvider {
  provider_id: string;
  moniker: string;
  btc_pk: string;
  commission_rate_percent: number;
  active_tvl_sat: number;
  delegations_count: number;
  uptime_percent: number;
  is_slashed: boolean;
  eots_public_key: string;
  first_registered_at: string;
  last_activity_at: string;
}

export interface EotsSlashingEvidence {
  evidence_id: string;
  provider_id: string;
  block_height: number;
  app_hash_tag: string;
  eots_pk: string;
  nonce_point: string;
  signature_a: string;
  signature_b: string;
  message_a: string;
  message_b: string;
  verified_status: 'equivocation_proven' | 'suspected_conflict' | 'invalid_evidence' | 'insufficient_evidence';
  recovered_secret_hash?: string;
  submitted_at: string;
}

export interface StakingTransactionVerificationRequest {
  raw_tx_hex: string;
  expected_family: 'staking_deposit' | 'unbonding' | 'slashing' | 'withdrawal';
  parameter_version?: string;
}

export interface StakingTransactionVerificationResult {
  valid: boolean;
  txid: string;
  family: 'staking_deposit' | 'unbonding' | 'slashing' | 'withdrawal' | 'unknown';
  detected_parameters: {
    staker_pk?: string;
    finality_provider_pk?: string;
    staking_amount_sat?: number;
    timelock_blocks?: number;
    covenant_signatures_count?: number;
    covenant_threshold_met?: boolean;
    slashing_destination_verified?: boolean;
  };
  errors: string[];
  warnings: string[];
}

export interface CrossChainReconciliationResult {
  reconciled: boolean;
  chain_name: string;
  btc_tip_height: number;
  consumer_app_height: number;
  active_stake_match: boolean;
  total_btc_stake_sat: number;
  total_consumer_voting_power_sat: number;
  unbonding_sync_status: 'synchronized' | 'lagging' | 'mismatch';
  discrepancies: string[];
}

export interface BitcoinStakingOverview {
  total_active_delegations: number;
  total_staked_sat: number;
  total_finality_providers: number;
  slashed_providers_count: number;
  current_protocol_parameter_version: string;
  recent_slashing_evidences_count: number;
  delegation_states_summary: Record<StakingDelegationState, number>;
}
