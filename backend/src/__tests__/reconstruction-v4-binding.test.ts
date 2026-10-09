import { configuredReconstructionV4Binding } from '../api/bitcoin/reconstruction-v4-binding';
import { chainSourceConfigurationSha256 } from '../api/bitcoin/chain-source-identity';
const tip=jest.fn(),readHash=jest.fn(),getBackend=jest.fn(()=>({releaseSha:'a'.repeat(40)}));
jest.mock('../config',()=>({__esModule:true,default:{MEMPOOL:{NETWORK:'signet'},CORE_RPC:{HOST:'127.0.0.1',PORT:38332}}}));
jest.mock('../api/backend-info',()=>({__esModule:true,default:{getBackendInfo:():{releaseSha:string}=>getBackend()}}));
jest.mock('../api/bitcoin/chain-source-identity.routes',()=>({configuredIdentityReader:(): import('../api/bitcoin/chain-source-identity').IdentityIndexReader=>({selector:{backend:'electrum',host:'127.0.0.1',port:50013,tls:false,addressHttpOrigin:'http://127.0.0.1:3022'},tip,hash:readHash})}));
it('uses the identical existing identity fingerprint without calling either source reader',()=>{const selector={backend:'electrum',host:'127.0.0.1',port:50013,tls:false,addressHttpOrigin:'http://127.0.0.1:3022'};expect(configuredReconstructionV4Binding()).toEqual({network:'signet',releaseSha:'a'.repeat(40),configurationSha256:chainSourceConfigurationSha256(selector)});expect(tip).not.toHaveBeenCalled();expect(readHash).not.toHaveBeenCalled();});
it('rejects unversioned artifact metadata without observing source data',()=>{getBackend.mockReturnValueOnce({releaseSha:'short'});expect(configuredReconstructionV4Binding()).toBeUndefined();expect(tip).not.toHaveBeenCalled();expect(readHash).not.toHaveBeenCalled();});
