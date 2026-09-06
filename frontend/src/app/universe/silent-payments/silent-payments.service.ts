import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, defer } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';

export interface SilentPaymentBlockManifest {
  schema_version: 1; chain: 'bitcoin'; network: string; height: number; block_hash: string;
  previous_block_hash: string; num_inputs: number; candidate_output_count: number;
  bundle_hash: string; bundle_url: string; created_at: string;
}
export interface SilentPaymentScanTransaction {
  txid: string; spent_outpoints: { txid: string; vout: number }[]; input_pubkeys: string[];
  candidate_outputs: { vout: number; pubkey: string; amount_sats: string }[];
}
export interface SilentPaymentBlockBundle {
  schema_version: 1; chain: 'bitcoin'; network: string; height: number; block_hash: string;
  previous_block_hash: string; transactions: SilentPaymentScanTransaction[];
}
export interface SilentPaymentSupportClaim {
  wallet_id: string; name: string; send_supported: boolean; receive_supported: boolean;
  bip352_compliance: boolean; bip375_send_psbt: boolean; bip376_spend_psbt: boolean;
  verified_version: string; updated_at: string; status: 'documented' | 'tested'; evidence_url: string;
}
export interface SilentPaymentCoverageOverview {
  chain: 'bitcoin'; network: string; status: 'current' | 'stale' | 'empty' | 'unavailable'; reason?: string;
  latest_indexed_height: number | null; total_indexed_blocks: number | null;
  total_candidate_outputs: number | null; total_sp_outputs_detected: null;
  ecosystem_adoption_count: null; support_claims: SilentPaymentSupportClaim[];
  last_updated: string | null; recent_manifests: SilentPaymentBlockManifest[];
}
export interface SilentPaymentPsbtResult {
  valid: boolean; bip375_present: boolean; bip376_present: boolean; error?: string;
  psbt_version?: number; well_formed?: boolean; cryptographically_verified?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SilentPaymentsApiService {
  private apiBaseUrl = '';
  get network(): string { return this.stateService.network || 'mainnet'; }
  get networkChanges$(): Observable<string> { return this.stateService.networkChanged$.pipe(map(network => network || 'mainnet')); }
  path(path: string): string { return (this.network === 'mainnet' ? '' : '/' + this.network) + path; }
  constructor(private httpClient: HttpClient, private stateService: StateService) {
    if (!this.stateService.isBrowser && this.stateService.env) {
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
  }
  private request<T>(path: string, body?: object): Observable<T> {
    return defer(() => {
      const network = this.network;
      const url = `${this.apiBaseUrl}/api/v1/intelligence/payments/silent/${path}?chain=bitcoin&network=${encodeURIComponent(network)}`;
      return (body ? this.httpClient.post<T>(url, body) : this.httpClient.get<T>(url)).pipe(
        takeUntil(this.networkChanges$.pipe(filter(next => next !== network))),
        map(result => {
          const scoped = result as { chain?: string; network?: string };
          if (scoped.chain && (scoped.chain !== 'bitcoin' || scoped.network !== network)) throw new Error('Source returned a different chain/network.');
          return result;
        })
      );
    });
  }
  getCoverage$(): Observable<SilentPaymentCoverageOverview> { return this.request('coverage'); }
  getBlockManifest$(height: number): Observable<SilentPaymentBlockManifest> {
    return this.request<SilentPaymentBlockManifest>(`blocks/${height}/manifest`).pipe(map(manifest => {
      if (manifest.height !== height) throw new Error('Source returned a different checkpoint height.');
      return manifest;
    }));
  }
  getBlockBundleBytes$(height: number): Observable<string> {
    const network = this.network;
    return this.httpClient.get(`${this.apiBaseUrl}/api/v1/intelligence/payments/silent/blocks/${height}/bundle?chain=bitcoin&network=${encodeURIComponent(network)}`, { responseType: 'text' }).pipe(takeUntil(this.networkChanges$.pipe(filter(next => next !== network))));
  }
  getSupportRegistry$(): Observable<SilentPaymentSupportClaim[]> { return this.request('support'); }
  validateAddress$(address: string): Observable<{ valid: boolean; network?: string; scan_pubkey?: string; spend_pubkey?: string; error?: string }> { return this.request('validate-address', { address }); }
  validatePsbt$(psbt: string): Observable<SilentPaymentPsbtResult> { return this.request('validate-psbt', { psbt }); }
}
