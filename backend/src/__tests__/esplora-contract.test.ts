import {
  addressHistoryProblems,
  addressSummaryProblems,
  utxoListProblems,
} from '../api/bitcoin/esplora-contract';

/**
 * The rules the address surface is built on, run against recorded answers.
 *
 * The failure mode this guards is specific and quiet: a fixture that is
 * generous where the real provider is strict. A mock that returns amounts as
 * strings, a mock that hands back an unbounded history because it only ever
 * holds three transactions, a mock that omits a block height because nothing
 * in the test rendered an age. Each of those passes forever and each of them
 * describes a provider that does not exist.
 *
 * So there is one set of rules, and both the fixtures below and the live index
 * are judged by it. `$probeAddressIndex` calls the same functions, which is
 * what makes the deployment's own readiness verdict and this test the same
 * claim rather than two that happen to agree today.
 *
 * Point UNIVERSE_ESPLORA_CONTRACT_URL at a running index to run the same
 * assertions against real answers.
 */

const ADDRESS = '1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';
const TXID = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16';

const summaryFixture = {
  address: ADDRESS,
  chain_stats: {
    funded_txo_count: 2,
    funded_txo_sum: 1_000_000_000,
    spent_txo_count: 1,
    spent_txo_sum: 1_000_000_000,
    tx_count: 2,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
};

const historyFixture = [
  {
    txid: TXID,
    vin: [{ txid: TXID, vout: 0 }],
    vout: [{ value: 1_000_000_000, scriptpubkey_address: ADDRESS }],
    status: { confirmed: true, block_height: 170, block_hash: '00'.repeat(32), block_time: 1231731025 },
  },
];

const utxoFixture = [
  { txid: TXID, vout: 0, value: 1_000_000_000, status: { confirmed: true, block_height: 170 } },
];

describe('esplora address contract', () => {
  it('accepts the answers the index actually gives', () => {
    expect(addressSummaryProblems(summaryFixture, ADDRESS)).toEqual([]);
    expect(addressHistoryProblems(historyFixture)).toEqual([]);
    expect(utxoListProblems(utxoFixture)).toEqual([]);
  });

  it('refuses a summary about a different address', () => {
    // A cache keyed wrong, or a redirect followed, and the page shows one
    // person's balance under another person's address.
    expect(addressSummaryProblems({ ...summaryFixture, address: 'bc1qsomethingelse' }, ADDRESS))
      .toContainEqual(expect.stringContaining('rather than'));
  });

  /**
   * The one that matters most. An amount that arrives as a string looks
   * completely normal in a fixture and concatenates instead of subtracting in
   * the balance calculation, and an amount that arrives as a float silently
   * loses satoshis above 2^53.
   */
  it('refuses an amount that is not a whole number of satoshis', () => {
    for (const value of ['1000000000', 1_000_000_000.5, null, undefined, {}]) {
      const summary = { ...summaryFixture, chain_stats: { ...summaryFixture.chain_stats, funded_txo_sum: value } };
      expect(addressSummaryProblems(summary, ADDRESS))
        .toContainEqual(expect.stringContaining('funded_txo_sum'));
    }
  });

  it('refuses a summary with a section missing', () => {
    const summary: Record<string, unknown> = { ...summaryFixture };
    delete summary.mempool_stats;
    expect(addressSummaryProblems(summary, ADDRESS)).toContainEqual('mempool_stats is missing');
  });

  it('refuses an unbounded history page', () => {
    // A provider that answers with an address's entire confirmed history puts
    // it through a browser. A fixture holding three transactions can never
    // notice, which is exactly why the bound is asserted rather than assumed.
    const enormous = Array.from({ length: 101 }, () => historyFixture[0]);
    expect(addressHistoryProblems(enormous)).toContainEqual(expect.stringContaining('past the 100'));
  });

  it('refuses a confirmed transaction with no block height', () => {
    const history = [{ ...historyFixture[0], status: { confirmed: true } }];
    expect(addressHistoryProblems(history)).toContainEqual(expect.stringContaining('without a block height'));
  });

  it('refuses a transaction that does not say whether it is confirmed', () => {
    const history = [{ ...historyFixture[0], status: {} }];
    expect(addressHistoryProblems(history)).toContainEqual(expect.stringContaining('does not say whether it is confirmed'));
  });

  it('refuses a history entry with no inputs or outputs', () => {
    const history = [{ ...historyFixture[0], vout: undefined }];
    expect(addressHistoryProblems(history)).toContainEqual(expect.stringContaining('carries no inputs or outputs'));
  });

  it('refuses a UTXO list past the limit the index enforces', () => {
    const enormous = Array.from({ length: 501 }, () => utxoFixture[0]);
    expect(utxoListProblems(enormous)).toContainEqual(expect.stringContaining('past the configured limit'));
  });

  it('refuses a UTXO whose value is not a whole number', () => {
    expect(utxoListProblems([{ ...utxoFixture[0], value: '1000' }]))
      .toContainEqual(expect.stringContaining('rather than a whole number'));
  });

  it('refuses answers that are not the shape at all', () => {
    expect(addressSummaryProblems(null, ADDRESS)).toEqual(['the address summary is not an object']);
    expect(addressSummaryProblems([], ADDRESS)).toEqual(['the address summary is not an object']);
    expect(addressHistoryProblems({})).toEqual(['the address history is not a list']);
    expect(utxoListProblems('[]')).toEqual(['the UTXO answer is not a list']);
  });
});

/**
 * The same rules, against a real index.
 *
 * Skipped unless an endpoint is given, because CI has no Bitcoin index and a
 * test that quietly passes without one would be worse than no test. The
 * release preflight runs the equivalent checks against the live index before
 * every cutover; this is here so the same assertions can be pointed at a
 * candidate index by hand.
 */
const liveIndex = process.env.UNIVERSE_ESPLORA_CONTRACT_URL;
const describeLive = liveIndex ? describe : describe.skip;

describeLive('esplora address contract against a live index', () => {
  const base = (liveIndex || '').replace(/\/+$/, '');

  async function get(path: string): Promise<unknown> {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`${path} answered HTTP ${response.status}`);
    }
    return response.json();
  }

  it('answers an address summary the way the fixtures say it does', async () => {
    expect(addressSummaryProblems(await get(`/address/${ADDRESS}`), ADDRESS)).toEqual([]);
  }, 40_000);

  it('answers a bounded history page', async () => {
    expect(addressHistoryProblems(await get(`/address/${ADDRESS}/txs`))).toEqual([]);
  }, 40_000);

  it('answers a bounded UTXO list', async () => {
    expect(utxoListProblems(await get(`/address/${ADDRESS}/utxo`))).toEqual([]);
  }, 40_000);

  it('pages an address with more history than one page holds', async () => {
    // The cursor is the contract. A provider that ignores it looks like a
    // working page and serves the same transactions forever.
    const burn = '1BitcoinEaterAddressDontSendf59kuE';
    const first = (await get(`/address/${burn}/txs`)) as Array<{ txid: string }>;
    expect(addressHistoryProblems(first)).toEqual([]);
    expect(first.length).toBeGreaterThan(0);
    const second = (await get(`/address/${burn}/txs?after_txid=${first[first.length - 1].txid}`)) as Array<{ txid: string }>;
    const firstPage = new Set(first.map((transaction) => transaction.txid));
    expect(second.filter((transaction) => firstPage.has(transaction.txid))).toEqual([]);
  }, 60_000);
});
