import { ReconstructionV3Source, UtxoReconstructionV3Service } from '../api/bitcoin/utxo-reconstruction-v3.service';
import { ReconstructionSnapshot, ReconstructionError } from '../api/bitcoin/utxo-reconstruction.service';
import { IEsploraApi } from '../api/bitcoin/esplora-api.interface';
const hash = (n: number) => n.toString(16).padStart(64, '0'), script = '0014' + 'a'.repeat(40);
const zero = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
const signal = () => new AbortController().signal;
function tx(n: number, height: number, value: number, spent?: number, spentValue = 100): IEsploraApi.Transaction {
  return { txid: hash(n), version: 1, locktime: 0, size: 100, weight: 400, fee: 0,
    vin: [spent == null ? { is_coinbase: true, prevout: null } : { is_coinbase: false, txid: hash(spent), vout: 0, prevout: { scriptpubkey: script, value: spentValue } }] as IEsploraApi.Vin[],
    vout: [{ scriptpubkey: script, value }] as IEsploraApi.Vout[], status: { confirmed: true, block_height: height, block_hash: hash(height), block_time: 1000 + height } };
}
function setup() {
  const old = [tx(2, 11, 70, 1), tx(1, 10, 100)]; let rows = old;
  const snapshot: ReconstructionSnapshot = { sourceId: hash(9), scriptPubKey: script, mempoolIdentity: hash(8),
    checkpoint: { network: 'signet', genesisHash: hash(7), blockHeight: 20, blockHash: hash(20), signetChallenge: '51', verifiedAt: new Date().toISOString() },
    summary: { address: 'address', chain_stats: { funded_txo_count: 2, funded_txo_sum: 170, spent_txo_count: 1, spent_txo_sum: 100, tx_count: 2 }, mempool_stats: { ...zero } } };
  const copy = () => ({ ...JSON.parse(JSON.stringify(snapshot)), canonicalAnchor: { heightAtomic: '20', blockHash: hash(20) } });
  const source: ReconstructionV3Source = { snapshot: jest.fn(async () => copy()), confirmedSnapshot: jest.fn(async () => ({ ...copy(), mempoolIdentity: null })),
    history: jest.fn(async (_address, after) => after ? rows.slice(rows.findIndex(row => row.txid === after) + 1) : rows),
    mempool: jest.fn(async () => []), verifyOutputs: jest.fn(async () => undefined), verifyHistoryBlocks: jest.fn(async () => undefined) };
  return { source, snapshot, old, service: new UtxoReconstructionV3Service(source, 'signet'), grow() {
    snapshot.checkpoint = { ...snapshot.checkpoint, blockHeight: 21, blockHash: hash(21) };
    snapshot.summary.chain_stats = { funded_txo_count: 3, funded_txo_sum: 200, spent_txo_count: 2, spent_txo_sum: 170, tx_count: 3 };
    rows = [tx(3, 21, 30, 2, 70), ...old];
  }, growAgain() {
    snapshot.checkpoint = { ...snapshot.checkpoint, blockHeight: 22, blockHash: hash(22) };
    snapshot.summary.chain_stats = { funded_txo_count: 4, funded_txo_sum: 220, spent_txo_count: 3, spent_txo_sum: 200, tx_count: 4 };
    rows = [tx(4, 22, 20, 3, 30), tx(3, 21, 30, 2, 70), ...old];
  } };
}
async function advance(service: UtxoReconstructionV3Service, view: Awaited<ReturnType<UtxoReconstructionV3Service['create']>>, count: number) {
  for (let i = 0; i < count; i++) view = await service.next('address', view.sessionId, view.cursor, signal()); return view;
}
it('closes immutable original history, exact new tail and separate mempool before returning Core-verified outputs', async () => {
  const f = setup(), start = await f.service.create('address', signal()); f.grow();
  const prefix = await advance(f.service, start, 2);
  expect(prefix.progress).toMatchObject({ phase: 'reconcile-confirmed', confirmedTransactionsProcessed: 2, confirmedTransactionsExpected: 2 });
  expect(prefix.confirmedAnchor.chainStats.tx_count).toBe(2); expect(prefix.result).toBeUndefined();
  const tail = await advance(f.service, prefix, 1);
  expect(tail.progress).toMatchObject({ phase: 'acquire-mempool', confirmedTailTransactionsProcessed: 1, confirmedTailTransactionsExpected: 1 });
  expect(tail.confirmedTailAnchor?.chainStats.tx_count).toBe(3); expect(tail.result).toBeUndefined();
  const complete = await advance(f.service, tail, 3);
  expect(complete.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(complete.result?.balanceAtomic).toBe('30');
  expect(complete.result?.items[0].txid).toBe(hash(3)); expect(complete.confirmedAnchor.blockHeight).toBe(20);
  expect(f.source.verifyOutputs).toHaveBeenCalledWith([expect.objectContaining({ txid: hash(3) })], expect.anything(), expect.objectContaining({ blockHeight: 21 }));
  expect(f.source.verifyHistoryBlocks).toHaveBeenCalled();
});
it('discards tail spends/funding and final verification on tip growth while retaining the closed base', async () => {
  const f = setup(), start = await f.service.create('address', signal()); f.grow();
  const tail = await advance(f.service, start, 3); f.growAgain();
  const reset = await advance(f.service, tail, 1);
  expect(reset).toMatchObject({ status: 'PARTIAL', reason: 'CONFIRMED_TAIL_CHANGED', confirmedTailAnchor: null,
    progress: { phase: 'reconcile-confirmed', confirmedEpoch: 1, confirmedTransactionsProcessed: 2, confirmedTailTransactionsProcessed: 0, verifiedOutputs: 0 } });
  expect(reset.result).toBeUndefined(); const complete = await advance(f.service, reset, 4);
  expect(complete.result?.balanceAtomic).toBe('20'); expect(complete.result?.items[0].txid).toBe(hash(4));
});
it('rejects a missing exact immutable head boundary instead of silently dropping older rows', async () => {
  const f = setup(), prefix = await advance(f.service, await f.service.create('address', signal()), 2);
  (f.source.history as jest.Mock).mockResolvedValueOnce([f.old[1]]);
  expect((await advance(f.service, prefix, 1)).status).toBe('INVALIDATED');
});
it('requires original counts and funded/spent sums to close even when current statistics have grown', async () => {
  const f = setup(), start = await f.service.create('address', signal()); f.grow();
  (f.source.history as jest.Mock).mockResolvedValueOnce([f.old[0]]).mockResolvedValueOnce([]);
  const first = await advance(f.service, start, 1), failed = await advance(f.service, first, 1);
  expect(failed.status).toBe('INVALIDATED'); expect(failed.result).toBeUndefined();
});
it('rejects initial statistics that move before the original fixed checkpoint is acquired', async () => {
  const f = setup(); const original = f.source.confirmedSnapshot as jest.Mock;
  const once = await original(); original.mockImplementationOnce(async () => once).mockImplementationOnce(async () => ({ ...once, summary: { ...once.summary, chain_stats: { ...once.summary.chain_stats, tx_count: 3 } } }));
  await expect(f.service.create('address', signal())).rejects.toMatchObject({ status: 409 });
});
it('withdraws cached complete results on canonical original-anchor loss', async () => {
  const f = setup(), complete = await advance(f.service, await f.service.create('address', signal()), 6);
  f.snapshot.checkpoint.blockHash = hash(99);
  const failed = await f.service.next('address', complete.sessionId, complete.cursor - 1, signal());
  expect(failed.status).toBe('INVALIDATED'); expect(failed.result).toBeUndefined(); expect(failed.progress.retainedBytes).toBe(0);
});
it('keeps tail acquisition retryable without committing a partial page on deadline', async () => {
  const f = setup(), prefix = await advance(f.service, await f.service.create('address', signal()), 2);
  (f.source.verifyHistoryBlocks as jest.Mock).mockRejectedValueOnce(new ReconstructionError(503, 'Bounded Core page deadline'));
  await expect(f.service.next('address', prefix.sessionId, prefix.cursor, signal())).rejects.toMatchObject({ status: 503 });
  const retry = await f.service.next('address', prefix.sessionId, prefix.cursor, signal()); expect(retry.cursor).toBe(prefix.cursor + 1); expect(retry.confirmedTailAnchor).not.toBeNull();
});
it('resets only mempool when the fixed closed tail remains unchanged', async () => {
  const f = setup(), outspends = await advance(f.service, await f.service.create('address', signal()), 5);
  f.snapshot.mempoolIdentity = hash(99); const reset = await advance(f.service, outspends, 1);
  expect(reset.progress).toMatchObject({ phase: 'acquire-mempool', confirmedEpoch: 0, mempoolEpoch: 1, confirmedTransactionsProcessed: 2 });
  expect(reset.confirmedTailAnchor).not.toBeNull(); expect(reset.result).toBeUndefined();
});
it('retains only the closed base across an above-anchor reorg and reconstructs the actual replacement tail', async () => {
  const f = setup(), start = await f.service.create('address', signal()); f.growAgain();
  const tail = await advance(f.service, start, 3); f.grow();
  const reset = await advance(f.service, tail, 1);
  expect(reset.progress.confirmedEpoch).toBe(1); expect(reset.latestObservedTip.blockHeight).toBe(21);
  expect(reset.confirmedAnchor.blockHeight).toBe(20); expect(reset.progress.confirmedTransactionsProcessed).toBe(2);
  const completed = await advance(f.service, reset, 4); expect(completed.result?.balanceAtomic).toBe('30');
});
it('does not commit canonical-page acquisition that ignores a caller cancellation', async () => {
  const f = setup(), start = await f.service.create('address', signal()); let release!: () => void;
  (f.source.verifyHistoryBlocks as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const controller = new AbortController(), pending = f.service.next('address', start.sessionId, 0, controller.signal);
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await expect(pending).rejects.toMatchObject({ status: 499 });
  const retry = await f.service.next('address', start.sessionId, 0, signal()); expect(retry.progress.confirmedTransactionsProcessed).toBe(2); expect(retry.cursor).toBe(1);
});
it('rejects a changed provider identity without reading a tail or preserving output candidates', async () => {
  const f = setup(), prefix = await advance(f.service, await f.service.create('address', signal()), 2);
  f.snapshot.sourceId = hash(77); const failed = await advance(f.service, prefix, 1);
  expect(failed.status).toBe('INVALIDATED'); expect(failed.confirmedTailAnchor).toBeNull(); expect(failed.result).toBeUndefined();
});
it('withdraws a lost-response complete retry and advances at most two cursor steps after actual confirmed growth', async () => {
  const f = setup(), complete = await advance(f.service, await f.service.create('address', signal()), 6); f.grow();
  const input = complete.cursor - 1, reset = await f.service.next('address', complete.sessionId, input, signal());
  expect(reset.cursor).toBe(input + 2); expect(reset.reason).toBe('CONFIRMED_TAIL_CHANGED'); expect(reset.result).toBeUndefined();
  const replay = await f.service.next('address', reset.sessionId, input, signal()); expect(replay.cursor).toBe(reset.cursor); expect(replay.progress.confirmedEpoch).toBe(1);
});
it('does not extend the fixed sixty minute session lifetime on manual continuation', async () => {
  const f = setup(); let now = 1000; const service = new UtxoReconstructionV3Service(f.source, 'signet', () => now);
  const start = await service.create('address', signal()); now += 59 * 60 * 1000;
  const partial = await service.next('address', start.sessionId, 0, signal()); expect(partial.expiresAt).toBe(start.expiresAt);
  now += 60 * 1000; await expect(service.next('address', start.sessionId, partial.cursor, signal())).rejects.toMatchObject({ status: 404 });
});
it('fails closed after sixteen confirmed-tail resets rather than retrying forever within the lifetime', async () => {
  const f = setup(); let view = await advance(f.service, await f.service.create('address', signal()), 3);
  for (let i = 0; i < 16; i++) {
    f.snapshot.checkpoint = { ...f.snapshot.checkpoint, blockHeight: 21 + i, blockHash: hash(21 + i) };
    view = await advance(f.service, view, 1); expect(view.progress.confirmedEpoch).toBe(i + 1);
    view = await advance(f.service, view, 1);
  }
  f.snapshot.checkpoint = { ...f.snapshot.checkpoint, blockHeight: 37, blockHash: hash(37) };
  await expect(f.service.next('address', view.sessionId, view.cursor, signal())).rejects.toMatchObject({ status: 422 });
  const rejected = await f.service.next('address', view.sessionId, view.cursor, signal()); expect(rejected.status).toBe('INVALIDATED'); expect(rejected.progress.retainedBytes).toBe(0); expect(rejected.result).toBeUndefined();
});
it('allows canonical above-anchor tip replacement during the prefix without creating an imaginary tail reset', async () => {
  const f = setup(), start = await f.service.create('address', signal()); f.growAgain();
  const prefix = await advance(f.service, start, 1); expect(prefix.latestObservedTip.blockHeight).toBe(22);
  f.grow(); const closed = await advance(f.service, prefix, 1);
  expect(closed.latestObservedTip.blockHeight).toBe(21); expect(closed.confirmedAnchor).toEqual(start.confirmedAnchor);
  expect(closed.progress).toMatchObject({ confirmedEpoch: 0, confirmedTransactionsProcessed: 2, phase: 'reconcile-confirmed' });
  expect(closed.confirmedTailAnchor).toBeNull(); expect(closed.result).toBeUndefined();
});
