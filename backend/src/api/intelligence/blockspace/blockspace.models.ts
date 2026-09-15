export interface BlockspaceSemanticClass {
  class_id: string;
  name: string;
  category: 'monetary' | 'infrastructure' | 'arbitrary_data' | 'layer2';
  description: string;
  weight_share_percentage: number;
  fee_share_percentage: number;
  tx_count_24h: number;
}

export interface BlockspaceCompositionPoint {
  block_height: number;
  timestamp_utc: string;
  total_weight: number;
  total_fee_sats: number;
  monetary_weight: number;
  layer2_weight: number;
  arbitrary_data_weight: number;
  consolidation_weight: number;
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
  confirmed: boolean;
  block_height: number | null;
  secondary_tags: string[];
  weight: number;
  fee_sats: number;
  feerate_sats_vb: number;
  evidence_summary: string;
}

export interface BlockspaceOverview {
  network: string;
  current_regime: BlockspaceRegimeEvent | null;
  median_feerate_24h: number;
  taxonomy_classes: BlockspaceSemanticClass[];
  composition_timeseries: BlockspaceCompositionPoint[];
  window: { blocks: number; from_height: number; to_height: number; covers_24h: boolean };
  checkpoint: { height: number; hash: string };
  last_updated: string;
}
