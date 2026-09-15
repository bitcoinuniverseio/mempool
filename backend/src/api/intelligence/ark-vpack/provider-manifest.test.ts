import { createHash } from 'crypto';
import { pointFromScalar, signSchnorr } from 'tiny-secp256k1';
import { verifyProviderManifest } from './provider-manifest';
const fixture = Buffer.alloc(32, 1);
const publicKey = Buffer.from(pointFromScalar(fixture, true)!);
const now = Date.parse('2026-09-15T00:00:00Z');
const payload = JSON.stringify({ provider_id: 'fixture', network: 'signet', endpoint_url: 'https://provider.example.invalid', vpack_version: 'vpack-wire-v1', identity_key: publicKey.toString('hex'), expires_at: '2026-09-16T00:00:00Z' });
const digest = createHash('sha256').update('Universe Ark provider manifest v1\n').update(payload).digest();
const request = { format: 'universe-ark-provider-manifest-v1', signed_payload: payload, signature: Buffer.from(signSchnorr(digest, fixture)).toString('hex') };
describe('Explicit provider statement authentication', () => {
  it('separates a valid signature from an independently trusted provider', () => {
    expect(verifyProviderManifest(request, [], now)).toMatchObject({ valid: false, signature_verified: true, signer_trusted: false });
    expect(verifyProviderManifest(request, [publicKey.toString('hex')], now)).toMatchObject({ valid: true, signature_verified: true, signer_trusted: true });
  });
  it('rejects any alteration to the exact signed JSON bytes', () => {
    expect(verifyProviderManifest({ ...request, signed_payload: payload.replace('fixture', 'altered') }, [publicKey.toString('hex')], now).signature_verified).toBe(false);
  });
  it('rejects expired statements and arbitrary legacy signature placeholders', () => {
    expect(verifyProviderManifest(request, [publicKey.toString('hex')], now + 86400001).valid).toBe(false);
    expect(verifyProviderManifest({ server_signed_manifest: 'sig-data' }, [], now).valid).toBe(false);
  });
});
