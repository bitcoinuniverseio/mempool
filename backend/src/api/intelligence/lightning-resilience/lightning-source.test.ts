import axios from 'axios';
import * as fs from 'fs';
import config from '../../../config';
import { readOwnedLnd } from './lightning-source';
jest.mock('axios',()=>({__esModule:true,default:{get:jest.fn()}}));
jest.mock('fs',()=>({...jest.requireActual('fs'),readFileSync:jest.fn(()=>Buffer.from('test fixture'))}));
describe('owned LND source publication boundary',()=>{
 const original={enabled:config.LIGHTNING.ENABLED,backend:config.LIGHTNING.BACKEND,network:config.MEMPOOL.NETWORK,publish:process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH};
 beforeEach(()=>{jest.clearAllMocks();config.LIGHTNING.ENABLED=true;config.LIGHTNING.BACKEND='lnd';config.MEMPOOL.NETWORK='signet';process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH='1';});
 afterAll(()=>{config.LIGHTNING.ENABLED=original.enabled;config.LIGHTNING.BACKEND=original.backend;config.MEMPOOL.NETWORK=original.network;if(original.publish===undefined)delete process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH;else process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH=original.publish;});
 it('makes no credential reads or RPC when disabled or publication not opted in',async()=>{config.LIGHTNING.ENABLED=false;await expect(readOwnedLnd()).rejects.toMatchObject({code:'lightning-disabled'});config.LIGHTNING.ENABLED=true;delete process.env.UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH;await expect(readOwnedLnd()).rejects.toMatchObject({code:'publication-disabled'});expect(axios.get).not.toHaveBeenCalled();expect(fs.readFileSync).not.toHaveBeenCalled();});
 it('rejects wrong network before accessing channel information',async()=>{(axios.get as jest.Mock).mockResolvedValue({data:{chains:[{chain:'bitcoin',network:'mainnet'}],synced_to_chain:true}});await expect(readOwnedLnd()).rejects.toMatchObject({code:'lightning-network-mismatch'});expect(axios.get).toHaveBeenCalledTimes(1);});
 it('reads only fixed getinfo/ListChannels paths with bounded TLS requests',async()=>{(axios.get as jest.Mock).mockResolvedValueOnce({data:{chains:[{chain:'bitcoin',network:'signet'}],synced_to_chain:true,identity_pubkey:'key'}}).mockResolvedValueOnce({data:{channels:[]}});expect((await readOwnedLnd()).channels).toEqual([]);expect((axios.get as jest.Mock).mock.calls.map(c=>c[0].split('/').at(-1))).toEqual(['getinfo','channels']);expect((axios.get as jest.Mock).mock.calls[0][1]).toMatchObject({timeout:10000,maxRedirects:0,maxContentLength:8388608});});
});
