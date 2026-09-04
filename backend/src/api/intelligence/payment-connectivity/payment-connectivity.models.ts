/**
 * Nostr and Lightning Payment Connectivity Models.
 */

export interface NwcCapabilityClaim {
  core_revision: string;
  supported_methods: string[];
  encryption_modes: ('nip44_v2' | 'nip04')[];
  notifications_supported: boolean;
  budget_renewal_supported: boolean;
}

export interface NwcRelay {
  relay_id: string;
  url: string;
  nip11_supported: boolean;
  software_version?: string;
  is_reachable: boolean;
  latency_ms: number;
  last_probe_at: string;
}

export interface NwcInfoObservation {
  wallet_pubkey: string;
  relay_urls: string[];
  kind_13194_event_id: string;
  supported_methods: string[];
  encryption_modes: string[];
  signature_verified: boolean;
  observed_at: string;
}

export interface LnurlCapability {
  lud01_base_spec: boolean;
  lud06_pay: boolean;
  lud03_withdraw: boolean;
  lud04_auth: boolean;
  lud16_lightning_address: boolean;
  lud18_payer_data: boolean;
  lud21_payment_verification: boolean;
}

export interface LnurlEndpoint {
  endpoint_id: string;
  domain: string;
  lightning_address_sample?: string;
  capabilities: LnurlCapability;
  is_https: boolean;
  ssrf_safe: boolean;
  last_validated_at: string;
}

export interface ZapPublicVerification {
  verification_id: string;
  zap_request_id: string;
  zap_receipt_id: string;
  recipient_nostr_pubkey: string;
  invoice_payment_hash: string;
  invoice_description_hash: string;
  description_hash_matches_request: boolean;
  amount_sats: number;
  receipt_signature_valid: boolean;
  is_valid_zap: boolean;
  verified_at: string;
}

export interface PaymentConnectivityProduct {
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

export interface PaymentConnectivityOverviewResponse {
  total_products: number;
  active_relays: number;
  verified_zaps_count: number;
  products: PaymentConnectivityProduct[];
  relays: NwcRelay[];
  lnurl_providers: LnurlEndpoint[];
}
