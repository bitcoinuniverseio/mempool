import { LightningSimulationParams } from './lightning-resilience.models';
import { LightningEvidenceError } from './lightning-evidence';
const MAX_SATS=2100000000000000;
function number(p:any,key:string,max:number,required=true):number|undefined{
 const v=p[key];if(v===undefined&&!required)return undefined;
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw new LightningEvidenceError('invalid-simulation',key+' must be a bounded non-negative safe integer.',400);return v;
}
/** Deterministic single-direction, simultaneous offer model. No stochastic success claims. */
export function simulateHtlcs(p:LightningSimulationParams){
 if(!p||typeof p!=='object'||Array.isArray(p))throw new LightningEvidenceError('invalid-simulation','Expected simulation parameters.',400);
 const capacity=number(p,'channel_capacity_sats',MAX_SATS)!;
 const slots=number(p,'htlc_slot_count',483)!;
 const pending=number(p,'pending_value_limit_sats',MAX_SATS)!;
 const count=number(p,'attacker_htlc_count',1000000)!;
 const hold=number(p,'attacker_hold_seconds',31536000)!;
 number(p,'honest_traffic_rate_per_min',1000000);number(p,'routing_base_fee_msat',1000000000);number(p,'routing_fee_proportional_millionths',1000000000);
 const amount=number(p,'attacker_htlc_value_sats',MAX_SATS,false);
 const upfront=number(p,'upfront_fee_msat',1000000000,false)??0;
 const holdRate=number(p,'hold_time_fee_per_second_msat',1000000000,false)??0;
 const quota=number(p,'circuit_breaker_slot_quota',483,false);
 if(typeof p.circuit_breaker_enabled!=='boolean'||(quota!==undefined&&!p.circuit_breaker_enabled))throw new LightningEvidenceError('invalid-simulation','Circuit breaker settings are inconsistent.',400);
 if(pending>capacity)throw new LightningEvidenceError('invalid-simulation','Pending value limit exceeds channel capacity.',400);
 if(amount===0&&count>0)throw new LightningEvidenceError('invalid-simulation','Per-HTLC value must be positive for nonzero offers.',400);
 const unconstrained=Math.min(count,slots);
 const slotBound=Math.min(unconstrained,p.circuit_breaker_enabled&&quota!==undefined?quota:slots);
 const accepted=count===0||hold===0?0:amount===undefined?null:Math.min(slotBound,Math.floor(pending/amount));
 const feeMsat=accepted===null?null:BigInt(accepted)*(BigInt(upfront)+BigInt(holdRate)*BigInt(hold));
 if(feeMsat!==null&&feeMsat>BigInt(Number.MAX_SAFE_INTEGER))throw new LightningEvidenceError('simulation-overflow','Hypothetical fee exceeds exact numeric range.',400);
 return {model:'single-direction-simultaneous-htlc-offers-v1',calibrated:false,scope:'User-supplied counterfactual; no payment is sent. No observed attacker intent or routing outcome is inferred.',
  accepted_htlc_count:accepted,accepted_htlc_count_upper_bound:hold===0?0:slotBound,remaining_slots:accepted===null?null:slots-accepted,
  locked_liquidity_sats:accepted===null?null:accepted*(amount??0),locked_liquidity_upper_bound_sats:hold===0||slotBound===0?0:pending,
  liquidity_time_product_sat_hours:accepted===null?null:accepted*(amount??0)*hold/3600,
  slot_exhaustion_seconds:accepted!==null&&slots>0&&accepted===slots?0:null,
  cost_to_attacker_sats:null,hypothetical_unconditional_fee_sats:feeMsat===null?null:Number(feeMsat)/1000,
  honest_failure_probability_pct:null,routing_revenue_sats:null,mitigation_effectiveness_pct:null,
  observations:[
   'All offers are simultaneous, start in an otherwise empty direction, and remain unresolved for the supplied hold duration. Zero hold means zero concurrent occupancy.',
   'Exact occupancy and liquidity require attacker_htlc_value_sats. Negotiated slot limits may be below the protocol maximum; select the actual directional limit.',
   'Circuit breaker quota is enforced immediately only when its explicit slot quota is supplied. The enabled flag alone does not establish effectiveness.',
   'Hypothetical unconditional fees equal accepted count × (upfront fee + hold-rate × seconds); supplied fee proposals are not evidence of deployed fees.',
   'Ordinary routing fees and honest traffic arrival rate do not establish realized revenue, attack cost or failure probability without settlement and traffic-duration data.'
  ]};
}
