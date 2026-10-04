import { describe,expect,it,vi } from 'vitest';
import { of } from 'rxjs';
import { UniverseApiService } from '../universe-api.service';
import { nativeInput,nativeSource,nativeVerdict,batchPage,nativeBatch } from './ark-native-test-fixtures';

function setup(network='',root='signet'){
  const state={isBrowser:true,network,env:{ROOT_NETWORK:root}};
  const get=vi.fn(() => of(batchPage()));const post=vi.fn(() => of(nativeVerdict));
  const api=new UniverseApiService({get,post} as any,state as any,{} as any);
  return {api,state,get,post};
}
describe('Native Ark selected-source HTTP contract',()=>{
  it('serializes bounded scalar native window and keeps actual rootSignet prefix/no-store',()=>{
    const {api,get}=setup();let observed:any;
    api.getArkBatches$({after:'0',limit:10}).subscribe(value=>observed=value);
    expect(get).toHaveBeenCalledWith('/api/v1/ark/batches',{params:{after:'0',limit:'10'},headers:{'Cache-Control':'no-store'}});
    expect(observed.total).toBeNull();expect(observed.page.completeCatalogue).toBe(false);
  });
  it('binds explicit Signet paths and exact before selector at subscription time',()=>{
    const {api,state,get}=setup('','mainnet');const read=api.getArkBatches$({after:'100',before:'200',limit:1});
    state.network='signet';get.mockImplementation(()=>of({batches:[],total:null,page:{...batchPage().page,after:'100',before:'200',limit:1}}));
    read.subscribe();expect(get.mock.calls[0][0]).toBe('/signet/api/v1/ark/batches');
    expect(get.mock.calls[0][1].params).toEqual({after:'100',before:'200',limit:'1'});
  });
  it('rejects changed selectors or numeric complete total before presenting rows',()=>{
    const {api,get}=setup();get.mockImplementation(()=>of({...batchPage(),total:0} as any));let error:any;
    api.getArkBatches$().subscribe({error:e=>error=e});expect(error).toBeTruthy();
  });
  it('submits only the new full native proof route in the selected source context',()=>{
    const {api,post}=setup('signet','mainnet');api.verifyArkNativeProof$(nativeInput).subscribe();
    expect(post).toHaveBeenCalledWith('/signet/api/v1/ark/verify/native',nativeInput,{headers:{'Cache-Control':'no-store'}});
    const foreign=setup('mainnet');let error:any;foreign.api.verifyArkNativeProof$(nativeInput).subscribe({error:e=>error=e});
    expect(error).toBeTruthy();expect(foreign.post).not.toHaveBeenCalled();
  });
  it('rejects a foreign source in native detail even when the UUID matches',()=>{
    const {api,get}=setup();const row=structuredClone(nativeBatch);row.source.profile.network='mainnet' as any;
    get.mockImplementation(()=>of(row as any));let error:any;api.getArkBatch$(row.batchId).subscribe({error:e=>error=e});
    expect(error.message).toContain('foreign');
  });
  it('accepts actual nullable operator source facts without synthesizing inventory',()=>{
    const {api,get}=setup();get.mockImplementation(()=>of({operators:[{id:nativeSource.profile.providerId,name:'Native ASP',aspPubkey:nativeSource.info.signerPubkey,
      status:'observed',activeVtxoCount:null,currentBatchHeight:null,totalVolumeSats:null,roundIntervalSec:null,
      providerVersion:nativeSource.info.version,sessionDurationSeconds:nativeSource.info.sessionDurationSeconds,source:nativeSource}],total:1} as any));
    let observed:any;api.getArkOperators$().subscribe(value=>observed=value);expect(observed.operators[0].activeVtxoCount).toBeNull();
    expect(get.mock.calls[0][1].headers['Cache-Control']).toBe('no-store');
  });
});
