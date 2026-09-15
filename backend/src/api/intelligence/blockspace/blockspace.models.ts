export interface BlockspaceSemanticClass {
  class_id: string;
  name: string;
  category: 'monetary' | 'infrastructure' | 'arbitrary_data' | 'layer2';
  description: string;
  weight_share_percentage: number | null;
  fee_share_percentage: number | null;
  tx_count_24h: number;
}

export interface BlockspaceCompositionPoint {
  block_height: number;
  timestamp_utc: string;
  total_weight: number | null;
  total_fee_sats: number | null;
  monetary_weight: number | null;
  layer2_weight: number | null;
  arbitrary_data_weight: number | null;
  consolidation_weight: number | null;
}

export interface BlockspaceRegimeEvent {
  regime_id: string;
  network: string;
  start_height: number;
  end_height?: number;
  regime_type: 'consolidation_friendly' | 'monetary_standard' | 'data_minting_spike' | 'extreme_congestion';
  median_feerate: number;
  primary_demand_driver: string;
  detected_at: string;
}

export interface BlockspaceTxEvidence {
  txid: string;
  primary_class: string;
  class_id: string;
  confirmed: boolean | null;
  block_height: number | null;
  secondary_tags: string[];
  weight: number | null;
  fee_sats: number | null;
  feerate_sats_vb: number | null;
  evidence_summary: string;
}

export interface BlockspaceOverview {
  network: string;
  current_regime: BlockspaceRegimeEvent | null;
  median_feerate_24h: number | null;
  fee_metric: string;
  taxonomy_classes: BlockspaceSemanticClass[];
  composition_timeseries: BlockspaceCompositionPoint[];
  window: { blocks: number; from_height: number; to_height: number; covers_24h: boolean | null; contiguous: boolean | null; transactions_complete: boolean | null; median_fee_observations: number; time_basis: string };
  checkpoint: { height: number; hash: string };
  last_updated: string;
}
