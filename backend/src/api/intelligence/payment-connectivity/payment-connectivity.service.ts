import {
  PaymentConnectivityProduct,
  NwcRelay,
  LnurlEndpoint,
  ZapPublicVerification,
  PaymentConnectivityOverviewResponse,
} from './payment-connectivity.models';
import * as ecc from 'tiny-secp256k1';
import { Resolver, resolvePublicAddress, validateWebhookUrl } from '../identity/developer-identity';

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
  public resolver?: Resolver;
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

  /** NIP-47 URI inspection only; no relay connection, signing or wallet access. */
  public inspectNwcUri(uri: string): {
    valid: boolean; masked_uri: string; wallet_service_pubkey: string;
    relays: string[]; lud16?: string; encryption_supported: string[];
    errors: string[]; warnings: string[]; verification_scope: string;
  } {
    const result = {
      valid: false, masked_uri: '', wallet_service_pubkey: '', relays: [] as string[],
      encryption_supported: [] as string[], errors: [] as string[],
      warnings: ['URI syntax and key validation only. Wallet authorization, relay reachability and encryption capabilities have not been observed.'],
      verification_scope: 'local-uri-inspection',
    };
    if (typeof uri !== 'string' || uri.length > 8192 || /[\s\x00-\x1f\x7f]/.test(uri)) {
      result.errors.push('Connection URI must be a bounded string without whitespace or control characters.');
      return result;
    }
    const match = /^nostr\+walletconnect:\/\/([0-9a-fA-F]{64})\?([^#]+)$/.exec(uri);
    if (!match) {
      result.errors.push('Expected nostr+walletconnect:// followed by a 32-byte x-only public key and query parameters.');
      return result;
    }
    try {
      // URLSearchParams accepts malformed percent encodings; validate first.
      for (const entry of match[2].split('&')) {
        const separator = entry.indexOf('=');
        if (separator < 1) throw new Error();
        decodeURIComponent(entry.slice(0, separator).replace(/\+/g, ' '));
        decodeURIComponent(entry.slice(separator + 1).replace(/\+/g, ' '));
      }
      const params = new URLSearchParams(match[2]);
      const pubkey = match[1].toLowerCase();
      const secrets = params.getAll('secret');
      const secret = secrets[0];
      if (!ecc.isXOnlyPoint(Buffer.from(pubkey, 'hex'))) result.errors.push('Wallet public key is not a secp256k1 x-only point.');
      if (secrets.length !== 1 || !/^[0-9a-fA-F]{64}$/.test(secret || '') || !ecc.isPrivate(Buffer.from(secret, 'hex'))) {
        result.errors.push('Exactly one client secret containing a valid 32-byte hex private scalar is required.');
      }
      for (const key of new Set(params.keys())) {
        if (key !== 'relay' && params.getAll(key).length > 1) result.errors.push('Duplicate singleton query parameter.');
      }
      const relays = params.getAll('relay');
      if (!relays.length) result.errors.push('At least one relay URL is required.');
      for (const relay of relays) {
        try {
          const parsed = new URL(relay);
          if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash) throw new Error();
          // Relay paths and queries can carry credentials too. Inspection does
          // not need to reproduce them, and must not echo a nested secret.
          result.relays.push(parsed.protocol + '//' + parsed.host + (parsed.pathname !== '/' || parsed.search ? '/[path-and-query-redacted]' : '/'));
        } catch { result.errors.push('Relay must be a valid ws/wss URL without user information or a fragment.'); }
      }
      result.wallet_service_pubkey = pubkey;
      result.masked_uri = 'nostr+walletconnect://' + pubkey + '?secret=[redacted]';
      // A malicious URI can repeat its client secret in a public-looking field.
      // Scrub every returned string, including public key and relay hostname.
      const redact = (value: string): string => {
        for (const item of secrets) if (item) value = value.replace(new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]');
        return value;
      };
      result.wallet_service_pubkey = redact(result.wallet_service_pubkey);
      result.masked_uri = redact(result.masked_uri);
      result.relays = result.relays.map(redact);
      result.valid = result.errors.length === 0;
      return result;
    } catch {
      result.errors.push('Invalid connection URI encoding.');
      return result;
    }
  }

  public async verifyPublicEndpoint(endpointUrl: string): Promise<{
    valid: boolean; is_https: boolean; ssrf_safe: boolean | null;
    resolved_address?: string; address_family?: number; verification_scope: string;
    details: string; errors: string[];
  }> {
    let isHttps = false;
    try {
      const parsed = validateWebhookUrl(endpointUrl);
      isHttps = parsed.protocol === 'https:';
      const pinned = await resolvePublicAddress(parsed, this.resolver);
      return {
        valid: true, is_https: true, ssrf_safe: null,
        resolved_address: pinned.address, address_family: pinned.family,
        verification_scope: 'dns-address-inspection',
        details: 'All resolved addresses passed the public-address policy at inspection time. No HTTP request or LNURL capability check was performed. A subsequent request must validate again and pin its connection; redirects require independent validation.',
        errors: [],
      };
    } catch {
      // Never echo untrusted URLs, resolver exceptions or URL credentials.
      return { valid: false, is_https: isHttps, ssrf_safe: false, verification_scope: 'dns-address-inspection',
        details: 'Endpoint inspection failed.', errors: ['Expected a credential-free HTTPS URL resolving only to public addresses.'] };
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
