import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { checkedReconstruction, atomicBtc, UtxoReconstructionView } from './utxo-reconstruction-view';
import { UtxoReconstructionComponent } from './utxo-reconstruction.component';

const address = 'tb1qpublictestaddress';
function fixture(): UtxoReconstructionView {
  return { schema: 'universe-address-utxo-reconstruction-v1', sessionId: '12345678-1234-1234-1234-123456789abc', cursor: 0,
    address, network: 'signet', status: 'PARTIAL', source: { genesisHash: '1'.repeat(64), blockHeight: 10, blockHash: '2'.repeat(64),
      network: 'signet', signetChallenge: '51', verifiedAt: '2026-10-03T00:00:00Z', sourceId: '3'.repeat(64),
      mempoolIdentity: '4'.repeat(64), scriptPubKey: '51' }, observedAt: '2026-10-03T00:00:00Z', expiresAt: '2026-10-03T00:30:00Z',
    progress: { phase: 'confirmed', confirmedTransactionsProcessed: 0, confirmedTransactionsExpected: 1,
      mempoolTransactionsProcessed: 0, mempoolTransactionsExpected: 0, candidateOutputs: 0, verifiedOutputs: 0, retainedBytes: 0 } };
}
function completed(): UtxoReconstructionView {
  const value = fixture(); value.cursor = 1; value.status = 'COMPLETE_AT_OBSERVED_TIP';
  value.progress = { ...value.progress, phase: 'complete', confirmedTransactionsProcessed: 1, candidateOutputs: 1, verifiedOutputs: 1 };
  value.result = { outputCount: 1, balanceAtomic: '66135', items: [{ txid: '5'.repeat(64), vout: 0, valueAtomic: '66135',
    status: { confirmed: true, block_height: 9, block_hash: '6'.repeat(64), block_time: 123 } }] };
  return value;
}
function setup() {
  const network = new BehaviorSubject('signet');
  const http = { post: vi.fn().mockReturnValue(of(fixture())), delete: vi.fn().mockReturnValue(of({})) };
  const component = new UtxoReconstructionComponent(http as any, { network: 'signet', networkChanged$: network,
    env: { ROOT_NETWORK: 'mainnet' } } as any, { markForCheck: vi.fn() } as any);
  component.address = address; component.ngOnInit(); return { component, http, network };
}
afterEach(() => vi.useRealTimers());

describe('explicit anchored output reconstruction', () => {
  it('publishes no eligible outputs until matching exact closure receipt arrives', () => {
    const { component, http } = setup(); component.start();
    expect(component.view.status).toBe('PARTIAL'); expect(component.visibleOutputs).toEqual([]);
    expect(http.post).toHaveBeenCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction`, {});
    http.post.mockReturnValueOnce(of(completed())); component.advance();
    expect(component.view.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(component.visibleOutputs.length).toBe(1);
    expect(component.btc(component.view.result.balanceAtomic)).toBe('0.00066135');
    expect(component.txPath('5'.repeat(64))).toBe('/signet/tx/' + '5'.repeat(64));
  });
  it('requires manual progress, guards pending dispatch and retries the same accepted cursor after transport failure', () => {
    const { component, http } = setup(); component.start();
    expect(http.post).toHaveBeenCalledOnce();
    const pending = new Subject(); http.post.mockReturnValueOnce(pending); component.advance(); component.advance();
    expect(http.post).toHaveBeenCalledTimes(2);
    pending.error({ error: { error: 'controlled deadline' } });
    expect(component.view.cursor).toBe(0); expect(component.error).toBe('controlled deadline');
    http.post.mockReturnValueOnce(of(completed())); component.advance();
    expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/${fixture().sessionId}/next`, { cursor: 0 });
  });
  it('clears and cancels old-network projection without feeding native output inventory', () => {
    const { component, http, network } = setup(); component.start();
    const pending = new Subject(); http.post.mockReturnValueOnce(pending); component.advance(); network.next('testnet4');
    expect(pending.observed).toBe(false); expect(component.view).toBeNull(); expect(component.visibleOutputs).toEqual([]);
    expect(http.delete).toHaveBeenCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/${fixture().sessionId}`);
    pending.next(completed()); expect(component.view).toBeNull();
  });
  it('retains partial progress after malformed responses and invalidates only on an explicit valid terminal receipt', () => {
    const { component, http } = setup(); component.start();
    const invalid = completed(); invalid.result.balanceAtomic = '1'; http.post.mockReturnValueOnce(of(invalid)); component.advance();
    expect(component.view.status).toBe('PARTIAL'); expect(component.visibleOutputs).toEqual([]); expect(component.error).toContain('sum');
    http.post.mockReturnValueOnce(of({ ...fixture(), status: 'INVALIDATED', reason: 'Observed tip changed' })); component.advance();
    expect(component.view.status).toBe('INVALIDATED'); expect(component.visibleOutputs).toEqual([]);
  });
  it('cancels active requests on explicit cancel, address change and destroy', () => {
    for (const action of ['cancel', 'address', 'destroy']) {
      const { component, http } = setup(); component.start(); const pending = new Subject();
      http.post.mockReturnValueOnce(pending); component.advance();
      http.delete.mockReturnValue(of({ ...fixture(), status: 'CANCELLED', reason: 'Explicitly cancelled' }));
      if (action === 'cancel') component.cancel();
      else if (action === 'address') { component.address = 'tb1qother'; component.ngOnChanges(); }
      else component.ngOnDestroy();
      expect(pending.observed).toBe(false); expect(component.visibleOutputs).toEqual([]);
      if (action === 'destroy') { component.start(); expect(http.post).toHaveBeenCalledTimes(2); }
    }
  });
  it('discloses an unsupported backend source and permits explicit start retry', () => {
    const { component, http } = setup(); http.post.mockReturnValueOnce(throwError(() => ({ error: { error: 'Esplora source is required' } })));
    component.start(); expect(component.view).toBeNull(); expect(component.error).toBe('Esplora source is required');
    component.start(); expect(component.view.status).toBe('PARTIAL');
  });
  it('bounds a hanging page and preserves accepted progress for retry', () => {
    vi.useFakeTimers(); const { component, http } = setup(); component.start(); const pending = new Subject();
    http.post.mockReturnValueOnce(pending); component.advance(); vi.advanceTimersByTime(25001);
    expect(pending.observed).toBe(false); expect(component.pending).toBe(false);
    expect(component.view.cursor).toBe(0); expect(component.error).toContain('deadline');
    http.post.mockReturnValueOnce(of(completed())); component.advance(); expect(component.view.result.outputCount).toBe(1);
  });
  it('cancels an unreturned create and does not invent a server cancellation receipt', () => {
    const { component, http } = setup(); const pending = new Subject(); http.post.mockReturnValueOnce(pending);
    component.start(); component.start(); expect(http.post).toHaveBeenCalledOnce(); component.cancel();
    expect(pending.observed).toBe(false); expect(http.delete).not.toHaveBeenCalled();
    expect(component.view).toBeNull(); expect(component.error).toContain('abandoned locally');
  });
  it('discloses failed cancellation cleanup without keeping complete outputs', () => {
    const { component, http } = setup(); component.start(); http.post.mockReturnValueOnce(of(completed())); component.advance();
    http.delete.mockReturnValueOnce(throwError(() => ({ message: 'cleanup unavailable' }))); component.cancel();
    expect(component.view).toBeNull(); expect(component.visibleOutputs).toEqual([]);
    expect(component.error).toContain('server cleanup was not confirmed');
  });
  it('rejects foreign context, cursor/source changes, partial result leakage and broken exact output closure', () => {
    const previous = fixture();
    const changes = [
      (v: UtxoReconstructionView) => { v.network = 'mainnet'; },
      (v: UtxoReconstructionView) => { v.address = 'other'; },
      (v: UtxoReconstructionView) => { v.cursor = 2; },
      (v: UtxoReconstructionView) => { v.source.blockHash = '7'.repeat(64); },
      (v: UtxoReconstructionView) => { v.source.mempoolIdentity = '8'.repeat(64); },
      (v: UtxoReconstructionView) => { v.result.items.push(v.result.items[0]); v.result.outputCount = 2; v.progress.candidateOutputs = 2; v.progress.verifiedOutputs = 2; },
      (v: UtxoReconstructionView) => { v.result.items[0].valueAtomic = '9007199254740993'; },
      (v: UtxoReconstructionView) => { v.progress.verifiedOutputs = 0; },
      (v: UtxoReconstructionView) => { v.progress.confirmedTransactionsExpected = 100001; },
      (v: UtxoReconstructionView) => { v.progress.mempoolTransactionsExpected = 501; },
      (v: UtxoReconstructionView) => { v.status = 'PARTIAL'; },
    ];
    for (const mutate of changes) { const value = completed(); mutate(value); expect(() => checkedReconstruction(value, address, 'signet', previous, 'next')).toThrow(); }
  });
  it('formats exact atomic amounts without floating-point conversion', () => {
    expect(atomicBtc('1')).toBe('0.00000001'); expect(atomicBtc('2100000000000000')).toBe('21000000.00000000');
    expect(() => atomicBtc('01')).toThrow();
  });
});
