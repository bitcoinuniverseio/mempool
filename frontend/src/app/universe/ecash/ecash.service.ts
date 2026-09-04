import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface CashuMint {
  mint_id: string;
  mint_url: string;
  name: string;
  nuts_supported: number[];
  active_keysets_count: number;
  keysets: { id: string; unit: string; active: boolean }[];
  last_heartbeat: string;
}

export interface FedimintFederation {
  federation_id: string;
  name: string;
  guardians_count: number;
  threshold: number;
  invite_code_sample?: string;
  modules: string[];
  current_epoch: number;
  last_epoch_at: string;
}

export interface EcashOverview {
  total_cashu_mints: number;
  total_fedimint_federations: number;
  total_verified_guardians: number;
  active_claims_count: number;
  mints: CashuMint[];
  federations: FedimintFederation[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class EcashApiService {
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

  getOverview$(): Observable<EcashOverview> {
    return this.httpClient.get<EcashOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/ecash/overview`
    );
  }

  getCashuMints$(): Observable<CashuMint[]> {
    return this.httpClient.get<CashuMint[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/ecash/cashu/mints`
    );
  }

  getCashuMintById$(mintId: string): Observable<CashuMint> {
    return this.httpClient.get<CashuMint>(
      `${this.apiBaseUrl}/api/v1/intelligence/ecash/cashu/mints/${encodeURIComponent(mintId)}`
    );
  }

  getFedimintFederations$(): Observable<FedimintFederation[]> {
    return this.httpClient.get<FedimintFederation[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/ecash/fedimint/federations`
    );
  }

  getFedimintFederationById$(federationId: string): Observable<FedimintFederation> {
    return this.httpClient.get<FedimintFederation>(
      `${this.apiBaseUrl}/api/v1/intelligence/ecash/fedimint/federations/${encodeURIComponent(federationId)}`
    );
  }
}
