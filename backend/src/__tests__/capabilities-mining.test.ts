import { CORE_READING_MAX_AGE_SECONDS, miningIndexVerdict, type MiningIndexFacts } from '../api/capabilities.mining';

/**
 * The incident behind these: on 2026-09-23 /api/v1/capabilities called mining
 * ready with the index at block 968172 and Core at 968299, because readiness
 * was "the tables have rows". Every case below is a way that rule was wrong.
 */

const NOW = Date.parse('2026-09-23T18:00:00.000Z');

function facts(overrides: Partial<MiningIndexFacts> = {}): MiningIndexFacts {
  return {
    blockRows: 11_000,
    highestHeight: 968_299,
    poolRows: 180,
    core: { blocks: 968_299, chain: 'main', initialBlockDownload: false, checkedAt: new Date(NOW - 10_000).toISOString() },
    network: 'mainnet',
    maxBehindTip: 3,
    now: NOW,
    ...overrides,
  };
}

describe('mining index readiness', () => {
  it('is ready when the indexed tip matches a fresh same-network Core reading', () => {
    expect(miningIndexVerdict(facts())).toEqual({
      state: 'ready', degradedReason: null, indexedTip: 968_299, bitcoinCoreTip: 968_299, lagBlocks: 0, maxLagBlocks: 3,
    });
  });

  it('refuses the production state that was published as ready', () => {
    const verdict = miningIndexVerdict(facts({ highestHeight: 968_172 }));
    expect(verdict.state).toBe('degraded');
    expect(verdict.lagBlocks).toBe(127);
    expect(verdict.degradedReason).toBe('The mining index is 127 blocks behind Bitcoin Core, more than the 3 allowed.');
  });

  it('holds the lag bound exactly at its boundary', () => {
    expect(miningIndexVerdict(facts({ highestHeight: 968_296 })).state).toBe('ready');
    expect(miningIndexVerdict(facts({ highestHeight: 968_295 })).state).toBe('degraded');
    expect(miningIndexVerdict(facts({ highestHeight: 968_299, maxBehindTip: 0 })).state).toBe('ready');
    expect(miningIndexVerdict(facts({ highestHeight: 968_298, maxBehindTip: 0 })).state).toBe('degraded');
  });

  it('never lets historical rows alone prove readiness', () => {
    expect(miningIndexVerdict(facts({ core: null })).state).toBe('unknown');
  });

  it('reports an empty index and missing pool metadata as degraded before judging currency', () => {
    expect(miningIndexVerdict(facts({ blockRows: 0, highestHeight: null }))).toMatchObject({
      state: 'degraded', indexedTip: null, lagBlocks: null,
      degradedReason: 'Block indexing is running but no block has been indexed yet.',
    });
    expect(miningIndexVerdict(facts({ poolRows: 0 }))).toMatchObject({
      state: 'degraded', degradedReason: 'Mining pool metadata has not been imported yet.',
    });
  });

  it('keeps unknown separate when the Core reading has expired, and publishes no stale lag', () => {
    const expired = new Date(NOW - (CORE_READING_MAX_AGE_SECONDS + 1) * 1000).toISOString();
    const verdict = miningIndexVerdict(facts({ core: { blocks: 968_299, chain: 'main', initialBlockDownload: false, checkedAt: expired } }));
    expect(verdict).toMatchObject({ state: 'unknown', bitcoinCoreTip: null, lagBlocks: null });
    const edge = new Date(NOW - CORE_READING_MAX_AGE_SECONDS * 1000).toISOString();
    expect(miningIndexVerdict(facts({ core: { blocks: 968_299, chain: 'main', initialBlockDownload: false, checkedAt: edge } })).state).toBe('ready');
    expect(miningIndexVerdict(facts({ core: { blocks: 968_299, chain: 'main', initialBlockDownload: false, checkedAt: 'not a time' } })).state).toBe('unknown');
  });

  it('refuses a Core reading from another network or one that does not say', () => {
    for (const chain of ['test', 'signet', null]) {
      const verdict = miningIndexVerdict(facts({ core: { blocks: 968_299, chain, initialBlockDownload: false, checkedAt: new Date(NOW).toISOString() } }));
      expect(verdict.state).toBe('unknown');
      expect(verdict.degradedReason).toContain('network');
    }
  });

  it('matches each served network to Core\'s own chain name', () => {
    for (const [network, chain] of [['signet', 'signet'], ['testnet', 'test'], ['testnet4', 'testnet4'], ['regtest', 'regtest']]) {
      const verdict = miningIndexVerdict(facts({ network, core: { blocks: 968_299, chain, initialBlockDownload: false, checkedAt: new Date(NOW).toISOString() } }));
      expect(verdict.state).toBe('ready');
    }
    expect(miningIndexVerdict(facts({ network: 'unlisted' })).state).toBe('unknown');
  });

  it('calls a node still in initial block download syncing, not ready', () => {
    const verdict = miningIndexVerdict(facts({ core: { blocks: 968_299, chain: 'main', initialBlockDownload: true, checkedAt: new Date(NOW).toISOString() } }));
    expect(verdict.state).toBe('syncing');
  });

  it('withholds readiness while the index is ahead of Core after a reorganization', () => {
    const verdict = miningIndexVerdict(facts({ highestHeight: 968_301 }));
    expect(verdict).toMatchObject({ state: 'unknown', lagBlocks: -2 });
  });

  it('recovers to ready once the index catches up again', () => {
    expect(miningIndexVerdict(facts({ highestHeight: 968_100 })).state).toBe('degraded');
    expect(miningIndexVerdict(facts({ highestHeight: 968_298 })).state).toBe('ready');
  });
});
