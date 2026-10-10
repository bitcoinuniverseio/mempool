import { readElectrumUtxoMetadata } from '../api/bitcoin/electrum-utxo-metadata';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const row = (n: number, height = n) => ({ tx_hash: hash(n), tx_pos: 0, height, value: 100 });
const core = async (method: string, params: unknown[]) => method === 'getblockhash' ? hash(params[0] as number)
  : { hash: params[0], height: parseInt(params[0] as string, 16), time: 1000 };

it('shares block-header reads for outputs in one block and preserves input order', async () => {
  const reader = jest.fn(core);
  const result = await readElectrumUtxoMetadata([row(9, 5), row(1, 0), row(7, 5)], reader);
  expect(result.map(x => x.txid)).toEqual([hash(9), hash(1), hash(7)]);
  expect(result[0].status).toEqual({ confirmed: true, block_height: 5, block_hash: hash(5), block_time: 1000 });
  expect(result[1].status).toEqual({ confirmed: false });
  expect(reader.mock.calls.map(x => x[0])).toEqual(['getblockhash', 'getblockheader']);
});

it('bounds concurrent reads when many outputs use different blocks', async () => {
  let active = 0, peak = 0;
  const reader = async (method: string, params: unknown[]) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return core(method, params);
  };
  expect((await readElectrumUtxoMetadata(Array.from({ length: 12 }, (_, i) => row(i + 1)), reader)).length).toBe(12);
  expect(peak).toBe(4);
});

it.each(['hash', 'height', 'time'])('rejects inconsistent canonical header %s', async field => {
  const reader = async (method: string, params: unknown[]) => {
    const answer = await core(method, params);
    if (method === 'getblockheader') return { ...answer as object, [field]: field === 'hash' ? hash(99) : -1 };
    return answer;
  };
  await expect(readElectrumUtxoMetadata([row(1)], reader)).rejects.toThrow('Invalid canonical UTXO block header');
});

it('rejects malformed indexed quantities before starting node reads', async () => {
  const reader = jest.fn(core);
  await expect(readElectrumUtxoMetadata([{ ...row(1), value: 0.5 }], reader)).rejects.toThrow('invalid UTXO contract');
  await expect(readElectrumUtxoMetadata([row(1, -1)], reader)).rejects.toThrow('Invalid indexed UTXO height');
  expect(reader).not.toHaveBeenCalled();
});

it('cancels the total request and schedules no later reads when a provider hangs', async () => {
  const signals: AbortSignal[] = [];
  const reader = jest.fn((_method: string, _params: unknown[], signal: AbortSignal) => {
    signals.push(signal); return new Promise<never>(() => {});
  });
  await expect(readElectrumUtxoMetadata(Array.from({ length: 8 }, (_, i) => row(i + 1)), reader, 20)).rejects.toThrow('deadline');
  expect(reader).toHaveBeenCalledTimes(4);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

it('aborts sibling reads on a provider failure and preserves the original failure', async () => {
  const failure = new Error('controlled provider rejection');
  const signals: AbortSignal[] = [];
  const reader = jest.fn((_method: string, params: unknown[], signal: AbortSignal) => {
    signals.push(signal);
    if (params[0] === 1) return Promise.reject(failure);
    return new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('controlled sibling cancellation')), { once: true });
    });
  });
  await expect(readElectrumUtxoMetadata(Array.from({ length: 8 }, (_, i) => row(i + 1)), reader)).rejects.toBe(failure);
  expect(reader).toHaveBeenCalledTimes(4);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});
