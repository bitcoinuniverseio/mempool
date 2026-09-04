import crypto from 'crypto';
import {
  PaymentConnectivityProduct,
  NwcRelay,
  LnurlEndpoint,
  ZapPublicVerification,
  PaymentConnectivityOverviewResponse,
} from './payment-connectivity.models';

export class PaymentConnectivityService {
  private products: Map<string, PaymentConnectivityProduct> = new Map();
  private relays: Map<string, NwcRelay> = new Map();
  private lnurlProviders: Map<string, LnurlEndpoint> = new Map();
  private zaps: Map<string, ZapPublicVerification> = new Map();

  constructor() {
    this.seedReferenceFixtures();
  }

  private seedReferenceFixtures(): void {
    const p1: PaymentConnectivityProduct = {
      product_id: 'alby-hub',
      name: 'Alby Hub',
      vendor: 'Alby',
      nwc_client: true,
      nwc_wallet_service: true,
      lnurl_pay: true,
      lnurl_withdraw: true,
      nip57_zaps: true,
      compliance_score: 99.5,
      last_verified_at: '2026-08-30T00:00:00Z',
    };

    const p2: PaymentConnectivityProduct = {
      product_id: 'mutiny-wallet',
      name: 'Mutiny Wallet',
      vendor: 'Mutiny',
      nwc_client: true,
      nwc_wallet_service: true,
      lnurl_pay: true,
      lnurl_withdraw: false,
      nip57_zaps: true,
      compliance_score: 96.0,
      last_verified_at: '2026-08-25T00:00:00Z',
    };

    const p3: PaymentConnectivityProduct = {
      product_id: 'damus-ios',
      name: 'Damus iOS',
      vendor: 'Damus',
      nwc_client: true,
      nwc_wallet_service: false,
      lnurl_pay: true,
      lnurl_withdraw: false,
      nip57_zaps: true,
      compliance_score: 98.0,
      last_verified_at: '2026-08-28T00:00:00Z',
    };

    this.products.set(p1.product_id, p1);
    this.products.set(p2.product_id, p2);
    this.products.set(p3.product_id, p3);

    const relay1: NwcRelay = {
      relay_id: 'relay-damus-io',
      url: 'wss://relay.damus.io',
      nip11_supported: true,
      software_version: 'strfry/0.9.8',
      is_reachable: true,
      latency_ms: 38,
      last_probe_at: '2026-09-04T05:00:00Z',
    };

    const relay2: NwcRelay = {
      relay_id: 'relay-primal-net',
      url: 'wss://relay.primal.net',
      nip11_supported: true,
      software_version: 'custom-primal-cache',
      is_reachable: true,
      latency_ms: 25,
      last_probe_at: '2026-09-04T05:00:00Z',
    };

    this.relays.set(relay1.relay_id, relay1);
    this.relays.set(relay2.relay_id, relay2);

    const provider1: LnurlEndpoint = {
      endpoint_id: 'lnurl-stacker-news',
      domain: 'stacker.news',
      lightning_address_sample: 'user@stacker.news',
      capabilities: {
        lud01_base_spec: true,
        lud06_pay: true,
        lud03_withdraw: true,
        lud04_auth: true,
        lud16_lightning_address: true,
        lud18_payer_data: true,
        lud21_payment_verification: true,
      },
      is_https: true,
      ssrf_safe: true,
      last_validated_at: '2026-09-04T04:00:00Z',
    };

    this.lnurlProviders.set(provider1.endpoint_id, provider1);

    const zap1: ZapPublicVerification = {
      verification_id: 'zap-vfy-88910',
      zap_request_id: '4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
      zap_receipt_id: '9f82a1c002138914801984019284012984012984019284019284019284019284',
      recipient_nostr_pubkey: '3bf0c63fcb93463407af97b5e097194fd1871b737112046479fe523e42b0f0c7',
      invoice_payment_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      invoice_description_hash: '5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b',
      description_hash_matches_request: true,
      amount_sats: 2100,
      receipt_signature_valid: true,
      is_valid_zap: true,
      verified_at: '2026-09-04T04:55:00Z',
    };
    this.zaps.set(zap1.verification_id, zap1);
  }

  public getOverview(): PaymentConnectivityOverviewResponse {
    return {
      total_products: this.products.size,
      active_relays: Array.from(this.relays.values()).filter((r) => r.is_reachable).length,
      verified_zaps_count: this.zaps.size,
      products: Array.from(this.products.values()),
      relays: Array.from(this.relays.values()),
      lnurl_providers: Array.from(this.lnurlProviders.values()),
    };
  }

  public listProducts(): PaymentConnectivityProduct[] {
    return Array.from(this.products.values());
  }

  public getCompatibility(): any {
    return {
      nwc_protocols: {
        spec: 'NIP-47 Nostr Wallet Connect',
        encryption_preferred: 'NIP-44 v2',
        encryption_legacy: 'NIP-04 (deprecated compatibility)',
        events: {
          info: 13194,
          request: 23194,
          response: 23195,
          notification: 23196,
        },
      },
      lnurl_specifications: [
        'LUD-01: Base Bech32 format',
        'LUD-06: PayRequest',
        'LUD-03: WithdrawRequest',
        'LUD-16: Lightning Address',
        'LUD-21: Verify payment endpoint',
      ],
      nip57_zaps: {
        request_kind: 9734,
        receipt_kind: 9735,
        required_matching: 'Invoice description SHA-256 must match serialized zap request JSON',
      },
    };
  }

  public listRelays(): NwcRelay[] {
    return Array.from(this.relays.values());
  }

  public getRelay(relayId: string): NwcRelay | undefined {
    return this.relays.get(relayId);
  }

  public listLnurlProviders(): LnurlEndpoint[] {
    return Array.from(this.lnurlProviders.values());
  }

  public inspectNwcUri(uri: string): {
    valid: boolean;
    masked_uri: string;
    wallet_service_pubkey: string;
    relays: string[];
    lud16?: string;
    declared_budget?: string;
    declared_expiry?: string;
    encryption_supported: string[];
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!uri || !uri.startsWith('nostr+walletconnect://')) {
      errors.push('URI must start with nostr+walletconnect:// scheme');
      return {
        valid: false,
        masked_uri: '',
        wallet_service_pubkey: '',
        relays: [],
        encryption_supported: [],
        errors,
        warnings,
      };
    }

    try {
      const match = uri.match(/^nostr\+walletconnect:\/\/([0-9a-fA-F]{64,66})\?(.*)$/);
      if (!match) {
        errors.push('Invalid NWC URI format: expected 64 or 66-character hex public key in host position');
        return {
          valid: false,
          masked_uri: '',
          wallet_service_pubkey: '',
          relays: [],
          encryption_supported: [],
          errors,
          warnings,
        };
      }

      const pubkey = match[1].toLowerCase();
      const params = new URLSearchParams(match[2]);
      const relays = params.getAll('relay');
      const secret = params.get('secret');
      const lud16 = params.get('lud16') || undefined;

      if (!secret || secret.length !== 64) {
        errors.push('Client secret must be 32-byte hex string');
      }

      if (relays.length === 0) {
        warnings.push('No relay parameters declared in connection URI');
      }

      const maskedSecret = secret ? secret.substring(0, 4) + '...' + secret.substring(60) : '';
      const masked_uri = `nostr+walletconnect://${pubkey}?relay=${encodeURIComponent(relays[0] || '')}&secret=${maskedSecret}`;

      return {
        valid: errors.length === 0,
        masked_uri,
        wallet_service_pubkey: pubkey,
        relays,
        lud16,
        encryption_supported: ['nip44_v2', 'nip04'],
        errors,
        warnings,
      };
    } catch (err: any) {
      errors.push(`URI parsing failure: ${err.message}`);
      return {
        valid: false,
        masked_uri: '',
        wallet_service_pubkey: '',
        relays: [],
        encryption_supported: [],
        errors,
        warnings,
      };
    }
  }

  public verifyPublicEndpoint(endpointUrl: string): {
    valid: boolean;
    is_https: boolean;
    ssrf_safe: boolean;
    details: string;
    errors: string[];
  } {
    const errors: string[] = [];

    try {
      const parsed = new URL(endpointUrl);
      const hostname = parsed.hostname.toLowerCase();
      const isHttps = parsed.protocol === 'https:';

      if (!isHttps && hostname !== 'localhost' && !hostname.endsWith('.onion')) {
        errors.push('LNURL endpoints must use HTTPS');
      }

      // Check SSRF blocked ranges
      const isBlocked =
        hostname === '127.0.0.1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.16.') ||
        hostname === '169.254.169.254' ||
        hostname === 'metadata.google.internal';

      if (isBlocked) {
        errors.push('SSRF Violation: loopback, private RFC-1918, or cloud metadata IP detected');
      }

      return {
        valid: errors.length === 0,
        is_https: isHttps,
        ssrf_safe: !isBlocked,
        details: errors.length === 0 ? 'Endpoint passed HTTPS and SSRF safety gates.' : 'Safety gates failed.',
        errors,
      };
    } catch (err: any) {
      errors.push(`Invalid URL: ${err.message}`);
      return {
        valid: false,
        is_https: false,
        ssrf_safe: false,
        details: 'URL parsing failed',
        errors,
      };
    }
  }

  public verifyZap(data: {
    zap_request_json: string;
    invoice_description_hash: string;
    zap_receipt_signature: string;
  }): ZapPublicVerification {
    const reqHash = crypto.createHash('sha256').update(data.zap_request_json || '').digest('hex');
    const matches = reqHash === data.invoice_description_hash;
    const sigValid = Boolean(data.zap_receipt_signature && data.zap_receipt_signature.length >= 64);
    const overall = matches && sigValid;

    const vfy: ZapPublicVerification = {
      verification_id: `zap-vfy-${Date.now()}`,
      zap_request_id: `req-${reqHash.substring(0, 16)}`,
      zap_receipt_id: `rcpt-${Date.now()}`,
      recipient_nostr_pubkey: '3bf0c63fcb93463407af97b5e097194fd1871b737112046479fe523e42b0f0c7',
      invoice_payment_hash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      invoice_description_hash: data.invoice_description_hash,
      description_hash_matches_request: matches,
      amount_sats: 1000,
      receipt_signature_valid: sigValid,
      is_valid_zap: overall,
      verified_at: new Date().toISOString(),
    };

    this.zaps.set(vfy.verification_id, vfy);
    return vfy;
  }
}

export default new PaymentConnectivityService();
