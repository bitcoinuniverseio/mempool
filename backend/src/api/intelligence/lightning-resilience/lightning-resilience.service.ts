import config from '../../../config';
import { LightningSimulationParams } from './lightning-resilience.models';
import { readOwnedLnd,LightningObservation } from './lightning-source';
import { LIGHTNING_LIMITS,LIGHTNING_SCOPE,LightningEvidenceError } from './lightning-evidence';
import { simulateHtlcs } from './lightning-simulation';
const MAX_SATS=2100000000000000;
const pub=(v:any)=>typeof v==='string'&&/^(02|03)[a-fA-F0-9]{64}$/.test(v);
function integer(v:any,max=MAX_SATS):number{
 if(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v))v=Number(v);
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw new LightningEvidenceError('invalid-lightning-source','Owned Lightning source contains invalid numeric data.');return v;
}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export class LightningResilienceService {
 private cache:{at:number;observation:LightningObservation;channels:any[]}|null=null;
 private flight:Promise<NonNullable<LightningResilienceService['cache']>>|null=null;
 constructor(private readonly options:{reader?:()=>Promise<LightningObservation>;now?:()=>number;network?:string}={}){}
 private async snapshot(){
  const now=(this.options.now??Date.now)();
  if(this.cache&&now>=this.cache.at&&now-this.cache.at<LIGHTNING_LIMITS.freshMs)return clone(this.cache);
  if(!this.flight){
   const work=Promise.resolve().then(()=> (this.options.reader??readOwnedLnd)()).then(observation=>{
    const at=Date.parse(observation.observed_at_utc),received=(this.options.now??Date.now)();
    if(observation.network!==(this.options.network??config.MEMPOOL.NETWORK)||!Number.isFinite(at)||at>received||received-at>LIGHTNING_LIMITS.freshMs||!pub(observation.identity_pubkey)||!Array.isArray(observation.channels)||observation.channels.length>LIGHTNING_LIMITS.channels)throw new LightningEvidenceError('invalid-lightning-source','Owned Lightning source identity, network, freshness or bounds are invalid.');
    const ids=new Set<string>();
    const channels=observation.channels.map(raw=>{
     if(!raw||typeof raw.chan_id!=='string'||!/^\d{1,20}$/.test(raw.chan_id)||BigInt(raw.chan_id)>0xffffffffffffffffn||!pub(raw.remote_pubkey)||typeof raw.channel_point!=='string'||!/^([a-fA-F0-9]{64}):[0-9]{1,10}$/.test(raw.channel_point)||!Array.isArray(raw.pending_htlcs)||raw.pending_htlcs.length>LIGHTNING_LIMITS.htlcsPerChannel)throw new LightningEvidenceError('invalid-lightning-source','Invalid owned channel shape.');
     const id=BigInt(raw.chan_id);const shortId=`${id>>40n}x${(id>>16n)&0xffffffn}x${id&0xffffn}`;
     if(ids.has(shortId))throw new LightningEvidenceError('invalid-lightning-source','Duplicate owned channel.');ids.add(shortId);
     const capacity=integer(raw.capacity),local=integer(raw.local_balance),remote=integer(raw.remote_balance);
     if(local+remote>capacity)throw new LightningEvidenceError('invalid-lightning-source','Owned channel balances exceed capacity.');
     const directional=(incoming:boolean,constraints:any)=>{
      const items=raw.pending_htlcs.filter(h=>{if(!h||typeof h.incoming!=='boolean')throw new LightningEvidenceError('invalid-lightning-source','Invalid HTLC direction.');return h.incoming===incoming;});
      const value=items.reduce((sum,h)=>sum+integer(h.amount),0);if(!Number.isSafeInteger(value)||value>capacity)throw new LightningEvidenceError('invalid-lightning-source','Invalid aggregate HTLC value.');
      const slots=constraints?.max_accepted_htlcs===undefined?null:integer(constraints.max_accepted_htlcs,483);
      const limit=constraints?.max_pending_amt_msat===undefined?null:integer(constraints.max_pending_amt_msat,Number.MAX_SAFE_INTEGER)/1000;
      return {slots_in_use:items.length,slot_capacity:slots,slot_utilization_pct:slots?items.length/slots*100:null,pending_value_sats:value,pending_value_limit_sats:limit,pending_value_utilization_pct:limit?value/limit*100:null};
     };
     const incoming=directional(true,raw.local_constraints),outgoing=directional(false,raw.remote_constraints);
     const slots=incoming.slot_capacity!==null&&outgoing.slot_capacity!==null?incoming.slot_capacity+outgoing.slot_capacity:null;
     const value=incoming.pending_value_sats+outgoing.pending_value_sats;
     if(value>capacity)throw new LightningEvidenceError('invalid-lightning-source','Aggregate unresolved HTLC value exceeds channel capacity.');
     return {short_channel_id:shortId,channel_point:raw.channel_point,node1_pubkey:observation.identity_pubkey,node2_pubkey:raw.remote_pubkey,capacity_sats:capacity,local_balance_sats:local,remote_balance_sats:remote,
      htlc_slot_capacity:slots,htlc_slots_in_use:raw.pending_htlcs.length,htlc_slot_utilization_pct:slots?raw.pending_htlcs.length/slots*100:null,pending_htlc_value_sats:value,pending_value_utilization_pct:null,incoming,outgoing,
      held_duration_p50_seconds:null,held_duration_p95_seconds:null,held_duration_p99_seconds:null,liquidity_time_product_sat_hours:null,failure_rate_pct:null,timeout_rate_pct:null,resilience_band:'unknown',mitigations_active:[],observed_at_utc:observation.observed_at_utc,network:observation.network,scope:LIGHTNING_SCOPE};
    });
    return this.cache={at,observation:{...observation,channels:[]},channels};
   });
   this.flight=work;work.finally(()=>{if(this.flight===work)this.flight=null;}).catch(()=>undefined);
  }
  let timer:NodeJS.Timeout|undefined;
  try{return clone(await Promise.race([this.flight,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new LightningEvidenceError('lightning-source-timeout','Owned Lightning telemetry timed out.')),LIGHTNING_LIMITS.timeoutMs);})]));}finally{if(timer)clearTimeout(timer);}
 }
 public async getOverview(){
  let snapshot:Awaited<ReturnType<LightningResilienceService['snapshot']>>|null=null;let sourceError:string|null=null;
  try{snapshot=await this.snapshot();}catch(e){sourceError=e instanceof LightningEvidenceError?e.code:'lightning-source-unavailable';}
  const channels=snapshot?.channels??[];const known=channels.filter(c=>c.htlc_slot_capacity!==null);const slotTotal=known.reduce((s,c)=>s+c.htlc_slot_capacity,0);
  return {network:this.options.network??config.MEMPOOL.NETWORK,total_channels_monitored:snapshot?channels.length:null,healthy_channels_count:null,congested_channels_count:null,active_incidents_count:null,average_slot_utilization_pct:slotTotal?known.reduce((s,c)=>s+c.htlc_slots_in_use,0)/slotTotal*100:null,average_held_duration_p95_seconds:null,
   onion_queue:{total_queue_depth:null,queue_utilization_pct:null,processing_rate_msgs_per_sec:null,dropped_msgs_rate_pct:null,rate_limit_active:null,status:'unknown'},recent_incidents:[],top_congested_channels:channels.filter(c=>c.htlc_slot_utilization_pct!==null).sort((a,b)=>b.htlc_slot_utilization_pct-a.htlc_slot_utilization_pct).slice(0,10),scope:LIGHTNING_SCOPE,
   source:{status:snapshot?'observed':'unavailable',method:'owned LND getinfo/ListChannels',observed_at_utc:snapshot?.observation.observed_at_utc??null,age_ms:snapshot?(this.options.now??Date.now)()-snapshot.at:null,freshness_limit_ms:LIGHTNING_LIMITS.freshMs,error:sourceError,hold_history_available:false,incident_detection_available:false}};
 }
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async listChannels(){return (await this.snapshot()).channels;}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getChannel(shortId:string){if(!/^\d{1,8}x\d{1,8}x\d{1,5}$/.test(shortId))throw new LightningEvidenceError('invalid-channel-id','Invalid short channel id.',400);const channel=(await this.listChannels()).find(c=>c.short_channel_id===shortId);if(!channel)throw new LightningEvidenceError('channel-not-observed','Channel is not in the current owned observation.',404);return channel;}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getNodeResilience(publicKey:string){if(!pub(publicKey))throw new LightningEvidenceError('invalid-node-key','Expected compressed node public key.',400);const snapshot=await this.snapshot();const channels=snapshot.channels.filter(c=>c.node1_pubkey===publicKey||c.node2_pubkey===publicKey);if(publicKey!==snapshot.observation.identity_pubkey&&!channels.length)throw new LightningEvidenceError('node-not-observed','Node is not in the current owned observation.',404);return {node_public_key:publicKey,total_channels:channels.length,resilience_status:'unknown',mitigation_coverage_pct:null,active_circuit_breaker:null,average_held_duration_seconds:null,onion_message_support:null,ptlc_readiness:'unknown',supported_mitigations:[],scope:LIGHTNING_SCOPE,observed_at_utc:snapshot.observation.observed_at_utc};}
 public listIncidents(){return [];}
 public listMitigations(){return [
  ['htlc_slot_caps','Negotiated directional HTLC slot limits','htlc_slots','https://github.com/lightning/bolts/blob/master/02-peer-protocol.md'],
  ['hold_time_fees','Hypothetical hold-time fees','fees','https://github.com/lightning/bolts'],
  ['circuit_breaker','Forwarding circuit breaker','circuit_breaker','https://github.com/lightninglabs/circuitbreaker'],
  ['onion_rate_limiting','Onion message rate limiting','onion_messages','https://github.com/lightning/bolts/blob/master/04-onion-routing.md']
 ].map(([capability_id,name,category,specification_url])=>({capability_id,name,category,specification_url,status:'unknown',description:'Reference concept; deployment and negotiated behavior have not been observed.',lnd_supported:null,cln_supported:null,eclair_supported:null,ldk_supported:null}));}
 public getCapabilities(){return {capabilities:this.listMitigations(),scope:'Reference concepts only; no implementation deployment claims.'};}
 public runSimulator(params:LightningSimulationParams){return simulateHtlcs(params);}
}
export default new LightningResilienceService();
