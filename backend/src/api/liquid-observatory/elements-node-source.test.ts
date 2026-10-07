import { ElementsNodeSource, ownedElementsReader } from './elements-node-source';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { mkdtemp, writeFile, rm, symlink, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
const blockHash='11'.repeat(32);
function reader(overrides: Record<string, unknown> = {}) { return {call:jest.fn(async(method:string)=>({getblockchaininfo:{chain:'elementsregtest',blocks:103,bestblockhash:blockHash,initialblockdownload:false,current_signblock_hex:'51',current_fedpeg_program:'51',current_fedpeg_script:'51'},getblockheader:{height:103,hash:blockHash},getblockhash:blockHash,...overrides}[method]))}; }
describe('bounded owned Elements checkpoint',()=>{
 it('rejects unsupported native methods before dispatch',async()=>{await expect(ownedElementsReader.call('sendrawtransaction',[])).rejects.toMatchObject({code:'unsupported-elements-method',status:400});});
 (process.platform==='win32'?it.skip:it)('actual HTTP transport dispatches only a protected regular cookie, rejects symlink and0640 first',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'elements-node-credential-')),file=join(directory,'cookie'),link=join(directory,'link');
  const priorOrigin=process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN,priorCookie=process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE;
  let calls=0;const server=createServer((_req,res)=>{calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:{controlledTransport:true},error:null}));});
  server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try{
   process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/';
   await writeFile(file,'__cookie__:controlled-only',{mode:0o600});await symlink(file,link);
   process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE=link;
   await expect(ownedElementsReader.call('getblockchaininfo',[])).rejects.toMatchObject({code:'unavailable-elements-node'});expect(calls).toBe(0);
   process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE=file;await chmod(file,0o640);
   await expect(ownedElementsReader.call('getblockchaininfo',[])).rejects.toMatchObject({code:'unavailable-elements-node'});expect(calls).toBe(0);
   await chmod(file,0o600);await expect(ownedElementsReader.call('getblockchaininfo',[])).resolves.toEqual({controlledTransport:true});expect(calls).toBe(1);
  }finally{
   if(priorOrigin===undefined)delete process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN;else process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN=priorOrigin;
   if(priorCookie===undefined)delete process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE;else process.env.UNIVERSE_ELEMENTS_RPC_COOKIE_FILE=priorCookie;
   await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});
  }
 });
 it('returns only evidenced public checkpoint/policy facts',async()=>{const result=await new ElementsNodeSource(reader()).snapshot('elementsregtest');expect(result).toMatchObject({blockHeight:103,blockHash,scope:'checkpoint-and-policy-only',reserveSats:null,activeAssetCount:null,signersOnline:null});});
 it('rejects caller origin or arbitrary networks before RPC',async()=>{const rpc=reader();await expect(new ElementsNodeSource(rpc).snapshot('http://127.0.0.1')).rejects.toMatchObject({status:400});expect(rpc.call).not.toHaveBeenCalled();});
 it('rejects the wrong source network',async()=>{await expect(new ElementsNodeSource(reader()).snapshot('liquidv1')).rejects.toMatchObject({code:'invalid-checkpoint'});});
 it('rejects a changed height/hash binding',async()=>{await expect(new ElementsNodeSource(reader({getblockhash:'22'.repeat(32)})).snapshot('elementsregtest')).rejects.toMatchObject({status:409});});
 it('rejects a missing federation policy instead of guessing a threshold',async()=>{const rpc=reader();const call=rpc.call;rpc.call=jest.fn(async m=>{const v:any=await call(m);if(m==='getblockchaininfo')v.current_signblock_hex=undefined;return v;});await expect(new ElementsNodeSource(rpc).snapshot('elementsregtest')).rejects.toMatchObject({code:'unsupported-federation-format'});});
 it('does not return credentials in transport failures',async()=>{const saved=process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN;process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN='http://private:secret@example.com';try{await expect(ownedElementsReader.call('getblockchaininfo',[])).rejects.toThrow('The owned Elements node could not return public chain evidence.');}finally{if(saved===undefined)delete process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN;else process.env.UNIVERSE_ELEMENTS_RPC_ORIGIN=saved;}});
});
(process.env.TEST_ELEMENTS_LIVE==='1'?describe:describe.skip)('real isolated Elements RPC',()=>{it('reads the actual mined confidential transaction checkpoint',async()=>{const result=await new ElementsNodeSource().snapshot('elementsregtest');expect(result.blockHeight).toBeGreaterThanOrEqual(103);expect(result.network).toBe('elementsregtest');expect(result.reserveSats).toBeNull();});});
