import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
// Execute complete production modules with explicit read-only boundary doubles; no copied handlers.
function load(relative: string, dependencies: Record<string, any>) {
 const file=path.join(__dirname,'..',relative), exports: any={};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports,require:(id:string)=>dependencies[id] || {},console,Buffer,setTimeout,clearTimeout});
 return exports.default;
}
function response() {const r:any={statusCode:200,body:undefined}; r.status=(s:number)=>{r.statusCode=s;return r;}; r.json=r.send=(b:any)=>{r.body=b;return r;}; r.header=r.setHeader=()=>r; return r;}
const errors={'../../utils/api':{handleError:(_q:any,r:any,s:number,m:string)=>r.status(s).send(m)}};
const config={MEMPOOL:{NETWORK:'mainnet',API_URL_PREFIX:'/api/v1/'}};
function nodes(source:any) {return load('api/explorer/nodes.routes.ts',{...errors,'../../config':config,'./nodes.api':source});}
function channels(source:any,bitcoin:any) {return load('api/explorer/channels.routes.ts',{...errors,'../../config':config,'./channels.api':source,'../bitcoin/bitcoin-api-factory':bitcoin});}
const txid='ab'.repeat(32), funding='cd'.repeat(32);
test('mining RPC failure is unavailable, never zero current observations',async()=>{
 const api=load('api/mining/mining-routes.ts',{...errors,'../../config':config,'../../logger':{debug:()=>{}},'../bitcoin/bitcoin-client':{getNetworkHashPs:async()=>{throw Error('offline');}},'../../repositories/HashratesRepository':{$getNetworkDailyHashrate:async()=>[]},'../../repositories/DifficultyAdjustmentsRepository':{$getAdjustments:async()=>[]},'../../repositories/BlocksRepository':{$blockCount:async()=>0}});
 const r=response();await api.$getHistoricalHashrate({params:{}},r);expect(r.statusCode).toBe(503);expect(r.body).not.toHaveProperty('currentHashrate');
});
test.each(['regtest','testnet4'])('no mainnet group fallback on %s',async network=>{
 config.MEMPOOL.NETWORK=network;const get=jest.fn();const r=response();await nodes({$getNode:get}).$getNodeGroup({params:{name:'mempool.space'}},r);expect(r.statusCode).toBe(404);expect(get).not.toHaveBeenCalled();
});
test('unknown group name is rejected before reading nodes',async()=>{
 config.MEMPOOL.NETWORK='mainnet';const get=jest.fn();const r=response();await nodes({$getNode:get}).$getNodeGroup({params:{name:'invented'}},r);expect(r.statusCode).toBe(404);expect(get).not.toHaveBeenCalled();
});
test('partial group read never becomes complete success',async()=>{
 config.MEMPOOL.NETWORK='mainnet';const get=jest.fn().mockImplementationOnce(async(public_key)=>({public_key})).mockRejectedValue(Error('database offline'));const r=response();await nodes({$getNode:get}).$getNodeGroup({params:{name:'mempool.space'}},r);expect(r.statusCode).toBe(503);
});
test('channel close maps every actual funding input instead of input zero',async()=>{
 const first={transaction_id:funding,transaction_vout:2,closing_transaction_id:txid},second={transaction_id:funding,transaction_vout:3,closing_transaction_id:txid};
 const r=response();await channels({$getChannelsByTransactionId:async()=>[first,second]},{$getRawTransaction:async()=>({txid,vin:[{txid:funding,vout:9},{txid:funding,vout:3},{txid:funding,vout:2}]})}).$getChannelsByTransactionIds({query:{txId:[txid]}},r);
 expect(r.statusCode).toBe(200);expect(r.body).toEqual([{inputs:{1:second,2:first},outputs:{}}]);
});
test('missing channel spending transaction does not fabricate an input association',async()=>{
 const r=response();await channels({$getChannelsByTransactionId:async()=>[{transaction_id:funding,transaction_vout:2,closing_transaction_id:txid}]},{$getRawTransaction:async()=>{throw Error('offline');}}).$getChannelsByTransactionIds({query:{txId:[txid]}},r);expect(r.statusCode).toBe(503);
});
test('missing height fails after one indexing attempt, without repeating work',async()=>{
 const block=load('api/blocks.ts',{'./common':{Common:{indexingEnabled:()=>true}},'../repositories/BlocksRepository':{$getBlockByHeight:async()=>null}});
 const index=jest.fn().mockResolvedValueOnce(undefined).mockRejectedValue(Error('repeated index attempt'));block.$indexBlockByHeight=index;
 await expect(block.$getBlocksBetweenHeight(3,3)).rejects.toThrow('Block source unavailable');expect(index).toHaveBeenCalledTimes(1);
});
test.each([NaN,-1,Infinity])('malformed mining hashrate %s is not evidence',async value=>{
 const api=load('api/mining/mining-routes.ts',{...errors,'../../config':config,'../bitcoin/bitcoin-client':{getNetworkHashPs:async()=>value,getDifficulty:async()=>1}});const r=response();await api.$getHistoricalHashrate({params:{}},r);expect(r.statusCode).toBe(503);
});
test('real zero hashrate with valid difficulty remains a valid response',async()=>{
 const api=load('api/mining/mining-routes.ts',{...errors,'../../config':config,'../bitcoin/bitcoin-client':{getNetworkHashPs:async()=>0,getDifficulty:async()=>2},'../../repositories/HashratesRepository':{$getNetworkDailyHashrate:async()=>[{timestamp:1}]},'../../repositories/DifficultyAdjustmentsRepository':{$getAdjustments:async()=>[]},'../../repositories/BlocksRepository':{$blockCount:async()=>1}});const r=response();await api.$getHistoricalHashrate({params:{}},r);expect(r.statusCode).toBe(200);expect(r.body.currentHashrate).toBe(0);expect(r.body.currentDifficulty).toBe(2);
});
test.each(['mainnet','testnet','signet'])('complete configured group observations retain array contract on %s',async network=>{
 config.MEMPOOL.NETWORK=network;const get=jest.fn(async(public_key)=>({public_key}));const r=response();await nodes({$getNode:get}).$getNodeGroup({params:{name:'mempool.space'}},r);expect(r.statusCode).toBe(200);expect(r.body.length).toBeGreaterThan(0);expect(r.body.length).toBe(get.mock.calls.length);
});
test('mismatched group identity is unavailable',async()=>{
 config.MEMPOOL.NETWORK='signet';const r=response();await nodes({$getNode:async()=>({public_key:'wrong'})}).$getNodeGroup({params:{name:'mempool.space'}},r);expect(r.statusCode).toBe(503);
});
test('unmatched closing outpoint is unavailable and cannot become input0',async()=>{
 const r=response();await channels({$getChannelsByTransactionId:async()=>[{transaction_id:funding,transaction_vout:2,closing_transaction_id:txid}]},{$getRawTransaction:async()=>({txid,vin:[{txid:funding,vout:3}]})}).$getChannelsByTransactionIds({query:{txId:[txid]}},r);expect(r.statusCode).toBe(503);
});
test('funding outputs retain exact output positions without unnecessary transaction reads',async()=>{
 const channel={transaction_id:txid,transaction_vout:3};const read=jest.fn();const r=response();await channels({$getChannelsByTransactionId:async()=>[channel]},{$getRawTransaction:read}).$getChannelsByTransactionIds({query:{txId:[txid]}},r);expect(r.body).toEqual([{inputs:{},outputs:{3:channel}}]);expect(read).not.toHaveBeenCalled();
});
test.each([[],['bad'],Array(51).fill(txid)].map(ids=>({ids})))('invalid or oversized channel query fails before source %#',async ({ids})=>{
 const read=jest.fn();const r=response();await channels({$getChannelsByTransactionId:read},{}).$getChannelsByTransactionIds({query:{txId:ids}},r);expect(r.statusCode).toBe(400);expect(read).not.toHaveBeenCalled();
});

test('block made available by one index attempt retains the complete range result',async()=>{
 const stored={height:3,id:txid,extras:{pool:{id:1,slug:'known'},feePercentiles:[1,2,3,4,5,6,7],feeRange:[1,2,3,4,5,6,7]}};
 const read=jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
 const block=load('api/blocks.ts',{'./common':{Common:{indexingEnabled:()=>true,blocksSummariesIndexingEnabled:()=>false}},'../repositories/BlocksRepository':{$getBlockByHeight:read},'./chain-tips':{getOrphanedBlocksAtHeight:()=>[]}});
 const index=jest.fn().mockResolvedValue(undefined);block.$indexBlockByHeight=index;
 const result=await block.$getBlocksBetweenHeight(3,3);expect(result).toHaveLength(1);expect(result[0].height).toBe(3);expect(result[0].fee_amt_percentiles.perc_50).toBe(4);expect(index).toHaveBeenCalledTimes(1);
});
test('unavailable fee percentile evidence remains null without discarding the block',async()=>{
 const stored={height:3,id:txid,extras:{pool:{id:1,slug:'known'}}};
 const block=load('api/blocks.ts',{'./common':{Common:{indexingEnabled:()=>true,blocksSummariesIndexingEnabled:()=>false}},'../repositories/BlocksRepository':{$getBlockByHeight:async()=>stored},'./chain-tips':{getOrphanedBlocksAtHeight:()=>[]}});
 const result=await block.$getBlocksBetweenHeight(3,3);expect(result[0].fee_amt_percentiles).toBeNull();expect(result[0].fee_rate_percentiles).toBeNull();
});
