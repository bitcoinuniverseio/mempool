import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface SilentPaymentBlockManifest {
  height: number;
  block_hash: string;
  num_inputs: number;
  num_sp_outputs: number;
  tweaks_hash: string;
  bundle_s3_url?: string;
  created_at: string;
}

export interface SilentPaymentSupportClaim {
  wallet_id: string;
  name: string;
  send_supported: boolean;
  receive_supported: boolean;
  bip352_compliance: boolean;
  bip375_send_psbt: boolean;
  bip376_spend_psbt: boolean;
  verified_version: string;
  updated_at: string;
}

export interface SilentPaymentCoverageOverview {
  latest_indexed_height: number;
  total_indexed_blocks: number;
  total_sp_outputs_detected: number;
  ecosystem_adoption_count: number;
  support_claims: SilentPaymentSupportClaim[];
  last_updated: string;
}

export interface SilentPaymentScanProgress {
  currentHeight: number;
  startHeight: number;
  targetHeight: number;
  matchesFound: number;
  status: 'idle' | 'scanning' | 'complete' | 'error';
}

@Injectable({
  providedIn: 'root',
})
export class SilentPaymentsApiService {
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

  getCoverage$(): Observable<SilentPaymentCoverageOverview> {
    return this.httpClient.get<SilentPaymentCoverageOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/coverage`
    );
  }

  getBlockManifest$(height: number): Observable<SilentPaymentBlockManifest> {
    return this.httpClient.get<SilentPaymentBlockManifest>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/blocks/${height}/manifest`
    );
  }

  getSupportRegistry$(): Observable<SilentPaymentSupportClaim[]> {
    return this.httpClient.get<SilentPaymentSupportClaim[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/support`
    );
  }

  validateAddress$(address: string): Observable<{ valid: boolean; network?: string; scan_pubkey?: string; spend_pubkey?: string; error?: string }> {
    return this.httpClient.post<{ valid: boolean; network?: string; scan_pubkey?: string; spend_pubkey?: string; error?: string }>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/validate-address`,
      { address }
    );
  }

  validatePsbt$(psbt: string): Observable<{ valid: boolean; bip375_present: boolean; bip376_present: boolean; error?: string }> {
    return this.httpClient.post<{ valid: boolean; bip375_present: boolean; bip376_present: boolean; error?: string }>(
      `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/validate-psbt`,
      { psbt }
    );
  }
}
