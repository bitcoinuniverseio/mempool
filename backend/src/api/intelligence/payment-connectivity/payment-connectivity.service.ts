import {
  PaymentConnectivityProduct,
  NwcRelay,
  LnurlEndpoint,
  ZapPublicVerification,
  PaymentConnectivityOverviewResponse,
} from './payment-connectivity.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class PaymentConnectivityEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const productDirectoryUnavailable =
  'Payment product observations are unavailable. Product and overview reads require the owned wallet product directory with version-specific NWC, LNURL and zap test results, which is not connected on this deployment.';

const relayProberUnavailable =
  'NWC relay observations are unavailable. Relay reads require the owned Nostr relay prober (NIP-11 fetch and reachability probe from the backend network), which is not connected on this deployment.';

const lnurlProberUnavailable =
  'LNURL provider observations are unavailable. Provider reads require the owned LNURL endpoint prober (LUD capability fetch over HTTPS from the backend network), which is not connected on this deployment.';

const zapVerifierUnavailable =
  'Zap verification is unavailable. Verifying a NIP-57 zap requires the owned Nostr relay reader for the receipt event, the owned Lightning invoice decoder for the payment hash and amount, and a Schnorr signature check, which are not connected on this deployment.';

const vendorTrustUnavailable =
  'Capability manifest verification is unavailable. It requires the owned vendor signing-key directory, which is not connected on this deployment.';

/**
 * NWC, LNURL and zap connectivity evidence.
 *
 * Products, relays and LNURL providers come from the owned directory and
 * probers. A deployment that has none gets a 503 that names them: an empty
 * relay directory and an absent one are different answers, and this never
 * turns the second into the first. The protocol compatibility table is a set
 * of specification constants, and URI and endpoint inspection are
 * computations on caller-supplied input; those stay answerable.
 */
export class PaymentConnectivityService {
  public getOverview(): PaymentConnectivityOverviewResponse {
    throw new PaymentConnectivityEvidenceError('unavailable-product-directory', productDirectoryUnavailable);
  }

  public listProducts(): PaymentConnectivityProduct[] {
    throw new PaymentConnectivityEvidenceError('unavailable-product-directory', productDirectoryUnavailable);
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
    throw new PaymentConnectivityEvidenceError('unavailable-relay-prober', relayProberUnavailable);
  }

  public getRelay(_relayId: string): NwcRelay | undefined {
    throw new PaymentConnectivityEvidenceError('unavailable-relay-prober', relayProberUnavailable);
  }

  public listLnurlProviders(): LnurlEndpoint[] {
    throw new PaymentConnectivityEvidenceError('unavailable-lnurl-prober', lnurlProberUnavailable);
  }

  public verifyManifest(): never {
    throw new PaymentConnectivityEvidenceError('unavailable-vendor-trust', vendorTrustUnavailable);
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

  public verifyZap(_data: {
    zap_request_json: string;
    invoice_description_hash: string;
    zap_receipt_signature: string;
  }): ZapPublicVerification {
    throw new PaymentConnectivityEvidenceError('unavailable-zap-verifier', zapVerifierUnavailable);
  }
}

export default new PaymentConnectivityService();
