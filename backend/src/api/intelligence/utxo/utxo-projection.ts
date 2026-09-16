import { Block,Transaction } from 'bitcoinjs-lib';
import { UtxoMuHash,UtxoCoin,serializeCoin } from './utxo-muhash';
import { GENESIS,integer,MAX_SATS,UTXO_LIMITS,UtxoEvidenceError } from './utxo-evidence';
import { HistoryStore } from '../time-machine/history-store';
export interface UtxoNodeReader {getBlockHash(height:number):Promise<string>;getBlock(hash:string,verbosity:number):Promise<any>;getBlockCount():Promise<number>;getBlockHeader(hash:string):Promise<any>;}
type Operation={kind:'create'|'spend';coin:UtxoCoin};
type Undo={height:number;hash:string;time:number;previous:string;previousTime:number;previousMuHash:string;operations:Operation[];transition:any};
const id=(coin:UtxoCoin)=>coin.txid+':'+coin.vout;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const satoshiJson=(value:bigint):number|string=>value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value.toString();
export class UtxoProjection {
 private coins=new Map<string,UtxoCoin>();private undo:Undo[]=[];private muhash=new UtxoMuHash();private height=0;private hash:string;private time=0;private flight:Promise<void>|null=null;private store?:HistoryStore;private initError:Error|null=null;
 constructor(readonly network:string,private readonly reader:UtxoNodeReader,file?:string){
  this.hash=GENESIS[network];if(!this.hash)throw new UtxoEvidenceError('utxo-network-unsupported','Unsupported UTXO projection network.');
  if(file){this.store=new HistoryStore(file,network);try{const data=this.store.read();if(data)this.restore(data);}catch(e){this.initError=e instanceof Error?e:new Error('Invalid UTXO snapshot');}}
 }
 private validateCoin(c:any):UtxoCoin{
  if(!c||typeof c.txid!=='string'||!/^[a-f0-9]{64}$/.test(c.txid)||typeof c.coinbase!=='boolean'||typeof c.script!=='string'||!/^([a-f0-9]{2})*$/.test(c.script)||c.script.length>20000||c.script.startsWith('6a'))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Invalid persisted UTXO coin.');
  integer(c.vout,0xffffffff);integer(c.height,0x7fffffff);integer(c.time,0xffffffff);integer(c.value,MAX_SATS);return c;
 }
 private restore(data:any){
  if(data.schema!=='utxo-projection-v1'||data.network!==this.network||!Array.isArray(data.coins)||data.coins.length>UTXO_LIMITS.coins||!Array.isArray(data.undo)||data.undo.length>UTXO_LIMITS.undoBlocks||typeof data.hash!=='string'||!/^[0-9a-f]{64}$/.test(data.hash))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Invalid UTXO projection checkpoint.');
  integer(data.height,0x7fffffff);integer(data.time,0xffffffff);
  const coins=new Map<string,UtxoCoin>(),muhash=new UtxoMuHash();let total=0;for(const raw of data.coins){const c=this.validateCoin(raw);if(c.height>data.height||coins.has(id(c)))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Duplicate or future persisted coin.');coins.set(id(c),c);muhash.insert(serializeCoin(c));total+=c.value;integer(total,MAX_SATS);}
  if(muhash.digest()!==data.muhash)throw new UtxoEvidenceError('invalid-utxo-checkpoint','Persisted MuHash does not match all coins.');
  let operations=0;let expectedHeight=data.height,expectedHash=data.hash;const reverse=new Map(coins),reverseHash=muhash.clone();
  for(const u of [...data.undo].reverse()){
   if(!u||u.height!==expectedHeight||u.hash!==expectedHash||!Array.isArray(u.operations)||typeof u.previous!=='string'||!/^[a-f0-9]{64}$/.test(u.previous)||typeof u.previousMuHash!=='string'||!/^[a-f0-9]{64}$/.test(u.previousMuHash))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Invalid undo chain.');integer(u.previousTime,0xffffffff);integer(u.time,0xffffffff);operations+=u.operations.length;if(operations>UTXO_LIMITS.undoOperations)throw new UtxoEvidenceError('invalid-utxo-checkpoint','Undo history exceeds bounds.');
   let createdCount=0,createdSats=0n,spentCount=0,spentSats=0n,satSeconds=0n;for(const op of u.operations){const c=this.validateCoin(op.coin);if(c.height>u.height||(op.kind==='create'&&(c.height!==u.height||c.time!==u.time)))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Undo coin height/time mismatch.');if(op.kind==='create'){createdCount++;createdSats+=BigInt(c.value);}else if(op.kind==='spend'){spentCount++;spentSats+=BigInt(c.value);satSeconds+=BigInt(c.value)*BigInt(Math.max(0,u.time-c.time));}}u.transition={height:u.height,block_hash:u.hash,created_count:createdCount,created_sats:satoshiJson(createdSats),spent_count:spentCount,spent_sats:satoshiJson(spentSats),net_utxo_change:createdCount-spentCount,coin_days_destroyed:Number(satSeconds)/8640000000000,coin_age_destroyed_sat_seconds:satSeconds.toString(),scope:'Projected spendable outputs, including coinbase; ages use non-negative block timestamp differences.'};
   for(const op of [...u.operations].reverse()){const c=this.validateCoin(op.coin),key=id(c);if(op.kind==='create'){if(JSON.stringify(reverse.get(key))!==JSON.stringify(c))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Undo output does not match state.');reverse.delete(key);reverseHash.remove(serializeCoin(c));}else if(op.kind==='spend'){if(reverse.has(key))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Duplicate restored output.');reverse.set(key,c);reverseHash.insert(serializeCoin(c));}else throw new UtxoEvidenceError('invalid-utxo-checkpoint','Invalid undo operation.');}
   if(reverse.size>UTXO_LIMITS.coins)throw new UtxoEvidenceError('invalid-utxo-checkpoint','Undo state exceeds projection capacity.');
   if(reverseHash.digest()!==u.previousMuHash)throw new UtxoEvidenceError('invalid-utxo-checkpoint','Undo MuHash mismatch.');expectedHeight--;expectedHash=u.previous;
  }
  if(data.height===0&&(data.hash!==GENESIS[this.network]||coins.size!==0))throw new UtxoEvidenceError('invalid-utxo-checkpoint','Invalid genesis state.');
  this.coins=coins;this.muhash=muhash;this.height=data.height;this.hash=data.hash;this.time=data.time;this.undo=data.undo;
 }
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 private async persist(){if(this.store)await this.store.write({schema:'utxo-projection-v1',network:this.network,height:this.height,hash:this.hash,time:this.time,muhash:this.muhash.digest(),coins:[...this.coins.values()],undo:this.undo});}
 public close(){this.store?.close();}
 public async sync():Promise<void>{if(this.flight)return this.flight;const work=this.synchronize();this.flight=work;try{await work;}finally{if(this.flight===work)this.flight=null;}}
 /** @asyncUnsafe rejections propagate to the caller, which handles them. */
 private async synchronize(){
  if(this.initError)throw new UtxoEvidenceError('utxo-checkpoint-invalid','Persisted UTXO projection is invalid or owned by another writer.');
  if(await this.reader.getBlockHash(0)!==GENESIS[this.network])throw new UtxoEvidenceError('utxo-network-mismatch','Owned UTXO node genesis does not match this network.');
  const target=integer(await this.reader.getBlockCount(),0x7fffffff);
  while(this.height>target||(this.height>0&&await this.reader.getBlockHash(this.height)!==this.hash)){this.rollbackToHeight(this.height-1);}
  if(this.height===0){const header=await this.reader.getBlockHeader(this.hash);this.time=integer(header.time,0xffffffff);}
  const end=Math.min(target,this.height+UTXO_LIMITS.blocksPerSync),deadline=Date.now()+10000;
  for(let height=this.height+1;height<=end;height++){if(Date.now()>=deadline)break;
   const hash=await this.reader.getBlockHash(height);const raw=await this.reader.getBlock(hash,0);this.applyBlock(raw,height,hash);
  }
  if(await this.reader.getBlockHash(this.height)!==this.hash)throw new UtxoEvidenceError('utxo-chain-changed','Canonical chain changed during UTXO projection; retry reconciliation.');
  await this.persist();
  if(this.height!==target)throw new UtxoEvidenceError('utxo-projection-catching-up',`UTXO projection is at height ${this.height}; target ${target}.`);
 }
 public applyBlock(raw:string,height:number,expectedHash:string){
  if(height!==this.height+1||typeof raw!=='string'||raw.length>UTXO_LIMITS.rawBlockBytes*2||!/^([a-fA-F0-9]{2})+$/.test(raw))throw new UtxoEvidenceError('invalid-utxo-block','Invalid block sequence or size.');
  const block=Block.fromHex(raw),transactions=block.transactions;
  if(!transactions?.length||block.getId()!==expectedHash||Buffer.from(block.prevHash!).reverse().toString('hex')!==this.hash||!Block.calculateMerkleRoot(transactions).equals(Buffer.from(block.merkleRoot!)))throw new UtxoEvidenceError('invalid-utxo-block','Block header, predecessor or Merkle root mismatch.');
  const coins=new Map(this.coins),muhash=this.muhash.clone(),operations:Operation[]=[];let createdCount=0,createdSats=0n,spentCount=0,spentSats=0n,satSeconds=0n;
  const spend=(coin:UtxoCoin)=>{coins.delete(id(coin));muhash.remove(serializeCoin(coin));operations.push({kind:'spend',coin});spentCount++;spentSats+=BigInt(coin.value);satSeconds+=BigInt(coin.value)*BigInt(Math.max(0,block.timestamp-coin.time));};
  transactions.forEach((tx,index)=>{
   const coinbase=tx.isCoinbase();if(coinbase!==(index===0))throw new UtxoEvidenceError('invalid-utxo-block','Invalid coinbase placement.');
   if(!coinbase)for(const input of tx.ins){const outpoint=Buffer.from(input.hash).reverse().toString('hex')+':'+input.index;const coin=coins.get(outpoint);if(!coin)throw new UtxoEvidenceError('utxo-missing-prevout','Projection has no referenced previous output.');spend(coin);}
   tx.outs.forEach((output,vout)=>{
    if(output.script[0]===0x6a||output.script.length>10000)return;
    const coin:UtxoCoin={txid:tx.getId(),vout,height,coinbase,value:integer(output.value,MAX_SATS),script:Buffer.from(output.script).toString('hex'),time:block.timestamp};const old=coins.get(id(coin));
    if(old){if(this.network!=='mainnet'||!coinbase||![91842,91880].includes(height))throw new UtxoEvidenceError('utxo-duplicate-outpoint','Duplicate unspent output.');spend(old);}
    coins.set(id(coin),coin);muhash.insert(serializeCoin(coin));operations.push({kind:'create',coin});createdCount++;createdSats+=BigInt(coin.value);
   });
  });
  if(coins.size>UTXO_LIMITS.coins||operations.length>UTXO_LIMITS.undoOperations)throw new UtxoEvidenceError('utxo-projection-capacity','Bounded UTXO projection capacity exceeded; a scalable owned index is required.');
  let amount=0;for(const coin of coins.values()){amount+=coin.value;integer(amount,MAX_SATS);}
  const transition={height,block_hash:expectedHash,created_count:createdCount,created_sats:satoshiJson(createdSats),spent_count:spentCount,spent_sats:satoshiJson(spentSats),net_utxo_change:createdCount-spentCount,coin_days_destroyed:Number(satSeconds)/8640000000000,coin_age_destroyed_sat_seconds:satSeconds.toString(),scope:'Projected spendable outputs, including coinbase; ages use non-negative block timestamp differences.'};
  this.undo.push({height,hash:expectedHash,time:block.timestamp,previous:this.hash,previousTime:this.time,previousMuHash:this.muhash.digest(),operations,transition});
  let retained=this.undo.reduce((n,u)=>n+u.operations.length,0);while(this.undo.length>UTXO_LIMITS.undoBlocks||retained>UTXO_LIMITS.undoOperations){retained-=this.undo.shift()!.operations.length;}
  this.coins=coins;this.muhash=muhash;this.height=height;this.hash=expectedHash;this.time=block.timestamp;
 }
 public rollbackToHeight(target:number):boolean{
  integer(target,0x7fffffff);if(target>=this.height)return false;
  if(!this.undo.length||target<this.undo[0].height-1)throw new UtxoEvidenceError('utxo-reorg-beyond-history','Reorganization exceeds retained undo history.');
  while(this.height>target){const undo=this.undo.pop()!;for(const op of [...undo.operations].reverse()){if(op.kind==='create'){this.coins.delete(id(op.coin));this.muhash.remove(serializeCoin(op.coin));}else{this.coins.set(id(op.coin),op.coin);this.muhash.insert(serializeCoin(op.coin));}}this.height--;this.hash=undo.previous;this.time=undo.previousTime;if(this.muhash.digest()!==undo.previousMuHash)throw new UtxoEvidenceError('utxo-undo-mismatch','Reversed UTXO state does not match retained commitment.');}return true;
 }
 public getState(){return {network:this.network,block_height:this.height,block_hash:this.hash,block_time:this.time,total_utxos:this.coins.size,total_amount_sats:[...this.coins.values()].reduce((s,c)=>s+c.value,0),muhash:this.muhash.digest(),rollback_floor_height:(this.undo[0]?.height??1)-1,persistence:this.store?'atomic-checkpoint':'process-memory-only'};}
 public getCoins(){return copy([...this.coins.values()]);}
 public getTransitions(limit:number){integer(limit,UTXO_LIMITS.history);return copy((limit===0?[]:this.undo.slice(-limit)).reverse().map(u=>u.transition));}
}
