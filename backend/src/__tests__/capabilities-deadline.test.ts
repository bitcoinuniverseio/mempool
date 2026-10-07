import {isolatedBackend,defaultMock,quietLogger} from '../../test-support/isolated-backend-helper';

describe('capability report address deadline',()=>{
  afterEach(()=>jest.useRealTimers());
  it('shares one slow probe, reports unknown data on timeout, and caches from completion',async()=>{
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const probe=jest.fn((_tip:number,selected:AbortSignal)=>{signal=selected;return new Promise(()=>{});});
    const subject:any=isolatedBackend('api/capabilities.ts',{
      '../config':defaultMock({MEMPOOL:{NETWORK:'mainnet',BACKEND:'electrum'},DATABASE:{ENABLED:true},STATISTICS:{ENABLED:true},ESPLORA:{MAX_BEHIND_TIP:2}}),
      '../database':defaultMock({query:async()=>[[{ready:1}]]}),
      '../logger':quietLogger,
      './backend-info':defaultMock({getBackendInfo:()=>({gitCommit:'test',chainSync:{blocks:100}})}),
      './common':{Common:{indexingEnabled:()=>false}},
      './capabilities.optional':{$optionalCapabilityReports:async()=>({})},
      './bitcoin/address-index':{$probeAddressIndex:probe,addressBackendKind:()=> 'electrum'},
    }).default;
    subject.$statisticsReport=async()=>({enabled:true,routesRegistered:true,state:'ready'});
    subject.$miningReport=async()=>({enabled:false,routesRegistered:true,state:'disabled'});
    subject.mempoolSize=()=>0;
    subject.markRoutesRegistered('addressLookup');
    const first=subject.$report(),second=subject.$report();
    await jest.advanceTimersByTimeAsync(8000);
    const [a,b]=await Promise.all([first,second]);
    expect(a).toBe(b);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(a.features.addressLookup).toMatchObject({state:'unavailable',coverage:null,rowCount:null});
    expect(a.features.addressLookup.dependencies[0]).toMatchObject({configured:true,reachable:false});
    await jest.advanceTimersByTimeAsync(5000);
    expect(await subject.$report()).toBe(a);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
