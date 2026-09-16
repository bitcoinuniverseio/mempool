import axios from 'axios';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { decodeBasicFilter } from './bip158';
import { CompactFiltersEvidenceError as EvidenceError } from './compact-filters.service';
export interface FilterReader { call(method:string,params:unknown[]):Promise<any>; }
export const GENESIS:Record<string,string>={main:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',test:'000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',testnet4:'00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',signet:'00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',regtest:'0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'};
export const ownedFilterReader:FilterReader={async call(method,params){const origin=process.env.UNIVERSE_FILTER_RPC_ORIGIN;if(!origin)throw new EvidenceError('unavailable-filter-index','An owned Core RPC source with blockfilterindex=1 is not configured. getblockfilter returns both filter and header.');try{const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search)throw Error('Invalid source');const cookie=process.env.UNIVERSE_FILTER_RPC_COOKIE_FILE;const auth=cookie?readFileSync(cookie,'utf8').trim():`${process.env.UNIVERSE_FILTER_RPC_USER||''}:${process.env.UNIVERSE_FILTER_RPC_PASSWORD||''}`;const response=await axios.post(url.toString(),{jsonrpc:'1.0',id:'compact-filter-reader',method,params},{headers:{Authorization:'Basic '+Buffer.from(auth).toString('base64')},timeout:3000,maxContentLength:2100000,maxBodyLength:1000,maxRedirects:0,proxy:false});if(response.data?.error||!Object.prototype.hasOwnProperty.call(response.data||{},'result'))throw Error('RPC failed');return response.data.result;}catch{throw new EvidenceError('unavailable-filter-index','The owned Core filter index could not return the requested public evidence.');}}};
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const sha256d=(b:Buffer)=>createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
export function filterCommitments(filter:string,previous:string){if(!hash(previous))throw Error('Malformed previous filter header');const values=decodeBasicFilter(filter);const digest=sha256d(Buffer.from(filter,'hex'));return {element_count:values.length,filter_hash:Buffer.from(digest).reverse().toString('hex'),filter_header:sha256d(Buffer.concat([digest,Buffer.from(previous,'hex').reverse()])).reverse().toString('hex')};}
let active=0;
export class CoreFilterSource {
 constructor(private reader:FilterReader=ownedFilterReader){}
 private async session<T>(network:string,action:(read:FilterReader['call'],tip:any)=>Promise<T>):Promise<T>{
  if(!Object.prototype.hasOwnProperty.call(GENESIS,network))throw new EvidenceError('invalid-network','Unsupported Bitcoin network.',400);
  if(active>=2)throw new EvidenceError('filter-source-busy','The bounded filter reader is busy.');active++;
  const deadline=Date.now()+15000;
  const read:FilterReader['call']=async(method,params)=>{
   if(Date.now()>=deadline)throw new EvidenceError('filter-source-timeout','Filter retrieval exceeded its budget. Request a smaller range.');
   // Await actual transport completion; caller timeout must not release this slot.
   return this.reader.call(method,params);
  };
  const observation=(async()=>{
   const before=await read('getblockchaininfo',[]);const genesis=await read('getblockhash',[0]);const index=await read('getindexinfo',['basic block filter index']);
   if(before.chain!==network||genesis!==GENESIS[network]||!hash(before.bestblockhash)||!Number.isSafeInteger(before.blocks)||before.blocks<0||before.initialblockdownload!==false)throw new EvidenceError('invalid-filter-checkpoint','Owned source network, genesis or sync state does not match the request.');
   if(index?.['basic block filter index']?.synced!==true||!Number.isSafeInteger(index['basic block filter index'].best_block_height)||index['basic block filter index'].best_block_height<before.blocks)throw new EvidenceError('unavailable-filter-index','The owned basic block filter index is absent or has not reached the current tip.');
   const result=await action(read,before);const after=await read('getblockchaininfo',[]);if(after.chain!==network||after.blocks!==before.blocks||after.bestblockhash!==before.bestblockhash||after.initialblockdownload!==false)throw new EvidenceError('filter-source-reorg','Owned tip changed during filter retrieval. Retry.',409);return result;
  })().finally(()=>{active--;});
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([observation,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new EvidenceError('filter-source-timeout','Filter retrieval exceeded its budget.')),Math.max(0,deadline-Date.now()));})]);}
  finally{clearTimeout(timer!);}
 }
 private async block(read:FilterReader['call'],tip:any,ref:string){
  let blockHash:string;if(/^(0|[1-9][0-9]{0,9})$/.test(ref)){const height=Number(ref);if(height>tip.blocks)throw new EvidenceError('invalid-filter-height','Requested height exceeds the owned tip.',400);blockHash=await read('getblockhash',[height]);}else if(hash(ref))blockHash=ref;else throw new EvidenceError('invalid-block-reference','Provide a block hash or canonical nonnegative height.',400);
  const header=await read('getblockheader',[blockHash,true]);const raw=await read('getblockheader',[blockHash,false]);
  if(typeof raw!=='string'||!/^[0-9a-f]{160}$/.test(raw)||sha256d(Buffer.from(raw,'hex')).reverse().toString('hex')!==blockHash||header.hash!==blockHash||!Number.isSafeInteger(header.height)||header.height<0||header.height>tip.blocks||await read('getblockhash',[header.height])!==blockHash)throw new EvidenceError('invalid-block-binding','Block header bytes, active-chain height and hash do not match.',409);
  const previous=header.height===0?'00'.repeat(32):Buffer.from(raw,'hex').subarray(4,36).reverse().toString('hex');
  if(header.height>0&&await read('getblockhash',[header.height-1])!==previous)throw new EvidenceError('filter-source-reorg','Previous block is not on the active chain.',409);
  const previousHeader=header.height===0?'00'.repeat(32):(await read('getblockfilter',[previous,'basic'])).header;
  const result=await read('getblockfilter',[blockHash,'basic']);let computed:ReturnType<typeof filterCommitments>;
  try{computed=filterCommitments(result.filter,previousHeader);}catch{throw new EvidenceError('invalid-filter-encoding','Core returned malformed or noncanonical BIP158 filter data.');}
  if(computed.filter_header!==result.header)throw new EvidenceError('invalid-filter-header','Filter hash does not link to the supplied previous filter header.');
  return{block_hash:blockHash,block_height:header.height,filter_type:'basic_0x00' as const,filter_bytes_hex:result.filter,filter_size_bytes:result.filter.length/2,...computed,prev_filter_header:previousHeader,is_verified_link:true,network:tip.chain,source:'owned-core-basic-filter-index',false_positive_rate:1/784931,includes_spent_prevouts:true,includes_outputs:true,excludes_op_return:true,content_recomputed:false,peer_agreement:null};
 }
 async getBlock(ref:string,network='main'){return this.session(network,(read,tip)=>this.block(read,tip,ref));}
 async range(start?:number,end?:number,network='main'){return this.session(network,async(read,tip)=>{const last=end??tip.blocks,first=start??Math.max(0,last-15);if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||last<first||last>tip.blocks||last-first>=32)throw new EvidenceError('invalid-filter-range','Choose an inclusive range of1–32 active heights.',400);const filters:any[]=[];let size=0;for(let h=first;h<=last;h++){const filter=await this.block(read,tip,String(h));size+=filter.filter_bytes_hex.length;if(size>4000000)throw new EvidenceError('filter-range-too-large','Encoded filters exceed4MB; request fewer blocks.',413);if(filters.length&&filter.prev_filter_header!==filters[filters.length-1].filter_header)throw new EvidenceError('invalid-filter-header','Adjacent filter headers do not link.');filters.push(filter);}return[{range_start:first,range_end:last,filter_type:'basic',status:'owned-index-links-verified',network,tip_height:tip.blocks,tip_hash:tip.bestblockhash,filters,peer_agreement:null,content_recomputed:false}];});}
 async checkpoints(network='main'){return this.session(network,async(read,tip)=>{const last=Math.floor(tip.blocks/1000)*1000;const entries:any[]=[];for(let h=Math.max(1000,last-4000);h<=last;h+=1000){const filter=await this.block(read,tip,String(h));entries.push({checkpoint_id:`${network}:${h}`,checkpoint_interval:1000,height:h,block_height:h,block_hash:filter.block_hash,filter_header:filter.filter_header,filter_hash:filter.filter_hash,provider_agreement_ratio:null,agreeing_providers_count:null,disagreeing_providers_count:null,scope:'latest-five-owned-index-checkpoints',peer_agreement:null});}return entries;});}
}
export const coreFilterSource=new CoreFilterSource();
