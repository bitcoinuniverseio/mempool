import swapsService from './swaps.service';

describe('SwapsService', () => {
  it('should return overview with active providers, protocols, and swaps', () => {
    const overview = swapsService.getOverview();
    expect(overview.total_swaps_observed).toBeGreaterThanOrEqual(100);
    expect(overview.active_providers_count).toBeGreaterThanOrEqual(2);
    expect(overview.protocols.length).toBeGreaterThanOrEqual(3);
    expect(overview.recent_swaps.length).toBeGreaterThanOrEqual(3);
  });

  it('should list protocols with correct features', () => {
    const protocols = swapsService.listProtocols();
    const submarine = protocols.find((p) => p.protocol_id === 'boltz_submarine_v2');
    expect(submarine).toBeDefined();
    expect(submarine?.taproot_support).toBe(true);
    expect(submarine?.supported_swap_types).toContain('submarine');
  });

  it('should list and retrieve providers', () => {
    const providers = swapsService.listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
    const boltz = swapsService.getProvider('boltz-exchange');
    expect(boltz).toBeDefined();
    expect(boltz?.name).toBe('Boltz Exchange');

    const history = swapsService.getProviderHistory('boltz-exchange');
    expect(history).toBeDefined();
    expect(history.uptime_pct_30d).toBeGreaterThanOrEqual(99.0);
  });

  it('should verify lockup conditions correctly', () => {
    const valid = swapsService.verifyLockup({
      lockup_address: 'bc1qvalidlockupaddress0123456789',
      expected_amount_sats: 100000,
      preimage_hash: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
      timeout_height: 864300,
      lockup_transaction: '00'.repeat(32),
    }, { currentHeight: 864200 });
    expect(valid.verified).toBe(true);
    expect(valid.errors.length).toBe(0);

    const invalid = swapsService.verifyLockup({
      lockup_address: '',
      expected_amount_sats: -50,
      preimage_hash: 'short_hash',
      timeout_height: 864100,
    }, { currentHeight: 864200 });
    expect(invalid.verified).toBe(false);
    expect(invalid.errors).toContain('Lockup address is missing');
    expect(invalid.errors).toContain('Invalid expected satoshi amount');
    expect(invalid.errors).toContain('Preimage hash must be 32 bytes hex');
  });

  it('should verify refund maturation correctly', () => {
    const premature = swapsService.verifyRefund({
      timeout_height: 864300,
    }, { currentHeight: 864200 });
    expect(premature.verified).toBe(false);
    expect(premature.timeout_matured).toBe(false);
    expect(premature.blocks_remaining).toBe(100);

    const matured = swapsService.verifyRefund({
      timeout_height: 864200,
    }, { currentHeight: 864250 });
    expect(matured.verified).toBe(true);
    expect(matured.timeout_matured).toBe(true);
    expect(matured.blocks_remaining).toBe(0);
  });

  it('should plan recovery for pending and matured swaps', () => {
    const planWaiting = swapsService.planRecovery({
      swap_id: 'swp-test-01',
      status: 'awaiting_lockup',
      expected_amount_sats: 50000,
      miner_fee_sats: 1200,
      timeout_height: 864300,
    }, { currentHeight: 864200 });
    expect(planWaiting.recommended_action).toBe('refundable_after_height');
    expect(planWaiting.blocks_until_refund).toBe(100);

    const planMatured = swapsService.planRecovery({
      swap_id: 'swp-test-02',
      status: 'claimable',
      expected_amount_sats: 50000,
      miner_fee_sats: 1200,
      timeout_height: 864200,
    }, { currentHeight: 864250 });
    expect(planMatured.recommended_action).toBe('refundable_now');
    expect(planMatured.unsigned_recovery_psbt).toBeDefined();
  });

  it('should verify provider capability manifests', () => {
    const valid = swapsService.verifyProviderManifest({
      provider_id: 'test-prov',
      identity_key: '02' + '11'.repeat(32),
      provider_signature: 'sig',
      protocols: ['boltz_submarine_v2'],
    });
    expect(valid.valid).toBe(true);

    const invalid = swapsService.verifyProviderManifest({
      provider_id: '',
      identity_key: '',
    });
    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain('provider_id is required');
  });

  it('should reconcile cross layer states', () => {
    const res = swapsService.reconcileCrossLayer('swp-boltz-887412-002');
    expect(res.reconciliation_state).toBe('fully_reconciled');
  });
});
