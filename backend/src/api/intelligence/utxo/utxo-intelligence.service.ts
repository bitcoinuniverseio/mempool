import config from '../../../config';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { UtxoCoin } from './utxo-muhash';
import { UtxoProjection } from './utxo-projection';
import { UtxoStatsCache } from './utxo-source';
import { integer,UTXO_LIMITS,UtxoEvidenceError } from './utxo-evidence';
function scriptType(hex:string):string{if(/^76a914[a-f0-9]{40}88ac$/.test(hex))return 'p2pkh';if(/^a914[a-f0-9]{40}87$/.test(hex))return 'p2sh';if(/^0014[a-f0-9]{40}$/.test(hex))return 'p2wpkh';if(/^0020[a-f0-9]{64}$/.test(hex))return 'p2wsh';if(/^5120[a-f0-9]{64}$/.test(hex))return 'p2tr';if(/^(21(02|03)[a-f0-9]{64}|4104[a-f0-9]{128})ac$/.test(hex))return 'p2pk';return 'other';}
const SCOPE='Owned Core coinstatsindex checkpoint. Cohorts require the complete independently reconciled bounded projection. Output value is not total issued or economically circulating supply.';
export class UtxoIntelligenceService {
 constructor(private readonly stats=new UtxoStatsCache(),private readonly projection?:UtxoProjection){}
 static getInstance(){return utxoIntelligenceService;}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getOverview(){const s=await this.stats.read();return {...s,dormant_10yr_sats:null,uneconomical_at_10_sat_vb_sats:null,last_reconciled_utc:null,reconciled:false,projection_configured:!!this.projection,source:{method:'owned Core gettxoutsetinfo muhash via coinstatsindex',observed_at_utc:s.observed_at_utc,freshness_limit_ms:UTXO_LIMITS.sourceFreshMs},scope:SCOPE};}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getReconciliation(){
  if(!this.projection){const s=await this.stats.read();return {...s,reconciled:false,projection_available:false,projection_muhash:null,hash_serialized_2:null,reorg_safe_checkpoint_height:null,scope:SCOPE};}
  await this.projection.sync();this.stats.invalidate();const s=await this.stats.read(),p=this.projection.getState();
  const same=s.network===p.network&&s.block_hash===p.block_hash&&s.block_height===p.block_height;
  const reconciled=same&&s.total_utxos===p.total_utxos&&s.total_amount_sats===p.total_amount_sats&&s.muhash===p.muhash;
  return {...s,reconciled,projection_available:true,projection_muhash:p.muhash,projection_total_utxos:p.total_utxos,projection_total_amount_sats:p.total_amount_sats,projection_height:p.block_height,hash_serialized_2:null,rollback_floor_height:p.rollback_floor_height,persistence:p.persistence,reorg_safe_checkpoint_height:null,reconciled_at_utc:reconciled?new Date().toISOString():null,scope:'Independent full projected outpoint set MuHash, count and exact value compared with Core at the identical canonical block. No finality is implied.'};
 }
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 private async reconciledCoins(){if(!this.projection)throw new UtxoEvidenceError('utxo-projection-unavailable','Complete owned UTXO cohort projection is not configured.');const r=await this.getReconciliation();if(!r.reconciled)throw new UtxoEvidenceError('utxo-reconciliation-failed','Projected UTXO set does not match the owned Core checkpoint.');const state=this.projection.getState();if(state.block_hash!==r.block_hash||state.muhash!==r.muhash)throw new UtxoEvidenceError('utxo-chain-changed','Projection changed after reconciliation.');return {coins:this.projection.getCoins(),report:r,transitions:this.projection.getTransitions(UTXO_LIMITS.history)};}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getCohorts(){const {coins,report}=await this.reconciledCoins();
  const groups=<Field extends string>(key:(c:UtxoCoin)=>string,field:Field)=>{const groups=new Map<string,{utxo_count:number;total_sats:number}>();for(const c of coins){const k=key(c),g=groups.get(k)??{utxo_count:0,total_sats:0};g.utxo_count++;g.total_sats+=c.value;groups.set(k,g);}return [...groups].map(([k,g])=>({[field]:k,...g,percent_of_supply:report.total_amount_sats?g.total_sats/report.total_amount_sats*100:0} as Record<Field,string> & {utxo_count:number;total_sats:number;percent_of_supply:number}));};
  const days=(c:UtxoCoin)=>Math.max(0,report.block_time-c.time)/86400;
  return {script_types:groups(c=>scriptType(c.script),'script_type'),age_cohorts:groups(c=>{const d=days(c);return d<1?'<1 day':d<7?'1-7 days':d<30?'7-30 days':d<90?'30-90 days':d<180?'90-180 days':d<365?'180-365 days':d<730?'1-2 years':d<1825?'2-5 years':d<3650?'5-10 years':'>=10 years';},'age_band'),value_cohorts:groups(c=>c.value<10000?'<10k sats':c.value<100000?'10k-100k sats':c.value<1000000?'100k-1M sats':c.value<10000000?'1M-10M sats':c.value<100000000?'10M-100M sats':c.value<1000000000?'100M-1B sats':'>=1B sats','value_band'),block_height:report.block_height,block_hash:report.block_hash,reconciled:true,scope:'Each partition contains every projected UTXO exactly once; age uses non-negative creation-to-checkpoint block timestamp differences. Percentages describe this UTXO value, not issued supply.'};
 }
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getEconomicThresholds(){const {coins,report}=await this.reconciledCoins();const sizes:Record<string,number>={p2pk:114,p2pkh:148,p2wpkh:68,p2tr:58};const known=coins.filter(c=>sizes[scriptType(c.script)]!==undefined);return [1,5,10,20,50,100].map(rate=>{const uneconomical=known.filter(c=>c.value<=rate*sizes[scriptType(c.script)]),sats=uneconomical.reduce((s,c)=>s+c.value,0);return {feerate_sats_vb:rate,uneconomical_utxo_count:uneconomical.length,uneconomical_sats:sats,percent_of_utxos:coins.length?uneconomical.length/coins.length*100:0,percent_of_supply:report.total_amount_sats?sats/report.total_amount_sats*100:0,unknown_spend_cost_utxo_count:coins.length-known.length,scope:'Input-only spend-size assumptions: P2PK114, P2PKH148, P2WPKH68, Taproot key path58 vB. Hidden scripts/other outputs unknown. Excludes output/transaction overhead; not a consensus dust or unspendability claim.'};});}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 public async getSpendTransitions(limit=10){integer(limit,UTXO_LIMITS.history);if(limit<1)throw new UtxoEvidenceError('invalid-utxo-limit','Transition limit must be1–288.',400);const result=await this.reconciledCoins();return result.transitions.slice(0,limit);}
 public rollbackToHeight(target:number){if(!this.projection)throw new UtxoEvidenceError('utxo-projection-unavailable','No owned UTXO projection is configured.');this.stats.invalidate();return this.projection.rollbackToHeight(target);}
}
const path=process.env.UNIVERSE_UTXO_PROJECTION_PATH;
// Explicit file configuration starts bounded projection on demand; no background indexer is launched.
const workerId=process.env.workerId;
const activeRole=!config.MEMPOOL.SPAWN_CLUSTER_PROCS || !!workerId && /^\d+$/.test(workerId);
const projection=path&&activeRole?new UtxoProjection(config.MEMPOOL.NETWORK,bitcoinClient,path+(config.MEMPOOL.SPAWN_CLUSTER_PROCS?'.worker-'+workerId:'')):undefined;
export const utxoIntelligenceService=new UtxoIntelligenceService(new UtxoStatsCache(),projection);
