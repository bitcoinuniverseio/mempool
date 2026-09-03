import { MempoolTransactionExtended } from '../mempool.interfaces';

/**
 * The service pulls in a Bitcoin Core client at module load. Only the pure
 * halves are under test here, so the client is replaced with something that
 * loads, and the tests never reach it.
 */
jest.mock('../api/bitcoin/bitcoin-client', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => ({}), getSpendMap: () => new Map() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  chunksFromDiagram,
  descendantsOf,
  MAX_PACKAGE_SIZE,
  validateRawTxs,
} = require('../api/mempool-intelligence/package-service');

function id(label: string): string {
  return label.padEnd(64, '0');
}

const RAW = 'deadbeef';

describe('validateRawTxs', () => {
  it('accepts a package of raw transactions', () => {
    expect(validateRawTxs([RAW, 'cafebabe'])).toBeNull();
  });

  it('refuses an empty package rather than answering about nothing', () => {
    expect(validateRawTxs([])?.status).toBe(400);
    expect(validateRawTxs(undefined)?.status).toBe(400);
    expect(validateRawTxs('deadbeef')?.status).toBe(400);
  });

  it('refuses more transactions than a node will relay as one package', () => {
    const many = new Array(MAX_PACKAGE_SIZE + 1).fill(RAW).map((_, i) => RAW + i.toString(16).padStart(2, '0'));
    const error = validateRawTxs(many);
    expect(error?.status).toBe(400);
    expect(error?.message).toContain(String(MAX_PACKAGE_SIZE));
  });

  it('refuses anything that is not even length hexadecimal', () => {
    expect(validateRawTxs(['zzzz'])?.status).toBe(400);
    expect(validateRawTxs(['abc'])?.status).toBe(400);
    expect(validateRawTxs([''])?.status).toBe(400);
    expect(validateRawTxs([123])?.status).toBe(400);
  });

  it('refuses a package larger than the route will read', () => {
    expect(validateRawTxs(['ab'.repeat(3_000_000)])?.status).toBe(400);
  });

  it('refuses the same transaction twice, which is not a package', () => {
    const error = validateRawTxs([RAW, RAW]);
    expect(error?.status).toBe(400);
    expect(error?.message).toContain('twice');
  });
});

describe('chunksFromDiagram', () => {
  it('turns a cumulative curve back into the groups it was drawn from', () => {
    const chunks = chunksFromDiagram([
      { vsize: 0, feerate: null },
      { vsize: 1000, feerate: 100 },
      { vsize: 3000, feerate: 50 },
    ]);
    expect(chunks).toEqual([
      { feerate: 100, vsize: 1000 },
      { feerate: 50, vsize: 2000 },
    ]);
  });

  it('skips the origin, which is a point rather than a group', () => {
    expect(chunksFromDiagram([{ vsize: 0, feerate: null }])).toEqual([]);
  });

  it('is empty for an empty curve', () => {
    expect(chunksFromDiagram([])).toEqual([]);
  });
});

describe('descendantsOf', () => {
  function entry(
    label: string,
    fee: number,
    vsize: number,
    outputs = 1,
  ): MempoolTransactionExtended {
    return {
      txid: id(label),
      fee,
      adjustedVsize: vsize,
      weight: vsize * 4,
      vout: new Array(outputs).fill({ value: 1000 }),
    } as unknown as MempoolTransactionExtended;
  }

  it('returns the transaction itself when nothing spends it', () => {
    const pool = { [id('a')]: entry('a', 500, 100) };
    const found = descendantsOf(id('a'), pool, new Map());
    expect(found).toEqual([{ txid: id('a'), feeSats: 500, vsize: 100 }]);
  });

  it('walks the whole chain of children', () => {
    const pool = {
      [id('a')]: entry('a', 500, 100),
      [id('b')]: entry('b', 600, 110),
      [id('c')]: entry('c', 700, 120),
    };
    const spendMap = new Map<string, MempoolTransactionExtended>([
      [`${id('a')}:0`, pool[id('b')]],
      [`${id('b')}:0`, pool[id('c')]],
    ]);
    const found = descendantsOf(id('a'), pool, spendMap);
    expect(found.map((tx) => tx.txid).sort()).toEqual([id('a'), id('b'), id('c')]);
  });

  it('counts a child that spends two of the same parent outputs once', () => {
    const pool = {
      [id('a')]: entry('a', 500, 100, 2),
      [id('b')]: entry('b', 600, 110),
    };
    const spendMap = new Map<string, MempoolTransactionExtended>([
      [`${id('a')}:0`, pool[id('b')]],
      [`${id('a')}:1`, pool[id('b')]],
    ]);
    expect(descendantsOf(id('a'), pool, spendMap)).toHaveLength(2);
  });

  it('terminates on a cycle rather than walking it forever', () => {
    const pool = {
      [id('a')]: entry('a', 500, 100),
      [id('b')]: entry('b', 600, 110),
    };
    const spendMap = new Map<string, MempoolTransactionExtended>([
      [`${id('a')}:0`, pool[id('b')]],
      [`${id('b')}:0`, pool[id('a')]],
    ]);
    expect(descendantsOf(id('a'), pool, spendMap)).toHaveLength(2);
  });

  it('uses the adjusted size, which is the size a replacement has to outbid', () => {
    const pool = {
      [id('a')]: {
        txid: id('a'), fee: 500, adjustedVsize: 180, weight: 400, vout: [{ value: 1 }],
      } as unknown as MempoolTransactionExtended,
    };
    expect(descendantsOf(id('a'), pool, new Map())[0].vsize).toBe(180);
  });

  it('falls back to weight over four when no adjusted size is recorded', () => {
    const pool = {
      [id('a')]: {
        txid: id('a'), fee: 500, weight: 400, vout: [{ value: 1 }],
      } as unknown as MempoolTransactionExtended,
    };
    expect(descendantsOf(id('a'), pool, new Map())[0].vsize).toBe(100);
  });

  it('returns nothing for a transaction the mempool does not hold', () => {
    expect(descendantsOf(id('missing'), {}, new Map())).toEqual([]);
  });
});
