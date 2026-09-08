const mockGetMempool = jest.fn(() => ({}));
const mockGetCurrentBlockHeight = jest.fn(() => 900_000);
const mockGetBlocks = jest.fn(() => [{ id: 'tip-a' }]);

jest.mock('../mempool', () => ({
  __esModule: true,
  default: {
    getMempool: mockGetMempool,
    isInSync: jest.fn(() => true),
  },
}));
jest.mock('../blocks', () => ({
  __esModule: true,
  default: {
    getCurrentBlockHeight: mockGetCurrentBlockHeight,
    getBlocks: mockGetBlocks,
  },
}));
jest.mock('../transaction-utils', () => ({
  __esModule: true,
  default: {
    addInnerScriptsToVin: jest.fn(),
    convertScriptSigAsm: jest.fn(() => ''),
  },
}));
jest.mock('../common', () => ({
  Common: { getTransactionFlags: jest.fn(() => 0) },
}));

import { BitcoinApi } from './bitcoin-api';
import { IBitcoinApi } from './bitcoin-api.interface';

function coreTransaction(
  txid: string,
  vin: IBitcoinApi.Vin[] = [{ coinbase: '00', sequence: 0 }],
  confirmations = 1,
): IBitcoinApi.Transaction {
  return {
    txid,
    version: 2,
    locktime: 0,
    size: 100,
    weight: 400,
    confirmations,
    blockhash: 'a'.repeat(64),
    blocktime: 1_700_000_000,
    vin,
    vout: [
      {
        value: 1,
        scriptPubKey: {
          address: '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3',
          asm: '',
          hex: '51',
          type: 'pubkeyhash',
        },
      },
    ],
  } as IBitcoinApi.Transaction;
}

describe('Bitcoin RPC transaction reads', () => {
  beforeEach(() => {
    mockGetMempool.mockReset().mockReturnValue({});
    mockGetCurrentBlockHeight.mockReset().mockReturnValue(900_000);
    mockGetBlocks.mockReset().mockReturnValue([{ id: 'tip-a' }]);
  });

  it('coalesces overlapping reads and returns independent cached values', /** @asyncUnsafe The test resolves and observes the controlled RPC promise. */
  async () => {
    let release: (transaction: unknown) => void = () => undefined;
    const rpc = {
      getRawTransaction: jest.fn(
        () => new Promise((resolve) => (release = resolve))
      ),
    };
    const api = new BitcoinApi(rpc);
    const txid = 'b'.repeat(64);

    const first = api.$getRawTransaction(txid);
    const second = api.$getRawTransaction(txid);
    await new Promise((resolve) => setImmediate(resolve));
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(1);
    release(coreTransaction(txid));

    const [firstValue, secondValue] = await Promise.all([first, second]);
    expect(firstValue).toEqual(secondValue);
    expect(firstValue).not.toBe(secondValue);
    firstValue.vout[0].value = 7;

    const cached = await api.$getRawTransaction(txid);
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(1);
    expect(cached.vout[0].value).toBe(100_000_000);
  });

  it('shares raw transaction admission and coalescing across API instances using one RPC agent', /** @asyncUnsafe The test releases each controlled RPC promise. */
  async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const rpc = {
      rpc: { agent: { maxSockets: 2 } },
      getRawTransaction: jest.fn((txid: string) => new Promise((resolve) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        releases.push(() => {
          active -= 1;
          resolve(coreTransaction(txid));
        });
      })),
    };
    const firstApi = new BitcoinApi(rpc);
    const secondApi = new BitcoinApi(rpc);
    const sharedTxid = 'a'.repeat(64);
    const requests = [
      firstApi.$getRawTransaction(sharedTxid),
      secondApi.$getRawTransaction(sharedTxid),
      firstApi.$getRawTransaction('b'.repeat(64)),
      secondApi.$getRawTransaction('c'.repeat(64)),
    ];

    await new Promise((resolve) => setImmediate(resolve));
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index++) {
      expect(releases).toHaveLength(1);
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(releases).toHaveLength(1);
    releases.shift()?.();

    await expect(Promise.all(requests)).resolves.toHaveLength(4);
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(3);
    expect(maximumActive).toBe(1);
  });

  it('does not retain raw Core responses or oversized converted transactions', /** @asyncUnsafe The test observes each completed RPC promise. */
  async () => {
    const rawTxid = 'd'.repeat(64);
    const largeTxid = 'e'.repeat(64);
    const rpc = {
      getRawTransaction: jest.fn((txid: string) => {
        const transaction = coreTransaction(txid);
        if (txid === rawTxid) {
          transaction.hex = '00'.repeat(1024);
        } else {
          transaction.vin = [{
            coinbase: '00',
            sequence: 0,
            txinwitness: ['f'.repeat(600 * 1024)],
          }];
        }
        return Promise.resolve(transaction);
      }),
    };
    const api = new BitcoinApi(rpc);

    await api.$getRawTransaction(rawTxid, true);
    await api.$getRawTransaction(rawTxid, true);
    await api.$getRawTransaction(largeTxid);
    await api.$getRawTransaction(largeTxid);

    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(4);
  });

  it('loads transaction inputs concurrently behind the shared RPC pool', /** @asyncUnsafe The test releases and observes every controlled RPC promise. */
  async () => {
    const txid = 'c'.repeat(64);
    const inputIds = ['d', 'e', 'f'].map((character) => character.repeat(64));
    const releases = new Map<string, () => void>();
    let active = 0;
    let maximumActive = 0;
    const rpc = {
      rpc: { agent: { maxSockets: 3 } },
      getRawTransaction: jest.fn((requestedTxid: string) => {
        if (requestedTxid === txid) {
          return Promise.resolve(
            coreTransaction(
              txid,
              inputIds.map((inputTxid) => ({
                txid: inputTxid,
                vout: 0,
                sequence: 0,
              }))
            )
          );
        }
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise((resolve) => releases.set(requestedTxid, () => {
          active -= 1;
          releases.delete(requestedTxid);
          resolve(coreTransaction(requestedTxid));
        }));
      }),
    };
    const api = new BitcoinApi(rpc);

    const pending = api.$getRawTransaction(txid, false, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(3);
    expect(releases.size).toBe(2);
    expect(maximumActive).toBe(2);

    releases.values().next().value?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(4);
    expect(maximumActive).toBe(2);
    for (const release of [...releases.values()]) {
      release();
    }

    await expect(pending).resolves.toMatchObject({
      txid,
      fee: 200_000_000,
    });
  });

  it('does not mark or cache a conflicted transaction as confirmed', /** @asyncUnsafe The test observes every controlled RPC promise. */
  async () => {
    const txid = '1'.repeat(64);
    const rpc = {
      getRawTransaction: jest.fn(() => Promise.resolve(
        coreTransaction(txid, [{ coinbase: '00', sequence: 0 }], -1),
      )),
    };
    const api = new BitcoinApi(rpc);

    const first = await api.$getRawTransaction(txid);
    const second = await api.$getRawTransaction(txid);

    expect(first.status).toEqual({ confirmed: false });
    expect(first.status.block_height).toBeUndefined();
    expect(second.status).toEqual({ confirmed: false });
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(2);
  });

  it('invalidates confirmed entries when the local tip identity changes', /** @asyncUnsafe The test observes every controlled RPC promise. */
  async () => {
    const txid = '2'.repeat(64);
    const rpc = {
      getRawTransaction: jest.fn(() => Promise.resolve(coreTransaction(txid))),
    };
    const api = new BitcoinApi(rpc);

    await api.$getRawTransaction(txid);
    await api.$getRawTransaction(txid);
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(1);

    mockGetBlocks.mockReturnValue([{ id: 'tip-b' }]);
    await api.$getRawTransaction(txid);
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(2);
  });

  it('loads missing mempool prevouts concurrently behind the reserved pool', /** @asyncUnsafe The test releases and observes every controlled RPC promise. */
  async () => {
    const txid = '3'.repeat(64);
    const inputIds = ['4', '5', '6'].map((character) => character.repeat(64));
    const transaction = {
      txid,
      version: 2,
      locktime: 0,
      size: 100,
      weight: 400,
      fee: 1,
      status: { confirmed: false },
      vout: [],
      vin: inputIds.map((inputTxid) => ({
        txid: inputTxid,
        vout: 0,
        is_coinbase: false,
        scriptsig: '',
        scriptsig_asm: '',
        inner_redeemscript_asm: '',
        inner_witnessscript_asm: '',
        sequence: 0,
        witness: [],
        prevout: null,
      })),
    };
    mockGetMempool.mockReturnValue({ [txid]: transaction });

    const releases = new Map<string, () => void>();
    let active = 0;
    let maximumActive = 0;
    const rpc = {
      rpc: { agent: { maxSockets: 3 } },
      getRawTransaction: jest.fn((requestedTxid: string) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise((resolve) => releases.set(requestedTxid, () => {
          active -= 1;
          releases.delete(requestedTxid);
          resolve(coreTransaction(requestedTxid));
        }));
      }),
    };
    const api = new BitcoinApi(rpc);

    const pending = api.$getRawTransaction(txid, false, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(releases.size).toBe(2);
    expect(maximumActive).toBe(2);

    releases.values().next().value?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(rpc.getRawTransaction).toHaveBeenCalledTimes(3);
    for (const release of [...releases.values()]) {
      release();
    }

    await expect(pending).resolves.toMatchObject({
      vin: [
        { prevout: expect.objectContaining({ value: 100_000_000 }) },
        { prevout: expect.objectContaining({ value: 100_000_000 }) },
        { prevout: expect.objectContaining({ value: 100_000_000 }) },
      ],
    });
  });

  it('bounds unique transaction admission while Core is saturated', /** @asyncUnsafe The test releases the controlled Core promise after observing admission. */
  async () => {
    let release: (transaction: unknown) => void = () => undefined;
    const coreRead = new Promise((resolve) => (release = resolve));
    const rpc = {
      rpc: { agent: { maxSockets: 2 } },
      getRawTransaction: jest.fn(() => coreRead),
    };
    const api = new BitcoinApi(rpc);
    const requests = Array.from({ length: 32 }, (_, index) =>
      api.$getRawTransaction(String(index).repeat(64))
    );
    const settledRequests = Promise.allSettled(requests);

    release(coreTransaction('0'.repeat(64)));
    const results = await settledRequests;
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((result) =>
      result.status === 'rejected' && result.reason?.code === 'EBUSY'
    )).toBe(true);
    expect(rpc.getRawTransaction.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('expires queued work before it can outlive the gateway request', /** @asyncUnsafe Fake timers advance only the owned queue deadline. */
  async () => {
    jest.useFakeTimers();
    let release: (transaction: unknown) => void = () => undefined;
    const rpc = {
      rpc: { agent: { maxSockets: 2 } },
      getRawTransaction: jest.fn(() => new Promise((resolve) => (release = resolve))),
    };
    const api = new BitcoinApi(rpc);

    try {
      const active = api.$getRawTransaction('7'.repeat(64));
      await Promise.resolve();
      await Promise.resolve();
      const queued = api.$getRawTransaction('8'.repeat(64));
      await Promise.resolve();
      jest.advanceTimersByTime(5_001);
      await expect(queued).rejects.toMatchObject({ code: 'ERPCQUEUETIMEOUT' });
      expect(rpc.getRawTransaction).toHaveBeenCalledTimes(1);
      release(coreTransaction('7'.repeat(64)));
      await expect(active).resolves.toMatchObject({ txid: '7'.repeat(64) });
    } finally {
      jest.useRealTimers();
    }
  });

  it('caps active raw reads below the gateway timeout', /** @asyncUnsafe The test observes the controlled RPC promise. */
  async () => {
    const txid = '9'.repeat(64);
    const directCall = jest.fn(() => Promise.resolve(coreTransaction(txid)));
    const rpc = {
      rpc: { agent: { maxSockets: 8 }, call: directCall },
      getRawTransaction: jest.fn(),
    };
    const api = new BitcoinApi(rpc);

    await api.$getRawTransaction(txid);

    expect(directCall).toHaveBeenCalledWith(
      'getrawtransaction',
      [txid, true],
      { timeout: 20_000 },
    );
    expect(rpc.getRawTransaction).not.toHaveBeenCalled();
  });
});
