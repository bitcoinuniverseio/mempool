import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

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
  secondary_tags: string[];
  weight: number;
  fee_sats: number;
  feerate_sats_vb: number;
  evidence_summary: string;
}

export interface BlockspaceOverview {
  current_regime: BlockspaceRegimeEvent;
  median_feerate_24h: number;
  taxonomy_classes: BlockspaceSemanticClass[];
  composition_timeseries: BlockspaceCompositionPoint[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class BlockspaceApiService {
  private apiBaseUrl = '';

  constructor(
    private http: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = (this.stateService.env.GIT_COMMIT_HASH ? '' : 'http://127.0.0.1:8999') + '/api/v1/intelligence/blockspace';
  }

  public getOverview(): Observable<BlockspaceOverview> {
    return this.http.get<BlockspaceOverview>(`${this.apiBaseUrl}/overview`);
  }

  public getTaxonomy(): Observable<BlockspaceSemanticClass[]> {
    return this.http.get<BlockspaceSemanticClass[]>(`${this.apiBaseUrl}/taxonomy`);
  }

  public getComposition(limit = 24): Observable<BlockspaceCompositionPoint[]> {
    return this.http.get<BlockspaceCompositionPoint[]>(`${this.apiBaseUrl}/composition?limit=${limit}`);
  }

  public getRegimes(): Observable<BlockspaceRegimeEvent[]> {
    return this.http.get<BlockspaceRegimeEvent[]>(`${this.apiBaseUrl}/regimes`);
  }

  public getTxSemantics(txid: string): Observable<BlockspaceTxEvidence> {
    return this.http.get<BlockspaceTxEvidence>(`${this.apiBaseUrl}/transactions/${txid}/semantics`);
  }
}
