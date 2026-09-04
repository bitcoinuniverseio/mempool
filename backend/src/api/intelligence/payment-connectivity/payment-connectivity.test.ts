import paymentConnectivityService from './payment-connectivity.service';

describe('PaymentConnectivityService', () => {
  it('should return overview with products and reachable relays', () => {
    const overview = paymentConnectivityService.getOverview();
    expect(overview.total_products).toBeGreaterThanOrEqual(3);
    expect(overview.active_relays).toBeGreaterThanOrEqual(2);
    expect(overview.lnurl_providers.length).toBeGreaterThanOrEqual(1);
    expect(overview.verified_zaps_count).toBeGreaterThanOrEqual(1);
  });

  it('should inspect and mask NWC URI without exposing secret in return value', () => {
    const rawSecret = '112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00';
    const uri = `nostr+walletconnect://0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798?relay=wss%3A%2F%2Frelay.damus.io&secret=${rawSecret}`;

    const inspected = paymentConnectivityService.inspectNwcUri(uri);
    expect(inspected.valid).toBe(true);
    expect(inspected.wallet_service_pubkey).toBe(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    );
    expect(inspected.relays).toContain('wss://relay.damus.io');
    expect(inspected.masked_uri).not.toContain(rawSecret);
    expect(inspected.masked_uri).toContain('1122...ff00');
  });

  it('should reject non-HTTPS and SSRF target URLs for LNURL endpoints', () => {
    const valid = paymentConnectivityService.verifyPublicEndpoint('https://service.example.com/.well-known/lnurlp/alice');
    expect(valid.valid).toBe(true);
    expect(valid.is_https).toBe(true);
    expect(valid.ssrf_safe).toBe(true);

    const httpBlocked = paymentConnectivityService.verifyPublicEndpoint('http://insecure.example.com/lnurl');
    expect(httpBlocked.valid).toBe(false);
    expect(httpBlocked.errors).toContain('LNURL endpoints must use HTTPS');

    const ssrfLoopback = paymentConnectivityService.verifyPublicEndpoint('https://127.0.0.1/admin');
    expect(ssrfLoopback.valid).toBe(false);
    expect(ssrfLoopback.ssrf_safe).toBe(false);

    const ssrfMetadata = paymentConnectivityService.verifyPublicEndpoint('https://169.254.169.254/latest/meta-data');
    expect(ssrfMetadata.valid).toBe(false);
    expect(ssrfMetadata.ssrf_safe).toBe(false);
  });

  it('should verify NIP57 zap request and invoice description hash linkage', () => {
    const zapReqJson = JSON.stringify({
      pubkey: '3bf0c63fcb93463407af97b5e097194fd1871b737112046479fe523e42b0f0c7',
      created_at: 1788500000,
      kind: 9734,
      tags: [['amount', '1000']],
    });

    const crypto = require('crypto');
    const expectedHash = crypto.createHash('sha256').update(zapReqJson).digest('hex');

    const validZap = paymentConnectivityService.verifyZap({
      zap_request_json: zapReqJson,
      invoice_description_hash: expectedHash,
      zap_receipt_signature: 'sig_valid_receipt_64_bytes_hex_string_representing_valid_schnorr',
    });
    expect(validZap.is_valid_zap).toBe(true);
    expect(validZap.description_hash_matches_request).toBe(true);

    const mismatchedZap = paymentConnectivityService.verifyZap({
      zap_request_json: zapReqJson,
      invoice_description_hash: 'wrong_hash',
      zap_receipt_signature: 'sig_valid',
    });
    expect(mismatchedZap.is_valid_zap).toBe(false);
    expect(mismatchedZap.description_hash_matches_request).toBe(false);
  });
});
