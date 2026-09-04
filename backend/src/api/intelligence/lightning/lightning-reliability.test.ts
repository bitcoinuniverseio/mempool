import { lightningReliabilityService } from './lightning-reliability.service';

describe('LightningReliabilityService', () => {
  const samplePubkey = '03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f';

  it('should return overview with fleet statistics and closures', () => {
    const overview = lightningReliabilityService.getOverview();
    expect(overview).toBeDefined();
    expect(overview.fleet_average_uptime_percentage).toBeGreaterThan(0);
    expect(overview.recent_closures_24h.cooperative).toBeGreaterThan(0);
    expect(overview.top_reliable_nodes.length).toBeGreaterThan(0);
  });

  it('should return node reliability metrics for known pubkey', () => {
    const node = lightningReliabilityService.getNodeReliability(samplePubkey);
    expect(node).not.toBeNull();
    expect(node?.node_pubkey).toBe(samplePubkey);
    expect(node?.uptime_30d_percentage).toBeGreaterThan(90);
    expect(node?.supported_lsps).toContain('LSPS0');
  });

  it('should return channel lifecycle by short channel id', () => {
    const channel = lightningReliabilityService.getChannelLifecycle('860400x120x0');
    expect(channel).not.toBeNull();
    expect(channel?.status).toBe('active');
    expect(channel?.capacity_sats).toBe(100000000);
  });

  it('should return closure forensics for closed channel', () => {
    const closureTxid = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e';
    const forensics = lightningReliabilityService.getClosureForensics(closureTxid);
    expect(forensics).not.toBeNull();
    expect(forensics?.closure_type).toBe('cooperative');
    expect(forensics?.settlement_status).toBe('settled');
  });

  it('should return active LSP directory', () => {
    const lsps = lightningReliabilityService.getLspProviders();
    expect(lsps.length).toBeGreaterThan(0);
    expect(lsps[0].lsps0_supported).toBe(true);
  });

  it('should simulate payment liquidity routing probability', () => {
    const sim = lightningReliabilityService.simulateLiquidity({
      target_pubkey: samplePubkey,
      amount_sats: 500000,
    });
    expect(sim.simulation_id).toBeDefined();
    expect(sim.estimated_path_probability).toBeGreaterThan(0.5);
    expect(sim.estimated_fee_sats).toBeGreaterThan(0);
  });
});
