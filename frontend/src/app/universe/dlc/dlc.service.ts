import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface DlcOracle {
  oracle_id: string;
  oracle_public_key: string;
  display_name: string;
  endpoint: string;
  endpoint_type: 'direct_http' | 'tor_v3' | 'signed_feed';
  protocol_revision: string;
  registration_source: string;
  first_observed_at: string;
  last_observed_at: string;
  last_success_at: string;
  health: 'healthy' | 'degraded' | 'unreachable';
  coverage: {
    total_announcements: number;
    total_attestations: number;
    conflicts_detected: number;
  };
}

export interface DlcEvent {
  event_id: string;
  oracle_id: string;
  event_descriptor: {
    descriptor_type: 'enumerated' | 'numeric';
    outcomes?: string[];
    num_digits?: number;
    min_value?: number;
    max_value?: number;
    rounding_intervals?: { begin_interval: number; rounding_mod: number }[];
  };
  event_maturity_epoch: number;
  maturity_formatted: string;
  nonces: string[];
  announcement_signature: string;
  verification_status: 'verified' | 'invalid_signature' | 'duplicate_nonce' | 'unsupported_tlv';
  attestation?: {
    attestation_time: string;
    outcomes: string[];
    signatures: string[];
    attestation_delay_seconds: number;
    conflict_detected: boolean;
  };
}

export interface DlcOverview {
  total_oracles: number;
  active_oracles: number;
  total_events: number;
  total_attestations: number;
  conflicts_detected: number;
  supported_tlv_revisions: string[];
  recent_events: DlcEvent[];
  featured_oracles: DlcOracle[];
}

@Injectable({
  providedIn: 'root',
})
export class DlcApiService {
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

  getOverview$(): Observable<DlcOverview> {
    return this.httpClient.get<DlcOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/overview`
    );
  }

  getOracles$(): Observable<DlcOracle[]> {
    return this.httpClient.get<DlcOracle[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/oracles`
    );
  }

  getOracleById$(oracleId: string): Observable<DlcOracle> {
    return this.httpClient.get<DlcOracle>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/oracles/${encodeURIComponent(oracleId)}`
    );
  }

  getEvents$(): Observable<DlcEvent[]> {
    return this.httpClient.get<DlcEvent[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/events`
    );
  }

  getEventById$(eventId: string): Observable<DlcEvent> {
    return this.httpClient.get<DlcEvent>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/events/${encodeURIComponent(eventId)}`
    );
  }

  verifyContractPackage$(pkg: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/contracts/verify`,
      pkg
    );
  }

  runSimulation$(sim: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/dlc/simulations`,
      sim
    );
  }
}
