import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { UtxoReconstructionComponent } from './utxo-reconstruction.component';
import { checkedReconstructionV2, UtxoReconstructionV2View } from './utxo-reconstruction-v2-view';

const address = 'tb1qpublictestaddress';
function initial(): UtxoReconstructionV2View {
  return { schema: 'universe-address-utxo-reconstruction-v2', sessionId: '12345678-1234-1234-1234-123456789abc',
    address, network: 'signet', cursor: 0, status: 'PARTIAL', observedAt: '2026-10-03T00:00:00Z', expiresAt: '2026-10-03T00:30:00Z',
    confirmedAnchor: { genesisHash: '1'.repeat(64), blockHash: '2'.repeat(64), blockHeight: 10, network: 'signet', signetChallenge: '51',
      sourceId: '3'.repeat(64), scriptPubKey: '51', verifiedAt: '2026-10-03T00:00:00Z',
      chainStats: { funded_txo_count: 1, spent_txo_count: 0, funded_txo_sum: 66135, spent_txo_sum: 0, tx_count: 1 } },
    mempoolAnchor: null, progress: { phase: 'confirmed', pageLimit: 100, mempoolEpoch: 0, confirmedTransactionsProcessed: 0,
      confirmedTransactionsExpected: 1, mempoolTransactionsProcessed: 0, mempoolTransactionsExpected: null,
      candidateOutputs: 0, verifiedOutputs: 0, retainedBytes: 0 } };
}
function acquired(): UtxoReconstructionV2View {
  const v = initial(); v.cursor = 1; v.progress = { ...v.progress, phase: 'outspends', confirmedTransactionsProcessed: 1,
    mempoolTransactionsExpected: 0, candidateOutputs: 1 };
  v.mempoolAnchor = { identity: '4'.repeat(64), observedAt: v.observedAt,
    addressMempoolStats: { funded_txo_count: 0, spent_txo_count: 0, funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } };
  return v;
}
function reset(cursor = 2): UtxoReconstructionV2View {
  const v = initial(); v.cursor = cursor; v.reason = 'MEMPOOL_CHANGED';
  v.progress = { ...v.progress, phase: 'acquire-mempool', mempoolEpoch: 1, confirmedTransactionsProcessed: 1 }; return v;
}
function complete(): UtxoReconstructionV2View {
  const v = acquired(); v.cursor = 2; v.status = 'COMPLETE_AT_OBSERVED_TIP'; v.progress.phase = 'complete'; v.progress.verifiedOutputs = 1;
  v.result = { outputCount: 1, balanceAtomic: '66135', items: [{ txid: '5'.repeat(64), vout: 0, valueAtomic: '66135',
    status: { confirmed: true, block_height: 9, block_hash: '6'.repeat(64), block_time: 123 } }] }; return v;
}
function setup() {
  const network = new BehaviorSubject('signet'); const http = { post: vi.fn().mockReturnValue(of(initial())), delete: vi.fn().mockReturnValue(of({})) };
  const c = new UtxoReconstructionComponent(http as any, { network: 'signet', networkChanged$: network, env: { ROOT_NETWORK: 'mainnet' } } as any,
    { markForCheck: vi.fn() } as any); c.address = address; c.ngOnInit(); c.selectVersion('v2'); return { c, http, network };
}
describe('explicit v2 anchored reconstruction', () => {
  it('starts without asserting any mempool evidence and uses only the opt-in endpoint', () => {
    const { c, http } = setup(); c.start();
    expect(http.post).toHaveBeenCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v2`, {});
    expect(c.mempoolIdentity).toBe('not acquired'); expect(c.v2View.progress.mempoolTransactionsExpected).toBeNull();
    expect(c.visibleOutputs).toEqual([]); c.selectVersion('v1'); expect(c.version).toBe('v2'); c.ngOnDestroy();
  });
  it('retains confirmed progress on explicit epoch reset, including a lost-response replay, but accepts no outputs', () => {
    for (const cursor of [2, 3]) {
      expect(checkedReconstructionV2(reset(cursor), address, 'signet', acquired(), 'next').progress.confirmedTransactionsProcessed).toBe(1);
    }
    for (const mutate of [v => v.progress.candidateOutputs = 1, v => v.progress.confirmedTransactionsProcessed = 0,
      v => v.progress.mempoolEpoch = 2, v => v.cursor = 4, v => v.result = complete().result]) {
      const value = reset(); mutate(value); expect(() => checkedReconstructionV2(value, address, 'signet', acquired(), 'next')).toThrow();
    }
  });
  it('requires immutable confirmed and acquired mempool identity and exact final output closure', () => {
    expect(checkedReconstructionV2(complete(), address, 'signet', acquired(), 'next').result.balanceAtomic).toBe('66135');
    for (const mutate of [v => v.confirmedAnchor.blockHash = '7'.repeat(64), v => v.mempoolAnchor.identity = '8'.repeat(64),
      v => v.result.balanceAtomic = '66134', v => v.result.items.push(v.result.items[0]), v => v.mempoolAnchor = null]) {
      const value = complete(); mutate(value); expect(() => checkedReconstructionV2(value, address, 'signet', acquired(), 'next')).toThrow();
    }
  });
  it('allows valid cancelled receipts after released candidates without keeping eligible outputs', () => {
    const v = complete(); v.status = 'CANCELLED'; delete v.result; v.progress.candidateOutputs = 0; v.progress.retainedBytes = 0;
    expect(checkedReconstructionV2(v, address, 'signet', complete(), 'cancel').status).toBe('CANCELLED');
  });
  it('retains accepted progress after a typed upstream failure and retries its same cursor once', () => {
    const { c, http } = setup(); c.start(); http.post.mockReturnValueOnce(of(acquired())); c.advance();
    http.post.mockReturnValueOnce(throwError(() => ({ error: { error: 'Provider unavailable', phase: 'outspends', sourceFailure: { code: 'UPSTREAM_FAILURE', upstreamStatus: 503 } } })));
    c.advance(); expect(c.view.cursor).toBe(1); expect(c.error).toContain('Failed phase: outspends');
    const pending = new Subject(); http.post.mockReturnValueOnce(pending); c.advance(); c.advance();
    expect(http.post).toHaveBeenCalledTimes(4); expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v2/${initial().sessionId}/next`, { cursor: 1 });
    pending.next(complete()); pending.complete(); expect(c.visibleOutputs.length).toBe(1); c.ngOnDestroy();
  });
  it('requires manual reacquisition after a mempool epoch reset before publishing its new complete closure', () => {
    const { c, http } = setup(); c.start(); http.post.mockReturnValueOnce(of(acquired())); c.advance();
    http.post.mockReturnValueOnce(of(reset())); c.advance();
    expect(c.v2View.progress.mempoolEpoch).toBe(1); expect(c.mempoolIdentity).toBe('not acquired');
    expect(c.visibleOutputs).toEqual([]); expect(http.post).toHaveBeenCalledTimes(3);
    const final = complete(); final.cursor = 3; final.progress.mempoolEpoch = 1; final.mempoolAnchor.identity = '9'.repeat(64);
    http.post.mockReturnValueOnce(of(final)); c.advance();
    expect(http.post).toHaveBeenLastCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v2/${initial().sessionId}/next`, { cursor: 2 });
    expect(c.mempoolIdentity).toBe('9'.repeat(64)); expect(c.visibleOutputs.length).toBe(1); c.ngOnDestroy();
  });
  it('cancels old v2 transport and cleanup in the old network on a scope change', () => {
    const { c, http, network } = setup(); c.start(); const pending = new Subject(); http.post.mockReturnValueOnce(pending); c.advance();
    network.next('testnet4'); expect(pending.observed).toBe(false); expect(c.view).toBeNull();
    expect(http.delete).toHaveBeenCalledWith(`/signet/api/v1/address/${address}/utxo-reconstruction/v2/${initial().sessionId}`);
    pending.next(complete()); expect(c.visibleOutputs).toEqual([]); c.ngOnDestroy();
  });
});
