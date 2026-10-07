/**
 * Whether the mining index is current, judged the only way that means
 * anything: its highest indexed block against a fresh Bitcoin Core reading
 * of the same network.
 *
 * The earlier rule called mining ready whenever the blocks and pools tables
 * had rows. On 2026-09-23 that published "ready" while the index stood at
 * block 968172 and Core at 968299: historical rows proved the index had once
 * run, not that it was still running. Time since the newest block was mined
 * is not a substitute either, because block intervals vary by hours on their
 * own and say nothing about the collector.
 *
 * Kept free of I/O so every branch is tested directly; capabilities.ts reads
 * the tables and the node and hands the facts in.
 */

/**
 * A Core reading older than this cannot vouch for the index. backend-info
 * refreshes it every 30 seconds, so four missed refreshes means the node or
 * the poller has stopped answering, and "current" can no longer be claimed.
 */
export const CORE_READING_MAX_AGE_SECONDS = 120;

export type MiningIndexState = 'ready' | 'syncing' | 'degraded' | 'unknown';

export interface CoreReading {
  readonly blocks: number;
  /** Core's own chain name (`main`, `test`, `testnet4`, `signet`, `regtest`), when reported. */
  readonly chain: string | null;
  readonly initialBlockDownload: boolean;
  readonly checkedAt: string;
}

export interface MiningIndexFacts {
  readonly blockRows: number;
  readonly highestHeight: number | null;
  readonly poolRows: number;
  readonly core: CoreReading | null;
  /** The network this backend serves, as configured (`MEMPOOL.NETWORK`). */
  readonly network: string;
  readonly maxBehindTip: number;
  readonly now: number;
}

export interface MiningIndexVerdict {
  readonly state: MiningIndexState;
  readonly degradedReason: string | null;
  readonly indexedTip: number | null;
  readonly bitcoinCoreTip: number | null;
  readonly lagBlocks: number | null;
  readonly maxLagBlocks: number;
}

/** Core's name for each network this backend can be configured to serve. */
const CORE_CHAIN: Readonly<Record<string, string>> = {
  mainnet: 'main',
  '': 'main',
  testnet: 'test',
  testnet4: 'testnet4',
  signet: 'signet',
  regtest: 'regtest',
  liquid: 'liquidv1',
  liquidtestnet: 'liquidtestnet',
};

export function miningIndexVerdict(facts: MiningIndexFacts): MiningIndexVerdict {
  const indexedTip = facts.blockRows > 0 && Number.isSafeInteger(facts.highestHeight) ? facts.highestHeight : null;
  const core = facts.core;
  const coreTip = core && Number.isSafeInteger(core.blocks) && core.blocks >= 0 ? core.blocks : null;
  const verdict = (state: MiningIndexState, degradedReason: string | null, reference: number | null = coreTip): MiningIndexVerdict => ({
    state,
    degradedReason,
    indexedTip,
    bitcoinCoreTip: reference,
    lagBlocks: indexedTip !== null && reference !== null ? reference - indexedTip : null,
    maxLagBlocks: facts.maxBehindTip,
  });

  if (facts.blockRows === 0 || indexedTip === null) {
    return verdict('degraded', 'Block indexing is running but no block has been indexed yet.');
  }
  if (facts.poolRows === 0) {
    return verdict('degraded', 'Mining pool metadata has not been imported yet.');
  }
  // From here the index has data. Whether it is current needs a reference,
  // and a missing, stale or foreign reference is an unknown, not a verdict.
  if (!core || coreTip === null) {
    return verdict('unknown', 'Bitcoin Core has not reported its height, so the index cannot be compared with it.', null);
  }
  const checkedAt = Date.parse(core.checkedAt);
  if (!Number.isFinite(checkedAt) || (facts.now - checkedAt) / 1000 > CORE_READING_MAX_AGE_SECONDS) {
    return verdict('unknown', 'The last Bitcoin Core reading is too old to judge the index against.', null);
  }
  const expectedChain = CORE_CHAIN[facts.network];
  if (!expectedChain || core.chain !== expectedChain) {
    return verdict('unknown', 'Bitcoin Core did not confirm it is on the network this backend serves.', null);
  }
  if (core.initialBlockDownload) {
    return verdict('syncing', 'Bitcoin Core is still in initial block download, so no index built on it is current yet.');
  }
  const lag = coreTip - indexedTip;
  if (lag < 0) {
    // Core reads lower than the index after a reorganization to a shorter
    // chain or while Core itself restarts. Neither side can be trusted to be
    // right until they agree again.
    return verdict('unknown', 'The mining index is ahead of Bitcoin Core, as happens during a reorganization or a node restart; readiness waits until they agree.');
  }
  if (lag > facts.maxBehindTip) {
    return verdict('degraded', `The mining index is ${lag} blocks behind Bitcoin Core, more than the ${facts.maxBehindTip} allowed.`);
  }
  return verdict('ready', null);
}
