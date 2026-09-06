import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';

export interface SwapProvider {
  provider_id: string; identity_key: string; name: string; protocols: string[]; protocol_versions: string[];
  networks: string[]; swap_types: string[]; minimum_amount_sats: number; maximum_amount_sats: number;
  fee_percentage: number; miner_fee_estimate_sats: number; timeout_policy_blocks: number;
  cooperative_claim_support: boolean; cooperative_refund_support: boolean; taproot_support: boolean;
  liquid_support: boolean; ark_support: boolean; health_status: 'online' | 'degraded' | 'offline' | 'unknown';
}
export interface SwapPackage { swap_id: string; swap_type: string; network: string; secondary_network?: string;
  provider_id: string; expected_amount_sats: number; timeout_height: number; status: string; }
export interface SwapsOverview {
  total_swaps_observed: number | null; active_providers_count: number | null; total_volume_sats: number | null;
  supported_protocols_count: number; recent_swaps: SwapPackage[]; active_providers: SwapProvider[]; protocols: any[];
  observation_status?: string; notes?: string[]; recent_observations?: any[];
}
export interface SwapRecoveryPlan {
  stage: string; recommended_action: string; notes: string[]; unsigned_recovery_psbt?: string;
  current_block_height: number | null; blocks_until_refund: number | null; recoverable_value_sats: number;
  estimated_miner_fee_sats: number; source_context?: { chain: string; network: string; source_id: string; block_hash: string; block_height: number; observed_at: string };
  decoded?: { txid: string; vout: number; destination: string; output_value_sats: number; fee_sats: number; locktime: number; sequence: number; input_count: number; output_count: number };
}

@Injectable({ providedIn: 'root' })
export class SwapsApiService {
  private baseUrl = '/api/v1/intelligence/swaps';
  constructor(private http: HttpClient, private state: StateService) {
    if (!state.isBrowser && state.env) this.baseUrl = state.env.NGINX_PROTOCOL + '://' + state.env.NGINX_HOSTNAME + ':' + state.env.NGINX_PORT + this.baseUrl;
  }
  get network(): string { return this.state.network || 'mainnet'; }
  path(path: string): string { return (this.state.network ? '/' + this.state.network : '') + path; }
  get network$(): Observable<string> { return this.state.networkChanged$.pipe(startWith(this.state.network), map(n => n || 'mainnet'), distinctUntilChanged()); }
  private params(network: string) { return { chain: 'bitcoin', network }; }
  public getOverview$(): Observable<SwapsOverview> {
    return this.network$.pipe(switchMap(network => this.http.get<SwapsOverview>(`${this.baseUrl}/overview`, { params: this.params(network) })));
  }
  public getProviders$(network = this.network): Observable<SwapProvider[]> {
    return this.http.get<SwapProvider[]>(`${this.baseUrl}/providers`, { params: this.params(network) });
  }
  public getProviderById$(id: string, network = this.network): Observable<SwapProvider> {
    return this.http.get<SwapProvider>(`${this.baseUrl}/providers/${encodeURIComponent(id)}`, { params: this.params(network) });
  }
  public recover$(pkg: object, network: string): Observable<{ recovery_plan: SwapRecoveryPlan }> {
    return this.http.post<{ recovery_plan: SwapRecoveryPlan }>(`${this.baseUrl}/chain-context`, pkg, { params: this.params(network) });
  }
  public verify$(pkg: object, network: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/public-receipts/verify`, pkg, { params: this.params(network) });
  }
}
