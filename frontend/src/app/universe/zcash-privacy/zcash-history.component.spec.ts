import { describe, expect, it, vi } from 'vitest';
import { Subject, firstValueFrom, of, throwError } from 'rxjs';
import { ZcashHistoryComponent } from './zcash-history.component';
import { checkedZcashHistory, signedZec } from './zcash-history-view';

function receipt(through = 16, tip = 32): any {
  const hash = (index: number) => index.toString(16).padStart(64, '0');
  return {schema: 'zcash-pool-history-v1', network: 'testnet', status: through === tip ? 'COMPLETE_WINDOW_AT_OBSERVED_TIP' : 'PARTIAL',
    source: {implementation: 'zebra', genesis: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38', tipHash: hash(tip), branchId: '76b809bb', nextBranchId: '76b809bb', observedAt: '2026-10-04T00:00:00Z'},
    tipHeight: tip, windowSize: 144, pageSize: 16, nextHeight: through === tip ? null : through + 1,
    verifiedThrough: {height: through, hash: hash(through)}, coverage: {fromHeight: 1, throughHeight: through, wholeChainHistory: false, grossFlows: 'unavailable', poolTransactionCounts: 'unavailable'},
    blocks: Array.from({length: through}, (_, index) => ({height: index + 1, hash: hash(index + 1), parent: hash(index), timestamp: 1000 + index,
      supplyZat: '9007199254740993', pools: ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'].map((id, pool) => ({id, balanceZat: pool === 0 ? String(9007199254740993n - BigInt(index)) : pool === 3 ? String(index) : '0', netChangeZat: pool === 0 ? '-1' : pool === 3 ? '1' : '0', monitored: true}))})),
    reorgRecovered: false, priorSnapshotArchivedThisRequest: false, interruptedWriteRecovered: false};
}
function fixture(read: any) {
  const networkChanged$ = new Subject<string>();
  const component = new ZcashHistoryComponent({getZcashPrivacyHistory$: read, chainNetwork: () => 'testnet'} as any, {networkChanged$} as any);
  component.ngOnInit(); return {component, networkChanged$};
}
describe('Manual best-chain Zcash net history consumer', () => {
  it('rejects a short complete window while preserving a warm partial window and complete cached window', () => {
    const short=receipt(1,1);short.tipHeight=1000;short.source.tipHash='a'.repeat(64);
    short.blocks[0]={...short.blocks[0],height:1000,hash:'a'.repeat(64),parent:'b'.repeat(64)};
    short.verifiedThrough={height:1000,hash:'a'.repeat(64)};short.coverage.fromHeight=1000;short.coverage.throughHeight=1000;
    expect(()=>checkedZcashHistory(short,'testnet')).toThrow();
    const partial=receipt(16,1001), hash=(height:number)=>height.toString(16).padStart(64,'0');
    partial.blocks=partial.blocks.map(block=>({...block,height:block.height+856,hash:hash(block.height+856),parent:hash(block.height+855)}));
    partial.coverage={...partial.coverage,fromHeight:857,throughHeight:872};partial.verifiedThrough={height:872,hash:hash(872)};partial.nextHeight=873;
    expect(checkedZcashHistory(partial,'testnet').status).toBe('PARTIAL');
    expect(checkedZcashHistory(receipt(144,144),'testnet').blocks).toHaveLength(144);
  });
  it('renders signed atomic values exactly and accepts independent bounded continuation', () => {
    expect(signedZec('-9007199254740993')).toBe('-90071992.54740993'); expect(signedZec('-1')).toBe('-0.00000001');
    const first = checkedZcashHistory(receipt(), 'testnet');
    expect(checkedZcashHistory(receipt(32), 'testnet', first).status).toBe('COMPLETE_WINDOW_AT_OBSERVED_TIP');
  });
  it.each(['foreign-network', 'broken-parent', 'incorrect-net', 'duplicate-pool', 'false-complete', 'gross-flow-claim', 'tip-change', 'no-progress', 'changed-prefix'])('rejects %s rather than claiming history coverage', mutation => {
    const first = receipt(), next = receipt(32);
    if (mutation === 'foreign-network') next.network = 'mainnet';
    if (mutation === 'broken-parent') next.blocks[18].parent = 'f'.repeat(64);
    if (mutation === 'incorrect-net') next.blocks[18].pools[0].netChangeZat = '0';
    if (mutation === 'duplicate-pool') next.blocks[18].pools[5].id = 'sprout';
    if (mutation === 'false-complete') next.verifiedThrough.hash = 'f'.repeat(64);
    if (mutation === 'gross-flow-claim') next.coverage.grossFlows = 'complete';
    if (mutation === 'tip-change') next.source.tipHash = 'f'.repeat(64);
    if (mutation === 'no-progress') Object.assign(next, first);
    if (mutation === 'changed-prefix') next.blocks[0].timestamp++;
    expect(() => checkedZcashHistory(next, 'testnet', first)).toThrow();
  });
  it('starts only on explicit action, prevents concurrent requests, retains accepted evidence on failure and retries same continuation', async () => {
    const pending = new Subject<any>();
    const read = vi.fn().mockReturnValueOnce(of(receipt())).mockReturnValueOnce(pending).mockReturnValueOnce(throwError(() => ({error: {error: 'Source unavailable'}}))).mockReturnValue(of(receipt(32)));
    const {component} = fixture(read); expect(read).not.toHaveBeenCalled(); component.start(); component.continueWindow(); component.continueWindow(); expect(read).toHaveBeenCalledTimes(2);
    pending.error({status: 503}); const failed = await firstValueFrom(component.vm$); expect(failed.history.verifiedThrough.height).toBe(16); expect(failed.error).toBeTruthy();
    component.retry(); expect((await firstValueFrom(component.vm$)).error).toBe('Source unavailable'); component.retry(); expect((await firstValueFrom(component.vm$)).history.status).toBe('COMPLETE_WINDOW_AT_OBSERVED_TIP'); component.ngOnDestroy();
  });
  it('cancels context and destroy reads, clears prior network evidence and refuses later requests', async () => {
    const first = new Subject<any>(), second = new Subject<any>(); const read = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const {component, networkChanged$} = fixture(read); component.start(); expect(first.observed).toBe(true); networkChanged$.next('signet'); expect(first.observed).toBe(false); expect((await firstValueFrom(component.vm$)).history).toBeUndefined();
    component.start(); component.ngOnDestroy(); expect(second.observed).toBe(false); component.start(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('local cancellation never claims the server ledger was rolled back', async () => {
    const pending = new Subject<any>(); const {component} = fixture(vi.fn(() => pending)); component.start(); component.cancel(); expect(pending.observed).toBe(false);
    expect((await firstValueFrom(component.vm$)).error).toContain('server may have committed'); component.ngOnDestroy();
  });
});
