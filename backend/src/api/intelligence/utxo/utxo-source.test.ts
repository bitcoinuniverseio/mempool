import { OwnedUtxoStats,UtxoStatsCache } from './utxo-source';
import { GENESIS } from './utxo-evidence';
describe('owned coinstatsindex evidence',()=>{
 const hash='ab'.repeat(32);
 function client(){return {getBlockHash:jest.fn(async(h:number)=>h===0?GENESIS.regtest:hash),getIndexInfo:jest.fn(async()=>({coinstatsindex:{synced:true}})),getBestBlockHash:jest.fn(async()=>hash),getTxOutSetInfo:jest.fn(async()=>({bestblock:hash,height:12,muhash:'cd'.repeat(32),txouts:2,total_amount:0.29,bogosize:150})),getBlockHeader:jest.fn(async()=>({time:1700000000}))};}
 it('requests a canonical historical muhash using only a synced index',async()=>{const c=client(),s=await new OwnedUtxoStats(c,'regtest').read();expect(s.total_amount_sats).toBe(29000000);expect(s.muhash).toBe('cd'.repeat(32));expect(c.getTxOutSetInfo).toHaveBeenCalledWith('muhash',hash,true);});
 it('never falls back to a full UTXO scan when index or network is missing',async()=>{const c=client();c.getIndexInfo.mockResolvedValue({} as any);await expect(new OwnedUtxoStats(c,'regtest').read()).rejects.toMatchObject({code:'utxo-coinstatsindex-unavailable'});expect(c.getTxOutSetInfo).not.toHaveBeenCalled();await expect(new OwnedUtxoStats(c,'signet').read()).rejects.toMatchObject({code:'utxo-network-mismatch'});});
 it('rejects a reorg during checkpoint observation',async()=>{const c=client();c.getBlockHash.mockImplementation(async h=>h===0?GENESIS.regtest:'ff'.repeat(32));await expect(new OwnedUtxoStats(c,'regtest').read()).rejects.toMatchObject({code:'utxo-chain-changed'});});
 it('shares fresh reads and rejects stale source timestamps',async()=>{let time=Date.now();const c=client(),reader={read:jest.fn(()=>new OwnedUtxoStats(c,'regtest').read())};const cache=new UtxoStatsCache(reader,()=>time);await Promise.all([cache.read(),cache.read()]);expect(reader.read).toHaveBeenCalledTimes(1);time+=40000;await expect(cache.read()).rejects.toMatchObject({code:'utxo-source-stale'});});
});
