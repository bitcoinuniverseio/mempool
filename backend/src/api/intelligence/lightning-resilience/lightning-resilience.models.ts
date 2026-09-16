import type { LightningResilienceService } from './lightning-resilience.service';
import type { simulateHtlcs } from './lightning-simulation';
export type CapabilityStatus='configured'|'negotiated'|'observed'|'supported_but_disabled'|'unsupported'|'unknown'|'proposal_only';
export interface LightningSimulationParams {
 channel_capacity_sats:number; htlc_slot_count:number; pending_value_limit_sats:number;
 attacker_htlc_count:number; attacker_hold_seconds:number; honest_traffic_rate_per_min:number;
 routing_base_fee_msat:number; routing_fee_proportional_millionths:number;
 upfront_fee_msat?:number; hold_time_fee_per_second_msat?:number;
 circuit_breaker_enabled:boolean; attacker_htlc_value_sats?:number; circuit_breaker_slot_quota?:number;
}
export type LightningSimulationResult=ReturnType<typeof simulateHtlcs>;
export type LightningResilienceOverview=Awaited<ReturnType<LightningResilienceService['getOverview']>>;
export type LightningChannelResilience=Awaited<ReturnType<LightningResilienceService['listChannels']>>[number];
export type LightningMitigationCapability=ReturnType<LightningResilienceService['listMitigations']>[number];
export type LightningOnionQueueMetrics=LightningResilienceOverview['onion_queue'];
