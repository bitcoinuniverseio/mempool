import config from '../../../config';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { GENESIS,btcToSats,integer,UTXO_LIMITS,UtxoEvidenceError } from './utxo-evidence';
export interface UtxoStats {network:string;block_height:number;block_hash:string;total_utxos:number;total_amount_sats:number;muhash:string;bogo_size:string;observed_at_utc:string;block_time:number;}
export interface UtxoStatsReader {read():Promise<UtxoStats>;}
export class OwnedUtxoStats implements UtxoStatsReader {
 constructor(private readonly client:any=bitcoinClient,private readonly network=config.MEMPOOL.NETWORK){}
 async read():Promise<UtxoStats>{
  if(await this.client.getBlockHash(0)!==GENESIS[this.network])throw new UtxoEvidenceError('utxo-network-mismatch','Owned UTXO node genesis does not match this backend.');
  const indexes=await this.client.getIndexInfo('coinstatsindex');if(indexes?.coinstatsindex?.synced!==true)throw new UtxoEvidenceError('utxo-coinstatsindex-unavailable','A synced owned coinstatsindex is required; full UTXO scans are not started by these routes.');
  const tip=await this.client.getBestBlockHash(),stats=await this.client.getTxOutSetInfo('muhash',tip,true);
  if(stats.bestblock!==tip||typeof stats.muhash!=='string'||!/^[0-9a-f]{64}$/.test(stats.muhash))throw new UtxoEvidenceError('invalid-utxo-source','Owned UTXO commitment is invalid.');
  const height=integer(stats.height,0x7fffffff);if(await this.client.getBlockHash(height)!==tip)throw new UtxoEvidenceError('utxo-chain-changed','Owned canonical chain changed during checkpoint read.');
  const header=await this.client.getBlockHeader(tip);return {network:this.network,block_height:height,block_hash:tip,total_utxos:integer(stats.txouts),total_amount_sats:btcToSats(stats.total_amount),muhash:stats.muhash,bogo_size:String(integer(stats.bogosize)),observed_at_utc:new Date().toISOString(),block_time:integer(header.time,0xffffffff)};
 }
}
/** A fresh checkpoint is shared by all legacy and intelligence UTXO routes. */
export class UtxoStatsCache {
 private cached:UtxoStats|null=null;private flight:Promise<UtxoStats>|null=null;
 constructor(private reader:UtxoStatsReader=new OwnedUtxoStats(),private now:()=>number=Date.now){}
 async read():Promise<UtxoStats>{
  if(this.cached&&this.now()>=Date.parse(this.cached.observed_at_utc)&&this.now()-Date.parse(this.cached.observed_at_utc)<UTXO_LIMITS.sourceFreshMs)return {...this.cached};
  if(!this.flight){const work=this.reader.read().then(s=>{const age=this.now()-Date.parse(s.observed_at_utc);if(!Number.isFinite(age)||age<0||age>UTXO_LIMITS.sourceFreshMs)throw new UtxoEvidenceError('utxo-source-stale','UTXO checkpoint source is stale.');return this.cached=s;});this.flight=work;void work.finally(()=>{if(this.flight===work)this.flight=null;}).catch(()=>undefined);}
  let timer:NodeJS.Timeout|undefined;try{return {...await Promise.race([this.flight,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new UtxoEvidenceError('utxo-source-timeout','Owned UTXO checkpoint timed out.')),10000);})])};}finally{if(timer)clearTimeout(timer);}
 }
 invalidate(){this.cached=null;}
}
