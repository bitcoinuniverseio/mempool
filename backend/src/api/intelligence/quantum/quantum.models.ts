export interface QuantumPubkeyExposure {
  outpoint: string;
  txid: string;
  vout: number;
  amount_sats: number;
  script_type: 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
  is_exposed: boolean;
  exposure_reason: 'direct_pubkey_script' | 'address_reuse_spend' | 'keypath_taproot' | 'hash_protected';
  first_exposed_height?: number;
}

export interface QuantumCohortBreakdown {
  script_type: string;
  total_utxos: number;
  total_sats: number;
  exposed_utxos: number;
  exposed_sats: number;
  exposed_percentage: number;
}

export interface QuantumRevealEvent {
  event_id: string;
  pubkey: string;
  txid: string;
  block_height: number;
  timestamp_utc: string;
  affected_outpoints_count: number;
  revealed_sats: number;
}

export interface QuantumMigrationPlanRequest {
  exposed_outpoints: string[];
  target_standard: 'p2wpkh' | 'p2tr_script_path' | 'post_quantum_tapscript';
}

export interface QuantumMigrationPlanResult {
  plan_id: string;
  total_exposed_sats: number;
  recommended_transactions_count: number;
  estimated_migration_fee_sats: number;
  post_migration_exposure_percentage: number;
  steps: { step_number: number; action: string; description: string }[];
}

export interface QuantumOverview {
  total_utxo_count: number;
  total_supply_sats: number;
  exposed_utxo_count: number;
  exposed_sats: number;
  exposed_supply_percentage: number;
  cohorts: QuantumCohortBreakdown[];
  recent_reveals: QuantumRevealEvent[];
  last_updated: string;
}
