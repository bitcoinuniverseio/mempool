export type CapabilityStatus =
  | 'configured'
  | 'negotiated'
  | 'observed'
  | 'supported_but_disabled'
  | 'unsupported'
  | 'unknown'
  | 'proposal_only';

export type IncidentType =
  | 'sustained_slot_pressure'
  | 'sustained_liquidity_lock'
  | 'abnormal_hold_duration'
  | 'timeout_cluster'
  | 'failure_spike'
  | 'onion_queue_pressure'
  | 'peer_concentration'
  | 'circuit_breaker_trigger'
  | 'mitigation_state_change'
  | 'source_gap';

export interface LightningChannelResilience {
  short_channel_id: string;
  channel_point: string;
  node1_pubkey: string;
  node2_pubkey: string;
  capacity_sats: number;
  local_balance_sats: number;
  remote_balance_sats: number;
  htlc_slot_capacity: number;
  htlc_slots_in_use: number;
  htlc_slot_utilization_pct: number;
  pending_htlc_value_sats: number;
  pending_value_utilization_pct: number;
  held_duration_p50_seconds: number;
  held_duration_p95_seconds: number;
  held_duration_p99_seconds: number;
  liquidity_time_product_sat_hours: number;
  failure_rate_pct: number;
  timeout_rate_pct: number;
  resilience_band: 'healthy' | 'moderate_pressure' | 'high_congestion' | 'critical';
  mitigations_active: string[];
}

export interface LightningResilienceIncident {
  incident_id: string;
  incident_type: IncidentType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channel_short_id?: string;
  affected_node_pubkey?: string;
  observed_at: string;
  duration_seconds: number;
  metric_name: string;
  threshold_value: number;
  observed_value: number;
  description: string;
  operator_recommendation: string;
}

export interface LightningMitigationCapability {
  capability_id: string;
  name: string;
  category: 'htlc_slots' | 'liquidity_bounds' | 'fees' | 'onion_messages' | 'circuit_breaker';
  description: string;
  status: CapabilityStatus;
  specification_url: string;
  lnd_supported: boolean;
  cln_supported: boolean;
  eclair_supported: boolean;
  ldk_supported: boolean;
}

export interface LightningOnionQueueMetrics {
  total_queue_depth: number;
  queue_utilization_pct: number;
  processing_rate_msgs_per_sec: number;
  dropped_msgs_rate_pct: number;
  rate_limit_active: boolean;
  status: 'normal' | 'congested' | 'rate_limited';
}

export interface LightningSimulationParams {
  channel_capacity_sats: number;
  htlc_slot_count: number;
  pending_value_limit_sats: number;
  attacker_htlc_count: number;
  attacker_hold_seconds: number;
  honest_traffic_rate_per_min: number;
  routing_base_fee_msat: number;
  routing_fee_proportional_millionths: number;
  upfront_fee_msat?: number;
  hold_time_fee_per_second_msat?: number;
  circuit_breaker_enabled: boolean;
}

export interface LightningSimulationResult {
  locked_liquidity_sats: number;
  slot_exhaustion_seconds: number;
  cost_to_attacker_sats: number;
  honest_failure_probability_pct: number;
  routing_revenue_sats: number;
  mitigation_effectiveness_pct: number;
  observations: string[];
}

export interface LightningResilienceOverview {
  total_channels_monitored: number;
  healthy_channels_count: number;
  congested_channels_count: number;
  active_incidents_count: number;
  average_slot_utilization_pct: number;
  average_held_duration_p95_seconds: number;
  onion_queue: LightningOnionQueueMetrics;
  recent_incidents: LightningResilienceIncident[];
  top_congested_channels: LightningChannelResilience[];
}
