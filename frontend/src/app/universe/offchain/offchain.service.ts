import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface OffchainOperator {
  operator_id: string;
  protocol: 'mercury_statechain' | 'teleport_coinswap';
  display_name: string;
  operator_public_key: string;
  endpoint: string;
  tor_endpoint?: string;
  supported_versions: string[];
  health: 'healthy' | 'degraded' | 'unreachable' | 'unknown';
  is_tor_only: boolean;
  published_terms: {
    fee_rate_basis_points: number;
    min_amount_sat: number;
    max_amount_sat: number;
  };
  last_probe_at: string;
}

export interface OffchainOverview {
  configured_coinswap_makers?:number;
  registry?:{source:string;scope:string};
  total_operators: number;
  active_operators: number | null;
  supported_protocols: string[];
  active_offers_count: number | null;
  recent_recoveries_count: number | null;
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
  health: 'healthy' | 'degraded' | 'unreachable' | 'unknown';
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
    ).pipe(map((res:any)=>{if(!Array.isArray(res.operators)||!Number.isSafeInteger(res.total_operators)||res.total_operators!==res.operators.length)throw new Error('Invalid registry summary');return {configured_coinswap_makers:res.configured_coinswap_makers,registry:res.registry,total_operators:res.total_operators,active_operators:null,active_offers_count:null,recent_recoveries_count:null,supported_protocols:[],featured_operators:res.operators.map(operatorRow)};}));
  }

  getOperators$(protocol?: string): Observable<OffchainOperator[]> {
    const url = protocol
      ? `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators?protocol=${encodeURIComponent(protocol)}`
      : `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators`;
    return this.httpClient.get<OffchainOperatorDetail[]>(url).pipe(map(rows=>{if(!Array.isArray(rows))throw new Error('Invalid operator catalogue');return rows.filter(row=>!protocol||row.protocol===protocol).map(operatorRow);}));
  }

  getOperatorById$(operatorId: string): Observable<OffchainOperatorDetail> {
    return this.httpClient.get<OffchainOperatorDetail>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/operators/${encodeURIComponent(operatorId)}`
    );
  }

  verifyManifest$(manifest:unknown):Observable<any> {return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/offchain/manifests/verify`,manifest);}

  verifyStatechainTransfer$(pkg: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/statechain/verify`,
      pkg
    );
  }

  verifyCoinswapPackage$(pkg: any): Observable<any> {
    return this.httpClient.post<any>(`${this.apiBaseUrl}/api/v1/intelligence/offchain/coinswap/verify`, pkg);
  }

  getRecoveryPlan$(context: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/offchain/recovery/context`,
      context
    );
  }
}

function operatorRow(row:OffchainOperatorDetail):OffchainOperator {
 if(!row || typeof row.operator_id!=='string' || !row.endpoints || typeof row.endpoints.clearnet!=='string')throw new Error('Invalid operator reference');
 return {operator_id:row.operator_id,protocol:row.protocol,display_name:row.display_name,operator_public_key:row.operator_public_key,endpoint:row.endpoints.clearnet,tor_endpoint:row.endpoints.tor_onion,supported_versions:row.supported_versions,health:'unknown',is_tor_only:false,published_terms:{fee_rate_basis_points:null,min_amount_sat:null,max_amount_sat:null},last_probe_at:null};
}
