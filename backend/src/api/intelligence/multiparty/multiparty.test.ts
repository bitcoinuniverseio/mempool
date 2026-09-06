import multipartyService, { MultipartyEvidenceError } from './multiparty.service';

const participants = [
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
];

describe('MultipartyService', () => {
  it('requires actual product capability and conformance evidence', () => {
    for (const read of [() => multipartyService.getOverview(), () => multipartyService.listProducts(),
      () => multipartyService.getProduct('coldcard-mk4-q'), () => multipartyService.getCompatibility(),
      () => multipartyService.getTestVectors()]) expect(read).toThrow(MultipartyEvidenceError);
  });

  it('keeps missing key-aggregation and nonce-verification engines explicit', () => {
    expect(multipartyService.verifyPublicSession({ participant_public_keys: participants })).toMatchObject({
      verified: false, stage: 'unavailable-musig2-engine', aggregate_public_key: null, final_bip340_valid: null,
    });
  });

  it('retains the application duplicate-cosigner check, including hexadecimal case aliases', () => {
    const result = multipartyService.verifyPublicSession({ participant_public_keys: [participants[0], participants[0].toUpperCase()] });
    expect(result.stage).toBe('invalid-input');
    expect(result.errors).toContain('Duplicate participant public keys are prohibited in this application.');
  });

  it('checks participant encodings instead of hashing arbitrary strings into an aggregate', () => {
    const result = multipartyService.verifyPublicSession({ participant_public_keys: ['not-a-key', 'another-string'] });
    expect(result).toMatchObject({ verified: false, stage: 'invalid-input', aggregate_public_key: null });
  });

  it('reports only the actual local public-nonce duplicate observation', () => {
    const result = multipartyService.verifyPublicSession({ participant_public_keys: participants, public_nonces: ['nonce', 'nonce'] });
    expect(result.has_duplicate_nonces).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.warnings.some(w => w.includes('not verification'))).toBe(true);
  });

  it('rejects malformed final signature fields without claiming a failed check ran', () => {
    expect(multipartyService.verifyPublicSession({ participant_public_keys: participants, final_signature: 'zz'.repeat(64) }))
      .toMatchObject({ verified: false, stage: 'invalid-input', final_bip340_valid: null });
  });

  it('does not confuse a complete vendor payload with a trusted signature', () => {
    expect(multipartyService.verifyManifest({ product_id: 'untrusted', signature: 'arbitrary' }))
      .toMatchObject({ verified: false, stage: 'unavailable-vendor-trust' });
    expect(multipartyService.verifyManifest(null)).toMatchObject({ verified: false, stage: 'invalid-input' });
  });
});
