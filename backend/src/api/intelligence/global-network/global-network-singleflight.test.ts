jest.mock('../../bitcoin/bitcoin-client',()=>({__esModule:true,default:{}}));
import config from '../../../config';
import {globalNetworkService} from './global-network.service';
describe('owned node snapshot singleflight',()=>{
 beforeEach(()=>{config.MEMPOOL.NETWORK='mainnet';globalNetworkService.resetForTests();});
 it('shares concurrent reads, expires cached data and never serves stale data after failure',async()=>{
  let resolve!:(value:any)=>void;const reader=jest.fn(()=>new Promise<any>(done=>resolve=done));globalNetworkService.nodeReader=reader;
  const first=globalNetworkService.getOverview(100000),second=globalNetworkService.getOverview(100000);
  expect(reader).toHaveBeenCalledTimes(1);resolve({genesisHash:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',peers:[],info:{version:300000,subversion:'/Core/',connections:0,networks:[]}});await Promise.all([first,second]);await globalNetworkService.getOverview(100010);expect(reader).toHaveBeenCalledTimes(1);
  globalNetworkService.nodeReader=async()=>{throw new Error('offline');};await expect(globalNetworkService.getOverview(140000)).rejects.toThrow(/complete network observation/);
 });
 it('bounds HTTP waits while sharing a hung underlying RPC',async()=>{
  jest.useFakeTimers();try{const reader=jest.fn(()=>new Promise<any>(()=>undefined));globalNetworkService.nodeReader=reader;
  const first=globalNetworkService.getOverview(100000).catch(error=>error);await jest.advanceTimersByTimeAsync(10000);expect(await first).toMatchObject({code:'node-timeout'});
  const second=globalNetworkService.getOverview(120000).catch(error=>error);await jest.advanceTimersByTimeAsync(10000);expect(await second).toMatchObject({code:'node-timeout'});expect(reader).toHaveBeenCalledTimes(1);
  }finally{globalNetworkService.resetForTests();jest.useRealTimers();}
 }); it('refuses a missing or wrong owned genesis for shared relay use',async()=>{globalNetworkService.nodeReader=async()=>({peers:[],info:{version:1,subversion:'x',networks:[]} as any,genesisHash:'ff'.repeat(32)});await expect(globalNetworkService.getOwnedNodeSnapshot()).rejects.toMatchObject({code:'node-network-mismatch'});});
});
