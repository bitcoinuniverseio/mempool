import multipartyService from './multiparty.service';

describe('MultipartyService', () => {
  it('should return overview with products and supported protocols', () => {
    const overview = multipartyService.getOverview();
    expect(overview.total_products).toBeGreaterThanOrEqual(2);
    expect(overview.bip373_ready_count).toBeGreaterThan(0);
    expect(overview.bip388_ready_count).toBeGreaterThan(0);
    expect(overview.sample_policies.length).toBeGreaterThanOrEqual(1);
  });

  it('should list products and retrieve single product by ID', () => {
    const products = multipartyService.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(2);

    const coldcard = multipartyService.getProduct('coldcard-mk4-q');
    expect(coldcard).toBeDefined();
    expect(coldcard?.capabilities.musig2_bip327).toBe(true);
    expect(coldcard?.capabilities.musig2_psbt_bip373).toBe(true);
  });

  it('should verify MuSig2 public session and reject duplicate participant pubkeys', () => {
    const valid = multipartyService.verifyPublicSession({
      participant_public_keys: [
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      ],
      public_nonces: ['nonce1', 'nonce2'],
      final_signature: '00'.repeat(64),
    });
    expect(valid.verified).toBe(true);
    expect(valid.has_duplicate_nonces).toBe(false);
    expect(valid.final_bip340_valid).toBe(true);

    const duplicateParticipants = multipartyService.verifyPublicSession({
      participant_public_keys: [
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      ],
      public_nonces: ['nonce1', 'nonce2'],
    });
    expect(duplicateParticipants.verified).toBe(false);
    expect(duplicateParticipants.errors).toContain(
      'Duplicate participant public keys are prohibited in key aggregation'
    );
  });

  it('should flag dangerous public nonce reuse across sessions', () => {
    const reusedNonces = multipartyService.verifyPublicSession({
      participant_public_keys: [
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      ],
      public_nonces: ['nonce_same', 'nonce_same'],
    });
    expect(reusedNonces.has_duplicate_nonces).toBe(true);
    expect(reusedNonces.warnings.length).toBeGreaterThan(0);
  });

  it('should provide compatibility and test vectors', () => {
    const comp = multipartyService.getCompatibility();
    expect(comp.matrix.length).toBeGreaterThanOrEqual(2);
    expect(comp.protocols.musig2).toBeDefined();

    const vectors = multipartyService.getTestVectors();
    expect(vectors.bip327_key_aggregation.length).toBeGreaterThan(0);
    expect(vectors.bip388_wallet_policy.length).toBeGreaterThan(0);
  });
});
