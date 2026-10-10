import config from '../config';
import {verifyAddressSource} from '../api/bitcoin/address-source-checkpoint';
describe('address source checkpoint identity',()=>{
  const original=config.MEMPOOL.NETWORK;
  beforeEach(()=>{config.MEMPOOL.NETWORK='signet';process.env.UNIVERSE_SIGNET_CHALLENGE='51';});
  afterAll(()=>{config.MEMPOOL.NETWORK=original;delete process.env.UNIVERSE_SIGNET_CHALLENGE;});
  const hash=(h:number)=>h===0?'0'.repeat(64):'1'.repeat(64);
  const core={getBlockchainInfo:async()=>({chain:'signet',blocks:100,bestblockhash:hash(100),signet_challenge:'51'}),getBlockHash:async(h:number)=>hash(h)};
  it('accepts only a shared active checkpoint with configured challenge',async()=>{await expect(verifyAddressSource(100,async(h)=>hash(h),core)).resolves.toMatchObject({blockHeight:100,signetChallenge:'51'});});
  it('rejects same-height forks and wrong genesis',async()=>{await expect(verifyAddressSource(100,async()=> '2'.repeat(64),core)).rejects.toThrow('differs');});
  it('rejects unattested custom Signet and absurd ahead index',async()=>{
    process.env.UNIVERSE_SIGNET_CHALLENGE='52';await expect(verifyAddressSource(100,async(h)=>hash(h),core)).rejects.toThrow('challenge');
    await expect(verifyAddressSource(1000000,async(h)=>hash(h),core)).rejects.toThrow('ahead');
  });
  it('does not accept a checkpoint while the owned source moves',async()=>{
    let counter=0;const moving={...core,getBlockchainInfo:async()=>({...await core.getBlockchainInfo(),bestblockhash:(counter++).toString(16).padStart(64,'0')})};
    await expect(verifyAddressSource(100,async(h)=>hash(h),moving)).rejects.toThrow('moved');
  });  it('bounds the complete checkpoint operation even when an injected source never replies', async()=>{
    await expect(verifyAddressSource(100,()=>new Promise(()=>{}),core,20)).rejects.toThrow('deadline');
  });
  it('does not start more source work when an uncooperative index replies after the deadline', async()=>{
    let finish!: (value:string)=>void;
    const pending=new Promise<string>(resolve=>{finish=resolve;});
    const reads=jest.fn(()=>pending);
    const measuredCore={getBlockchainInfo:jest.fn(core.getBlockchainInfo),getBlockHash:jest.fn(core.getBlockHash)};
    await expect(verifyAddressSource(100,reads,measuredCore,20)).rejects.toThrow('deadline');
    const calls={info:measuredCore.getBlockchainInfo.mock.calls.length,hash:measuredCore.getBlockHash.mock.calls.length};
    finish(hash(0));
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(reads).toHaveBeenCalledTimes(2);
    expect(measuredCore.getBlockchainInfo).toHaveBeenCalledTimes(calls.info);
    expect(measuredCore.getBlockHash).toHaveBeenCalledTimes(calls.hash);
  });
  it('starts exactly four independent hash reads together and fences their completion with a fresh Core observation', async()=>{
    const completions: (()=>void)[]=[];
    const info=jest.fn(core.getBlockchainInfo);
    const delayed=(height:number)=>new Promise<string>(resolve=>completions.push(()=>resolve(hash(height))));
    const nodeHash=jest.fn(delayed), indexHash=jest.fn(delayed);
    const pending=verifyAddressSource(100,indexHash,{getBlockchainInfo:info,getBlockHash:nodeHash});
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(nodeHash.mock.calls).toEqual([[0],[100]]);expect(indexHash.mock.calls.map(call=>call[0])).toEqual([0,100]);
    expect(info).toHaveBeenCalledTimes(1);expect(completions).toHaveLength(4);
    completions.forEach(finish=>finish());
    await expect(pending).resolves.toMatchObject({blockHeight:100,genesisHash:hash(0),blockHash:hash(100)});
    expect(info).toHaveBeenCalledTimes(2);
  });
  it('settles every started Core read when an index callback throws synchronously', async () => {
    const pending: AbortSignal[] = [];
    const rpc = { call: jest.fn((method: string, _params: unknown[], options: { signal: AbortSignal }) => {
      if (method === 'getblockchaininfo') return core.getBlockchainInfo();
      pending.push(options.signal);
      return new Promise((_, reject) => options.signal.addEventListener('abort',
        () => reject(Object.assign(new Error('RPC request cancelled'), {code: 'EABORTED'})), {once: true}));
    }) };
    await expect(verifyAddressSource(100, () => { throw new Error('Index probe cancelled'); }, {...core, rpc}))
      .rejects.toThrow('Index probe cancelled');
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(pending).toHaveLength(2);
    expect(pending.every(signal => signal.aborted)).toBe(true);
  });
  it('cancels the owned Core read at the caller deadline and permits a fresh retry', async () => {
    const controller = new AbortController();
    const reads = jest.fn(async (height: number) => hash(height));
    const rpc = { call: jest.fn((_method: string, _params: unknown[], options: { signal: AbortSignal }) =>
      new Promise((_, reject) => options.signal.addEventListener('abort',
        () => reject(new Error('RPC request cancelled')), {once: true}))) };
    const result = verifyAddressSource(100, reads, {...core, rpc}, 1000, controller.signal);
    const rejected = expect(result).rejects.toThrow('RPC request cancelled');
    controller.abort();
    await rejected;
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    await expect(verifyAddressSource(100, reads, core)).resolves.toMatchObject({blockHeight: 100});
  });
  it('does not enqueue Core work for a caller that is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const rpc = {call: jest.fn()};
    await expect(verifyAddressSource(100, async height => hash(height), {...core, rpc}, 1000, controller.signal))
      .rejects.toThrow('deadline');
    expect(rpc.call).not.toHaveBeenCalled();
  });
});
