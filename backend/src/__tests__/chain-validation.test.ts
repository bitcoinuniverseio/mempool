import {isolatedBackend,defaultMock,quietLogger} from './isolated-backend-helper';
const hash=(n: number)=>String(n).repeat(64);
describe('retained active chain validation',()=>{
  const setup=(rows: any[],tip=2,fail=false,moved=false)=>{
    const writes: any[]=[]; let reads=0;
    const api={$getBlockHashTip:async()=>hash(moved && reads++>0?3:tip),$getBlock:async(id: string)=>({id,height:tip}),$getBlockHash:async(n: number)=>hash(n)};
    const subject=isolatedBackend('repositories/BlocksRepository.ts',{
      '../api/bitcoin/bitcoin-api-factory':{...defaultMock(api),bitcoinCoreApi:api},'../logger':quietLogger,
      '../config':defaultMock({MEMPOOL:{INDEXING_BLOCKS_AMOUNT:-1}}),
      '../database':defaultMock({query:async(sql: any,params: any)=>{if(fail)throw Error('db unavailable'); if(typeof sql==='string' && sql.startsWith('SELECT'))return [rows];writes.push([sql,params]);return [[],[]];}}),
      './CpfpRepository':defaultMock({$deleteClustersFrom:async(n: number)=>writes.push(['cpfp',n])}),
      './HashratesRepository':defaultMock({$deleteHashratesFromTimestamp:async()=>{}}),
      './DifficultyAdjustmentsRepository':defaultMock({$deleteAdjustementsFromHeight:async(n: number)=>writes.push(['difficulty',n])}),
    }).default;
    subject.$setCanonicalBlockAtHeight=async(...args: any[])=>writes.push(['active',...args]);
    return {subject,writes};
  };
  const rows=(oldestStale=false)=>[2,1].map(n=>({height:n,hash:hash(n),previous_block_hash:hash(n-1),timestamp:2000000+n*600,stale:n===1 && oldestStale}));
  it('repairs the oldest retained height and invalidates from its timestamp',async()=>{
    const {subject,writes}=setup(rows(true));
    await expect(subject.$validateChain()).resolves.toBe(false);
    expect(writes).toContainEqual(['active',hash(1),1]);
    expect(writes).toContainEqual(['difficulty',1]);
    expect(writes).toContainEqual(['cpfp',1]);
    expect(writes[0][1]).toEqual([2000600-604800]);
  });
  it('fetches a missing tip safely without claiming completeness',async()=>{
    const {subject}=setup(rows(),3); await expect(subject.$validateChain()).resolves.toBe(false);
  });
  it('does not translate database failures or moving snapshots into success',async()=>{
    await expect(setup(rows(),2,true).subject.$validateChain()).rejects.toThrow();
    const moving=setup(rows(true),2,false,true); await expect(moving.subject.$validateChain()).rejects.toThrow('tip changed');expect(moving.writes).toEqual([]);
  });
  it('handles an empty retained database explicitly',async()=>{await expect(setup([]).subject.$validateChain()).resolves.toBe(false);});
});
