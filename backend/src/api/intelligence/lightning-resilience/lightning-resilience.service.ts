import {
  LightningResilienceOverview,
  LightningChannelResilience,
  LightningResilienceIncident,
  LightningMitigationCapability,
  LightningSimulationParams,
  LightningSimulationResult,
} from './lightning-resilience.models';

export class LightningResilienceService {
  private channels: LightningChannelResilience[] = [
    {
      short_channel_id: '864195x120x1',
      channel_point: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0',
      node1_pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      node2_pubkey: '03cde89ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef',
      capacity_sats: 10000000,
      local_balance_sats: 6200000,
      remote_balance_sats: 3800000,
      htlc_slot_capacity: 483,
      htlc_slots_in_use: 38,
      htlc_slot_utilization_pct: 7.8,
      pending_htlc_value_sats: 450000,
      pending_value_utilization_pct: 4.5,
      held_duration_p50_seconds: 1.2,
      held_duration_p95_seconds: 4.8,
      held_duration_p99_seconds: 12.4,
      liquidity_time_product_sat_hours: 1520,
      failure_rate_pct: 0.2,
      timeout_rate_pct: 0.01,
      resilience_band: 'healthy',
      mitigations_active: ['slot_limits', 'circuit_breaker'],
    },
    {
      short_channel_id: '864190x304x2',
      channel_point: '0e3e2357e806b6cdb1f70b54c3a3a17b6714ee1f0e249fa23d8a969e1c911e22:1',
      node1_pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      node2_pubkey: '02112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      capacity_sats: 5000000,
      local_balance_sats: 800000,
      remote_balance_sats: 4200000,
      htlc_slot_capacity: 483,
      htlc_slots_in_use: 395,
      htlc_slot_utilization_pct: 81.7,
      pending_htlc_value_sats: 3200000,
      pending_value_utilization_pct: 64.0,
      held_duration_p50_seconds: 18.5,
      held_duration_p95_seconds: 142.0,
      held_duration_p99_seconds: 480.0,
      liquidity_time_product_sat_hours: 48500,
      failure_rate_pct: 4.8,
      timeout_rate_pct: 1.2,
      resilience_band: 'high_congestion',
      mitigations_active: ['slot_limits'],
    },
  ];

  private incidents: LightningResilienceIncident[] = [
    {
      incident_id: 'inc-jam-864190-01',
      incident_type: 'sustained_slot_pressure',
      severity: 'high',
      channel_short_id: '864190x304x2',
      observed_at: '2026-09-04T16:15:00Z',
      duration_seconds: 1800,
      metric_name: 'htlc_slot_utilization_pct',
      threshold_value: 75.0,
      observed_value: 81.7,
      description: 'Pattern consistent with prolonged holds across multiple downstream hops.',
      operator_recommendation: 'Operator review recommended. Consider lowering per-peer in-flight slot quota.',
    },
    {
      incident_id: 'inc-onion-864192-02',
      incident_type: 'onion_queue_pressure',
      severity: 'medium',
      observed_at: '2026-09-04T17:00:00Z',
      duration_seconds: 600,
      metric_name: 'queue_utilization_pct',
      threshold_value: 70.0,
      observed_value: 78.4,
      description: 'Onion message transit queue elevated above normal baseline.',
      operator_recommendation: 'Adaptive rate-limiter engaged. Monitor transit drop rates.',
    },
  ];

  private capabilities: LightningMitigationCapability[] = [
    {
      capability_id: 'htlc_slot_caps',
      name: 'Per-Peer HTLC Slot Quotas',
      category: 'htlc_slots',
      description: 'Limits the maximum number of concurrent unresolved HTLCs any single peer or downstream route can hold.',
      status: 'configured',
      specification_url: 'https://github.com/lightning/bolts/pull/1199',
      lnd_supported: true,
      cln_supported: true,
      eclair_supported: true,
      ldk_supported: true,
    },
    {
      capability_id: 'hold_time_fees',
      name: 'Hold-Time Proportional Routing Fees',
      category: 'fees',
      description: 'Charges an unconditional or hold-duration fee proportional to the time channel liquidity is committed.',
      status: 'observed',
      specification_url: 'https://lists.linuxfoundation.org/pipermail/lightning-dev/2023-May/003940.html',
      lnd_supported: false,
      cln_supported: true,
      eclair_supported: false,
      ldk_supported: true,
    },
    {
      capability_id: 'circuit_breaker',
      name: 'Automated Forwarding Circuit Breaker',
      category: 'circuit_breaker',
      description: 'Temporarily throttles forwarding requests from peers exhibiting elevated timeout or hold duration ratios.',
      status: 'configured',
      specification_url: 'https://github.com/lightninglabs/circuitbreaker',
      lnd_supported: true,
      cln_supported: true,
      eclair_supported: false,
      ldk_supported: false,
    },
    {
      capability_id: 'onion_rate_limiting',
      name: 'Onion Message Token Bucket Rate Limiter',
      category: 'onion_messages',
      description: 'Prevents resource exhaustion from high-frequency onion-message relays by applying token bucket limits.',
      status: 'configured',
      specification_url: 'https://github.com/lightning/bolts/pull/798',
      lnd_supported: true,
      cln_supported: true,
      eclair_supported: true,
      ldk_supported: true,
    },
  ];

  public getOverview(): LightningResilienceOverview {
    return {
      total_channels_monitored: 84,
      healthy_channels_count: 81,
      congested_channels_count: 3,
      active_incidents_count: this.incidents.length,
      average_slot_utilization_pct: 14.2,
      average_held_duration_p95_seconds: 12.8,
      onion_queue: {
        total_queue_depth: 142,
        queue_utilization_pct: 28.4,
        processing_rate_msgs_per_sec: 85,
        dropped_msgs_rate_pct: 0.0,
        rate_limit_active: false,
        status: 'normal',
      },
      recent_incidents: this.incidents,
      top_congested_channels: this.channels,
    };
  }

  public listChannels(): LightningChannelResilience[] {
    return this.channels;
  }

  public getChannel(shortId: string): LightningChannelResilience | undefined {
    return this.channels.find((c) => c.short_channel_id === shortId);
  }

  public getNodeResilience(publicKey: string): any {
    return {
      node_public_key: publicKey,
      total_channels: 14,
      resilience_status: 'healthy',
      mitigation_coverage_pct: 100,
      active_circuit_breaker: true,
      average_held_duration_seconds: 3.4,
      onion_message_support: true,
      ptlc_readiness: 'supported_but_disabled',
      supported_mitigations: this.capabilities.map((c) => c.capability_id),
    };
  }

  public listIncidents(): LightningResilienceIncident[] {
    return this.incidents;
  }

  public listMitigations(): LightningMitigationCapability[] {
    return this.capabilities;
  }

  public getCapabilities(): { capabilities: LightningMitigationCapability[] } {
    return { capabilities: this.capabilities };
  }

  public runSimulator(params: LightningSimulationParams): LightningSimulationResult {
    const slotCount = params.htlc_slot_count || 483;
    const attackerCount = Math.min(params.attacker_htlc_count || 100, slotCount);
    const holdSeconds = params.attacker_hold_seconds || 3600;

    const lockedLiquidity = Math.min(
      params.channel_capacity_sats * 0.8,
      attackerCount * (params.pending_value_limit_sats / slotCount || 20000)
    );

    const baseCost = attackerCount * (params.routing_base_fee_msat / 1000 || 1);
    const holdFeeCost = params.hold_time_fee_per_second_msat
      ? attackerCount * ((params.hold_time_fee_per_second_msat * holdSeconds) / 1000)
      : 0;
    const totalAttackerCost = Math.round(baseCost + holdFeeCost);

    const honestFailureRate = Math.min(95, Math.round((attackerCount / slotCount) * 100));
    const mitigationEffectiveness = params.circuit_breaker_enabled ? 85 : params.hold_time_fee_per_second_msat ? 72 : 24;

    return {
      locked_liquidity_sats: Math.round(lockedLiquidity),
      slot_exhaustion_seconds: Math.round(slotCount / 10),
      cost_to_attacker_sats: totalAttackerCost,
      honest_failure_probability_pct: honestFailureRate,
      routing_revenue_sats: Math.round(totalAttackerCost * 0.9),
      mitigation_effectiveness_pct: mitigationEffectiveness,
      observations: [
        `Under this model, locking ${attackerCount} slots costs the attacker ${totalAttackerCost} sats.`,
        params.circuit_breaker_enabled
          ? 'Circuit breaker triggers after sustained holds, reducing honest traffic failure.'
          : 'Without circuit breakers, honest forwardings experience elevated failure rates.',
      ],
    };
  }
}

export default new LightningResilienceService();
