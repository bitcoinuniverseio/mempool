import lightningResilienceService from './lightning-resilience.service';

describe('LightningResilienceService', () => {
  it('should return overview with healthy and congested channels', () => {
    const overview = lightningResilienceService.getOverview();
    expect(overview.total_channels_monitored).toBeGreaterThan(0);
    expect(overview.healthy_channels_count).toBeGreaterThan(0);
    expect(overview.onion_queue).toBeDefined();
    expect(overview.recent_incidents.length).toBeGreaterThan(0);
  });

  it('should list and retrieve channels by short_channel_id', () => {
    const channels = lightningResilienceService.listChannels();
    expect(channels.length).toBeGreaterThanOrEqual(2);

    const first = channels[0];
    const retrieved = lightningResilienceService.getChannel(first.short_channel_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.capacity_sats).toBe(first.capacity_sats);
  });

  it('should retrieve node resilience profile and capabilities', () => {
    const profile = lightningResilienceService.getNodeResilience('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    expect(profile).toBeDefined();
    expect(profile.resilience_status).toBe('healthy');
    expect(profile.supported_mitigations.length).toBeGreaterThan(0);
  });

  it('should report incident alerts without peer accusation', () => {
    const incidents = lightningResilienceService.listIncidents();
    expect(incidents.length).toBeGreaterThanOrEqual(2);
    for (const inc of incidents) {
      expect(inc.operator_recommendation).toBeDefined();
      expect(inc.description).not.toContain('attacker');
    }
  });

  it('should simulate channel jamming and calculate attacker cost vs honest failure', () => {
    const simResult = lightningResilienceService.runSimulator({
      channel_capacity_sats: 10000000,
      htlc_slot_count: 483,
      pending_value_limit_sats: 5000000,
      attacker_htlc_count: 200,
      attacker_hold_seconds: 7200,
      honest_traffic_rate_per_min: 15,
      routing_base_fee_msat: 1000,
      routing_fee_proportional_millionths: 50,
      hold_time_fee_per_second_msat: 2,
      circuit_breaker_enabled: true,
    });
    expect(simResult.locked_liquidity_sats).toBeGreaterThan(0);
    expect(simResult.cost_to_attacker_sats).toBeGreaterThan(0);
    expect(simResult.mitigation_effectiveness_pct).toBeGreaterThan(50);
    expect(simResult.observations.length).toBeGreaterThan(0);
  });
});
