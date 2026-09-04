import decentralizedMiningService from './mining-decentralized.service';

describe('DecentralizedMiningService', () => {
  it('should return overview with protocols and observed shares', () => {
    const overview = decentralizedMiningService.getOverview();
    expect(overview.protocols.length).toBe(3);
    expect(overview.total_active_sources).toBeGreaterThanOrEqual(2);
    expect(overview.recent_shares.length).toBeGreaterThanOrEqual(2);
    expect(overview.recent_templates.length).toBeGreaterThanOrEqual(1);
  });

  it('should support DATUM, P2Pool v2, and Braidpool protocols', () => {
    const protocols = decentralizedMiningService.listProtocols();
    const ids = protocols.map((p) => p.protocol_id);
    expect(ids).toContain('datum_gateway');
    expect(ids).toContain('p2pool_v2');
    expect(ids).toContain('braidpool');
  });

  it('should handle DAG multi-parent share references in Braidpool', () => {
    const shares = decentralizedMiningService.listShares();
    const braidShare = shares.find((s) => s.protocol_id === 'braidpool');
    expect(braidShare).toBeDefined();
    expect(braidShare?.parent_share_ids.length).toBeGreaterThanOrEqual(2);
    expect(braidShare?.is_valid).toBe(true);
  });

  it('should measure template autonomy and compare miner vs pool templates', () => {
    const comparison = decentralizedMiningService.compareTemplates();
    expect(comparison.similarity_ratio).toBeGreaterThan(0.9);
    expect(comparison.shared_txs_count).toBeGreaterThan(3000);
    expect(comparison.exclusive_txs_a_count).toBeGreaterThan(0);
  });

  it('should report on-chain coinbase payout evidence', () => {
    const payouts = decentralizedMiningService.listPayouts();
    expect(payouts.length).toBeGreaterThanOrEqual(1);
    expect(payouts[0].verified_on_chain).toBe(true);
    expect(payouts[0].settlement_type).toBe('coinbase_output');
  });
});
