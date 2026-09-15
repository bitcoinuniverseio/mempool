export interface PayjoinDirectory {
  directory_id: string;
  url: string;
  /** SHA-256 of the OHTTP keys the directory served; null when the probe failed. */
  ohttp_key_hash: string | null;
  bip77_supported: boolean;
  bip78_supported: boolean;
  latency_ms: number | null;
  last_tested_at: string;
  error: string | null;
}

export interface PayjoinProposalAnalysisRequest {
  original_psbt: string;
  proposal_psbt: string;
}

export interface PayjoinProposalAnalysisResult {
  analysis_id: string;
  protocol_version: 'BIP78' | 'BIP77';
  inputs_added_by_receiver: number;
  /** Null when the added inputs carry no UTXO data. */
  receiver_contributed_sats: number | null;
  original_fee_sats: number | null;
  proposal_fee_sats: number | null;
  fee_delta_sats: number | null;
  effective_feerate_sats_vb: number | null;
  heuristics_broken: string[];
  /** The number of heuristics broken; no scoring model is applied. */
  privacy_score_gain: number;
  is_valid: boolean;
  validation_messages: string[];
  original: { inputs: number; outputs: number };
  proposal: { inputs: number; outputs: number };
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
  /** Always true: the playground narrates the protocol and builds nothing. */
  simulated: true;
  step: 'original_created' | 'proposal_generated' | 'signed_and_broadcast';
  sender_address: string;
  receiver_address: string;
  amount_sats: number;
  original_txid: null;
  payjoin_txid: null;
  events_trace: { timestamp: string; phase: string; details: string }[];
}

export interface PayjoinOverview {
  active_directories_count: number;
  configured_directories_count: number;
  /** Null: no payjoin detector runs on this deployment. */
  total_payjoins_detected_24h: number | null;
  common_input_heuristic_breaks_24h: number | null;
  compatibility_catalog: PayjoinCompatibilityEntry[];
  compatibility_source: string;
  last_updated: string;
}
