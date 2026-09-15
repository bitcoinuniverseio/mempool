import { ZcashBlockSource, ownedZcashReader } from './zcash-block-source';
const hash = (n:number) => n.toString(16).padStart(64,'0');
function fixture(change?: (method:string,params:unknown[],value:any,count:number)=>any) {
 let count=0;const calls:Array<{method:string;params:unknown[]}>=[];
 const reader={call:jest.fn(async(method:string,params:unknown[])=>{calls.push({method,params});let value:any;if(method==='getblockchaininfo'){count++;value={chain:'main',blocks:100,initial_block_download_complete:true,bestblockhash:hash(100)};}if(method==='getblockhash')value=hash(params[0] as number);if(method==='getblock')value='00'.repeat(140);return change?change(method,params,value,count):value;})};
 return {source:new ZcashBlockSource(reader),calls};
}
describe('bounded owned Zcash public block source',()=>{
 it('retrieves only public raw blocks under one stable owned checkpoint',async()=>{const {source,calls}=fixture();const result=await source.range('mainnet',5,6,hash(4));expect(result).toMatchObject({previous_hash:hash(4),start_height:5,end_height:6,history_complete:false});expect(result.blocks.map(b=>b.height)).toEqual([5,6]);expect(calls.every(c=>['getblockchaininfo','getblockhash','getblock'].includes(c.method))).toBe(true);});
 it.each(['testnet','regtest','malformed'] as const)('rejects unsupported or wrong-network interval %s',async network=>{await expect(fixture().source.range(network,5,6)).rejects.toThrow();});
 it.each([[0,1],[5,4],[1,11],[1.5,2],[1,Number.MAX_SAFE_INTEGER]])('rejects invalid interval %s..%s',async(start,end)=>{const {source,calls}=fixture();await expect(source.range('mainnet',start,end)).rejects.toThrow();expect(calls).toHaveLength(0);});
 it('detects reorg at resume checkpoint before fetching blocks',async()=>{const {source,calls}=fixture();await expect(source.range('mainnet',5,6,hash(3))).rejects.toMatchObject({code:'reorg-detected',status:409});expect(calls.some(c=>c.method==='getblock')).toBe(false);});
 it.each(['sync','tip','raw'] as const)('rejects inconsistent source %s',async mutation=>{const {source}=fixture((method,_params,value,count)=>{if(mutation==='sync'&&method==='getblockchaininfo')value.initial_block_download_complete=false;if(mutation==='tip'&&method==='getblockchaininfo'&&count===2)value.bestblockhash=hash(101);if(mutation==='raw'&&method==='getblock')return 'invalid';return value;});await expect(source.range('mainnet',5,6)).rejects.toThrow();});
 it('source absence remains explicit and never returns fixture data',async()=>{const previous=process.env.UNIVERSE_ZCASH_RPC_ORIGIN;delete process.env.UNIVERSE_ZCASH_RPC_ORIGIN;try{await expect(ownedZcashReader.call('getblockchaininfo',[])).rejects.toMatchObject({code:'unavailable-zcash-node',status:503});}finally{if(previous!==undefined)process.env.UNIVERSE_ZCASH_RPC_ORIGIN=previous;}});
});
