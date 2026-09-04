import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface GlobalNetworkSensor {
  sensor_id: string;
  region: string;
  asn?: number;
  software_version: string;
  status: 'active' | 'degraded' | 'offline';
  v1_supported: boolean;
  v2_bip324_supported: boolean;
  addrv2_bip155_supported: boolean;
  last_probe_utc: string;
}

export interface GlobalNetworkCrawlEpoch {
  epoch_id: string;
  network: string;
  started_at: string;
  completed_at?: string;
  discovered_nodes: number;
  reachable_nodes: number;
  v2_nodes: number;
  status: 'running' | 'completed' | 'failed';
}

export interface GlobalNetworkObservation {
  id: string;
  epoch_id: string;
  endpoint_id: string;
  ip_or_onion: string;
  port: number;
  services: number;
  user_agent: string;
  start_height: number;
  relay: boolean;
  transport_v2: boolean;
  addrv2: boolean;
  latency_ms: number;
  country_code?: string;
  asn?: number;
  observed_at: string;
}

export interface GlobalNetworkDnsSeed {
  seed_id: string;
  hostname: string;
  maintainer: string;
  active: boolean;
  last_query_at: string;
  discovered_addrs_count: number;
  reachable_ratio: number;
}

export interface GlobalNetworkSnapshot {
  snapshot_id: string;
  network: string;
  block_height: number;
  timestamp_utc: string;
  total_nodes: number;
  v2_percentage: number;
  top_asns: { asn: number; org: string; count: number }[];
  top_clients: { client: string; count: number }[];
  geo_distribution: { country: string; count: number }[];
  s3_path?: string;
}

export interface GlobalNetworkOverview {
  active_epoch: GlobalNetworkCrawlEpoch;
  sensors_count: number;
  total_reachable_nodes: number;
  bip324_v2_adoption_percentage: number;
  addrv2_adoption_percentage: number;
  top_user_agents: { agent: string; count: number; percentage: number }[];
  geographic_distribution: { country: string; count: number }[];
  transport_breakdown: { transport: string; count: number }[];
  last_updated: string;
}

export interface GlobalNetworkSelfCheckResult {
  check_id: string;
  endpoint_address: string;
  port: number;
  probed_from_region: string;
  reachable: boolean;
  bip324_handshake: boolean;
  latency_ms: number;
  user_agent?: string;
  services?: number;
  probed_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class GlobalNetworkApiService {
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

  getOverview$(): Observable<GlobalNetworkOverview> {
    return this.httpClient.get<GlobalNetworkOverview>(`${this.apiBaseUrl}/api/v1/intelligence/network/global/overview`);
  }

  getNodes$(limit = 50, offset = 0): Observable<{ nodes: GlobalNetworkObservation[]; total: number }> {
    return this.httpClient.get<{ nodes: GlobalNetworkObservation[]; total: number }>(
      `${this.apiBaseUrl}/api/v1/intelligence/network/global/nodes?limit=${limit}&offset=${offset}`
    );
  }

  getNodeDetail$(endpointId: string): Observable<GlobalNetworkObservation> {
    return this.httpClient.get<GlobalNetworkObservation>(
      `${this.apiBaseUrl}/api/v1/intelligence/network/global/nodes/${encodeURIComponent(endpointId)}`
    );
  }

  getDnsSeeds$(): Observable<GlobalNetworkDnsSeed[]> {
    return this.httpClient.get<GlobalNetworkDnsSeed[]>(`${this.apiBaseUrl}/api/v1/intelligence/network/global/seeds`);
  }

  getSnapshots$(): Observable<GlobalNetworkSnapshot[]> {
    return this.httpClient.get<GlobalNetworkSnapshot[]>(`${this.apiBaseUrl}/api/v1/intelligence/network/global/snapshots`);
  }

  getSensors$(): Observable<GlobalNetworkSensor[]> {
    return this.httpClient.get<GlobalNetworkSensor[]>(`${this.apiBaseUrl}/api/v1/intelligence/network/global/sensors`);
  }

  performSelfCheck$(endpointAddress: string, port: number): Observable<GlobalNetworkSelfCheckResult> {
    return this.httpClient.post<GlobalNetworkSelfCheckResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/network/global/self-checks`,
      { endpoint_address: endpointAddress, port }
    );
  }
}
