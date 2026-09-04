import bitcoinStakingService from './bitcoin-staking.service';

describe('BitcoinStakingService', () => {
  it('should return overview with active delegations and parameter version', () => {
    const overview = bitcoinStakingService.getOverview();
    expect(overview.total_finality_providers).toBeGreaterThanOrEqual(3);
    expect(overview.total_active_delegations).toBeGreaterThanOrEqual(1);
    expect(overview.current_protocol_parameter_version).toBe('babylon-mainnet-phase-1');
    expect(overview.delegation_states_summary.active).toBeGreaterThanOrEqual(1);
  });

  it('should filter delegations by state', () => {
    const all = bitcoinStakingService.listDelegations();
    expect(all.length).toBeGreaterThanOrEqual(3);

    const activeOnly = bitcoinStakingService.listDelegations('active');
    expect(activeOnly.length).toBeGreaterThanOrEqual(1);
    expect(activeOnly.every((d) => d.state === 'active')).toBe(true);

    const slashedOnly = bitcoinStakingService.listDelegations('slashed');
    expect(slashedOnly.length).toBeGreaterThanOrEqual(1);
    expect(slashedOnly.every((d) => d.state === 'slashed')).toBe(true);
  });

  it('should verify staking transactions and check parameter bounds', () => {
    // 64 bytes valid dummy hex
    const dummyTx = '0200000001' + '00'.repeat(32) + '0000000000fdffffff01' + '00e1f50500000000' + '160014' + '11'.repeat(20) + '00000000';
    const result = bitcoinStakingService.verifyTransaction({
      raw_tx_hex: dummyTx,
      expected_family: 'staking_deposit',
      parameter_version: 'babylon-mainnet-phase-1',
    });

    expect(result.valid).toBe(true);
    expect(result.family).toBe('staking_deposit');
    expect(result.txid).toBeDefined();
    expect(result.detected_parameters.covenant_threshold_met).toBe(true);
  });

  it('should reject invalid or malformed transaction hex', () => {
    const result = bitcoinStakingService.verifyTransaction({
      raw_tx_hex: 'deadbeef',
      expected_family: 'staking_deposit',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Transaction hex is malformed or too short');
  });

  it('should mathematically verify EOTS equivocation evidence', () => {
    const validEvidence = bitcoinStakingService.verifySlashingEvidence({
      eots_pk: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      nonce_point: '028888888888888888888888888888888888888888888888888888888888888888',
      message_a: 'block_hash_alpha_vote_00000000000000000001',
      message_b: 'block_hash_beta_vote_00000000000000000002',
      signature_a: '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022001',
      signature_b: '3045022100a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2022002',
    });

    expect(validEvidence.verified).toBe(true);
    expect(validEvidence.status).toBe('equivocation_proven');
    expect(validEvidence.recovered_secret_hash).toBeDefined();
    expect(validEvidence.recovered_secret_hash?.length).toBe(64);

    const identicalMessageEvidence = bitcoinStakingService.verifySlashingEvidence({
      eots_pk: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      nonce_point: '028888888888888888888888888888888888888888888888888888888888888888',
      message_a: 'same_message',
      message_b: 'same_message',
      signature_a: 'sig1',
      signature_b: 'sig2',
    });

    expect(identicalMessageEvidence.verified).toBe(false);
    expect(identicalMessageEvidence.status).toBe('invalid_evidence');
  });

  it('should reconcile on-chain Bitcoin stake with consumer PoS voting power', () => {
    const reconciliation = bitcoinStakingService.reconcileWithConsumerPoS('babylon-hub-1');
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.active_stake_match).toBe(true);
    expect(reconciliation.unbonding_sync_status).toBe('synchronized');
    expect(reconciliation.total_btc_stake_sat).toEqual(reconciliation.total_consumer_voting_power_sat);
  });
});
