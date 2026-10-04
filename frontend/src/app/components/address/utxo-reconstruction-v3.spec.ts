import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { UtxoReconstructionComponent } from './utxo-reconstruction.component';
import { checkedReconstructionV3, UtxoReconstructionV3View } from './utxo-reconstruction-v3-view';
const address = 'tb1qpublictestaddress';
function initial(): UtxoReconstructionV3View {
  const cp = {genesisHash:'1'.repeat(64),blockHash:'2'.repeat(64),blockHeight:10,network:'signet',signetChallenge:'51',verifiedAt:'2026-10-03T00:00:00Z'};
  return {schema:'universe-address-utxo-reconstruction-v3',sessionId:'12345678-1234-1234-1234-123456789abc',address,network:'signet',cursor:0,status:'PARTIAL',observedAt:cp.verifiedAt,expiresAt:'2026-10-03T01:00:00Z',
    confirmedAnchor:{...cp,sourceId:'3'.repeat(64),scriptPubKey:'51',chainStats:{funded_txo_count:1,spent_txo_count:0,funded_txo_sum:66135,spent_txo_sum:0,tx_count:1}},
    latestObservedTip:{...cp},confirmedTailAnchor:null,mempoolAnchor:null,
    progress:{phase:'confirmed',pageLimit:100,confirmedEpoch:0,mempoolEpoch:0,confirmedTransactionsProcessed:0,confirmedTransactionsExpected:1,confirmedTailTransactionsProcessed:0,confirmedTailTransactionsExpected:null,mempoolTransactionsProcessed:0,mempoolTransactionsExpected:null,candidateOutputs:0,verifiedOutputs:0,retainedBytes:0}};
}
function acquired(): UtxoReconstructionV3View {
  const v=initial();v.cursor=1;v.latestObservedTip={...v.latestObservedTip,blockHeight:11,blockHash:'a'.repeat(64)};
  v.confirmedTailAnchor={checkpoint:{...v.latestObservedTip},chainStats:{...v.confirmedAnchor.chainStats,tx_count:2,spent_txo_count:1,spent_txo_sum:66135}};
  v.progress={...v.progress,phase:'outspends',confirmedTransactionsProcessed:1,confirmedTailTransactionsProcessed:1,confirmedTailTransactionsExpected:1,mempoolTransactionsExpected:0};
  v.mempoolAnchor={identity:'4'.repeat(64),observedAt:v.observedAt,checkpoint:{...v.latestObservedTip},addressMempoolStats:{funded_txo_count:0,spent_txo_count:0,funded_txo_sum:0,spent_txo_sum:0,tx_count:0}};return v;
}
function complete(): UtxoReconstructionV3View {const v=acquired();v.cursor=2;v.status='COMPLETE_AT_OBSERVED_TIP';v.progress.phase='complete';v.result={outputCount:0,balanceAtomic:'0',items:[]};return v;}
function reset(tail=true,cursor=2): UtxoReconstructionV3View {
  const v=acquired();v.cursor=cursor;v.reason=tail?'CONFIRMED_TAIL_CHANGED':'MEMPOOL_CHANGED';v.mempoolAnchor=null;v.progress.mempoolEpoch++;v.progress.mempoolTransactionsExpected=null;v.progress.phase=tail?'reconcile-confirmed':'acquire-mempool';
  if(tail){v.confirmedTailAnchor=null;v.progress.confirmedEpoch++;v.progress.confirmedTailTransactionsProcessed=0;v.progress.confirmedTailTransactionsExpected=null;}return v;
}
function setup(){const network=new BehaviorSubject('signet'),http={post:vi.fn().mockReturnValue(of(initial())),delete:vi.fn().mockReturnValue(of({}))};
  const c=new UtxoReconstructionComponent(http as any,{network:'signet',networkChanged$:network,env:{ROOT_NETWORK:'mainnet'}} as any,{markForCheck:vi.fn()} as any);c.address=address;c.ngOnInit();c.selectVersion('v3');return{c,http,network};}
describe('explicit V3 live confirmed tail',()=>{
  it('requires exact original/tail/mempool closure before eligible outputs',()=>{
    expect(checkedReconstructionV3(complete(),address,'signet',acquired(),'next').result.balanceAtomic).toBe('0');
    for(const mutate of [v=>v.confirmedAnchor.verifiedAt='2026-10-03T00:01:00Z',v=>v.confirmedTailAnchor=null,v=>v.progress.confirmedTailTransactionsProcessed=0,v=>v.confirmedTailAnchor.chainStats.tx_count=3,v=>v.mempoolAnchor.checkpoint.blockHash='b'.repeat(64),v=>v.result.balanceAtomic='1']){
      const v=complete();mutate(v);expect(()=>checkedReconstructionV3(v,address,'signet',acquired(),'next')).toThrow();}
  });
  it('retains only closed original prefix on tail reset and explicit lost-response reset replay',()=>{
    for(const cursor of [2,3])expect(checkedReconstructionV3(reset(true,cursor),address,'signet',acquired(),'next').progress.confirmedTransactionsProcessed).toBe(1);
    for(const mutate of [v=>v.progress.confirmedEpoch=0,v=>v.progress.mempoolEpoch=0,v=>v.confirmedTailAnchor=acquired().confirmedTailAnchor,v=>v.progress.confirmedTransactionsProcessed=0,v=>v.cursor=4,v=>v.result=complete().result]){
      const v=reset();mutate(v);expect(()=>checkedReconstructionV3(v,address,'signet',acquired(),'next')).toThrow();}
  });
  it('preserves closed tail on mempool reset but rejects changed tail or epoch',()=>{
    expect(checkedReconstructionV3(reset(false),address,'signet',acquired(),'next').confirmedTailAnchor).toEqual(acquired().confirmedTailAnchor);
    for(const mutate of [v=>v.confirmedTailAnchor=null,v=>v.confirmedTailAnchor.chainStats.funded_txo_sum++,v=>v.progress.confirmedEpoch++]){const v=reset(false);mutate(v);expect(()=>checkedReconstructionV3(v,address,'signet',acquired(),'next')).toThrow();}
  });
  it('allows independently reproved above-original reorg before tail acquisition, requires reset after acquisition',()=>{
    const previous=initial();previous.cursor=1;previous.latestObservedTip={...previous.latestObservedTip,blockHeight:12,blockHash:'c'.repeat(64)};
    const next=acquired();next.cursor=2;expect(checkedReconstructionV3(next,address,'signet',previous,'next').latestObservedTip.blockHeight).toBe(11);
    const stale=acquired();stale.cursor=2;stale.latestObservedTip.blockHash='b'.repeat(64);expect(()=>checkedReconstructionV3(stale,address,'signet',acquired(),'next')).toThrow();
    const cleared=reset();cleared.latestObservedTip={...cleared.latestObservedTip,blockHeight:10,blockHash:'2'.repeat(64)};expect(checkedReconstructionV3(cleared,address,'signet',acquired(),'next').confirmedTailAnchor).toBeNull();
    cleared.latestObservedTip.blockHash='b'.repeat(64);expect(()=>checkedReconstructionV3(cleared,address,'signet',acquired(),'next')).toThrow();
  });
  it('requires final accounting to match even a self-consistent forged output list',()=>{
    const v=complete();v.progress.candidateOutputs=1;v.progress.verifiedOutputs=1;
    v.result={outputCount:1,balanceAtomic:'1',items:[{txid:'5'.repeat(64),vout:0,valueAtomic:'1',status:{confirmed:false}}]};
    expect(()=>checkedReconstructionV3(v,address,'signet',acquired(),'next')).toThrow('accounting');
  });
  it('requires explicit manual progress after reset and publishes only reacquired final closure',()=>{
    const {c,http}=setup();c.start();http.post.mockReturnValueOnce(of(acquired()));c.advance();http.post.mockReturnValueOnce(of(reset()));c.advance();
    expect(c.v3View.progress.confirmedEpoch).toBe(1);expect(c.mempoolIdentity).toBe('not acquired');expect(c.visibleOutputs).toEqual([]);expect(http.post).toHaveBeenCalledTimes(3);
    const final=complete();final.cursor=3;final.progress.confirmedEpoch=1;final.progress.mempoolEpoch=1;
    http.post.mockReturnValueOnce(of(final));c.advance();expect(c.view.status).toBe('COMPLETE_AT_OBSERVED_TIP');expect(c.view.result.balanceAtomic).toBe('0');c.ngOnDestroy();
  });
  it('rejects implicit open-tail reset and capacity overflow; terminal release has no outputs',()=>{
    const previous=initial();previous.cursor=1;previous.progress.phase='reconcile-confirmed';previous.progress.confirmedTransactionsProcessed=1;previous.progress.confirmedTailTransactionsExpected=2;previous.progress.confirmedTailTransactionsProcessed=1;
    const next=structuredClone(previous);next.cursor=2;next.progress.confirmedTailTransactionsExpected=3;
    expect(()=>checkedReconstructionV3(next,address,'signet',previous,'next')).toThrow();
    const invalid=acquired();invalid.status='INVALIDATED';invalid.progress.candidateOutputs=0;invalid.progress.retainedBytes=0;
    expect(checkedReconstructionV3(invalid,address,'signet',acquired(),'next').result).toBeUndefined();
    invalid.progress.retainedBytes=1;expect(()=>checkedReconstructionV3(invalid,address,'signet',acquired(),'next')).toThrow();
    const tooMany=initial();tooMany.progress.confirmedEpoch=17;expect(()=>checkedReconstructionV3(tooMany,address,'signet')).toThrow();
  });
  it('uses only opt-in V3 endpoint, bounded retry/pending guard and old-context cleanup',()=>{
    const {c,http,network}=setup();c.start();expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v3`,{});
    http.post.mockReturnValueOnce(of(acquired()));c.advance();http.post.mockReturnValueOnce(throwError(()=>({error:{error:'Unavailable',phase:'reconcile-confirmed'}})));c.advance();expect(c.view.cursor).toBe(1);expect(c.error).toContain('Failed phase: reconcile-confirmed');
    const pending=new Subject();http.post.mockReturnValueOnce(pending);c.advance();c.advance();expect(http.post).toHaveBeenCalledTimes(4);expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v3/${initial().sessionId}/next`,{cursor:1});
    network.next('testnet4');expect(pending.observed).toBe(false);expect(c.view).toBeNull();expect(http.delete).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v3/${initial().sessionId}`);pending.next(complete());expect(c.visibleOutputs).toEqual([]);c.ngOnDestroy();
  });
});
