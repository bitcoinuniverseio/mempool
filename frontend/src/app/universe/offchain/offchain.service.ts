import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface OffchainOperator {
  operator_id: string;
  protocol: 'mercury_statechain' | 'teleport_coinswap';
  display_name: string;
  operator_public_key: string;
  endpoint: string;
  tor_endpoint?: string;
  supported_versions: string[];
  health: 'healthy' | 'degraded' | 'unreachable';
  is_tor_only: boolean;
  published_terms: {
    fee_rate_basis_points: number;
    min_amount_sat: number;
    max_amount_sat: number;
  };
  last_probe_at: string;
}

export interface OffchainOverview {
  total_operators: number;
  active_operators: number;
  supported_protocols: string[];
  active_offers_count: number;
  recent_recoveries_count: number;
  featured_operators: OffchainOperator[];
}

/** Fields returned by GET /offchain/operators/:operatorId. */
export interface OffchainOperatorDetail {
  operator_id: string;
  protocol: 'mercury_statechain' | 'teleport_coinswap';
  operator_public_key: string;
  display_name: string;
  networks: string[];
  endpoints: { clearnet: string; tor_onion?: string; i2p?: string };
  supported_versions: string[];
  signature_count_endpoint?: string;
  transfer_capabilities: string[];
  recovery_capabilities: string[];
  health: 'healthy' | 'degraded' | 'unreachable';
  effective_from: string;
  expires_at: string;
  provenance: { registered_in_knowledge_registry: boolean; identity_ref?: string; verified_signature: boolean };
}

@Injectable({
  providedIn: 'root',
})
export class OffchainApiService {
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

  getOverview$(): Observable<OffchainOverview> {
    return this.httpClient.get<OffchainOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/overview`
    );
  }

  getOperators$(protocol?: string): Observable<OffchainOperator[]> {
    const url = protocol
      ? `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators?protocol=${encodeURIComponent(protocol)}`
      : `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators`;
    return this.httpClient.get<OffchainOperator[]>(url);
  }

  getOperatorById$(operatorId: string): Observable<OffchainOperatorDetail> {
    return this.httpClient.get<OffchainOperatorDetail>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators/${encodeURIComponent(operatorId)}`
    );
  }

  verifyStatechainTransfer$(pkg: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/manifests/verify`,
      pkg
    );
  }

  getRecoveryPlan$(context: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/recovery/context`,
      context
    );
  }
}
