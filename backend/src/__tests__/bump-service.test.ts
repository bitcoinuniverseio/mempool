import { MempoolTransactionExtended } from '../mempool.interfaces';

/**
 * Only the pure halves are under test here. The Bitcoin Core client is
 * replaced with something that loads, and nothing in these tests reaches it.
 */
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {} }));

let fakeMempool: { [txid: string]: MempoolTransactionExtended } = {};
jest.mock('../api/mempool', () => ({
  __esModule: true,
  default: { getMempool: () => fakeMempool, getSpendMap: () => new Map() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  buildTarget,
  MAX_TARGET_FEERATE,
  readTargetFeerate,
  spendableTypeOf,
} = require('../api/mempool-intelligence/bump-service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const intelligence = require('../api/mempool-intelligence/mempool-intelligence').default;

function id(label: string): string {
  return label.padEnd(64, '0');
}

function entry(options: {
  label: string;
  fee?: number;
  vsize?: number;
  sequences?: number[];
  outputs?: { value: number; type: string }[];
  parents?: string[];
}): MempoolTransactionExtended {
  const vsize = options.vsize ?? 200;
  return {
    txid: id(options.label),
    fee: options.fee ?? 1000,
    vsize,
    adjustedVsize: vsize,
    weight: vsize * 4,
    vin: (options.sequences ?? [0xfffffffd]).map((sequence, i) => ({
      txid: id(options.parents?.[i] ?? 'external'),
      vout: 0,
      sequence,
    })),
    vout: (options.outputs ?? [{ value: 100_000, type: 'v0_p2wpkh' }]).map((out) => ({
      value: out.value,
      scriptpubkey_type: out.type,
    })),
  } as unknown as MempoolTransactionExtended;
}

beforeEach(() => {
  intelligence.invalidate();
  fakeMempool = {};
});

describe('spendableTypeOf', () => {
  it('names the four types whose spend size the type settles', () => {
    expect(spendableTypeOf('p2pkh')).toBe('p2pkh');
    expect(spendableTypeOf('v0_p2wpkh')).toBe('p2wpkh');
    expect(spendableTypeOf('v0_p2wsh')).toBe('p2wsh');
    expect(spendableTypeOf('v1_p2tr')).toBe('p2tr');
  });

  it('refuses to name a bare script hash, whose spend it has not seen', () => {
    // A p2sh output could wrap anything, so no spend size follows from it.
    expect(spendableTypeOf('p2sh')).toBe('unknown');
    expect(spendableTypeOf('multisig')).toBe('unknown');
    expect(spendableTypeOf('nonstandard')).toBe('unknown');
    expect(spendableTypeOf(undefined)).toBe('unknown');
  });
});

describe('readTargetFeerate', () => {
  it('takes a whole rate and a fractional one', () => {
    expect(readTargetFeerate('20')).toBe(20);
    expect(readTargetFeerate('1.5')).toBe(1.5);
  });

  it('refuses an absent rate rather than picking one', () => {
    expect(readTargetFeerate(undefined)).toBeNull();
    expect(readTargetFeerate('')).toBeNull();
  });

  it('refuses zero, a negative and text', () => {
    expect(readTargetFeerate('0')).toBeNull();
    expect(readTargetFeerate('-5')).toBeNull();
    expect(readTargetFeerate('fast')).toBeNull();
  });

  it('refuses a repeated query parameter, which arrives as an array', () => {
    expect(readTargetFeerate(['1', '2'])).toBeNull();
  });

  it('refuses a rate past the ceiling', () => {
    expect(readTargetFeerate(String(MAX_TARGET_FEERATE))).toBe(MAX_TARGET_FEERATE);
    expect(readTargetFeerate(String(MAX_TARGET_FEERATE + 1))).toBeNull();
  });

  it('refuses more precision than a fee rate carries', () => {
    expect(readTargetFeerate('1.23456')).toBeNull();
  });
});

describe('buildTarget', () => {
  it('returns null for a transaction the mempool does not hold', () => {
    expect(buildTarget(id('missing'), {}, new Map())).toBeNull();
  });

  it('reads the outputs with their types and values', () => {
    fakeMempool = {
      [id('a')]: entry({
        label: 'a',
        outputs: [{ value: 90_000, type: 'v1_p2tr' }, { value: 5_000, type: 'p2sh' }],
      }),
    };
    const target = buildTarget(id('a'), fakeMempool, new Map());
    expect(target?.outputs).toEqual([
      { index: 0, valueSats: 90_000, type: 'p2tr', spent: false },
      { index: 1, valueSats: 5_000, type: 'unknown', spent: false },
    ]);
  });

  it('marks an output the mempool already spends', () => {
    fakeMempool = { [id('a')]: entry({ label: 'a' }) };
    const spendMap = new Map<string, MempoolTransactionExtended>([
      [`${id('a')}:0`, entry({ label: 'b' })],
    ]);
    expect(buildTarget(id('a'), fakeMempool, spendMap)?.outputs[0].spent).toBe(true);
  });

  it('reads the replacement signal from the input sequences', () => {
    fakeMempool = { [id('a')]: entry({ label: 'a', sequences: [0xffffffff] }) };
    expect(buildTarget(id('a'), fakeMempool, new Map())?.signalsReplacement).toBe(false);
    fakeMempool = { [id('a')]: entry({ label: 'a', sequences: [0xffffffff, 0xfffffffd] }) };
    expect(buildTarget(id('a'), fakeMempool, new Map())?.signalsReplacement).toBe(true);
  });

  it('excludes the transaction itself from its own descendants', () => {
    // The planner adds this transaction's fee to the eviction total on its
    // own, so counting it here would double the price of every replacement.
    fakeMempool = {
      [id('a')]: entry({ label: 'a', fee: 1000 }),
      [id('b')]: entry({ label: 'b', fee: 700, parents: ['a'] }),
    };
    const spendMap = new Map<string, MempoolTransactionExtended>([
      [`${id('a')}:0`, fakeMempool[id('b')]],
    ]);
    const target = buildTarget(id('a'), fakeMempool, spendMap);
    expect(target?.descendants.map((d) => d.txid)).toEqual([id('b')]);
  });

  it('takes the ancestor totals from the cluster engine', () => {
    fakeMempool = {
      [id('a')]: entry({ label: 'a', fee: 1000, vsize: 200 }),
      [id('b')]: entry({ label: 'b', fee: 700, vsize: 150, parents: ['a'] }),
    };
    const target = buildTarget(id('b'), fakeMempool, new Map());
    // The child's ancestor set is itself plus its parent.
    expect(target?.ancestorVsize).toBe(350);
    expect(target?.ancestorFeeSats).toBe(1700);
  });

  it('uses the adjusted size, which is the size every rate is against', () => {
    fakeMempool = {
      [id('a')]: {
        ...entry({ label: 'a' }), adjustedVsize: 275, weight: 800,
      } as unknown as MempoolTransactionExtended,
    };
    expect(buildTarget(id('a'), fakeMempool, new Map())?.vsize).toBe(275);
  });

  it('falls back to weight over four when no adjusted size is recorded', () => {
    fakeMempool = {
      [id('a')]: {
        txid: id('a'), fee: 500, weight: 800, vin: [], vout: [],
      } as unknown as MempoolTransactionExtended,
    };
    expect(buildTarget(id('a'), fakeMempool, new Map())?.vsize).toBe(200);
  });
});
