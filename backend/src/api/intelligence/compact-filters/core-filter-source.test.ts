import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CoreFilterSource,filterCommitments } from './core-filter-source';
const vector=JSON.parse(readFileSync(resolve(__dirname,'../../../../../tools/compact-filters/bip158-testnet19.json'),'utf8'))[1];
function reader(){const [,hash,raw,,previous,filter,header]=vector;return {call:jest.fn(async(method:string,params:unknown[])=>{if(method==='getblockchaininfo')return{chain:'test',blocks:0,bestblockhash:hash,initialblockdownload:false};if(method==='getindexinfo')return{'basic block filter index':{synced:true,best_block_height:0}};if(method==='getblockhash')return hash;if(method==='getblockheader')return params[1]===false?raw.slice(0,160):{hash,height:0};if(method==='getblockfilter')return{filter,header};throw Error('unexpected RPC');})};}
describe('owned filter adapter against independent official genesis data',()=>{
 it('binds raw block header, active height, canonical filter and chained header',async()=>{const rpc=reader();const result=await new CoreFilterSource(rpc).getBlock('0','test');expect(result.filter_header).toBe(vector[6]);expect(result.element_count).toBe(1);expect(result.content_recomputed).toBe(false);expect(result.peer_agreement).toBeNull();expect(rpc.call.mock.calls.every(([m])=>m!=='getblockfilterheader')).toBe(true);});
 it('returns real scoped interval data and no provider agreement',async()=>{const range=await new CoreFilterSource(reader()).range(0,0,'test');expect(range[0].filters).toHaveLength(1);expect(range[0].peer_agreement).toBeNull();});
 it('returns no positive1000 checkpoint before height1000 only after verifying the source',async()=>{const rpc=reader();expect(await new CoreFilterSource(rpc).checkpoints('test')).toEqual([]);expect(rpc.call).toHaveBeenCalledWith('getindexinfo',['basic block filter index']);});
 it.each(['network','genesis','sync','index','header','filter','reorg'])('rejects altered %s source evidence',async failure=>{const rpc=reader(),original=rpc.call;let tips=0;rpc.call=jest.fn(async(method,params)=>{const value:any=await original(method,params);if(method==='getblockchaininfo'){tips++;if(failure==='network')value.chain='main';if(failure==='sync')value.initialblockdownload=true;if(failure==='reorg'&&tips>1)value.bestblockhash='11'.repeat(32);}if(failure==='genesis'&&method==='getblockhash')return '11'.repeat(32);if(failure==='index'&&method==='getindexinfo')return{};if(failure==='header'&&method==='getblockheader'&&params[1]===false)return '00'.repeat(80);if(failure==='filter'&&method==='getblockfilter')value.header='11'.repeat(32);return value;});await expect(new CoreFilterSource(rpc).getBlock('0','test')).rejects.toThrow();});
 it('rejects unsupported network before invoking source',async()=>{const rpc=reader();await expect(new CoreFilterSource(rpc).getBlock('0','http://attacker')).rejects.toMatchObject({status:400});expect(rpc.call).not.toHaveBeenCalled();});
 it('rejects oversized ranges and malformed references',async()=>{await expect(new CoreFilterSource(reader()).range(0,33,'test')).rejects.toMatchObject({status:400});await expect(new CoreFilterSource(reader()).getBlock('01','test')).rejects.toMatchObject({status:400});});
});

it('retains both session slots after caller timeout until underlying RPCs actually settle',async()=>{
 jest.useFakeTimers();const finish:Array<(value:any)=>void>=[];
 const rpc={call:jest.fn(()=>new Promise(resolve=>finish.push(resolve)))};
 const source=new CoreFilterSource(rpc);
 try{
  const first=source.getBlock('0','test'),second=source.getBlock('0','test');
  const failed=Promise.all([expect(first).rejects.toMatchObject({code:'filter-source-timeout'}),expect(second).rejects.toMatchObject({code:'filter-source-timeout'})]);
  await jest.advanceTimersByTimeAsync(15001);await failed;
  await expect(source.getBlock('0','test')).rejects.toMatchObject({code:'filter-source-busy'});expect(rpc.call).toHaveBeenCalledTimes(2);
  finish.forEach(resolve=>resolve({}));await jest.advanceTimersByTimeAsync(0);
  // Expired observations finish without issuing any more RPCs, releasing slots.
  expect(rpc.call).toHaveBeenCalledTimes(2);
  await expect(new CoreFilterSource(reader()).getBlock('0','test')).resolves.toMatchObject({block_height:0});
 }finally{finish.forEach(resolve=>resolve({}));await jest.advanceTimersByTimeAsync(0);jest.useRealTimers();}
});
