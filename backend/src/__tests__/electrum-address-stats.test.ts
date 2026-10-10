import { createHash } from 'crypto';
import { collectElectrumAddressStats, ElectrumStatsReader } from '../api/bitcoin/electrum-address-stats';
const hash = (n: number) => n.toString(16).padStart(64, '0'), script = '0014' + 'a'.repeat(40);
const selected = createHash('sha256').update(Buffer.from(script, 'hex')).digest().reverse().toString('hex');
const checkpoint = { network: 'signet', genesisHash: hash(0), blockHeight: 20, blockHash: hash(20), signetChallenge: '51', verifiedAt: new Date().toISOString() };
const output = (sats: number) => ({ n: 0, value: sats / 100000000, scriptPubKey: { hex: script } });
function setup() {
  const transactions = {
    [hash(1)]: { txid: hash(1), confirmations: 11, blockhash: hash(10), vin: [{ coinbase: '01' }], vout: [output(200000)] },
    [hash(2)]: { txid: hash(2), vin: [{ txid: hash(1), vout: 0 }], vout: [output(100000)] },
  };
  const history = [{ tx_hash: hash(1), height: 10 }, { tx_hash: hash(2), height: 0, fee: 0 }];
  const reader: ElectrumStatsReader = {
    checkpoint: jest.fn(async () => ({ ...checkpoint })), history: jest.fn(async () => history),
    balance: jest.fn(async () => ({ confirmed: 200000, unconfirmed: -100000 })),
    core: jest.fn(async (method, params) => method === 'getblockhash' ? hash(params[0] as number) : transactions[params[0] as string]),
  };
  return { reader, history, transactions };
}
it('derives actual funded/spent turnover and counts including a zero-fee mempool spend', async () => {
  const { reader } = setup(); const result = await collectElectrumAddressStats(selected, reader);
  expect(result.chain_stats).toEqual({ funded_txo_count: 1, funded_txo_sum: 200000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 });
  expect(result.mempool_stats).toEqual({ funded_txo_count: 1, funded_txo_sum: 100000, spent_txo_count: 1, spent_txo_sum: 200000, tx_count: 1 });
  expect(reader.core).toHaveBeenCalledWith('getrawtransaction', [hash(1), 1], expect.any(AbortSignal));
});
it('returns the funded fixture count1 instead of fabricated zero', async () => {
  const { reader, history } = setup(); history.splice(1); (reader.balance as jest.Mock).mockResolvedValue({ confirmed: 200000, unconfirmed: 0 });
  const result = await collectElectrumAddressStats(selected, reader); expect(result.chain_stats.funded_txo_count).toBe(1); expect(result.mempool_stats.tx_count).toBe(0);
});
it('allows extra Core confirmations above the indexed common checkpoint while binding the exact funding block', async () => {
  const { reader, transactions } = setup(); transactions[hash(1)].confirmations = 12;
  expect((await collectElectrumAddressStats(selected, reader)).chain_stats.funded_txo_count).toBe(1);
});
it.each(['history', 'balance', 'checkpoint'])('rejects %s changes before publishing statistics', async field => {
  const { reader } = setup();
  if (field === 'history') (reader.history as jest.Mock).mockResolvedValueOnce([{ tx_hash: hash(1), height: 10 }, { tx_hash: hash(2), height: 0 }]).mockResolvedValueOnce([{ tx_hash: hash(1), height: 10 }]);
  if (field === 'balance') (reader.balance as jest.Mock).mockResolvedValueOnce({ confirmed: 200000, unconfirmed: -100000 }).mockResolvedValueOnce({ confirmed: 200000, unconfirmed: 0 });
  if (field === 'checkpoint') (reader.checkpoint as jest.Mock).mockResolvedValueOnce(checkpoint).mockResolvedValueOnce({ ...checkpoint, blockHash: hash(999) });
  await expect(collectElectrumAddressStats(selected, reader)).rejects.toThrow(/changed/);
});
it.each(['missingPrevout', 'wrongBalance', 'wrongBlock', 'duplicate', 'oversized'])('fails closed on %s without a balance-only fabricated summary', async defect => {
  const { reader, transactions, history } = setup();
  if (defect === 'missingPrevout') (reader.core as jest.Mock).mockImplementation(async (method, params) => params[1] === 1 ? undefined : method === 'getblockhash' ? hash(params[0]) : transactions[params[0]]);
  if (defect === 'wrongBalance') (reader.balance as jest.Mock).mockResolvedValue({ confirmed: 1, unconfirmed: 0 });
  if (defect === 'wrongBlock') transactions[hash(1)].blockhash = hash(11);
  if (defect === 'duplicate') history.push(history[0]);
  if (defect === 'oversized') (reader.history as jest.Mock).mockResolvedValue(Array.from({ length: 1001 }, (_, i) => ({ tx_hash: hash(i), height: 1 })));
  await expect(collectElectrumAddressStats(selected, reader)).rejects.toThrow();
});
it('bounds address resolution and prevents new reads after its deadline even if it ignores cancellation', async () => {
  jest.useFakeTimers(); const { reader } = setup(); let release!: () => void;
  const result = collectElectrumAddressStats(() => new Promise(resolve => { release = () => resolve(selected); }), reader);
  const assertion = expect(result).rejects.toThrow(/deadline/); await jest.advanceTimersByTimeAsync(15001); await assertion;
  release(); await Promise.resolve(); expect(reader.checkpoint).not.toHaveBeenCalled(); expect(reader.core).not.toHaveBeenCalled(); jest.useRealTimers();
});

it('links an already cancelled caller before address resolution or any source dispatch', async () => {
  const { reader } = setup(), controller = new AbortController(), selectedRead = jest.fn(async () => selected);
  controller.abort();
  await expect(collectElectrumAddressStats(selectedRead, reader, controller.signal)).rejects.toThrow(/deadline/);
  expect(selectedRead).not.toHaveBeenCalled(); expect(reader.checkpoint).not.toHaveBeenCalled(); expect(reader.core).not.toHaveBeenCalled();
});

it('caller cancellation at5s ends fallback statistics without late source work and removes listeners', async () => {
  jest.useFakeTimers();
  try {
    const { reader } = setup(), controller = new AbortController(), remove = jest.spyOn(controller.signal, 'removeEventListener');
    let finish: (value: string) => void = jest.fn();
    const result = collectElectrumAddressStats(() => new Promise<string>(resolve => { finish = resolve; }), reader, controller.signal);
    const rejected = expect(result).rejects.toThrow(/deadline/); await Promise.resolve();
    jest.advanceTimersByTime(5000); controller.abort(); await rejected;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    finish(selected); await Promise.resolve(); await Promise.resolve();
    expect(reader.checkpoint).not.toHaveBeenCalled(); expect(reader.core).not.toHaveBeenCalled();
    await expect(collectElectrumAddressStats(selected, setup().reader)).resolves.toHaveProperty('chain_stats');
  } finally { jest.useRealTimers(); }
});

it('a synchronous reader failure does not orphan its cancellation rejection', async () => {
  const { reader } = setup(); reader.checkpoint = (): never => { throw Error('synchronous source failure'); };
  await expect(collectElectrumAddressStats(selected, reader)).rejects.toThrow('synchronous source failure');
  await Promise.resolve(); await Promise.resolve();
});
