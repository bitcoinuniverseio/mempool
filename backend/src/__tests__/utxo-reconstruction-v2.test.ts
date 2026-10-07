import { UtxoReconstructionV2Service, ReconstructionV2Source } from '../api/bitcoin/utxo-reconstruction-v2.service';
import { ReconstructionError, ReconstructionSnapshot } from '../api/bitcoin/utxo-reconstruction.service';
import { IEsploraApi } from '../api/bitcoin/esplora-api.interface';
const script = '0014' + 'a'.repeat(40), hash = (n: number) => n.toString(16).padStart(64, '0');
const zero = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
function transaction(n: number, value: number, spent?: number, spentValue = 100): IEsploraApi.Transaction {
  return { txid: hash(n), version: 1, locktime: 0, size: 100, weight: 400, fee: 0,
    vin: [spent == null ? { is_coinbase: true, prevout: null } : { is_coinbase: false, txid: hash(spent), vout: 0, prevout: { scriptpubkey: script, value: spentValue } }] as IEsploraApi.Vin[],
    vout: [{ scriptpubkey: script, value }] as IEsploraApi.Vout[],
    status: { confirmed: true, block_height: n + 9, block_hash: hash(n + 100), block_time: 1000 + n } };
}
function setup() {
  const snapshot: ReconstructionSnapshot = { sourceId: hash(9), scriptPubKey: script, mempoolIdentity: hash(8),
    checkpoint: { network: 'signet', genesisHash: hash(7), blockHeight: 20, blockHash: hash(6), signetChallenge: '51', verifiedAt: new Date().toISOString() },
    summary: { address: 'address', chain_stats: { funded_txo_count: 2, funded_txo_sum: 170, spent_txo_count: 1, spent_txo_sum: 100, tx_count: 2 }, mempool_stats: { ...zero } } };
  const copy = () => JSON.parse(JSON.stringify(snapshot));
  const source: ReconstructionV2Source = { snapshot: jest.fn(async () => copy()), confirmedSnapshot: jest.fn(async () => ({ ...copy(), mempoolIdentity: null })),
    history: jest.fn(async (_address, after) => after ? [] : [transaction(2, 70, 1), transaction(1, 100)]), mempool: jest.fn(async () => []), verifyOutputs: jest.fn(async () => undefined) };
  return { service: new UtxoReconstructionV2Service(source, 'signet'), source, snapshot };
}
function canonicalGrowth(source: ReconstructionV2Source, snapshot: ReconstructionSnapshot, height = 21): void {
  const original = { ...snapshot.checkpoint };
  snapshot.checkpoint = { ...snapshot.checkpoint, blockHeight: height, blockHash: hash(height) };
  const copy = () => ({ ...JSON.parse(JSON.stringify(snapshot)), canonicalAnchor: { heightAtomic: String(original.blockHeight), blockHash: original.blockHash } });
  (source.confirmedSnapshot as jest.Mock).mockImplementation(async () => ({ ...copy(), mempoolIdentity: null }));
  (source.snapshot as jest.Mock).mockImplementation(async () => copy());
}
const signal = () => new AbortController().signal;
async function advance(service: UtxoReconstructionV2Service, view: Awaited<ReturnType<UtxoReconstructionV2Service['create']>>, count: number) {
  for (let i = 0; i < count; i++) view = await service.next('address', view.sessionId, view.cursor, signal());
  return view;
}
it('keeps confirmed progress without acquiring or asserting a global mempool identity', async () => {
  const { service, source, snapshot } = setup(); const start = await service.create('address', signal());
  snapshot.mempoolIdentity = hash(123); snapshot.summary.mempool_stats.tx_count = 499;
  const view = await service.next('address', start.sessionId, 0, signal());
  expect(view.schema).toBe('universe-address-utxo-reconstruction-v2'); expect(view.mempoolAnchor).toBeNull();
  expect(view.progress).toMatchObject({ confirmedTransactionsProcessed: 2, pageLimit: 100, mempoolTransactionsExpected: null });
  expect(source.snapshot).not.toHaveBeenCalled(); expect(source.history).toHaveBeenCalledWith('address', undefined, 100, expect.anything());
});
it('only publishes outputs after separate exact mempool capture, closure and independent verification', async () => {
  const { service, source } = setup(); const start = await service.create('address', signal());
  const partial = await advance(service, start, 4); expect(partial.status).toBe('PARTIAL'); expect(partial.result).toBeUndefined();
  expect(partial.mempoolAnchor?.identity).toBe(hash(8)); expect(partial.progress.phase).toBe('outspends');
  const complete = await advance(service, partial, 1); expect(complete.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(complete.result?.balanceAtomic).toBe('70');
  expect(source.verifyOutputs).toHaveBeenCalledWith([expect.objectContaining({ txid: hash(2), value: 70 })], expect.anything(), expect.objectContaining({ blockHeight: 20 }));
});
it('resets only mempool and all output verification when final exact identity changes', async () => {
  const { service, snapshot } = setup(); const partial = await advance(service, await service.create('address', signal()), 4);
  snapshot.mempoolIdentity = hash(99); const reset = await advance(service, partial, 1);
  expect(reset).toMatchObject({ status: 'PARTIAL', reason: 'MEMPOOL_CHANGED', mempoolAnchor: null, progress: { phase: 'acquire-mempool', mempoolEpoch: 1, confirmedTransactionsProcessed: 2, verifiedOutputs: 0, candidateOutputs: 0 } });
  expect(reset.result).toBeUndefined(); const completed = await advance(service, reset, 3); expect(completed.result?.balanceAtomic).toBe('70');
});
it('withdraws a cached complete result after fresh mempool movement without replaying old outputs', async () => {
  const { service, snapshot } = setup(); const complete = await advance(service, await service.create('address', signal()), 5);
  snapshot.mempoolIdentity = hash(99); const replay = await service.next('address', complete.sessionId, complete.cursor - 1, signal());
  expect(replay.status).toBe('PARTIAL'); expect(replay.reason).toBe('MEMPOOL_CHANGED'); expect(replay.result).toBeUndefined(); expect(replay.progress.confirmedTransactionsProcessed).toBe(2);
});
it('invalidates a real independent output mismatch when the exact mempool is unchanged', async () => {
  const { service, source } = setup(); const partial = await advance(service, await service.create('address', signal()), 4);
  (source.verifyOutputs as jest.Mock).mockRejectedValueOnce(new ReconstructionError(409, 'Independent Core output differs'));
  const failed = await advance(service, partial, 1); expect(failed.status).toBe('INVALIDATED'); expect(failed.result).toBeUndefined();
});
it('removes discarded mempool spends and funding before rebuilding a new final epoch', async () => {
  const { service, source, snapshot } = setup(); const tx = transaction(3, 30, 2, 70); tx.status = { confirmed: false };
  snapshot.summary.mempool_stats = { funded_txo_count: 1, funded_txo_sum: 30, spent_txo_count: 1, spent_txo_sum: 70, tx_count: 1 };
  (source.mempool as jest.Mock).mockResolvedValue([tx]);
  const partial = await advance(service, await service.create('address', signal()), 4); expect(partial.progress.candidateOutputs).toBe(1);
  snapshot.summary.mempool_stats = { ...zero }; snapshot.mempoolIdentity = hash(88); (source.mempool as jest.Mock).mockResolvedValue([]);
  const reset = await advance(service, partial, 1); const complete = await advance(service, reset, 3);
  expect(complete.result?.balanceAtomic).toBe('70'); expect(complete.result?.items[0].txid).toBe(hash(2)); expect(complete.progress.mempoolEpoch).toBe(1);
});
it('keeps the cursor retryable when a page acquisition fails before progress commits', async () => {
  const { service, source } = setup(); const start = await service.create('address', signal());
  (source.history as jest.Mock).mockRejectedValueOnce(new ReconstructionError(503, 'Unavailable history'));
  await expect(service.next('address', start.sessionId, 0, signal())).rejects.toMatchObject({ status: 503 });
  const retry = await service.next('address', start.sessionId, 0, signal()); expect(retry.cursor).toBe(1); expect(retry.progress.confirmedTransactionsProcessed).toBe(2);
});
it('invalidates confirmed tip or statistics changes including a cached cursor retry', async () => {
  const { service, snapshot } = setup(); const first = await advance(service, await service.create('address', signal()), 1);
  snapshot.checkpoint.blockHash = hash(88); const replay = await service.next('address', first.sessionId, 0, signal());
  expect(replay.status).toBe('INVALIDATED'); expect(replay.progress.retainedBytes).toBe(0); expect(replay.result).toBeUndefined();
});
it('reserves pending slots before confirmed acquisition and releases terminal state', async () => {
  const { service, source, snapshot } = setup(); const release: (() => void)[] = [];
  (source.confirmedSnapshot as jest.Mock).mockImplementation(() => new Promise(resolve => release.push(() => resolve({ ...JSON.parse(JSON.stringify(snapshot)), mempoolIdentity: null }))));
  const pending = Array.from({ length: 8 }, () => service.create('address', signal()));
  await expect(service.create('address', signal())).rejects.toMatchObject({ status: 429 }); expect(release).toHaveLength(8);
  release.forEach(work => work()); const views = await Promise.all(pending); expect(service.cancel('address', views[0].sessionId).status).toBe('CANCELLED');
  (source.confirmedSnapshot as jest.Mock).mockResolvedValue({ ...JSON.parse(JSON.stringify(snapshot)), mempoolIdentity: null });
  expect((await service.create('address', signal())).status).toBe('PARTIAL');
});

it('advances a changed cached-final retry at most two cursor steps with an explicit new epoch', async () => {
  const { service, snapshot } = setup(); const complete = await advance(service, await service.create('address', signal()), 5);
  const previous = complete.cursor - 1; snapshot.mempoolIdentity = hash(123);
  const reset = await service.next('address', complete.sessionId, previous, signal());
  expect(reset.cursor).toBe(previous + 2); expect(reset.progress.mempoolEpoch).toBe(1); expect(reset.result).toBeUndefined();
  const replay = await service.next('address', complete.sessionId, previous, signal());
  expect(replay.cursor).toBe(reset.cursor); expect(replay.progress.mempoolEpoch).toBe(1); expect(replay.mempoolAnchor).toBeNull();
});
it('retains proved confirmed closure when mempool capture itself is inconsistent', async () => {
  const { service, source } = setup(); const confirmed = await advance(service, await service.create('address', signal()), 2);
  (source.snapshot as jest.Mock).mockRejectedValueOnce(new ReconstructionError(409, 'Index and Core mempool identities differ'));
  const reset = await advance(service, confirmed, 1);
  expect(reset.status).toBe('PARTIAL'); expect(reset.reason).toBe('MEMPOOL_CHANGED'); expect(reset.progress.confirmedTransactionsProcessed).toBe(2);
  expect(reset.progress.phase).toBe('acquire-mempool'); expect(reset.mempoolAnchor).toBeNull(); expect(reset.result).toBeUndefined();
});
it('cancels a late confirmed page without committing rows or exposing final outputs', async () => {
  const { service, source } = setup(); const start = await service.create('address', signal()); let release!: () => void;
  (source.history as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([transaction(2, 70, 1)]); }));
  const pending = service.next('address', start.sessionId, 0, signal()); await new Promise(resolve => setImmediate(resolve));
  expect(service.cancel('address', start.sessionId).status).toBe('CANCELLED'); release();
  const cancelled = await pending; expect(cancelled.status).toBe('CANCELLED'); expect(cancelled.progress.confirmedTransactionsProcessed).toBe(0); expect(cancelled.progress.retainedBytes).toBe(0); expect(cancelled.result).toBeUndefined();
});
it('rejects a provider page exceeding the explicit hundred-transaction bound', async () => {
  const { service, source } = setup(); const start = await service.create('address', signal());
  (source.history as jest.Mock).mockResolvedValueOnce(Array.from({ length: 101 }, (_, i) => transaction(i + 1, 1)));
  const invalid = await service.next('address', start.sessionId, 0, signal()); expect(invalid.status).toBe('INVALIDATED'); expect(invalid.result).toBeUndefined();
});
it('preserves immutable confirmed progress across canonical tip growth and verifies at the final captured tip', async () => {
  const { service, source, snapshot } = setup(); const start = await service.create('address', signal());
  canonicalGrowth(source, snapshot);
  const page = await advance(service, start, 1);
  expect(page.confirmedAnchor.blockHeight).toBe(20); expect(page.confirmedAnchor.blockHash).toBe(hash(6));
  expect(page.confirmedAnchor.verifiedAt).toBe(start.confirmedAnchor.verifiedAt);
  expect(page.latestObservedTip).toMatchObject({ blockHeight: 21, blockHash: hash(21) });
  expect(source.confirmedSnapshot).toHaveBeenLastCalledWith('address', expect.anything(), expect.objectContaining({ blockHeight: 20, blockHash: hash(6) }));
  const complete = await advance(service, page, 4);
  expect(complete.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(complete.mempoolAnchor?.checkpoint.blockHeight).toBe(21);
  expect(source.verifyOutputs).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ blockHeight: 21, blockHash: hash(21) }));
});
it.each(['missing', 'wrong-height', 'wrong-hash', 'changed-stats', 'changed-source', 'changed-genesis', 'changed-script', 'changed-challenge'])('rejects tip growth with %s original-anchor provenance', async fault => {
  const { service, source, snapshot } = setup(); const start = await service.create('address', signal()); canonicalGrowth(source, snapshot);
  const implementation = source.confirmedSnapshot as jest.Mock;
  const valid = await implementation('address', signal());
  if (fault === 'missing') delete valid.canonicalAnchor;
  if (fault === 'wrong-height') valid.canonicalAnchor.heightAtomic = '19';
  if (fault === 'wrong-hash') valid.canonicalAnchor.blockHash = hash(77);
  if (fault === 'changed-stats') valid.summary.chain_stats.tx_count++;
  if (fault === 'changed-source') valid.sourceId = hash(77);
  if (fault === 'changed-genesis') valid.checkpoint.genesisHash = hash(77);
  if (fault === 'changed-script') valid.scriptPubKey = '51';
  if (fault === 'changed-challenge') valid.checkpoint.signetChallenge = '52';
  implementation.mockResolvedValue(valid);
  const failed = await advance(service, start, 1); expect(failed.status).toBe('INVALIDATED'); expect(failed.result).toBeUndefined();
  expect(source.history).not.toHaveBeenCalled();
});
it('withdraws a cached completed result on final tip growth while retaining original confirmed closure', async () => {
  const { service, source, snapshot } = setup(); const complete = await advance(service, await service.create('address', signal()), 5);
  canonicalGrowth(source, snapshot);
  const reset = await service.next('address', complete.sessionId, complete.cursor - 1, signal());
  expect(reset).toMatchObject({ status: 'PARTIAL', reason: 'FINAL_TIP_CHANGED', mempoolAnchor: null,
    progress: { phase: 'acquire-mempool', mempoolEpoch: 1, confirmedTransactionsProcessed: 2, candidateOutputs: 0, verifiedOutputs: 0 } });
  expect(reset.result).toBeUndefined(); expect(reset.confirmedAnchor.blockHeight).toBe(20); expect(reset.latestObservedTip.blockHeight).toBe(21);
  expect((await advance(service, reset, 3)).result?.balanceAtomic).toBe('70');
});
it('keeps a moving shared-tip acquisition retryable without accepting unproved page progress', async () => {
  const { service, source, snapshot } = setup(); const start = await service.create('address', signal());
  (source.confirmedSnapshot as jest.Mock).mockRejectedValueOnce(new ReconstructionError(409, 'Active chain moved during confirmed source acquisition'));
  await expect(service.next('address', start.sessionId, 0, signal())).rejects.toMatchObject({ status: 503 });
  expect(source.history).not.toHaveBeenCalled(); canonicalGrowth(source, snapshot);
  const retry = await service.next('address', start.sessionId, 0, signal()); expect(retry.cursor).toBe(1); expect(retry.progress.confirmedTransactionsProcessed).toBe(2);
});
it('has a fixed sixty-minute V2 expiry which does not slide when progress is read', async () => {
  const { source } = setup(); let now = 100000;
  const service = new UtxoReconstructionV2Service(source, 'signet', () => now); const start = await service.create('address', signal());
  expect(Date.parse(start.expiresAt) - now).toBe(60 * 60 * 1000);
  now += 31 * 60 * 1000; const page = await advance(service, start, 1); expect(page.expiresAt).toBe(start.expiresAt);
  now = Date.parse(start.expiresAt);
  await expect(service.next('address', start.sessionId, page.cursor, signal())).rejects.toMatchObject({ status: 404 });
});
it('does not commit acquired history rows when the after-read shared-tip proof moves', async () => {
  const { service, source } = setup(); const start = await service.create('address', signal());
  const implementation = (source.confirmedSnapshot as jest.Mock).getMockImplementation()!;
  (source.confirmedSnapshot as jest.Mock).mockImplementationOnce(implementation).mockRejectedValueOnce(new ReconstructionError(409, 'Active chain moved during confirmed source acquisition'));
  await expect(service.next('address', start.sessionId, 0, signal())).rejects.toMatchObject({ status: 503 });
  const retry = await service.next('address', start.sessionId, 0, signal());
  expect(retry.cursor).toBe(1); expect(retry.progress.confirmedTransactionsProcessed).toBe(2);
  expect(source.history).toHaveBeenCalledTimes(2); expect(retry.result).toBeUndefined();
});
