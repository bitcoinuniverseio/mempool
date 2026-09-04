import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface LightningProbeObservation {
  probe_id: string;
  node_pubkey: string;
  sensor_region: string;
  handshake_success: boolean;
  latency_ms: number;
  features_hex?: string;
  lsps_supported: string[];
  observed_at: string;
}

export interface LightningNodeReliability {
  node_pubkey: string;
  alias?: string;
  reachability_score: number;
  gossip_freshness_seconds: number;
  policy_volatility_score: number;
  uptime_30d_percentage: number;
  supported_lsps: string[];
  probes: LightningProbeObservation[];
  last_probed_at: string;
}

export interface LightningLiquiditySimulationResult {
  simulation_id: string;
  target_pubkey: string;
  amount_sats: number;
  estimated_path_probability: number;
  estimated_fee_sats: number;
  min_hops: number;
  available_capacity_estimate_sats: number;
  confidence_rating: 'high' | 'moderate' | 'low';
}

export interface LightningChannelLifecycle {
  channel_id: string;
  short_channel_id: string;
  funding_txid: string;
  funding_vout: number;
  node1_pubkey: string;
  node1_alias?: string;
  node2_pubkey: string;
  node2_alias?: string;
  capacity_sats: number;
  opened_height: number;
  closed_height?: number;
  status: 'active' | 'closed';
  closure_txid?: string;
  closure_type?: 'cooperative' | 'unilateral' | 'penalty_breach';
}

export interface LightningClosureForensics {
  closure_txid: string;
  channel_id: string;
  short_channel_id?: string;
  closure_type: 'cooperative' | 'unilateral' | 'penalty_breach';
  closed_at_height: number;
  reclaimed_balance_sats: number;
  contested_balance_sats: number;
  swept_htlcs_count: number;
  timelock_delay_blocks: number;
  settlement_status: 'settled' | 'disputed' | 'pending_sweep';
}

export interface LightningLspProvider {
  provider_id: string;
  name: string;
  node_pubkey: string;
  endpoint_url?: string;
  lsps0_supported: boolean;
  lsps1_order_supported: boolean;
  lsps2_jit_supported: boolean;
  lsps5_metrics_supported: boolean;
  active_channel_capacity_sats: number;
  compliance_verified: boolean;
  specs: Record<string, unknown>;
  updated_at: string;
}

export interface LightningReliabilityOverview {
  total_probed_nodes: number;
  fleet_average_uptime_percentage: number;
  active_lsp_providers_count: number;
  recent_closures_24h: {
    cooperative: number;
    unilateral: number;
    penalty: number;
  };
  top_reliable_nodes: {
    pubkey: string;
    alias: string;
    score: number;
    uptime: number;
  }[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class LightningReliabilityApiService {
  private apiBaseUrl = '';

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.apiBaseUrl =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
  }

  getOverview$(): Observable<LightningReliabilityOverview> {
    return this.httpClient.get<LightningReliabilityOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/overview`
    );
  }

  getNodeReliability$(pubkey: string): Observable<LightningNodeReliability> {
    return this.httpClient.get<LightningNodeReliability>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/nodes/${encodeURIComponent(pubkey)}`
    );
  }

  getChannelLifecycle$(shortId: string): Observable<LightningChannelLifecycle> {
    return this.httpClient.get<LightningChannelLifecycle>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/channels/${encodeURIComponent(shortId)}`
    );
  }

  getClosureForensics$(txid: string): Observable<LightningClosureForensics> {
    return this.httpClient.get<LightningClosureForensics>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/closures/${encodeURIComponent(txid)}`
    );
  }

  getLspProviders$(): Observable<LightningLspProvider[]> {
    return this.httpClient.get<LightningLspProvider[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/lsps`
    );
  }

  simulateLiquidity$(targetPubkey: string, amountSats: number, sourcePubkey?: string): Observable<LightningLiquiditySimulationResult> {
    return this.httpClient.post<LightningLiquiditySimulationResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/lightning/reliability/simulations`,
      { target_pubkey: targetPubkey, amount_sats: amountSats, source_pubkey: sourcePubkey }
    );
  }
}
