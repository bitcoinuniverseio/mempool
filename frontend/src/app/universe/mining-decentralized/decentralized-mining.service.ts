import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface MiningShare {
  share_id: string;
  protocol: 'datum' | 'p2pool' | 'braidpool';
  share_height: number;
  miner_identity: string;
  payout_script: string;
  difficulty_target: string;
  parent_share_hashes: string[];
  observed_at: string;
  template_hash: string;
  is_valid: boolean;
  on_chain_txid?: string;
}

export interface DecentralizedMiningOverview {
  active_protocols: string[];
  total_shares_observed: number;
  total_miners_active: number;
  estimated_hashrate_ph: number;
  recent_shares: MiningShare[];
  template_autonomy_percent: number;
}

@Injectable({
  providedIn: 'root',
})
export class DecentralizedMiningApiService {
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

  getOverview$(): Observable<DecentralizedMiningOverview> {
    return this.httpClient.get<DecentralizedMiningOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/mining-decentralized/overview`
    );
  }

  getShares$(protocol?: string): Observable<MiningShare[]> {
    const url = protocol
      ? `${this.apiBaseUrl}/api/v1/intelligence/mining-decentralized/shares?protocol=${encodeURIComponent(protocol)}`
      : `${this.apiBaseUrl}/api/v1/intelligence/mining-decentralized/shares`;
    return this.httpClient.get<MiningShare[]>(url);
  }

  getShareById$(shareId: string): Observable<MiningShare> {
    return this.httpClient.get<MiningShare>(
      `${this.apiBaseUrl}/api/v1/intelligence/mining-decentralized/shares/${encodeURIComponent(shareId)}`
    );
  }

  getTemplateComparison$(): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/mining-decentralized/compare`
    );
  }
}
