export interface ConsensusProposal {
  proposal_id: string;
  bip_number?: number;
  title: string;
  author: string;
  proposal_type: 'covenant' | 'arithmetic' | 'introspection' | 'upgrade';
  status:
    'draft' | 'proposed' | 'active_discussion' | 'superseded' | 'complete';
  covenant_type: 'recursive' | 'non_recursive' | 'general';
  activation_mechanism: string;
  spec_url: string;
  summary: string;
  opcodes: string[];
  expressiveness_score: number | null;
  security_surface_rating: 'minimal' | 'moderate' | 'complex' | null;
  created_at: string;
}

export interface CovenantSimulationRequest {
  proposal_id: string;
  covenant_script: string;
  deposit_sats: number;
  timelock_blocks: number;
  recovery_pubkey: string;
  unvault_pubkey: string;
  transaction_hex?: string;
  input_index?: number;
}

export interface CovenantSimulationResult {
  simulation_id: string;
  proposal_id: string;
  valid: boolean | null;
  template_matches: boolean;
  calculated_template_hash: string;
  committed_template_hash: string;
  scope: string;
  state_transitions: {
    from_state: string;
    to_state: string;
    trigger: string;
    delay_blocks?: number;
  }[];
  witness_weight_estimate: number | null;
  covenant_restrictions_summary: string[];
}

export interface VaultDesignTemplate {
  template_id: string;
  name: string;
  description: string;
  proposal_target: string;
  hot_key_threshold: number;
  recovery_delay_blocks: number;
  auto_cancel_available: boolean;
  execution_scope: string;
}

export interface ConsensusLabOverview {
  proposals_count: number;
  covenant_types: { type: string; count: number }[];
  featured_proposals: ConsensusProposal[];
  vault_templates: VaultDesignTemplate[];
  last_updated: string | null;
  source_basis: string;
}
