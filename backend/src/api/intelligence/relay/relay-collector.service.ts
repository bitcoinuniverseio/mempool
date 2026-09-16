import { createHash, randomUUID } from 'crypto';
import config from '../../../config';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { globalNetworkService } from '../global-network/global-network.service';

export class RelayEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}
export const RELAY_LIMITS = { transactions: 10000, eventsPerTransaction: 16, retentionMs: 24*60*60*1000, eventsPerPoll: 10000, subscribers: 100, sourceFreshMs: 30000 } as const;
type OwnedSnapshot = Awaited<ReturnType<typeof globalNetworkService.getOwnedNodeSnapshot>>;
export interface RelayPollEvent {
  event_id: string; schema_version: 'relay-poll-v1'; network: string; source_id: string; source_sequence: number;
  observed_at_utc: string; clock_offset_ms: null; clock_uncertainty_ms: null; payload_hash: string;
  payload: { txid: string; presence: 'present'|'left_mempool'; previous_complete_poll_utc: string|null; complete_poll: boolean; observation_method: 'backend-mempool-poll' };
}
export interface TransactionRelayLifecycle {
  txid: string; network: string; source_id: string; sensor_count: 1; first_observed_utc: string; last_observed_utc: string;
  first_observed_uncertainty_ms: null; clock_offset_ms: null; observations: RelayPollEvent['payload'][];
  events: RelayPollEvent[]; latency_percentiles: null; spread_delta_ms: null; policy_accepted_ratio: null; bip324_ratio: null;
  scope: string; retention: { events_pruned: number; expires_at_utc: string };
}
const SCOPE = 'One owned backend mempool poll observer. Detection time is not peer arrival time; local-clock accuracy, per-transaction transport, rejection causes and multi-sensor propagation latency are not measured.';
export class RelayCollectorService {
  private static instance: RelayCollectorService;
  private readonly network: string;
  private readonly sourceId: string;
  private readonly now: ()=>number;
  private readonly snapshotReader: (now:number)=>Promise<OwnedSnapshot>;
  private readonly policyReader: ()=>Promise<{fullrbf?:boolean}>;
  private readonly maxTransactions: number;
  private records = new Map<string,TransactionRelayLifecycle>();
  private subscribers = new Set<(event:RelayPollEvent)=>void>();
  private sequence=0;
  private lastCompletePoll:number|null=null;
  private lastPoll:number|null=null;
  private interrupted=false;
  private droppedEvents=0;
  private clockRegressions=0;
  private sourceError:string|null=null;
  private policyCache:{at:number;value:{fullrbf?:boolean};available:boolean}|null=null;
  private policyFlight:Promise<{at:number;value:{fullrbf?:boolean};available:boolean}>|null=null;
  constructor(options:{network?:string;now?:()=>number;snapshotReader?:(now:number)=>Promise<OwnedSnapshot>;policyReader?:()=>Promise<{fullrbf?:boolean}>;maxTransactions?:number}={}){
    this.network=options.network??config.MEMPOOL.NETWORK;this.now=options.now??Date.now;
    this.sourceId='owned-mempool-poller-'+this.network+'-'+(config.MEMPOOL.SPAWN_CLUSTER_PROCS ? process.env.workerId??'primary' : 'single');
    this.snapshotReader=options.snapshotReader??(now=>globalNetworkService.getOwnedNodeSnapshot(now));
    this.policyReader=options.policyReader??(()=>bitcoinClient.getMempoolInfo());
    this.maxTransactions=Math.max(1,Math.min(RELAY_LIMITS.transactions,options.maxTransactions??RELAY_LIMITS.transactions));
  }
  static getInstance():RelayCollectorService{return this.instance??(this.instance=new RelayCollectorService());}
  private prune(now:number):void{
    for(const [id,record] of this.records) if(Date.parse(record.last_observed_utc)<now-RELAY_LIMITS.retentionMs)this.records.delete(id);
    while(this.records.size>this.maxTransactions)this.records.delete(this.records.keys().next().value!);
  }
  /** Feed only the current poll's deltas, never the recentlyDeleted rolling history. */
  public observeMempoolPoll(added:Array<{txid:string}>,removed:Array<{txid:string}>,complete:boolean,now=this.now()):void{
    if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(new Date(now).getTime()))return;
    const backwards=this.lastPoll!==null&&now<this.lastPoll;
    if(backwards){this.interrupted=true;this.clockRegressions++;}
    const previous=!this.interrupted&&!backwards&&this.lastCompletePoll!==null ? new Date(this.lastCompletePoll).toISOString():null;
    let processed=0; const droppedBefore=this.droppedEvents;
    poll: for(const [list,presence] of [[added,'present'],[removed,'left_mempool']] as const){
      for(const tx of list){
        if(processed>=RELAY_LIMITS.eventsPerPoll){this.droppedEvents+=added.length+removed.length-processed;break poll;} processed++;
        if(!tx||!/^[0-9a-fA-F]{64}$/.test(tx.txid)){this.droppedEvents++;continue;}
        const txid=tx.txid.toLowerCase();const existing=this.records.get(txid);
        if(existing?.events[existing.events.length-1]?.payload.presence===presence)continue;
        const at=new Date(now).toISOString();
        const payload:RelayPollEvent['payload']={txid,presence,previous_complete_poll_utc:previous,complete_poll:complete,observation_method:'backend-mempool-poll'};
        const event:RelayPollEvent={event_id:randomUUID(),schema_version:'relay-poll-v1',network:this.network,source_id:this.sourceId,source_sequence:++this.sequence,observed_at_utc:at,clock_offset_ms:null,clock_uncertainty_ms:null,payload_hash:createHash('sha256').update(JSON.stringify(payload)).digest('hex'),payload};
        const record=existing??{txid,network:this.network,source_id:event.source_id,sensor_count:1,first_observed_utc:at,last_observed_utc:at,first_observed_uncertainty_ms:null,clock_offset_ms:null,observations:[],events:[],latency_percentiles:null,spread_delta_ms:null,policy_accepted_ratio:null,bip324_ratio:null,scope:SCOPE,retention:{events_pruned:0,expires_at_utc:''}};
        record.last_observed_utc=at;record.events.push(event);
        if(record.events.length>RELAY_LIMITS.eventsPerTransaction){record.events.shift();record.retention.events_pruned++;}
        record.observations=record.events.map(e=>e.payload);record.retention.expires_at_utc=new Date(now+RELAY_LIMITS.retentionMs).toISOString();
        this.records.delete(txid);this.records.set(txid,record);this.prune(now);
        for(const subscriber of this.subscribers){try{subscriber(JSON.parse(JSON.stringify(event)));}catch{/* One disconnected reader cannot break polling. */}}
      }
    }
    this.lastPoll=now;
    if(complete&&this.droppedEvents===droppedBefore&&added.length+removed.length<=RELAY_LIMITS.eventsPerPoll){this.lastCompletePoll=now;this.interrupted=false;}else this.interrupted=true;
    this.prune(now);
  }
  public markPollFailure():void{this.interrupted=true;}
  public subscribe(handler:(event:RelayPollEvent)=>void):()=>void{
    if(this.subscribers.size>=RELAY_LIMITS.subscribers)throw new RelayEvidenceError('relay-stream-capacity','Relay stream capacity reached.',429);
    this.subscribers.add(handler);return()=>this.subscribers.delete(handler);
  }
  public getPropagationForTx(txid:string):TransactionRelayLifecycle{
    if(typeof txid!=='string'||!/^[0-9a-fA-F]{64}$/.test(txid))throw new RelayEvidenceError('invalid-txid','txid must contain 64 hex characters.',400);
    this.prune(this.now());const record=this.records.get(txid.toLowerCase());
    if(!record)throw new RelayEvidenceError('transaction-not-observed','This observer has no retained mempool detection for that transaction. Unknown transactions are not sampled.',404);
    return JSON.parse(JSON.stringify(record));
  }
  private async snapshot(now=this.now()):Promise<OwnedSnapshot>{
    try{const result=await this.snapshotReader(now);if(result.network!==this.network||!Number.isFinite(result.age_ms)||result.age_ms<0||result.age_ms>RELAY_LIMITS.sourceFreshMs)throw new Error('Network or freshness mismatch');this.sourceError=null;return result;}
    catch{this.sourceError='Owned Core peer/network observation is unavailable, stale or on the wrong network.';throw new RelayEvidenceError('owned-node-unavailable',this.sourceError);}
  }
  private async policy(now=this.now()){
    if(this.policyCache&&now>=this.policyCache.at&&now-this.policyCache.at<RELAY_LIMITS.sourceFreshMs)return this.policyCache;
    if(!this.policyFlight){
      const promise=Promise.resolve().then(()=>this.policyReader()).then(value=>({at:now,value,available:true}),()=>({at:now,value:{},available:false}));
      this.policyFlight=promise;
      void promise.then(value=>{this.policyCache=value;if(this.policyFlight===promise)this.policyFlight=null;});
    }
    let timer:NodeJS.Timeout|undefined;
    try{return await Promise.race([this.policyFlight,new Promise<{at:number;value:{fullrbf?:boolean};available:boolean}>(resolve=>{timer=setTimeout(()=>resolve({at:now,value:{},available:false}),10000);})]);}
    finally{if(timer)clearTimeout(timer);}
  }
  private transport(snapshot:OwnedSnapshot){
    const total=snapshot.peers.length,v2=snapshot.peers.filter(p=>p.transport_protocol_type==='v2').length,v1=snapshot.peers.filter(p=>p.transport_protocol_type==='v1').length;
    return{network:this.network,total_peers:total,bip324_peers:v2,legacy_peers:v1,unknown_transport_peers:total-v2-v1,known_transport_peers:v1+v2,bip324_percent:v1+v2?Math.round(10000*v2/(v1+v2))/100:null,erlay_status:'not_observed',observed_at_utc:snapshot.observed_at_utc,age_ms:snapshot.age_ms,scope:'Connected peers of the owned node only; percentage denominator excludes unknown transport metadata. Per-transaction transport is not observed.'};
  }
  private sensor(snapshot:OwnedSnapshot,policy:{value:{fullrbf?:boolean};available:boolean}){
    return{id:this.sourceId,network:this.network,name:'Owned Bitcoin Core node',region:null,client_version:snapshot.info.subversion,protocol_version:snapshot.info.protocolversion??null,full_rbf:typeof policy.value.fullrbf==='boolean'?policy.value.fullrbf:null,min_relay_feerate:typeof snapshot.info.relayfee==='number'&&Number.isFinite(snapshot.info.relayfee)&&snapshot.info.relayfee>=0?snapshot.info.relayfee*100000:null,clock_offset_ms:null,clock_uncertainty_ms:null,connected_peers_count:snapshot.peers.length,bip324_peers_count:this.transport(snapshot).bip324_peers,erlay_supported:null,status:'online',last_heartbeat:snapshot.observed_at_utc,policy_source_available:policy.available,scope:SCOPE};
  }
  public async getSensors(){const now=this.now();const [snapshot,policy]=await Promise.all([this.snapshot(now),this.policy(now)]);return[this.sensor(snapshot,policy)];}
  public async getTransportMetrics(){return this.transport(await this.snapshot());}
  public async getPolicyDifferences(){const sensors=await this.getSensors();return{network:this.network,differences:[],total:0,comparison_available:false,observed_local_policy:{full_rbf:sensors[0].full_rbf,min_relay_feerate_sats_vb:sensors[0].min_relay_feerate},observed_at_utc:sensors[0].last_heartbeat,scope:'One owned node; multi-sensor policy divergence cannot be calculated.'};}
  public async getOverview(){
    const now=this.now();const [snapshot,policy]=await Promise.all([this.snapshot(now),this.policy(now)]);this.prune(now);
    return{network:this.network,fleet_size:1,online_sensors:1,median_network_latency_ms:null,bip324_adoption_percent:this.transport(snapshot).bip324_percent,erlay_adoption_percent:null,active_policy_divergences_count:null,multisensor_comparison_available:false,recent_propagation_sample:[...this.records.values()].slice(-10).reverse().map(record=>JSON.parse(JSON.stringify(record))),sensors:[this.sensor(snapshot,policy)],transport:this.transport(snapshot),scope:SCOPE,
      collection:{observer_id:this.sourceId,persistence:'process-memory-only',last_poll_utc:this.lastPoll===null?null:new Date(this.lastPoll).toISOString(),last_complete_poll_utc:this.lastCompletePoll===null?null:new Date(this.lastCompletePoll).toISOString(),status:this.lastPoll===null?'not_started':this.interrupted?'interrupted':now-this.lastPoll>RELAY_LIMITS.sourceFreshMs?'stale':'observing',clock_regressions:this.clockRegressions,retained_transactions:this.records.size,dropped_events:this.droppedEvents,limits:RELAY_LIMITS},source:{mempool_backend:config.MEMPOOL.BACKEND,method:'owned Core getpeerinfo/getnetworkinfo and configured backend mempool polls',observed_at_utc:snapshot.observed_at_utc,age_ms:snapshot.age_ms,freshness_limit_ms:RELAY_LIMITS.sourceFreshMs,error:this.sourceError}};
  }
}
export const relayCollectorService=RelayCollectorService.getInstance();
