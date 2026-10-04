import { createHash } from 'crypto';
import { Transaction } from 'bitcoinjs-lib';
import { UtxoReconstructionV4Service } from '../api/bitcoin/utxo-reconstruction-v4.service';
import { GlobalTransactionProof, ReconstructionV4Source } from '../api/bitcoin/utxo-reconstruction-v4.source';
import { GlobalReconstructionSnapshot } from '../api/bitcoin/utxo-reconstruction.source';
import { ReconstructionError } from '../api/bitcoin/utxo-reconstruction.service';
import { IEsploraApi } from '../api/bitcoin/esplora-api.interface';

const hash = (n: number): string => n.toString(16).padStart(64, '0'), script = '0014' + 'a'.repeat(40);
const digest = (data: unknown): string => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const zero = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
const signal = (): AbortSignal => new AbortController().signal;
/** Controlled native serialization/proof data; no actual consensus/source acceptance claim. */
function globalTx(n: number, outputScript = '51', inputTxid = hash(900 + n)): GlobalTransactionProof {
  const transaction = new Transaction(); transaction.version = 2;
  transaction.addInput(Buffer.from(inputTxid, 'hex').reverse(), 0); transaction.addOutput(Buffer.from(outputScript, 'hex'), 150);
  const rawHex = transaction.toHex(); return { txid: transaction.getId(), rawHex, rawSha256: createHash('sha256').update(Buffer.from(rawHex, 'hex')).digest('hex') };
}
function setup(count = 220) {
  let sequence = 1, pool = [globalTx(0)]; const proofs = new Map(pool.map(proof => [proof.txid, proof]));
  const funding = { txid: hash(1), version: 1, locktime: 0, size: 100, weight: 400, fee: 0,
    vin: [{ is_coinbase: true, prevout: null }], vout: Array.from({ length: count }, () => ({ scriptpubkey: script, value: 100 })),
    status: { confirmed: true, block_height: 10, block_hash: hash(10), block_time: 1010 } } as IEsploraApi.Transaction;
  const snapshot: GlobalReconstructionSnapshot = { sourceId: hash(9), scriptPubKey: script, mempoolIdentity: '',
    checkpoint: { network: 'signet', genesisHash: hash(7), blockHeight: 20, blockHash: hash(20), signetChallenge: '51', verifiedAt: new Date().toISOString() },
    summary: { address: 'address', chain_stats: { funded_txo_count: count, funded_txo_sum: count * 100, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 }, mempool_stats: { ...zero } },
    globalMempool: { transactionCount: 1, sequenceAtomic: '1', txids: [] } };
  const copy = (): GlobalReconstructionSnapshot => {
    const ids = pool.map(proof => proof.txid).sort();
    return { ...JSON.parse(JSON.stringify(snapshot)), mempoolIdentity: digest({ ids, sequence }),
      globalMempool: { transactionCount: ids.length, sequenceAtomic: String(sequence), txids: ids.length <= 100 ? ids : null },
      canonicalAnchor: { heightAtomic: '20', blockHash: hash(20) } };
  };
  const source: ReconstructionV4Source = { snapshot: jest.fn(async () => copy()), confirmedSnapshot: jest.fn(async () => ({ ...copy(), mempoolIdentity: null })),
    history: jest.fn(async (_address, after) => after ? [] : [funding]), mempool: jest.fn(async () => []),
    verifyOutputs: jest.fn(async () => undefined), verifyHistoryBlocks: jest.fn(async () => undefined),
    globalTransactions: jest.fn(async ids => ids.map(id => { const proof = proofs.get(id); if (!proof) throw new ReconstructionError(503, 'native payload unavailable'); return proof; })) };
  return { source, snapshot, funding, proofs, service: new UtxoReconstructionV4Service(source, 'signet'), original: pool[0],
    setPool(next: GlobalTransactionProof[]) { pool = next; sequence++; next.forEach(proof => proofs.set(proof.txid, proof)); },
    setSequence() { sequence++; }, currentIdentity: () => copy().mempoolIdentity };
}
async function outspends(f: ReturnType<typeof setup>) {
  let view = await f.service.create('address', signal());
  for (let step = 0; step < 5; step++) view = await f.service.next('address', view.sessionId, view.cursor, signal());
  expect(view.progress.phase).toBe('outspends'); return view;
}
const state = (f: ReturnType<typeof setup>, id: string): any => (f.service as any).sessions.get(id);
const view = (f: ReturnType<typeof setup>, id: string): any => (f.service as any).view(state(f, id));

it.each([null, '', 'unknown'])('rejects malformed large-pool fallback identity %s before committing acquisition', async identity => {
  const f = setup(); f.setPool(Array.from({ length: 101 }, (_, n) => globalTx(n)));
  const original = f.source.snapshot;
  f.source.snapshot = jest.fn(async (...args) => ({ ...await original(...args), mempoolIdentity: identity as any }));
  let current = await f.service.create('address', signal());
  for (let i = 0; i < 6 && current.progress.phase !== 'acquire-mempool'; i++) current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.progress.phase).toBe('acquire-mempool');
  const cursor = current.cursor;
  await expect(f.service.next('address', current.sessionId, cursor, signal())).rejects.toMatchObject({ status: 503 });
  expect(state(f, current.sessionId).cursor).toBe(cursor);
  expect(view(f, current.sessionId).globalMempoolProof.verifiedOutputContext).toBeNull();
});

it('binds a complete empty output set to its independently fenced context and revalidates retries', async () => {
  const f = setup(); f.snapshot.summary.chain_stats = { ...zero };
  (f.source.history as jest.Mock).mockResolvedValue([]);
  let current = await f.service.create('address', signal());
  expect(current.globalMempoolProof.verifiedOutputContext).toBeNull();
  for (let i = 0; i < 8 && current.status === 'PARTIAL'; i++) current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.status).toBe('COMPLETE_AT_OBSERVED_TIP');
  expect(current.result).toMatchObject({ outputCount: 0, balanceAtomic: '0', items: [] });
  expect(current.globalMempoolProof.verifiedOutputContext).toMatchObject({ identity: f.currentIdentity(), outputCount: 0, outpointsSha256: digest([]) });
  f.setPool([f.original, globalTx(1)]);
  current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.status).toBe('COMPLETE_AT_OBSERVED_TIP');
  expect(current.globalMempoolProof.verifiedOutputContext).toMatchObject({ identity: f.currentIdentity(), outputCount: 0, outpointsSha256: digest([]) });
  expect(current.mempoolAnchor!.observedAt).toBe(current.globalMempoolProof.transitions[0].observedAt);
  state(f, current.sessionId).global.verifiedIdentity = undefined;
  const rejected = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(rejected.reason).toBe('VERIFIED_OUTPUT_CONTEXT_UNKNOWN');
  expect(rejected.result).toBeUndefined(); expect(rejected.globalMempoolProof.verifiedOutputContext).toBeNull();
});

it('retains independently verified outputs only across byte-proved unrelated additions/removals and closes current context', async () => {
  const f = setup(); let current = await outspends(f);
  current = await f.service.next('address', current.sessionId, current.cursor, signal()); expect(current.progress.verifiedOutputs).toBe(100); expect(current.result).toBeUndefined();
  const added = globalTx(1); f.setPool([f.original, added]);
  current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.progress).toMatchObject({ verifiedOutputs: 200, mempoolEpoch: 0 }); expect(current.globalMempoolProof.transitions[0]).toMatchObject({ fromIdentity: current.globalMempoolProof.initialIdentity, addedTxids: [added.txid], verifiedOutputsRetained: 100 });
  expect(current.mempoolAnchor!.observedAt).toBe(current.globalMempoolProof.transitions[0].observedAt);
  f.setPool([added]); current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(current.result).toMatchObject({ outputCount: 220, balanceAtomic: '22000' });
  expect(current.globalMempoolProof.verifiedOutputContext).toMatchObject({ identity: f.currentIdentity(), outputCount: 220, checkpoint: { blockHeight: 20 } });
  expect(current.globalMempoolProof.transitionCount).toBe(2); expect(current.globalMempoolProof.transitions[1].removedTxids).toEqual([f.original.txid]);
  expect((f.source.verifyOutputs as jest.Mock).mock.calls.map(call => call[0].length)).toEqual([100, 100, 20]);
});
it.each(['funding', 'spending'])('resets all final proofs for a relevant %s despite unchanged reported address statistics', async kind => {
  const f = setup(); let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
  f.setPool([f.original, kind === 'funding' ? globalTx(1, script) : globalTx(1, '51', hash(1))]);
  const reset = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(reset).toMatchObject({ status: 'PARTIAL', reason: 'ADDRESS_RELEVANT_GLOBAL_TRANSACTION', progress: { phase: 'acquire-mempool', verifiedOutputs: 0, mempoolEpoch: 1, confirmedTransactionsProcessed: 1 } });
  expect(reset.result).toBeUndefined(); expect(reset.globalMempoolProof.retainedBytes).toBe(0); expect(reset.confirmedTailAnchor).not.toBeNull();
});
it('does not trust zero address mempool statistics when independently read global native payload funds the script', async () => {
  const f = setup(); f.setPool([globalTx(1, script)]);
  let current = await f.service.create('address', signal()); for (let i = 0; i < 5; i++) current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.status).toBe('INVALIDATED'); expect(current.reason).toMatch(/global transactions do not close/); expect(current.result).toBeUndefined();
});
it('reacquires an uncached removed transaction from both native interfaces or safely resets when missing', async () => {
  for (const missing of [false, true]) {
    const f = setup(); let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
    state(f, current.sessionId).global.proofs.delete(f.original.txid); f.setPool([]); if (missing) f.proofs.delete(f.original.txid);
    const result = await f.service.next('address', current.sessionId, current.cursor, signal());
    if (missing) expect(result).toMatchObject({ reason: 'GLOBAL_TRANSACTION_PROOF_UNAVAILABLE', progress: { verifiedOutputs: 0, mempoolEpoch: 1 } });
    else { expect(result.progress.verifiedOutputs).toBe(200); expect(result.globalMempoolProof.transitions[0].removedTxids).toEqual([f.original.txid]); }
  }
});
it('resets final proofs when a previously observed selected-script spend is removed', async () => {
  const f = setup(), spend = globalTx(1, '51', hash(1)); f.setPool([spend]);
  f.snapshot.summary.mempool_stats = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 1, spent_txo_sum: 100, tx_count: 1 };
  (f.source.mempool as jest.Mock).mockResolvedValue([{ txid: spend.txid, version: 2, locktime: 0, size: 100, weight: 400, fee: 0,
    vin: [{ txid: hash(1), vout: 0, is_coinbase: false, prevout: { scriptpubkey: script, value: 100 } }],
    vout: [{ scriptpubkey: '51', value: 150 }], status: { confirmed: false } }]);
  let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(current.progress.verifiedOutputs).toBe(100); f.setPool([]);
  const reset = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(reset).toMatchObject({ reason: 'ADDRESS_RELEVANT_GLOBAL_TRANSACTION', progress: { verifiedOutputs: 0, mempoolEpoch: 1 } });
  expect(reset.result).toBeUndefined(); expect(reset.globalMempoolProof.verifiedOutputContext).toBeNull();
});
it('keeps fixed expiry and rejects pressure without enlarging the retained memory bound', async () => {
  const f = setup(); let now = 1000; const service = new UtxoReconstructionV4Service(f.source, 'signet', () => now);
  const start = await service.create('address', signal()); now += 59 * 60000;
  const partial = await service.next('address', start.sessionId, start.cursor, signal()); expect(partial.expiresAt).toBe(start.expiresAt);
  now += 60000; await expect(service.next('address', start.sessionId, partial.cursor, signal())).rejects.toMatchObject({ status: 404 });
  const pressure = setup(), current = await outspends(pressure); state(pressure, current.sessionId).bytes = 32 * 1024 * 1024;
  pressure.setPool([pressure.original, globalTx(2)]);
  const reset = await pressure.service.next('address', current.sessionId, current.cursor, signal());
  expect(reset.reason).toBe('GLOBAL_PROOF_BYTE_CAPACITY'); expect(reset.result).toBeUndefined();
  expect(reset.progress.retainedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
});
it.each(['missing', 'digest', 'identifier', 'sequence-only'])('safely resets %s global proof and never exposes a partial result', async mode => {
  const f = setup(); let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
  const added = globalTx(1); if (mode === 'sequence-only') f.setSequence(); else f.setPool([f.original, added]);
  if (mode === 'missing') f.proofs.delete(added.txid);
  if (mode === 'digest') f.proofs.set(added.txid, { ...added, rawSha256: hash(99) });
  if (mode === 'identifier') f.proofs.set(added.txid, { ...f.original, txid: added.txid });
  const reset = await f.service.next('address', current.sessionId, current.cursor, signal());
  expect(reset.progress).toMatchObject({ phase: 'acquire-mempool', verifiedOutputs: 0, mempoolEpoch: 1 }); expect(reset.result).toBeUndefined();
});
it('cancellation and later output-acquisition failure commit neither transition nor cursor/proofs', async () => {
  const f = setup(); let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
  const before = current, added = globalTx(1); f.setPool([f.original, added]); const controller = new AbortController();
  (f.source.globalTransactions as jest.Mock).mockImplementationOnce(async () => { controller.abort(); return [added]; });
  await expect(f.service.next('address', current.sessionId, current.cursor, controller.signal)).rejects.toMatchObject({ status: 499 });
  expect(view(f, current.sessionId)).toMatchObject({ cursor: before.cursor, mempoolAnchor: before.mempoolAnchor, progress: { verifiedOutputs: 100 }, globalMempoolProof: { transitionCount: 0 } });
  (f.source.verifyOutputs as jest.Mock).mockRejectedValueOnce(new ReconstructionError(503, 'native output acquisition failed'));
  await expect(f.service.next('address', current.sessionId, current.cursor, signal())).rejects.toMatchObject({ status: 503 });
  expect(view(f, current.sessionId)).toMatchObject({ cursor: before.cursor, mempoolAnchor: before.mempoolAnchor, progress: { verifiedOutputs: 100 }, globalMempoolProof: { transitionCount: 0 } });
  const retry = await f.service.next('address', current.sessionId, current.cursor, signal()); expect(retry.progress.verifiedOutputs).toBe(200); expect(retry.globalMempoolProof.transitionCount).toBe(1);
});
it('does not accept a moving global set during exact native delta acquisition', async () => {
  const f = setup(), current = await outspends(f), added = globalTx(1); f.setPool([f.original, added]);
  (f.source.globalTransactions as jest.Mock).mockImplementationOnce(async () => { f.setPool([f.original, added, globalTx(2)]); return [added]; });
  const reset = await f.service.next('address', current.sessionId, current.cursor, signal()); expect(reset.progress).toMatchObject({ verifiedOutputs: 0, mempoolEpoch: 1 }); expect(reset.result).toBeUndefined();
});
it('uses the explicit original strict-global fallback above100 or512KiB proof capacity, without claiming solved churn', async () => {
  for (const pool of [Array.from({ length: 101 }, (_, i) => globalTx(i)), [globalTx(1, '6a' + '00'.repeat(90000))]]) {
    const f = setup(); f.setPool(pool); const current = await outspends(f);
    expect(current.globalMempoolProof.mode).toBe('strict-global-fallback'); expect(current.globalMempoolProof.retainedBytes).toBeLessThanOrEqual(524288);
    f.setPool([...pool, globalTx(999)]); const reset = await f.service.next('address', current.sessionId, current.cursor, signal());
    expect(reset).toMatchObject({ reason: 'STRICT_GLOBAL_MEMPOOL_CHANGED', progress: { verifiedOutputs: 0, mempoolEpoch: 1 } }); expect(reset.result).toBeUndefined();
  }
});
it('charges all proof bytes inside32MiB, releases on Cancel, and invalidates bounded transition exhaustion', async () => {
  const f = setup(), current = await outspends(f); expect(current.progress.retainedBytes).toBeGreaterThan(current.globalMempoolProof.retainedBytes);
  state(f, current.sessionId).global.transitionCount = 128; f.setPool([f.original, globalTx(1)]);
  const invalid = await f.service.next('address', current.sessionId, current.cursor, signal()); expect(invalid.status).toBe('INVALIDATED'); expect(invalid.progress.retainedBytes).toBe(0); expect(invalid.globalMempoolProof.retainedBytes).toBe(0);
  const other = setup(), active = await outspends(other), cancelled = other.service.cancel('address', active.sessionId);
  expect(cancelled.progress.retainedBytes).toBe(0); expect(cancelled.globalMempoolProof.retainedBytes).toBe(0); expect(cancelled.result).toBeUndefined();
});
it('does not retain verified output context across source replacement/reorg or changed confirmed tail', async () => {
  for (const change of ['source', 'reorg', 'tail']) {
    const f = setup(); let current = await outspends(f); current = await f.service.next('address', current.sessionId, current.cursor, signal());
    if (change === 'source') f.snapshot.sourceId = hash(99);
    if (change === 'reorg') f.snapshot.checkpoint.blockHash = hash(99);
    if (change === 'tail') f.snapshot.summary.chain_stats.tx_count++;
    const rejected = await f.service.next('address', current.sessionId, current.cursor, signal());
    // Terminal release preserves the historical observation count, never a reusable proof/result.
    expect(rejected.progress.verifiedOutputs).toBe(change === 'tail' ? 0 : 100); expect(rejected.result).toBeUndefined(); expect(rejected.globalMempoolProof.verifiedOutputContext).toBeNull();
    if (change !== 'tail') expect(rejected.progress.retainedBytes).toBe(0);
    if (change === 'tail') expect(rejected.reason).toBe('CONFIRMED_TAIL_CHANGED'); else expect(rejected.status).toBe('INVALIDATED');
  }
});
