import { describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { UniverseApiService } from '../universe-api.service';
import { correlateCatHolders, fractalProfile, mergeCatPage, validateFractalRead } from './fractal-evidence';

const profile = {network:'fractal-testnet',release:'0.4.0',sourceRevision:'8c22167f04250c7dd03afe46af4158bd08001183',configurationSha256:'c'.repeat(64),binarySha256:'d'.repeat(64)} as const;
const observation = {schema:'fractal-observation-v1',network:'fractal-testnet',genesisHash:'000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',blockOneHash:'000000000021b22bb6a9718e5db62fca1eb2ac6e34535e70c67b374dcb29c570',checkpoint:{height:12,hash:'a'.repeat(64)},ready:false,observedAt:'2026-10-04T12:00:00.000Z',source:profile};
const tip = {schema:'fractal-tip-v1',observation,height:12,hash:'a'.repeat(64),time:123,network:'fractal-testnet'};
const token=(id='a')=>({schema:'cat20-token-v1',tokenId:id.repeat(64)+'_0',name:'Token',symbol:'T',decimals:8,maxSupplyAtomic:null,circulatingSupplyAtomic:'9007199254740993',mintLimitAtomic:null,deployTxid:'b'.repeat(64),deployHeight:10,minterAddress:null,minterPubKey:'e'.repeat(64),minterType:null,holderCount:0,transferCount:null,state:null,unavailable:['maxSupplyAtomic']});
const page=(items:any[],total:number,nextCursor:string|null):any=>({schema:'cat20-page-v1',observation:{...observation,ready:true},checkpoint:observation.checkpoint,trackerSourceRevision:'8d5aeee7484bacc33d0014b44503c0b59d39aaff',items,total,nextCursor});
function service(reply:unknown=tip, network='testnet', configured:unknown=profile):{api:UniverseApiService;get:ReturnType<typeof vi.fn>} {
 const get=vi.fn(()=>of(reply));return {get,api:new UniverseApiService({get} as any,{isBrowser:true,network:'signet',env:{UNIVERSE_CHAIN_NETWORKS:{fractal:network},FRACTAL_SOURCE_PROFILE:configured}} as any,{} as any)};
}
describe('Independent Fractal source and exact wire guards',()=>{
 it('serializes Fractal testnet independently of Bitcoin selection and preserves IBD observations',()=>{
  const {api,get}=service();let value:any;api.getFractalTip$().subscribe(v=>value=v);
  expect(get).toHaveBeenCalledWith('/api/v1/fractal/tip?network=testnet',{headers:{'Cache-Control':'no-store'}});expect(value.observation.ready).toBe(false);
 });
 it.each([['mainnet',profile],['signet',profile],['testnet',null],['testnet',{}],['testnet',{...profile,release:'0.5.0'}]])('refuses unsupported or unbound source before HTTP %s',(network,p)=>{
  const {api,get}=service(tip,network,p);let failure:any;api.getFractalTip$().subscribe({error:e=>failure=e});expect(failure).toBeInstanceOf(Error);expect(get).not.toHaveBeenCalled();
 });
 it.each([{...observation,network:'mainnet'},{...observation,blockOneHash:'b'.repeat(64)},{...observation,source:{...profile,configurationSha256:'f'.repeat(64)}},{...observation,source:{...profile,binarySha256:'f'.repeat(64)}}])('rejects foreign identity despite matching genesis',changed=>{
  expect(()=>validateFractalRead({...tip,observation:changed},'fractal-tip-v1',profile)).toThrow();
 });
 it('accepts exact public source JSON and rejects a malformed profile',()=>{expect(fractalProfile(JSON.stringify(profile))).toEqual(profile);expect(()=>fractalProfile('')).toThrow();});
 it('retains unobserved mempool facts as null and rejects fabricated fee statistics',()=>{
  const mempool={schema:'fractal-mempool-v1',observation,count:1,totalBytes:200,totalWeight:null,minFeeRate:null,maxFeeRate:null,medianFeeRate:null,pendingCat20TxCount:null,unavailable:['transaction weights']};
  expect(validateFractalRead(mempool,'fractal-mempool-v1',profile)).toBe(mempool);expect(()=>validateFractalRead({...mempool,medianFeeRate:0},'fractal-mempool-v1',profile)).toThrow();
 });
 it('preserves token atomic strings beyond Number precision and owner PKH without invented addresses',()=>{
  const p=page([token()],1,null);expect(validateFractalRead(p,'cat20-page-v1',profile).items[0].circulatingSupplyAtomic).toBe('9007199254740993');
  const holder=page([{ownerPubKeyHash:'a'.repeat(40),address:null,percentage:null,balanceAtomic:'9007199254740993'}],1,null);expect(()=>validateFractalRead(holder,'cat20-page-v1',profile)).not.toThrow();holder.items[0].address='bc1invented';expect(()=>validateFractalRead(holder,'cat20-page-v1',profile)).toThrow();
 });
 it('pins page checkpoint and rejects duplicates, source changes, empty continuation and false completion',()=>{
  const first=mergeCatPage(undefined,page([token('a')],2,'cursor'));
  for(const second of [page([],2,'next'),page([token('a')],2,null),page([],2,null),{...page([token('b')],2,null),checkpoint:{height:13,hash:'a'.repeat(64)}}]) expect(()=>mergeCatPage(first,second)).toThrow();
  expect(mergeCatPage(first,page([token('b')],2,null)).items.length).toBe(2);
 });
 it('distinguishes coinbase input from prevout and keeps unknown fee null',()=>{
  const transaction={schema:'fractal-transaction-v1',observation,txid:'a'.repeat(64),hash:'b'.repeat(64),version:2,size:100,weight:400,locktime:0,vin:[{coinbase:'51',sequence:4294967295}],vout:[{n:0,valueAtomic:'9007199254740993',scriptPubKey:{hex:'51'}}],feeAtomic:null,feeState:'unknown-prevouts',cat20State:'not-joined'};
  expect(()=>validateFractalRead(transaction,'fractal-transaction-v1',profile)).not.toThrow();
  expect(()=>validateFractalRead({...transaction,feeAtomic:'0'},'fractal-transaction-v1',profile)).toThrow();
  expect(()=>validateFractalRead({...transaction,vin:[{...transaction.vin[0],txid:'c'.repeat(64),vout:0}]},'fractal-transaction-v1',profile)).toThrow();
 });
 it('does not combine token facts with holders from a different checkpoint or total',()=>{
  const p=page([],0,null),t={...token(),observation:p.observation,checkpoint:p.checkpoint,trackerSourceRevision:p.trackerSourceRevision} as any;
  expect(()=>correlateCatHolders(t,p)).not.toThrow();
  expect(()=>correlateCatHolders(t,{...p,total:1})).toThrow();expect(()=>correlateCatHolders(t,{...p,checkpoint:{height:13,hash:'a'.repeat(64)}})).toThrow();
 });
 it('serializes bounded cursor and rejects invalid request inputs before transport',()=>{
  const {api,get}=service(page([],0,null));api.getCat20Tokens$({limit:50,cursor:'opaque+/=?'}).subscribe();expect(get.mock.calls[0][0]).toBe('/api/v1/fractal/cat20/tokens?limit=50&cursor=opaque%2B%2F%3D%3F&network=testnet');
  for(const request of [{limit:0},{limit:501},{limit:1.2},{cursor:''}]) {let error:any;api.getCat20Tokens$(request).subscribe({error:e=>error=e});expect(error).toBeInstanceOf(Error);}expect(get).toHaveBeenCalledTimes(1);
 });
 it('aborts pending transport on unsubscribe and gives this source a finite 15-second deadline',()=>{
  vi.useFakeTimers();try {const pending=new Subject<any>(),{api,get}=service();get.mockReturnValue(pending);const sub=api.getFractalTip$().subscribe();expect(pending.observed).toBe(true);sub.unsubscribe();expect(pending.observed).toBe(false);let error:any;api.getFractalTip$().subscribe({error:e=>error=e});vi.advanceTimersByTime(15000);expect(error?.name).toBe('TimeoutError');expect(pending.observed).toBe(false);}finally{vi.useRealTimers();}
 });
});
