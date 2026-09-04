import dlcService from './dlc.service';

describe('DlcService', () => {
  it('should return overview with active oracles and verified events', () => {
    const overview = dlcService.getOverview();
    expect(overview.total_oracles).toBeGreaterThanOrEqual(2);
    expect(overview.healthy_oracles).toBeGreaterThanOrEqual(2);
    expect(overview.recent_events.length).toBeGreaterThanOrEqual(2);
    expect(overview.active_conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('should list oracles and retrieve single oracle by ID', () => {
    const oracles = dlcService.listOracles();
    expect(oracles.length).toBeGreaterThanOrEqual(2);

    const first = oracles[0];
    const retrieved = dlcService.getOracle(first.oracle_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.oracle_public_key).toBe(first.oracle_public_key);
  });

  it('should verify valid oracle announcement and reject duplicate nonces', () => {
    const valid = dlcService.verifyAnnouncement({
      oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      event_id: 'test-event-01',
      event_descriptor: { type: 'enumerated', outcomes: ['win', 'loss'] },
      event_maturity_epoch: 1788500000,
      nonces: ['02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235'],
      announcement_signature: '72a6b22b10298a0c5c4f24fef7d8b584a7e937d5718a209b0b4a7be6c7a918e9324bc6885dfb2e59fa257f8cf28e5784931a7c36e4f3a743b174780614cf12c5',
    });
    expect(valid.verified).toBe(true);
    expect(valid.errors.length).toBe(0);

    const invalid = dlcService.verifyAnnouncement({
      oracle_public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      event_id: 'test-event-02',
      event_descriptor: { type: 'enumerated', outcomes: ['win', 'loss'] },
      event_maturity_epoch: 1788500000,
      nonces: [
        '02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235',
        '02e07174624d775191c0e0b3f5115291d92a4a350a4179373f1d3a5a7849e7b235',
      ],
      announcement_signature: 'sig',
    });
    expect(invalid.verified).toBe(false);
    expect(invalid.errors).toContain('Duplicate nonce points detected in announcement');
  });

  it('should verify contract package collateral conservation', () => {
    const validPkg = dlcService.verifyContractPackage({
      parties: [
        {
          role: 'local',
          public_key: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '00'.repeat(32), vout: 0, value_sats: 100000 },
        },
        {
          role: 'remote',
          public_key: '03c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '11'.repeat(32), vout: 0, value_sats: 100000 },
        },
      ],
      cets: [
        {
          cet_id: 'cet-1',
          outcome: 'win',
          local_payout_sats: 198000,
          remote_payout_sats: 0,
          fee_sats: 2000,
          adaptor_signature: 'sig-adaptor-1',
          locktime: 860500,
        },
      ],
      refund: {
        locktime: 861000,
        local_payout_sats: 99000,
        remote_payout_sats: 99000,
      },
    });
    expect(validPkg.valid).toBe(true);
    expect(validPkg.total_collateral_sats).toBe(200000);

    const invalidPkg = dlcService.verifyContractPackage({
      parties: [
        {
          role: 'local',
          public_key: 'pub1',
          collateral_sats: 100000,
          payout_address: 'bc1q...',
          funding_input: { txid: '00'.repeat(32), vout: 0, value_sats: 100000 },
        },
      ],
    });
    expect(invalidPkg.valid).toBe(false);
    expect(invalidPkg.errors).toContain('DLC contract package requires exactly two parties');
  });

  it('should create and retrieve regtest simulations for settlement and outage', () => {
    const settlementSim = dlcService.createSimulation({
      scenario: 'settlement',
      contract_id: 'contract-test-01',
      oracle_ids: ['oracle-kormir-alpha'],
      outcome: 'increase_gt_5pct',
    });
    expect(settlementSim.status).toBe('simulated_success');
    expect(settlementSim.adaptor_signatures_valid).toBe(true);

    const outageSim = dlcService.createSimulation({
      scenario: 'oracle_outage',
      contract_id: 'contract-test-02',
      oracle_ids: ['oracle-crypto-data-feed'],
    });
    expect(outageSim.status).toBe('simulated_refund');

    const retrieved = dlcService.getSimulation(settlementSim.simulation_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.simulation_id).toBe(settlementSim.simulation_id);
  });
});
