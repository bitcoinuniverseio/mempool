import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface QuantumPubkeyExposure {
  outpoint: string;
  txid: string;
  vout: number;
  amount_sats: number;
  script_type: 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
  is_exposed: boolean;
  exposure_reason: 'direct_pubkey_script' | 'address_reuse_spend' | 'keypath_taproot' | 'hash_protected';
  first_exposed_height?: number;
}

export interface QuantumCohortBreakdown {
  script_type: string;
  total_utxos: number;
  total_sats: number;
  exposed_utxos: number;
  exposed_sats: number;
  exposed_percentage: number;
}

export interface QuantumRevealEvent {
  event_id: string;
  pubkey: string;
  txid: string;
  block_height: number;
  timestamp_utc: string;
  affected_outpoints_count: number;
  revealed_sats: number;
}

export interface QuantumMigrationPlanResult {
  plan_id: string;
  total_exposed_sats: number;
  recommended_transactions_count: number;
  estimated_migration_fee_sats: number;
  post_migration_exposure_percentage: number;
  steps: { step_number: number; action: string; description: string }[];
}

export interface QuantumOverview {
  total_utxo_count: number;
  total_supply_sats: number;
  exposed_utxo_count: number;
  exposed_sats: number;
  exposed_supply_percentage: number;
  cohorts: QuantumCohortBreakdown[];
  recent_reveals: QuantumRevealEvent[];
  last_updated: string;
}

@Injectable({
  providedIn: 'root',
})
export class QuantumApiService {
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

  getOverview$(): Observable<QuantumOverview> {
    return this.httpClient.get<QuantumOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/quantum/overview`
    );
  }

  getCohorts$(): Observable<QuantumCohortBreakdown[]> {
    return this.httpClient.get<QuantumCohortBreakdown[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/quantum/cohorts`
    );
  }

  getHistory$(): Observable<QuantumRevealEvent[]> {
    return this.httpClient.get<QuantumRevealEvent[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/quantum/history`
    );
  }

  auditIdentifier$(identifier: string): Observable<QuantumPubkeyExposure> {
    return this.httpClient.post<QuantumPubkeyExposure>(
      `${this.apiBaseUrl}/api/v1/intelligence/quantum/audit`,
      { identifier }
    );
  }

  generateMigrationPlan$(outpoints: string[]): Observable<QuantumMigrationPlanResult> {
    return this.httpClient.post<QuantumMigrationPlanResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/quantum/migration-plans`,
      { exposed_outpoints: outpoints, target_standard: 'p2wpkh' }
    );
  }
}
