/**
 * Decentralized Mining Sharechain and Template Autonomy Observatory Models.
 */

export type MiningShareState =
  | 'observed'
  | 'locally_verified'
  | 'accepted_by_coordinator'
  | 'rejected_by_coordinator'
  | 'propagated'
  | 'orphaned'
  | 'stale'
  | 'included_in_block_candidate'
  | 'contributed_to_payout'
  | 'paid_on_chain'
  | 'unknown';

export interface DecentralizedMiningProtocol {
  protocol_id: 'datum_gateway' | 'p2pool_v2' | 'braidpool';
  name: string;
  architecture: 'miner_selected_templates' | 'linear_sharechain' | 'dag_consensus';
  current_version: string;
  share_structure: string;
  payout_mechanism: string;
  description: string;
}

export interface DecentralizedMiningSource {
  source_id: string;
  protocol_id: 'datum_gateway' | 'p2pool_v2' | 'braidpool';
  endpoint: string;
  source_name: string;
  is_active: boolean;
  current_height: number;
  share_target: string;
  shares_accepted_count: number;
  shares_rejected_count: number;
  stale_ratio_pct: number;
  submission_latency_ms: number;
  last_block_candidate_height?: number;
  last_seen_at: string;
}

export interface DecentralizedMiningShare {
  share_id: string;
  protocol_id: 'datum_gateway' | 'p2pool_v2' | 'braidpool';
  source_id: string;
  height: number;
  parent_share_ids: string[];
  miner_payout_script: string;
  work_value: number;
  share_target: string;
  difficulty: number;
  template_id: string;
  states: MiningShareState[];
  is_valid: boolean;
  mined_at: string;
}

export interface DecentralizedMiningTemplate {
  template_id: string;
  protocol_id: string;
  source_id: string;
  height: number;
  tx_count: number;
  total_weight: number;
  total_fees_sats: number;
  coinbase_payout_outputs_count: number;
  coinbase_tags: string[];
  miner_controlled_ratio_pct: number;
  author_provenance: 'locally_constructed' | 'pool_constructed' | 'hybrid_guardrails' | 'insufficient_evidence';
  template_fingerprint: string;
  created_at: string;
}

export interface DecentralizedMiningTemplateComparison {
  height: number;
  template_a_id: string;
  template_b_id: string;
  shared_txs_count: number;
  exclusive_txs_a_count: number;
  exclusive_txs_b_count: number;
  similarity_ratio: number;
  fee_difference_sats: number;
}

export interface DecentralizedMiningPayoutEvidence {
  payout_id: string;
  protocol_id: string;
  block_height: number;
  payout_commitment: string;
  coinbase_txid?: string;
  settlement_type: 'coinbase_output' | 'sharechain_claim' | 'lightning_settlement';
  amount_sats: number;
  recipient_script: string;
  verified_on_chain: boolean;
  confirmed_at: string;
}

export interface DecentralizedMiningOverviewResponse {
  protocols: DecentralizedMiningProtocol[];
  total_active_sources: number;
  total_observed_shares: number;
  recent_shares: DecentralizedMiningShare[];
  recent_templates: DecentralizedMiningTemplate[];
  sources: DecentralizedMiningSource[];
  recent_payouts: DecentralizedMiningPayoutEvidence[];
}
