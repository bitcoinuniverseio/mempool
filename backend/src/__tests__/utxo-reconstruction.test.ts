import { UtxoReconstructionService, ReconstructionSnapshot, ReconstructionSource } from '../api/bitcoin/utxo-reconstruction.service';
import { IEsploraApi } from '../api/bitcoin/esplora-api.interface';

const script = '0014' + 'a'.repeat(40), hash = (n: number) => n.toString(16).padStart(64, '0');
const zero = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
function transaction(n: number, value: number, spent?: number): IEsploraApi.Transaction {
  return { txid: hash(n), version: 1, locktime: 0, size: 100, weight: 400, fee: 0,
    vin: [spent == null ? { is_coinbase: true, prevout: null } : { is_coinbase: false, txid: hash(spent), vout: 0, prevout: { scriptpubkey: script, value: 100 } }] as IEsploraApi.Vin[],
    vout: [{ scriptpubkey: script, value }] as IEsploraApi.Vout[],
    status: { confirmed: true, block_height: n + 9, block_hash: hash(n + 100), block_time: 1000 + n } };
}
function setup() {
  const snapshot: ReconstructionSnapshot = { sourceId: hash(9), scriptPubKey: script, mempoolIdentity: hash(8),
    checkpoint: { network: 'signet', genesisHash: hash(7), blockHeight: 20, blockHash: hash(6), signetChallenge: '51', verifiedAt: new Date().toISOString() },
    summary: { address: 'address', chain_stats: { funded_txo_count: 2, funded_txo_sum: 170, spent_txo_count: 1, spent_txo_sum: 100, tx_count: 2 }, mempool_stats: { ...zero } } };
  const source: ReconstructionSource = { snapshot: jest.fn(async () => JSON.parse(JSON.stringify(snapshot))),
    history: jest.fn(async (_address, after) => after ? [] : [transaction(2, 70, 1), transaction(1, 100)]),
    mempool: jest.fn(async () => []), verifyOutputs: jest.fn(async () => undefined) };
  return { service: new UtxoReconstructionService(source, 'signet'), source, snapshot };
}
const signal = () => new AbortController().signal;

describe('explicit bounded UTXO reconstruction', () => {
  it('keeps pages partial until exact history, amounts and independent outspends close', async () => {
    const { service, source } = setup(); let view = await service.create('address', signal());
    expect(view.result).toBeUndefined();
    for (let i = 0; i < 3; i++) { view = await service.next('address', view.sessionId, view.cursor, signal()); expect(view.status).toBe('PARTIAL'); expect(view.result).toBeUndefined(); }
    view = await service.next('address', view.sessionId, view.cursor, signal());
    expect(view.status).toBe('COMPLETE_AT_OBSERVED_TIP'); expect(view.result?.balanceAtomic).toBe('70');
    expect(view.result?.items).toEqual([{ txid: hash(2), vout: 0, valueAtomic: '70', status: transaction(2, 70, 1).status }]);
    expect(source.verifyOutputs).toHaveBeenCalledWith([expect.objectContaining({ txid: hash(2), value: 70 })], expect.anything(), expect.objectContaining({ network: 'signet', blockHeight: 20 }));
  });
  it('replays the previous cursor with a fresh source check and without duplicate progress', async () => {
    const { service, source } = setup(); const start = await service.create('address', signal());
    const first = await service.next('address', start.sessionId, 0, signal()), count = (source.snapshot as jest.Mock).mock.calls.length;
    expect(await service.next('address', start.sessionId, 0, signal())).toMatchObject({
      sessionId: first.sessionId, cursor: first.cursor, status: first.status, progress: first.progress,
    });
    expect((source.snapshot as jest.Mock).mock.calls.length).toBe(count + 1);
    await expect(service.next('other-address', start.sessionId, 1, signal())).rejects.toMatchObject({ status: 404 });
    await expect(service.next('address', start.sessionId, 42, signal())).rejects.toMatchObject({ status: 409 });
  });
  it('invalidates a cached cursor replay when its exact source context changes', async () => {
    const { service, snapshot } = setup(); const start = await service.create('address', signal());
    await service.next('address', start.sessionId, 0, signal()); snapshot.mempoolIdentity = hash(123);
    const replay = await service.next('address', start.sessionId, 0, signal()); expect(replay.status).toBe('INVALIDATED'); expect(replay.result).toBeUndefined();
  });
  it('reserves pending creation slots before source reads and reclaims cancelled terminal slots', async () => {
    const { service, source, snapshot } = setup(); const releases: (() => void)[] = [];
    (source.snapshot as jest.Mock).mockImplementation(() => new Promise(resolve => releases.push(() => resolve(JSON.parse(JSON.stringify(snapshot))))));
    const pending = Array.from({ length: 8 }, () => service.create('address', signal()));
    await expect(service.create('address', signal())).rejects.toMatchObject({ status: 429 });
    expect(releases).toHaveLength(8); releases.forEach(release => release()); const sessions = await Promise.all(pending);
    service.cancel('address', sessions[0].sessionId);
    (source.snapshot as jest.Mock).mockResolvedValue(JSON.parse(JSON.stringify(snapshot)));
    expect((await service.create('address', signal())).status).toBe('PARTIAL');
    await expect(service.next('address', sessions[0].sessionId, 0, signal())).rejects.toMatchObject({ status: 404 });
  });
  it.each(['blockHash', 'mempoolIdentity', 'statistics'])('invalidates %s changes without a complete result', async field => {
    const { service, snapshot } = setup(); const start = await service.create('address', signal());
    if (field === 'blockHash') snapshot.checkpoint.blockHash = hash(55);
    if (field === 'mempoolIdentity') snapshot.mempoolIdentity = hash(66);
    if (field === 'statistics') snapshot.summary.chain_stats.funded_txo_sum++;
    const view = await service.next('address', start.sessionId, 0, signal()); expect(view.status).toBe('INVALIDATED'); expect(view.result).toBeUndefined(); expect(view.progress.retainedBytes).toBe(0);
  });
  it('does not commit a timed out page and permits retry of its original cursor', async () => {
    const { service, source } = setup(); const start = await service.create('address', signal()), controller = new AbortController();
    (source.history as jest.Mock).mockImplementationOnce(async () => { controller.abort(); return [transaction(2, 70, 1)]; });
    await expect(service.next('address', start.sessionId, 0, controller.signal)).rejects.toMatchObject({ status: 499 });
    const view = await service.next('address', start.sessionId, 0, signal()); expect(view.progress.confirmedTransactionsProcessed).toBe(2); expect(view.cursor).toBe(1);
  });
  it('cancels an active page and releases its retained state', async () => {
    const { service, source } = setup(); const start = await service.create('address', signal()); let release!: () => void;
    (source.history as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([transaction(2, 70, 1)]); }));
    const pending = service.next('address', start.sessionId, 0, signal());
    await new Promise(resolve => setImmediate(resolve));
    await expect(service.next('address', start.sessionId, 0, signal())).rejects.toMatchObject({ status: 409 });
    expect(service.cancel('address', start.sessionId).status).toBe('CANCELLED'); release();
    expect((await pending).status).toBe('CANCELLED'); expect((await pending).result).toBeUndefined();
  });
  it.each(['duplicate', 'unsafe', 'missingPrevout', 'missingHistory'])('rejects %s closure defects', async defect => {
    const { service, source } = setup(); const start = await service.create('address', signal());
    const rows = [transaction(2, 70, 1), transaction(1, 100)];
    if (defect === 'duplicate') rows.push(rows[1]);
    if (defect === 'unsafe') rows[0].vout[0].value = Number.MAX_SAFE_INTEGER + 1;
    if (defect === 'missingPrevout') rows[0].vin[0].prevout = null;
    if (defect === 'missingHistory') rows.splice(0, 2);
    (source.history as jest.Mock).mockResolvedValueOnce(rows);
    const view = await service.next('address', start.sessionId, 0, signal()); expect(view.status).toBe('INVALIDATED'); expect(view.result).toBeUndefined();
  });
  it('bounds actual retained bytes even when transaction and output counts are small', async () => {
    const { service, source } = setup();
    const huge = transaction(1, 100); const largeScript = 'ab'.repeat(4500);
    // Select the same large script before session creation so retained output bytes are charged.
    const { snapshot } = setup(); snapshot.scriptPubKey = largeScript;
    snapshot.summary.chain_stats = { ...zero, funded_txo_count: 1000, funded_txo_sum: 100000, tx_count: 1 };
    (source.snapshot as jest.Mock).mockResolvedValue(snapshot);
    huge.vout = Array.from({ length: 1000 }, () => ({ ...huge.vout[0], scriptpubkey: largeScript }));
    const fresh = await service.create('address', signal()); (source.history as jest.Mock).mockResolvedValueOnce([huge]);
    const result = await service.next('address', fresh.sessionId, 0, signal()); expect(result.status).toBe('INVALIDATED'); expect(result.reason).toMatch(/memory/); expect(result.result).toBeUndefined();
  });
});
