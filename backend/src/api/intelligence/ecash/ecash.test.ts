import * as crypto from 'crypto';
import * as secp256k1 from 'tiny-secp256k1';
import { ecashService, EcashUnavailableError, claimDigest } from './ecash.service';

describe('ecash providers: configured mints and signed claims', () => {
  beforeEach(() => { ecashService.resetForTests(); ecashService.configuredMints = () => []; });

  it('is unavailable until a mint is configured, and federations need a client', async () => {
    await expect(ecashService.getMints()).rejects.toThrow(EcashUnavailableError);
    await expect(ecashService.getOverview()).rejects.toThrow(/UNIVERSE_ECASH_MINTS/);
    expect(() => ecashService.getFederations()).toThrow(/Fedimint client/);
  });

  it('reads each configured mint through its own NUT-06 and NUT-02 endpoints', async () => {
    ecashService.configuredMints = () => ['https://mint.example.org', 'https://down.example.org'];
    const identity = await import('../identity/developer-identity');
    jest.spyOn(identity, 'resolvePublicAddress').mockResolvedValue({ address: '93.184.216.5', family: 4 });
    ecashService.fetcher = async (url, _address, path) => {
      if (!url.hostname.startsWith('mint')) { return { status: null, json: null, error: 'ETIMEDOUT' }; }
      if (path === '/v1/info') { return { status: 200, json: { name: 'Example Mint', nuts: { '4': {}, '5': {}, '7': {} } }, error: null }; }
      return { status: 200, json: { keysets: [{ id: '00a1', unit: 'sat', active: true }, { id: '00b2', unit: 'sat', active: false }] }, error: null };
    };
    const mints = await ecashService.getMints();
    expect(mints[0]).toMatchObject({ name: 'Example Mint', nuts_supported: [4, 5, 7], active_keysets_count: 1, reachable: true, error: null });
    expect(mints[0].keysets).toHaveLength(2);
    expect(mints[1]).toMatchObject({ name: null, reachable: false, error: 'Mint info observation unavailable or malformed.', keysets: null, active_keysets_count: null });
    expect(await ecashService.getMintById(mints[0].mint_id)).toMatchObject({ name: 'Example Mint' });
    expect(await ecashService.getMintById('mint-none')).toBeNull();
    const overview = await ecashService.getOverview();
    expect(overview).toMatchObject({ total_cashu_mints: 2, reachable_cashu_mints: 1, total_fedimint_federations: null, active_claims_count: null, federations: [] });
  });

  it('a claim is verified only by its signature, and nothing is registered', () => {
    const privateKey = crypto.randomBytes(32);
    const pubkey = Buffer.from(secp256k1.pointFromScalar(privateKey, true)!).toString('hex');
    const body = { provider_type: 'cashu_mint' as const, identifier: 'mint-1', domain: 'mint.example.org' };
    const signature = Buffer.from(secp256k1.signSchnorr(claimDigest(body), privateKey)).toString('hex');
    const verified = ecashService.verifyClaim({ ...body, operator_pubkey: pubkey, attestation_signature: signature });
    expect(verified).toMatchObject({ verified: true, scheme: 'schnorr', registered: false });
    expect(verified.verified_at).not.toBeNull();
    const forged = ecashService.verifyClaim({ ...body, operator_pubkey: pubkey, attestation_signature: crypto.randomBytes(64).toString('hex') });
    expect(forged).toMatchObject({ verified: false, verified_at: null });
    expect(forged.reason).toMatch(/does not verify/);
    expect(() => ecashService.verifyClaim({ domain: 'x' })).toThrow(/required/);
    expect(() => ecashService.verifyClaim({ ...body, provider_type: 'bank' as never, operator_pubkey: pubkey, attestation_signature: signature })).toThrow(/provider_type/);
  });
});

describe('Cashu source failure evidence',()=>{
  beforeEach(async()=>{ecashService.resetForTests();ecashService.configuredMints=()=>['https://mint.example.org'];const identity=await import('../identity/developer-identity');jest.spyOn(identity,'resolvePublicAddress').mockResolvedValue({address:'93.184.216.5',family:4});});
  it.each([{status:503,json:{keysets:[]},error:null},{status:200,json:{},error:null},{status:200,json:{keysets:[{id:'00a1',unit:'sat',active:'true'}]},error:null},{status:200,json:{keysets:[]},error:'response-too-large'}])('keeps failed/malformed keysets unknown: %p',async result=>{
    ecashService.fetcher=async(_u,_a,path)=>path==='/v1/info'?{status:200,json:{name:'Mint',nuts:{'4':{}}},error:null}:result;
    const [mint]=await ecashService.getMints();expect(mint).toMatchObject({name:'Mint',info_status:'observed',keysets_status:'unavailable',keysets:null,active_keysets_count:null,reachable:false,last_heartbeat:null});
  });
  it('preserves known empty keysets as zero and cache observation time',async()=>{
    ecashService.fetcher=async(_u,_a,path)=>({status:200,json:path==='/v1/info'?{nuts:{}}:{keysets:[]},error:null});
    const now=Date.now();const [mint]=await ecashService.getMints(now);expect(mint).toMatchObject({keysets:[],active_keysets_count:0,reachable:true});
    expect((await ecashService.getOverview()).last_updated).toBe(new Date(now).toISOString());
  });
  it('invalidates cache when configured origins change or are removed',async()=>{
    ecashService.fetcher=async(_u,_a,path)=>({status:200,json:path==='/v1/info'?{nuts:{}}:{keysets:[]},error:null});
    const first=await ecashService.getMints();ecashService.configuredMints=()=>['https://second.example.org'];
    const second=await ecashService.getMints();expect(second[0].mint_id).not.toBe(first[0].mint_id);
    ecashService.configuredMints=()=>[];await expect(ecashService.getMints()).rejects.toMatchObject({status:503});
  });
});

import * as https from 'https';
import { EventEmitter } from 'events';
import { defaultFetcher } from './ecash.service';
describe('Cashu HTTP response bounds',()=>{
  afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
  function transport() {
    const request:any=new EventEmitter();request.end=jest.fn();request.destroy=jest.fn();
    const response:any=new EventEmitter();response.statusCode=200;response.destroy=jest.fn();
    let callback:Function=()=>{};
    jest.spyOn(require('https'),'request').mockImplementation(((_options:any,cb:Function)=>{callback=cb;return request;}) as any);
    const pending=defaultFetcher(new URL('https://mint.example.org'),'93.184.216.5','/v1/keysets');callback(response);
    return {request,response,pending};
  }
  it('rejects a valid JSON prefix followed by discarded oversized bytes',async()=>{
    const {response,request,pending}=transport();response.emit('data',Buffer.from('{"keysets":[]}'));response.emit('data',Buffer.alloc(256*1024));response.emit('end');
    expect(await pending).toMatchObject({json:null,error:'response-too-large'});expect(request.destroy).toHaveBeenCalled();expect(response.destroy).toHaveBeenCalled();
  });
  it('uses an absolute deadline even if response keeps streaming',async()=>{
    jest.useFakeTimers();const {response,request,pending}=transport();
    for(let i=0;i<5;i++){response.emit('data',Buffer.from(' '));jest.advanceTimersByTime(1000);}
    expect(await pending).toMatchObject({json:null,error:'deadline-exceeded'});expect(request.destroy).toHaveBeenCalled();
  });
});
