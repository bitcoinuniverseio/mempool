export interface PayjoinDirectory {
  directory_id: string;
  url: string;
  ohttp_key_hash: string;
  bip77_supported: boolean;
  bip78_supported: boolean;
  latency_ms: number;
  last_tested_at: string;
}

export interface PayjoinProposalAnalysisRequest {
  original_psbt: string;
  proposal_psbt: string;
}

export interface PayjoinProposalAnalysisResult {
  analysis_id: string;
  protocol_version: 'BIP78' | 'BIP77';
  inputs_added_by_receiver: number;
  receiver_contributed_sats: number;
  original_fee_sats: number;
  proposal_fee_sats: number;
  fee_delta_sats: number;
  effective_feerate_sats_vb: number;
  heuristics_broken: string[];
  privacy_score_gain: number;
  is_valid: boolean;
  validation_messages: string[];
}

export interface PayjoinCompatibilityEntry {
  software: string;
  role: 'sender' | 'receiver' | 'both';
  bip78_v1_http: boolean;
  bip77_v2_ohttp: boolean;
  status: 'production' | 'testing' | 'planned';
  notes: string;
}

export interface PayjoinPlaygroundSession {
  session_id: string;
  step: 'original_created' | 'proposal_generated' | 'signed_and_broadcast';
  sender_address: string;
  receiver_address: string;
  amount_sats: number;
  original_txid?: string;
  payjoin_txid?: string;
  events_trace: { timestamp: string; phase: string; details: string }[];
}

export interface PayjoinOverview {
  active_directories_count: number;
  total_payjoins_detected_24h: number;
  common_input_heuristic_breaks_24h: number;
  compatibility_catalog: PayjoinCompatibilityEntry[];
  last_updated: string;
}
