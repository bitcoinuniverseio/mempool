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
    expect(reads).toHaveBeenCalledTimes(1);
    expect(measuredCore.getBlockchainInfo).toHaveBeenCalledTimes(calls.info);
    expect(measuredCore.getBlockHash).toHaveBeenCalledTimes(calls.hash);
  });
});
