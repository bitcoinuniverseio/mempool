import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, startWith, distinctUntilChanged } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface StakingProtocolParameters {
  version_id: string;
  activation_height: number;
  min_staking_time_blocks: number;
  max_staking_time_blocks: number;
  unbonding_time_blocks: number;
  min_staking_amount_sat: number;
  max_staking_amount_sat: number;
  confirmation_depth: number;
  covenant_quorum: {
    required: number;
    total: number;
    public_keys: string[];
  };
  slashing_burn_script: string;
  is_active: boolean;
}

export interface StakingDelegation {
  delegation_id: string;
  staker_pk: string;
  finality_provider_pks: string[];
  staking_amount_sat: number;
  state: string;
  staking_txid: string;
  staking_vout: number;
  staking_timelock_blocks: number;
  start_height: number;
  end_height: number;
  unbonding_txid?: string;
  unbonding_timelock_blocks?: number;
  slashing_txid?: string;
  withdrawn_txid?: string;
  covenant_signatures_count: number;
  covenant_signatures_required: number;
  last_updated_at: string;
  discrepancy_flags: string[];
}

export interface FinalityProvider {
  provider_id: string;
  moniker: string;
  btc_pk: string;
  commission_rate_percent: number;
  active_tvl_sat: number;
  delegations_count: number;
  uptime_percent: number;
  is_slashed: boolean;
  eots_public_key: string;
  first_registered_at: string;
  last_activity_at: string;
}

export interface EotsSlashingEvidence {
  evidence_id: string;
  provider_id: string;
  block_height: number;
  app_hash_tag: string;
  eots_pk: string;
  nonce_point: string;
  signature_a: string;
  signature_b: string;
  message_a: string;
  message_b: string;
  verified_status: string;
  recovered_secret_hash?: string;
  submitted_at: string;
}

export interface BitcoinStakingOverview {
  total_active_delegations: number;
  total_staked_sat: number;
  total_finality_providers: number;
  slashed_providers_count: number;
  current_protocol_parameter_version: string;
  recent_slashing_evidences_count: number;
  delegation_states_summary: Record<string, number>;
}

@Injectable({
  providedIn: 'root',
})
export class BitcoinStakingApiService {
  private origin = '';
  get network(): string {return this.stateService.network || 'mainnet';}
  get networkChanges$(): Observable<string> {return this.stateService.networkChanged$.pipe(startWith(this.stateService.network),map(n => n || 'mainnet'),distinctUntilChanged());}
  private get apiBaseUrl(): string {return this.origin + (this.network === 'mainnet' ? '' : '/' + this.network);}

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.origin =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
  }

  private bound<T>(request: Observable<T>, id?: [string,string]): Observable<T> {
    const network = this.network;
    return request.pipe(map(value => {
      const rows = Array.isArray(value) ? value : [value];
      if (rows.length > 10000) throw Error('Staking response exceeds the bounded row limit.');
      if (this.network !== network || rows.some((r: any) => !r || r.network !== network || (id && r[id[0]] !== id[1]))) throw Error('Staking response is not bound to the requested network and identity.');
      return value;
    }));
  }

  getOverview$(): Observable<BitcoinStakingOverview> {
    return this.bound(this.httpClient.get<BitcoinStakingOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/overview`
    ));
  }

  getParameters$(): Observable<StakingProtocolParameters[]> {
    return this.bound(this.httpClient.get<StakingProtocolParameters[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/parameters`
    ));
  }

  getDelegations$(state?: string): Observable<StakingDelegation[]> {
    const url = state
      ? `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/delegations?state=${encodeURIComponent(state)}`
      : `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/delegations`;
    return this.bound(this.httpClient.get<StakingDelegation[]>(url));
  }

  getDelegationById$(delegationId: string): Observable<StakingDelegation> {
    return this.bound(this.httpClient.get<StakingDelegation>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/delegation/${encodeURIComponent(delegationId)}`
    ), ['delegation_id', delegationId]);
  }

  getFinalityProviders$(): Observable<FinalityProvider[]> {
    return this.bound(this.httpClient.get<FinalityProvider[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/finality-providers`
    ));
  }

  getFinalityProviderById$(providerId: string): Observable<FinalityProvider> {
    return this.bound(this.httpClient.get<FinalityProvider>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/finality-provider/${encodeURIComponent(providerId)}`
    ), ['provider_id', providerId]);
  }

  getEvidence$(): Observable<EotsSlashingEvidence[]> {
    return this.bound(this.httpClient.get<EotsSlashingEvidence[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/evidence`
    ));
  }

  verifyTransaction$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/verify-transaction`,
      req
    );
  }

  verifyEvidence$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/verify-evidence`,
      req
    );
  }

  reconcile$(chainName: string): Observable<any> {
    return this.bound(this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/bitcoin-staking/reconcile`,
      { chain_name: chainName }
    ), ['chain_name', chainName]);
  }
}
