export type VtxoVerificationState =
  | 'package_valid'
  | 'anchor_verified'
  | 'exit_path_verified'
  | 'path_exclusivity_verified'
  | 'path_exclusivity_not_verified'
  | 'expired'
  | 'already_spent'
  | 'reorged'
  | 'incomplete'
  | 'unsupported'
  | 'invalid'
  | 'unknown';

export type VtxoLifecycleState =
  | 'created'
  | 'received'
  | 'active'
  | 'refresh_due'
  | 'refresh_pending'
  | 'refreshed'
  | 'spent_offchain'
  | 'collaborative_exit_pending'
  | 'collaboratively_exited'
  | 'unilateral_exit_available'
  | 'unilateral_exit_started'
  | 'unilateral_exit_waiting'
  | 'unilateral_exit_complete'
  | 'expired'
  | 'swept'
  | 'conflicting'
  | 'reorged'
  | 'unknown';

export interface MinimalViableVtxo {
  vtxo_id: string;
  version: number;
  network: string;
  amount_sats: number;
  script_pubkey: string;
  sequence: number;
  exit_delay_blocks: number;
  anchor_outpoint: {
    txid: string;
    vout: number;
  };
  asp_pubkey: string;
  user_pubkey: string;
  parent_vtxo_id?: string;
  expires_at_height: number;
}

export interface VpackImplementationAdapter {
  implementation_id: 'arkade' | 'bark' | string;
  implementation_name: string;
  implementation_revision: string;
  supported_vpack_versions: string[];
  dialect_features: {
    native_extensions_supported: string[];
    fee_anchor_type: string;
    taproot_tree_style: string;
  };
}

export interface VpackProvider {
  provider_id: string;
  identity_key: string;
  name: string;
  network: string;
  protocol_version: string;
  vpack_version: string;
  native_package_version: string;
  endpoint_url: string;
  health_status: 'online' | 'degraded' | 'offline';
  current_round_id: string;
  current_block_height: number;
  exit_delay_blocks: number;
  refresh_interval_blocks: number;
  supported_asset_types: string[];
  fee_policy: {
    base_fee_sats: number;
    pct_fee: number;
  };
  server_signed_manifest: string;
  last_successful_observation: string;
}

export interface VpackPublicAnchorVerification {
  anchor_outpoint: string;
  exists_onchain: boolean;
  block_height?: number;
  confirmations: number;
  spend_status: 'unspent' | 'spent' | 'conflicting';
  spend_txid?: string;
  exit_delay_blocks: number;
  verified: boolean;
  errors: string[];
}

export interface VpackUnilateralExitPlan {
  vtxo_id: string;
  anchor_outpoint: string;
  required_transactions_count: number;
  csv_delay_blocks: number;
  estimated_package_vsize: number;
  estimated_package_fee_sats: number;
  fee_anchor_available: boolean;
  cpfp_output_index?: number;
  exit_stages: {
    stage_index: number;
    tx_type: 'round_transaction' | 'connector_transaction' | 'exit_transaction';
    ready_to_broadcast: boolean;
    required_delay_blocks: number;
  }[];
  unsigned_exit_psbt: string;
  warnings: string[];
}

export interface VpackOverview {
  total_vpack_versions: number;
  active_providers_count: number;
  supported_implementations: VpackImplementationAdapter[];
  recent_verified_anchors: number;
  providers: VpackProvider[];
  active_versions: string[];
}
