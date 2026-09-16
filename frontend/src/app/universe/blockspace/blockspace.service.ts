import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer, of, map, startWith, distinctUntilChanged, switchMap, catchError } from 'rxjs';
import { StateService } from '@app/services/state.service';

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

@Injectable({
  providedIn: 'root',
})
export class BlockspaceApiService {
  private get apiBaseUrl(): string {
    const network = this.stateService.network || 'mainnet';
    if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(network)) throw new Error('Unsupported blockspace network.');
    const base = this.stateService.isBrowser ? '' : this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    const prefix = network !== 'mainnet' && network !== this.stateService.env.ROOT_NETWORK ? '/' + network : '';
    return base + prefix + '/api/v1/intelligence/blockspace';
  }

  watch<T>(load: () => Observable<T>): Observable<{ kind: 'loading' } | { kind: 'ready'; data: T } | { kind: 'error'; error: string }> {
    return defer(() => (this.stateService.networkChanged$ ?? of(this.stateService.network)).pipe(
      startWith(this.stateService.network), map(() => this.stateService.network || 'mainnet'), distinctUntilChanged(),
      switchMap(() => defer(load).pipe(
        map(data => ({ kind: 'ready' as const, data })),
        catchError(() => of({ kind: 'error' as const, error: 'Blockspace observations are unavailable for the selected network.' })),
        startWith({ kind: 'loading' as const }),
      )),
    ));
  }

  constructor(
    private http: HttpClient,
    private stateService: StateService,
  ) {

  }

  public getOverview(): Observable<BlockspaceOverview> {
    return this.http.get<BlockspaceOverview>(`${this.apiBaseUrl}/overview`).pipe(map(value => {
      if (!value || value.network !== (this.stateService.network || 'mainnet') || !Array.isArray(value.taxonomy_classes) || !Array.isArray(value.composition_timeseries)) throw new Error('Mismatched blockspace evidence.');
      return value;
    }));
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
