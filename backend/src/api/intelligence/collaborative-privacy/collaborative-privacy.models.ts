export type ProtocolClassification =
  | 'protocol_proven'
  | 'protocol_claimed'
  | 'shape_consistent'
  | 'shape_inconsistent'
  | 'insufficient_evidence'
  | 'not_evaluated';

export type CollaborativeProtocolId = 'wabisabi' | 'joinmarket' | 'whirlpool_archival';

export interface CollaborativeProtocol {
  protocol_id: CollaborativeProtocolId;
  name: string;
  revision: string;
  coordination_model: 'centralized_blinded' | 'decentralized_maker_taker' | 'fixed_denomination_pool';
  anonymous_credentials: boolean;
  fidelity_bonds_supported: boolean;
  specification_url: string;
}

export interface CollaborativeCoordinator {
  coordinator_id: string;
  identity_key: string;
  name: string;
  protocol: CollaborativeProtocolId;
  protocol_revision: string;
  networks: string[];
  endpoint_types: string[];
  fee_policy_description: string;
  min_input_count: number;
  max_input_count: number;
  health_status: 'online' | 'degraded' | 'offline';
  effective_from: string;
  expires_at: string;
  coordinator_signature: string;
}

export interface JoinMarketFidelityBond {
  bond_utxo: string;
  maker_pubkey: string;
  locktime_height: number;
  current_height: number;
  blocks_remaining: number;
  locked_sats: number;
  calculated_bond_value_sats: number;
  is_active: boolean;
  reused: boolean;
  signature_verified: boolean;
}

export interface CollaborativeRound {
  round_id: string;
  protocol: CollaborativeProtocolId;
  coordinator_id: string;
  phase: 'input_registration' | 'connection_confirmation' | 'output_registration' | 'signing' | 'ended';
  input_count: number;
  output_count: number;
  registered_amount_sats: number;
  mining_fee_sats: number;
  coordinator_fee_sats: number;
  equal_output_groups_count: number;
  effective_anonymity_set_min: number;
  effective_anonymity_set_max: number;
  final_txid?: string;
  classification: ProtocolClassification;
  started_at_utc: string;
  completed_at_utc?: string;
}

export interface CollaborativePrivacyOverview {
  active_protocols_count: number;
  active_coordinators_count: number;
  observed_rounds_24h: number;
  active_fidelity_bonds_count: number;
  protocols: CollaborativeProtocol[];
  coordinators: CollaborativeCoordinator[];
  recent_rounds: CollaborativeRound[];
  fidelity_bonds: JoinMarketFidelityBond[];
}
