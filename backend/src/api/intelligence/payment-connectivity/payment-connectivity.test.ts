import { Application, Request, Response } from 'express';
import paymentConnectivityRoutes from './payment-connectivity.routes';
import paymentConnectivityService, { PaymentConnectivityEvidenceError } from './payment-connectivity.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three wallet products with invented compliance scores, two relays
 * that were reachable because the constant said so, an LNURL provider with
 * every capability flag set, and a zap verdict whose recipient, payment hash
 * and amount were the same constants for every input. Passing those proved
 * the constants were present, not that any relay or zap had been observed.
 */
describe('PaymentConnectivityService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing product directory rather than invented compliance scores', () => {
    expect(() => paymentConnectivityService.getOverview()).toThrow(unavailable('unavailable-product-directory'));
    expect(() => paymentConnectivityService.listProducts()).toThrow(unavailable('unavailable-product-directory'));
  });

  it('reports the missing relay prober rather than relays that are reachable by constant', () => {
    expect(() => paymentConnectivityService.listRelays()).toThrow(unavailable('unavailable-relay-prober'));
    expect(() => paymentConnectivityService.getRelay('relay-damus-io')).toThrow(unavailable('unavailable-relay-prober'));
  });

  it('reports the missing LNURL prober rather than a provider with every capability', () => {
    expect(() => paymentConnectivityService.listLnurlProviders()).toThrow(unavailable('unavailable-lnurl-prober'));
  });

  it('reports the missing zap verifier and vendor trust rather than a verdict', () => {
    expect(() => paymentConnectivityService.verifyZap({ zap_request_json: '{}', invoice_description_hash: 'x', zap_receipt_signature: 'y' }))
      .toThrow(unavailable('unavailable-zap-verifier'));
    expect(() => paymentConnectivityService.verifyManifest()).toThrow(unavailable('unavailable-vendor-trust'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => paymentConnectivityService.getOverview(),
      () => paymentConnectivityService.listProducts(),
      () => paymentConnectivityService.listRelays(),
      () => paymentConnectivityService.listLnurlProviders(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(PaymentConnectivityEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('keeps the protocol compatibility table, which is specification constants', () => {
    const compatibility = paymentConnectivityService.getCompatibility();
    expect(compatibility.nip57_zaps.request_kind).toBe(9734);
    expect(compatibility.nwc_protocols.events.request).toBe(23194);
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
});

describe('Payment connectivity HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    paymentConnectivityRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const { gets } = mount();
    expect(gets.size).toBe(6);
    for (const [path, handler] of gets) {
      if (path.endsWith('/compatibility')) continue;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { relayId: 'relay' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('products');
      expect(body).not.toHaveProperty('relays');
    }
  });

  it.each([
    ['/api/v1/intelligence/payment-connectivity/manifests/verify', { product_id: 'alby-hub' }, 'unavailable-vendor-trust'],
    ['/api/v1/intelligence/payment-connectivity/zaps/verify', { zap_request_json: '{}', invoice_description_hash: 'x', zap_receipt_signature: 'y' }, 'unavailable-zap-verifier'],
  ])('never returns a verified verdict from %s without a verifier', (path, body, stage) => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    posts.get(path)!({ body } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('verified', true);
  });
});
