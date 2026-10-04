import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { checkedReconstructionV4, reconstructionOutputDigest, UtxoReconstructionV4View } from './utxo-reconstruction-v4-view';
import { UtxoReconstructionComponent } from './utxo-reconstruction.component';
import { readFileSync } from 'node:fs';
const address = 'tb1qpublictestaddress';
function initial(): UtxoReconstructionV4View {
  const cp = { genesisHash:'1'.repeat(64), blockHash:'2'.repeat(64), blockHeight:10, network:'signet', signetChallenge:'51', verifiedAt:'2026-10-03T00:00:00Z' };
  return { schema:'universe-address-utxo-reconstruction-v4', sessionId:'12345678-1234-1234-1234-123456789abc', address, network:'signet', cursor:0,
    status:'PARTIAL', observedAt:cp.verifiedAt, expiresAt:'2026-10-03T01:00:00Z',
    confirmedAnchor:{...cp,sourceId:'3'.repeat(64),scriptPubKey:'51',chainStats:{funded_txo_count:1,spent_txo_count:0,funded_txo_sum:66135,spent_txo_sum:0,tx_count:1}},
    latestObservedTip:{...cp},confirmedTailAnchor:null,mempoolAnchor:null,
    progress:{phase:'confirmed',pageLimit:100,confirmedEpoch:0,mempoolEpoch:0,confirmedTransactionsProcessed:0,confirmedTransactionsExpected:1,
      confirmedTailTransactionsProcessed:0,confirmedTailTransactionsExpected:null,mempoolTransactionsProcessed:0,mempoolTransactionsExpected:null,candidateOutputs:0,verifiedOutputs:0,retainedBytes:0},
    globalMempoolProof:{mode:'uninitialized',fallbackReason:null,maximumTransactions:100,maximumRetainedBytes:524288,retainedBytes:0,
      transactionCount:null,sequenceAtomic:null,initialIdentity:null,transitionCount:0,maximumTransitions:128,maximumRetainedTransitions:8,transitions:[],verifiedOutputContext:null} };
}
function acquired(): UtxoReconstructionV4View {
  const v=initial();v.cursor=1;v.progress={...v.progress,phase:'outspends',confirmedTransactionsProcessed:1,confirmedTailTransactionsExpected:0,mempoolTransactionsExpected:0,candidateOutputs:1,retainedBytes:100};
  v.confirmedTailAnchor={checkpoint:{...v.latestObservedTip},chainStats:{...v.confirmedAnchor.chainStats}};
  v.mempoolAnchor={identity:'4'.repeat(64),observedAt:v.observedAt,checkpoint:{...v.latestObservedTip},addressMempoolStats:{funded_txo_count:0,spent_txo_count:0,funded_txo_sum:0,spent_txo_sum:0,tx_count:0}};
  v.globalMempoolProof={...v.globalMempoolProof,mode:'irrelevant-delta-proof',initialIdentity:'4'.repeat(64),transactionCount:0,sequenceAtomic:'0'};return v;
}
function complete(): UtxoReconstructionV4View {
  const v=acquired();v.cursor=2;v.status='COMPLETE_AT_OBSERVED_TIP';v.progress.phase='complete';v.progress.verifiedOutputs=1;
  v.result={outputCount:1,balanceAtomic:'66135',items:[{txid:'a'.repeat(64),vout:0,valueAtomic:'66135',status:{confirmed:true,block_height:10,block_hash:'2'.repeat(64),block_time:1}}]};
  v.globalMempoolProof.verifiedOutputContext={identity:v.mempoolAnchor.identity,checkpoint:{...v.latestObservedTip},outputCount:1,outpointsSha256:reconstructionOutputDigest(v)};return v;
}
function transition(): UtxoReconstructionV4View {
  const v=complete();v.mempoolAnchor={...v.mempoolAnchor,identity:'5'.repeat(64),observedAt:'2026-10-03T00:00:01Z'};
  v.observedAt='2026-10-03T00:00:01Z';
  v.globalMempoolProof.transitionCount=1;v.globalMempoolProof.transactionCount=1;v.globalMempoolProof.sequenceAtomic='1';
  v.globalMempoolProof.transitions=[{transition:1,fromIdentity:'4'.repeat(64),toIdentity:'5'.repeat(64),addedTxids:['b'.repeat(64)],removedTxids:[],proofSha256:'c'.repeat(64),observedAt:v.mempoolAnchor.observedAt,verifiedOutputsRetained:0}];
  v.globalMempoolProof.verifiedOutputContext.identity=v.mempoolAnchor.identity;return v;
}
describe('explicit bounded V4 global transition consumer',()=>{
  it('accepts the preserved actual native complete-zero receipt with refreshed canonical measurement',()=>{
    const fixture=JSON.parse(readFileSync('src/app/components/address/utxo-reconstruction-v4-native-measurement.fixture.json','utf8'));
    const result=checkedReconstructionV4(fixture.value,fixture.address,'signet',fixture.previous,'next');
    expect(result.result.items).toEqual([]);expect(result.globalMempoolProof.transitionCount).toBe(1);
    expect(result.mempoolAnchor.checkpoint.blockHash).toBe(fixture.previous.mempoolAnchor.checkpoint.blockHash);
    expect(result.mempoolAnchor.checkpoint.verifiedAt).not.toBe(fixture.previous.mempoolAnchor.checkpoint.verifiedAt);
  });
  it('requires all V3 closures plus exact ordered eligible output digest/current context',()=>{
    expect(checkedReconstructionV4(complete(),address,'signet',acquired(),'next').result.balanceAtomic).toBe('66135');
    for(const mutate of [v=>v.globalMempoolProof.verifiedOutputContext=null,v=>v.globalMempoolProof.verifiedOutputContext.outpointsSha256='f'.repeat(64),
      v=>v.globalMempoolProof.verifiedOutputContext.identity='f'.repeat(64),v=>v.result.items[0].valueAtomic='66134',v=>v.confirmedTailAnchor=null]) {
      const v=complete();mutate(v);expect(()=>checkedReconstructionV4(v,address,'signet',acquired(),'next')).toThrow();
    }
  });
  it('accepts only a continuous bounded bridge for unrelated global identity changes',()=>{
    expect(checkedReconstructionV4(transition(),address,'signet',acquired(),'next').mempoolAnchor.identity).toBe('5'.repeat(64));
    for(const mutate of [v=>v.globalMempoolProof.transitions=[],v=>v.globalMempoolProof.transitions[0].fromIdentity='f'.repeat(64),
      v=>v.globalMempoolProof.transitions[0].transition=2,v=>v.globalMempoolProof.transitions[0].addedTxids=[],
      v=>v.mempoolAnchor.observedAt='2026-10-03T00:00:02Z',v=>v.mempoolAnchor.addressMempoolStats.tx_count=1,
      v=>v.globalMempoolProof.mode='strict-global-fallback',v=>v.globalMempoolProof.transitions[0].verifiedOutputsRetained=2]) {
      const v=transition();mutate(v);expect(()=>checkedReconstructionV4(v,address,'signet',acquired(),'next')).toThrow();
    }
  });
  it('retains a proved round-trip global transition and rejects gaps in the retained bridge',()=>{
    const v=transition(),first=v.globalMempoolProof.transitions[0];v.globalMempoolProof.transitionCount=2;
    v.globalMempoolProof.transitions.push({...first,transition:2,fromIdentity:first.toIdentity,toIdentity:first.fromIdentity,
      addedTxids:[],removedTxids:first.addedTxids,observedAt:'2026-10-03T00:00:02Z'});
    v.mempoolAnchor.identity=first.fromIdentity;v.mempoolAnchor.observedAt='2026-10-03T00:00:02Z';
    v.observedAt='2026-10-03T00:00:02Z';
    v.globalMempoolProof.verifiedOutputContext.identity=first.fromIdentity;
    expect(checkedReconstructionV4(v,address,'signet',acquired(),'next').globalMempoolProof.transitionCount).toBe(2);
    v.globalMempoolProof.transitions.shift();expect(()=>checkedReconstructionV4(v,address,'signet',acquired(),'next')).toThrow();
  });
  it('accepts a freshly measured same-canonical checkpoint only through the proved bridge and rejects source/time changes',()=>{
    const v=transition();v.mempoolAnchor.checkpoint.verifiedAt='2026-10-03T00:00:01Z';
    v.globalMempoolProof.verifiedOutputContext.checkpoint={...v.mempoolAnchor.checkpoint};
    expect(checkedReconstructionV4(v,address,'signet',acquired(),'next').mempoolAnchor.checkpoint.verifiedAt).toBe(v.observedAt);
    for(const mutate of [next=>next.mempoolAnchor.checkpoint.blockHash='f'.repeat(64),next=>next.mempoolAnchor.checkpoint.blockHeight++,
      next=>next.mempoolAnchor.checkpoint.network='mainnet',next=>next.mempoolAnchor.checkpoint.genesisHash='f'.repeat(64),
      next=>next.mempoolAnchor.checkpoint.signetChallenge='52',next=>next.mempoolAnchor.checkpoint.sourceId='f'.repeat(64),
      next=>next.mempoolAnchor.checkpoint.verifiedAt='2026-10-02T23:59:59Z',next=>next.mempoolAnchor.checkpoint.verifiedAt='2026-10-03T00:00:02Z']) {
      const next=structuredClone(v);mutate(next);next.globalMempoolProof.verifiedOutputContext.checkpoint={...next.mempoolAnchor.checkpoint};
      expect(()=>checkedReconstructionV4(next,address,'signet',acquired(),'next')).toThrow();
    }
  });
  it('requires a fenced empty output digest even when the complete balance is zero',()=>{
    const v=complete();v.confirmedTailAnchor.chainStats={...v.confirmedTailAnchor.chainStats,spent_txo_count:1,spent_txo_sum:66135,tx_count:2};
    v.progress.confirmedTailTransactionsExpected=1;v.progress.confirmedTailTransactionsProcessed=1;v.progress.candidateOutputs=0;v.progress.verifiedOutputs=0;
    v.result={outputCount:0,balanceAtomic:'0',items:[]};v.globalMempoolProof.verifiedOutputContext={identity:v.mempoolAnchor.identity,
      checkpoint:{...v.latestObservedTip},outputCount:0,outpointsSha256:reconstructionOutputDigest(v)};
    const prior=structuredClone(v);prior.cursor=1;prior.status='PARTIAL';prior.progress.phase='outspends';delete prior.result;prior.globalMempoolProof.verifiedOutputContext=null;
    expect(checkedReconstructionV4(v,address,'signet',prior,'next').result.items).toEqual([]);
    v.globalMempoolProof.verifiedOutputContext=null;expect(()=>checkedReconstructionV4(v,address,'signet',prior,'next')).toThrow();
  });
  it('keeps strict unknown/relevant fallback resets partial with no eligible outputs',()=>{
    const old=acquired(),v=acquired();v.cursor=2;v.reason='ADDRESS_RELEVANT_GLOBAL_TRANSACTION';v.progress.mempoolEpoch=1;v.progress.phase='acquire-mempool';
    v.progress.mempoolTransactionsExpected=null;v.progress.candidateOutputs=0;v.mempoolAnchor=null;v.globalMempoolProof=initial().globalMempoolProof;
    expect(checkedReconstructionV4(v,address,'signet',old,'next').result).toBeUndefined();
    const stale=complete();stale.reason=v.reason;stale.progress.mempoolEpoch=1;expect(()=>checkedReconstructionV4(stale,address,'signet',old,'next')).toThrow();
  });
  it('rejects over-bound cache and unsafe sequence or transition counters',()=>{
    for(const mutate of [v=>v.globalMempoolProof.retainedBytes=524289,v=>v.globalMempoolProof.transactionCount=101,
      v=>v.globalMempoolProof.sequenceAtomic='18446744073709551616',v=>v.globalMempoolProof.transitionCount=129]) {
      const v=acquired();mutate(v);expect(()=>checkedReconstructionV4(v,address,'signet')).toThrow();
    }
  });
  it('binds explicit V4 path, preserves same-scope refresh, cancels pending request on actual context change',()=>{
    const network=new BehaviorSubject('signet'),pending=new Subject(),http={post:vi.fn().mockReturnValueOnce(of(initial())).mockReturnValueOnce(pending),delete:vi.fn().mockReturnValue(of({}))};
    const c=new UtxoReconstructionComponent(http as any,{network:'signet',networkChanged$:network,env:{ROOT_NETWORK:'mainnet'}} as any,{markForCheck:vi.fn()} as any);
    c.address=address;c.ngOnInit();c.selectVersion('v4');c.start();expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v4`,{});
    c.nativeSourceState='loading';c.ngOnChanges({nativeSourceState:{} as any});expect(c.view?.sessionId).toBe(initial().sessionId);
    c.advance();c.advance();expect(http.post).toHaveBeenCalledTimes(2);expect(pending.observed).toBe(true);
    network.next('testnet4');expect(pending.observed).toBe(false);expect(c.view).toBeNull();
    expect(http.delete).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v4/${initial().sessionId}`);
    pending.next(complete());expect(c.visibleOutputs).toEqual([]);c.ngOnDestroy();
  });
  it('binds an empty route prefix to independently configured Signet root rather than Mainnet',()=>{
    const network=new BehaviorSubject(''),http={post:vi.fn().mockReturnValue(of(initial())),delete:vi.fn().mockReturnValue(of({}))};
    const c=new UtxoReconstructionComponent(http as any,{network:'',networkChanged$:network,env:{ROOT_NETWORK:'signet'}} as any,{markForCheck:vi.fn()} as any);
    c.address=address;c.ngOnInit();c.selectVersion('v4');c.start();expect(http.post).toHaveBeenLastCalledWith(`/api/v1/address/${address}/utxo-reconstruction/v4`,{});
    expect(c.view?.network).toBe('signet');expect(c.error).toBeNull();network.next('');expect(c.view?.sessionId).toBe(initial().sessionId);
    network.next('testnet4');expect(c.view).toBeNull();expect(http.delete).toHaveBeenLastCalledWith(`/api/v1/address/${address}/utxo-reconstruction/v4/${initial().sessionId}`);c.ngOnDestroy();
  });
});
