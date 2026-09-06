import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface MultipartyProduct {
  product_id: string;
  name: string;
  protocol: string;
  bip_standards: string[];
  summary: string;
  hardware_compatibility: {
    coldcard: boolean;
    bitbox02: boolean;
    ledger: boolean;
    trezor: boolean;
    krux: boolean;
    jade: boolean;
  };
}

export interface Musig2Session {
  session_id: string;
  aggregate_pubkey: string;
  cosigners: string[];
  message_hash: string;
  stage: 'round_1_nonces' | 'round_2_partial_sigs' | 'finalized';
  public_nonces: string[];
  partial_signatures: string[];
  final_schnorr_signature?: string;
  created_at: string;
  is_valid: boolean;
}

export interface Musig2VerificationRequest {
  participant_public_keys: string[];
  message_hash: string;
  public_nonces?: string[];
  partial_signatures?: string[];
  final_signature?: string;
}

export interface Musig2VerificationResult {
  verified: boolean;
  stage: 'invalid-input' | 'partial-session' | 'verified-session';
  scope: 'bip327-untweaked-public-transcript';
  participant_count: number;
  aggregate_public_key: string | null;
  key_aggregation_verified: boolean;
  nonce_aggregation_verified: boolean;
  partial_signature_validity: boolean[];
  final_bip340_valid: boolean | null;
  final_signature: string | null;
  errors: string[];
  warnings: string[];
}

export interface MultipartyOverview {
  total_products: number;
  supported_protocols: string[];
  bip_standards_count: number;
  hardware_vendors_count: number;
  featured_products: MultipartyProduct[];
  active_sessions_count: number;
}

@Injectable({
  providedIn: 'root',
})
export class MultipartyApiService {
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

  getOverview$(): Observable<MultipartyOverview> {
    return this.httpClient.get<MultipartyOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/multiparty/overview`
    );
  }

  getProducts$(): Observable<MultipartyProduct[]> {
    return this.httpClient.get<MultipartyProduct[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/multiparty/products`
    );
  }

  getProductById$(productId: string): Observable<MultipartyProduct> {
    return this.httpClient.get<MultipartyProduct>(
      `${this.apiBaseUrl}/api/v1/intelligence/multiparty/products/${encodeURIComponent(productId)}`
    );
  }

  verifyMusig2Session$(session: Musig2VerificationRequest | { cosigners: string[]; message_digest: string }): Observable<Musig2VerificationResult> {
    const request = 'participant_public_keys' in session ? session : {
      participant_public_keys: session.cosigners, message_hash: session.message_digest,
    };
    return this.httpClient.post<Musig2VerificationResult>(
      `${this.apiBaseUrl}/api/v1/intelligence/multiparty/public-sessions/verify`,
      request
    );
  }

  getCompatibility$(): Observable<any> {
    return this.httpClient.get<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/multiparty/compatibility`
    );
  }
}
