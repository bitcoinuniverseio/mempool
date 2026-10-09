import {isolatedBackend,defaultMock,quietLogger} from '../../test-support/isolated-backend-helper';
import {addressSummaryProblems,utxoListProblems} from '../api/bitcoin/esplora-contract';

describe('Electrum capability probe composition',()=>{
  afterEach(()=>jest.useRealTimers());
  const stats={funded_txo_count:0,funded_txo_sum:0,spent_txo_count:0,spent_txo_sum:0,tx_count:0};
  function fixture(options:{badSummary?:boolean;badUtxos?:boolean;checkpointFailure?:boolean;slow?:boolean}={}) {
    const config={MEMPOOL:{NETWORK:'mainnet',BACKEND:'electrum'},ELECTRUM:{HOST:'127.0.0.1',PORT:50011},ESPLORA:{MAX_BEHIND_TIP:2}};
    const delay=<T>(value:T,ms:number)=>new Promise<T>(resolve=>setTimeout(()=>resolve(value),ms));
    const client={
      $getIndexedTip:jest.fn(async()=>100),
      $getAddress:jest.fn((address:string)=>delay(options.badSummary?{}:{address,chain_stats:stats,mempool_stats:stats},4500)),
      $getAddressUtxos:jest.fn(()=>delay(options.badUtxos?[{}]:[],options.slow?9000:7079)),
      $getIndexBlockHash:jest.fn(async()=> '1'.repeat(64)),
    };
    const verify=jest.fn(async(_tip:unknown,_hash:unknown,_core:unknown,_budget:unknown,signal?:AbortSignal)=>{
      if(options.checkpointFailure||signal?.aborted)throw new Error('source checkpoint refused');
      return {genesisHash:'0'.repeat(64),blockHeight:100,blockHash:'1'.repeat(64),network:'mainnet',signetChallenge:null,verifiedAt:new Date().toISOString()};
    });
    const address=isolatedBackend('api/bitcoin/address-index.ts',{
      '../../config':defaultMock(config),'../../logger':quietLogger,
      './esplora-contract':{addressSummaryProblems,utxoListProblems},
      './bitcoin-api-factory':defaultMock(client),'./address-source-checkpoint':{verifyAddressSource:verify},
    });
    const caps=isolatedBackend('api/capabilities.ts',{
      '../config':defaultMock(config),'../database':defaultMock({}), '../logger':quietLogger,
      './backend-info':defaultMock({getBackendInfo:()=>({chainSync:{blocks:100}})}),
      './common':{Common:{indexingEnabled:()=>false}},'./capabilities.optional':{$optionalCapabilityReports:async()=>({})},
      './bitcoin/address-index':address,
    }).default;
    return {caps,client,verify};
  }
  it('fits the actual 4.5s summary and 7.079s UTXO timings inside the unchanged 8s shared deadline',async()=>{
    jest.useFakeTimers();const {caps,client,verify}=fixture();const pending=caps.$addressLookupReport();
    await jest.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({state:'ready',indexedTip:100});
    expect(client.$getAddress).toHaveBeenCalledTimes(1);expect(client.$getAddressUtxos).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][4]).toBeInstanceOf(AbortSignal);
  });
  it.each(['badSummary','badUtxos','checkpointFailure'] as const)('never reports ready after %s',async failure=>{
    jest.useFakeTimers();const {caps}=fixture({[failure]:true});const pending=caps.$addressLookupReport();
    await jest.advanceTimersByTimeAsync(7079);expect((await pending).state).toBe('degraded');
  });
  it('retains the 8s unavailable deadline and refuses a late successful UTXO result',async()=>{
    jest.useFakeTimers();const {caps,verify}=fixture({slow:true});const pending=caps.$addressLookupReport();
    await jest.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({state:'unavailable',indexedTip:null,coverage:null});
    await jest.advanceTimersByTimeAsync(1000);expect(verify).not.toHaveBeenCalled();
  });
});
