import collaborativePrivacyService from './collaborative-privacy.service';

describe('CollaborativePrivacyService', () => {
  it('should return overview with protocols, coordinators, and rounds', () => {
    const overview = collaborativePrivacyService.getOverview();
    expect(overview.active_protocols_count).toBeGreaterThanOrEqual(3);
    expect(overview.coordinators.length).toBeGreaterThanOrEqual(2);
    expect(overview.recent_rounds.length).toBeGreaterThanOrEqual(2);
    expect(overview.fidelity_bonds.length).toBeGreaterThanOrEqual(1);
  });

  it('should list distinct protocols including WabiSabi and JoinMarket', () => {
    const res = collaborativePrivacyService.listProtocols();
    const ids = res.protocols.map((p) => p.protocol_id);
    expect(ids).toContain('wabisabi');
    expect(ids).toContain('joinmarket');
    expect(ids).toContain('whirlpool_archival');
  });

  it('should retrieve coordinator details and policy descriptions', () => {
    const coord = collaborativePrivacyService.getCoordinator('coord-zk-wasabi');
    expect(coord).toBeDefined();
    expect(coord?.protocol).toBe('wabisabi');
    expect(coord?.fee_policy_description).toBeDefined();
  });

  it('should inspect rounds and verify CoinJoin properties without ownership claims', () => {
    const round = collaborativePrivacyService.getRound('rnd-ws-864205-01');
    expect(round).toBeDefined();
    expect(round?.classification).toBe('protocol_proven');
    expect(round?.effective_anonymity_set_min).toBeGreaterThan(0);

    const verification = collaborativePrivacyService.verifyPublicPackage({
      protocol: 'wabisabi',
      round_id: 'rnd-ws-864205-01',
    });
    expect(verification.verified).toBe(true);
    expect(verification.ownership_inference).toContain('none');
  });

  it('should list JoinMarket timelocked fidelity bonds', () => {
    const res = collaborativePrivacyService.listFidelityBonds();
    expect(res.fidelity_bonds.length).toBeGreaterThanOrEqual(1);
    const bond = res.fidelity_bonds[0];
    expect(bond.is_active).toBe(true);
    expect(bond.calculated_bond_value_sats).toBeGreaterThan(0);
    expect(bond.signature_verified).toBe(true);
  });
});
