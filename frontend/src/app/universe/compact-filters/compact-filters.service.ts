import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface CompactFilterProvider {
  provider_id: string;
  address: string;
  port: number;
  subversion: string;
  services_bitmask: string;
  has_compact_filters_service_bit: boolean;
  actual_filter_serving_verified: boolean;
  filter_tip_height: number;
  latency_ms: number;
  is_reachable: boolean;
  last_probe_at: string;
}

export interface CompactFilterCheckpoint {
  checkpoint_interval: number;
  height: number;
  block_hash: string;
  filter_header: string;
}

export interface CompactFilterOverview {
  total_providers: number;
  active_providers: number;
  verified_serving_providers: number;
  chain_filter_tip_height: number;
  basic_filter_type: string;
  total_checkpoints: number;
  recent_providers: CompactFilterProvider[];
  checkpoints_sample: CompactFilterCheckpoint[];
}

@Injectable({
  providedIn: 'root',
})
export class CompactFiltersApiService {
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

  getOverview$(): Observable<CompactFilterOverview> {
    return this.httpClient.get<CompactFilterOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/compact-filters/overview`
    );
  }

  getProviders$(): Observable<CompactFilterProvider[]> {
    return this.httpClient.get<CompactFilterProvider[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/compact-filters/providers`
    );
  }

  getProviderById$(providerId: string): Observable<CompactFilterProvider> {
    return this.httpClient.get<CompactFilterProvider>(
      `${this.apiBaseUrl}/api/v1/intelligence/compact-filters/providers/${encodeURIComponent(providerId)}`
    );
  }

  getBlockFilter$(blockHash: string): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/compact-filters/blocks/${encodeURIComponent(blockHash)}`
    );
  }

  executeVerification$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/compact-filters/verifications`,
      req
    );
  }
}
