// Validate the existing wire DTO without inventing absent source bindings.
type Row=Record<string,any>;
const MAX=2100000000000000;
const FLOW_MAX=BigInt(MAX)*300000n;
const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown,max=4096)=>typeof v==='string'&&v.length>0&&v.length<=max;
const decimal=(v:unknown,max:bigint)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,30})$/.test(v)&&BigInt(v)<=max;
const percent=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
const percentString=(v:unknown)=>typeof v==='string'&&v.length<=32&&/^(\d+)(\.\d+)?([eE][+-]?\d+)?$/.test(v)&&percent(Number(v));
const utc=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const list=(v:unknown,max:number):v is Row[]=>Array.isArray(v)&&v.length<=max&&v.every(object);
const check=(v:unknown)=>{if(!v)throw Error('Malformed or mismatched UTXO observation.');};
const stats=(v:Row,n:string)=>integer(v.block_height,0x7fffffff)&&hash(v.block_hash)&&v.network===n&&integer(v.total_utxos)&&integer(v.total_amount_sats,MAX)&&hash(v.muhash)&&decimal(v.bogo_size,BigInt(Number.MAX_SAFE_INTEGER))&&utc(v.observed_at_utc)&&integer(v.block_time,0xffffffff);
const checkpoint=(v:Row,n:string)=>v.network===n&&integer(v.block_height,0x7fffffff)&&hash(v.block_hash);
const scripts=['p2pk','p2pkh','p2sh','p2wpkh','p2wsh','p2tr','other'];
const unique=(rows:Row[],key:string)=>new Set(rows.map(r=>r[key])).size===rows.length;
const groups=(rows:unknown,key:string,max:number)=>list(rows,max)&&unique(rows,key)&&rows.every(r=>text(r[key],128)&&integer(r.utxo_count,100000)&&integer(r.total_sats,MAX)&&percent(r.percent_of_supply));
const flow=(amount:unknown,count:number)=> (integer(amount)||decimal(amount,FLOW_MAX))&&BigInt(amount as number|string)<=BigInt(count)*BigInt(MAX);
const shares=(rows:Row[],amount:string,share:string,total:bigint)=>rows.every(r=>Math.abs(Number(r[share])-(total===0n?0:Number(r[amount])/Number(total)*100))<=1e-9);
export function checkedUtxoEvidence(path:string,value:unknown,network:string):{value:unknown;disclosure:string|null}{
 check(object(value));const v=value as Row;if(v.network!==undefined)check(v.network===network);let bound=false;
 switch(path){
  case '/api/v1/intelligence/utxo/overview':
   check(stats(v,network)&&text(v.scope)&&v.reconciled===false&&typeof v.projection_configured==='boolean'&&v.dormant_10yr_sats===null&&v.uneconomical_at_10_sat_vb_sats===null&&v.last_reconciled_utc===null&&object(v.source)&&text(v.source.method)&&v.source.observed_at_utc===v.observed_at_utc&&v.source.freshness_limit_ms===30000);bound=true;break;
  case '/api/v1/intelligence/utxo/reconciliation':
   check(stats(v,network)&&typeof v.reconciled==='boolean'&&typeof v.projection_available==='boolean'&&text(v.scope)&&v.hash_serialized_2===null&&v.reorg_safe_checkpoint_height===null);
   if(!v.projection_available)check(v.reconciled===false&&v.projection_muhash===null);
   else{check(hash(v.projection_muhash)&&integer(v.projection_total_utxos,100000)&&integer(v.projection_total_amount_sats,MAX)&&integer(v.projection_height,0x7fffffff)&&integer(v.rollback_floor_height,0x7fffffff)&&v.rollback_floor_height<=v.projection_height&&['atomic-checkpoint','process-memory-only'].includes(v.persistence)&&(v.reconciled_at_utc===null||utc(v.reconciled_at_utc)));if(v.reconciled)check(v.projection_height===v.block_height&&v.projection_muhash===v.muhash&&v.projection_total_utxos===v.total_utxos&&v.projection_total_amount_sats===v.total_amount_sats&&utc(v.reconciled_at_utc));}bound=true;break;
  case '/api/v1/intelligence/utxo/cohorts':{
   check(checkpoint(v,network)&&v.reconciled===true&&text(v.scope)&&groups(v.script_types,'script_type',7)&&v.script_types.every((r:Row)=>scripts.includes(r.script_type))&&groups(v.age_cohorts,'age_band',10)&&groups(v.value_cohorts,'value_band',7));
   const partitions=[v.script_types,v.age_cohorts,v.value_cohorts],totals=partitions.map(rows=>({count:rows.reduce((n:number,r:Row)=>n+r.utxo_count,0),sats:rows.reduce((n:number,r:Row)=>n+r.total_sats,0)}));check(totals.every(t=>integer(t.count,100000)&&integer(t.sats,MAX)&&t.count===totals[0].count&&t.sats===totals[0].sats)&&partitions.every(rows=>shares(rows,'total_sats','percent_of_supply',BigInt(totals[0].sats))));bound=true;break;
  }
  case '/api/v1/intelligence/utxo/economic-thresholds':
   check(checkpoint(v,network)&&list(v.thresholds,6)&&v.count===6&&v.thresholds.length===6&&unique(v.thresholds,'feerate_sats_vb')&&v.thresholds.every((r:Row)=>[1,5,10,20,50,100].includes(r.feerate_sats_vb)&&integer(r.uneconomical_utxo_count,100000)&&integer(r.uneconomical_sats,MAX)&&integer(r.unknown_spend_cost_utxo_count,100000)&&percent(r.percent_of_utxos)&&percent(r.percent_of_supply)&&text(r.scope)));bound=true;break;
  case '/api/v1/intelligence/utxo/spend-transitions':
   check(checkpoint(v,network)&&list(v.transitions,288)&&v.count===v.transitions.length&&unique(v.transitions,'height')&&v.transitions.every((r:Row)=>integer(r.height,0x7fffffff)&&r.height<=v.block_height&&hash(r.block_hash)&&(r.height!==v.block_height||r.block_hash===v.block_hash)&&integer(r.created_count,300000)&&integer(r.spent_count,300000)&&r.created_count+r.spent_count<=300000&&flow(r.created_sats,r.created_count)&&flow(r.spent_sats,r.spent_count)&&r.net_utxo_change===r.created_count-r.spent_count&&decimal(r.coin_age_destroyed_sat_seconds,BigInt(r.spent_sats)*0xffffffffn)&&typeof r.coin_days_destroyed==='number'&&Number.isFinite(r.coin_days_destroyed)&&r.coin_days_destroyed>=0&&text(r.scope)));bound=true;break;
  case '/api/v1/utxo-set/checkpoints':
   check(v.network===network&&list(v.checkpoints,288)&&v.checkpoints.length>0&&v.total===v.checkpoints.length&&unique(v.checkpoints,'blockHeight')&&v.checkpoints.every((r:Row)=>r.network===network&&integer(r.blockHeight,0x7fffffff)&&hash(r.blockHash)&&hash(r.muhashHex)&&integer(r.totalTxOuts)&&decimal(r.bogoSize,BigInt(Number.MAX_SAFE_INTEGER))&&decimal(r.totalAmountSats,BigInt(MAX))&&typeof r.verifiedAtTimestamp==='number'&&Number.isFinite(r.verifiedAtTimestamp)&&r.verifiedAtTimestamp>=0));bound=true;break;
  case '/api/v1/utxo-set/distribution':{
   check(v.network===network&&integer(v.blockHeight,0x7fffffff)&&hash(v.blockHash)&&list(v.valueCohorts,7)&&unique(v.valueCohorts,'label')&&v.valueCohorts.every((r:Row)=>text(r.label,128)&&integer(r.txOutCount,100000)&&decimal(r.totalAmountSats,BigInt(MAX))&&percentString(r.supplyPercentage))&&list(v.scriptTypes,7)&&unique(v.scriptTypes,'scriptType')&&v.scriptTypes.every((r:Row)=>scripts.includes(r.scriptType)&&integer(r.count,100000)&&decimal(r.totalAmountSats,BigInt(MAX))&&percentString(r.percentage)));
   const count=v.valueCohorts.reduce((n:number,r:Row)=>n+r.txOutCount,0),total=v.valueCohorts.reduce((n:bigint,r:Row)=>n+BigInt(r.totalAmountSats),0n);check(integer(count,100000)&&count===v.scriptTypes.reduce((n:number,r:Row)=>n+r.count,0)&&total<=BigInt(MAX)&&total===v.scriptTypes.reduce((n:bigint,r:Row)=>n+BigInt(r.totalAmountSats),0n)&&shares(v.valueCohorts,'totalAmountSats','supplyPercentage',total)&&shares(v.scriptTypes,'totalAmountSats','percentage',total));bound=true;break;
  }
  case '/api/v1/utxo-set/protocols':check(['ordinalsBearingCount','runesBearingCount','stampsBearingCount','multiProtocolCount','pureBitcoinCount'].every(k=>integer(v[k])));break;
  case '/api/v1/utreexo/roots':check(integer(v.blockHeight,0x7fffffff)&&integer(v.numLeaves)&&integer(v.forestRows,64)&&Array.isArray(v.roots)&&v.roots.length<=64&&v.roots.every(hash));break;
  default:throw Error('Unsupported UTXO evidence response path.');
 }
 const reference=path.endsWith('/overview')?'checkpoint':path.endsWith('/checkpoints')?`${v.checkpoints?.length} checkpoint records`:path.endsWith('/reconciliation')?`block ${v.block_hash}`:`checkpoint #${v.block_height??v.blockHeight} ${v.block_hash??v.blockHash}`;
 return {value,disclosure:bound?`Reported ${network} ${reference}. An independent operator source profile has not been attested; panels may refer to different checkpoints.`:'This response has no selected-network source binding. It has not been independently matched to the other panels or an operator source profile.'};
}
