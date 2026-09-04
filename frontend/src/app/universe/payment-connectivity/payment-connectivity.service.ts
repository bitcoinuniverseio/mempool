import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

export interface PaymentProduct {
  product_id: string;
  name: string;
  vendor: string;
  nwc_client: boolean;
  nwc_wallet_service: boolean;
  lnurl_pay: boolean;
  lnurl_withdraw: boolean;
  nip57_zaps: boolean;
  compliance_score: number;
  last_verified_at: string;
}

export interface NwcRelay {
  relay_id: string;
  url: string;
  nip11_supported: boolean;
  software_version: string;
  is_reachable: boolean;
  latency_ms: number;
  last_probe_at: string;
}

export interface LnurlEndpoint {
  endpoint_id: string;
  domain: string;
  lightning_address_sample: string;
  capabilities: {
    lud01_base_spec: boolean;
    lud06_pay: boolean;
    lud03_withdraw: boolean;
    lud04_auth: boolean;
    lud16_lightning_address: boolean;
    lud18_payer_data: boolean;
    lud21_payment_verification: boolean;
  };
  is_https: boolean;
}

export interface PaymentConnectivityOverview {
  total_products: number;
  active_relays: number;
  verified_zaps_count: number;
  featured_products: PaymentProduct[];
  relays: NwcRelay[];
  lnurl_providers: LnurlEndpoint[];
}

@Injectable({
  providedIn: 'root',
})
export class PaymentConnectivityApiService {
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

  getOverview$(): Observable<PaymentConnectivityOverview> {
    return this.httpClient.get<PaymentConnectivityOverview>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/overview`
    );
  }

  getProducts$(): Observable<PaymentProduct[]> {
    return this.httpClient.get<PaymentProduct[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/products`
    );
  }

  getRelays$(): Observable<NwcRelay[]> {
    return this.httpClient.get<NwcRelay[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/relays`
    );
  }

  getLnurlProviders$(): Observable<LnurlEndpoint[]> {
    return this.httpClient.get<LnurlEndpoint[]>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/lnurl/providers`
    );
  }

  inspectNwcUri$(uri: string): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/nwc/inspect`,
      { uri }
    );
  }

  verifyZap$(req: any): Observable<any> {
    return this.httpClient.post<any>(
      `${this.apiBaseUrl}/api/v1/intelligence/payment-connectivity/zaps/verify`,
      req
    );
  }
}
