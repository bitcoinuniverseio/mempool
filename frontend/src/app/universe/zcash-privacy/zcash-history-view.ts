export interface ZcashPoolHistory {
  schema: 'zcash-pool-history-v1'; network: string; status: 'PARTIAL' | 'COMPLETE_WINDOW_AT_OBSERVED_TIP';
  source: { implementation: string; genesis: string; tipHash: string; branchId: string; nextBranchId: string; observedAt: string };
  tipHeight: number; windowSize: 144; pageSize: 16; nextHeight: number | null;
  verifiedThrough: { height: number; hash: string };
  coverage: { fromHeight: number; throughHeight: number; wholeChainHistory: false; grossFlows: 'unavailable'; poolTransactionCounts: 'unavailable' };
  blocks: { height: number; hash: string; parent: string; timestamp: number; supplyZat: string;
    pools: { id: string; balanceZat: string; netChangeZat: string; monitored: boolean }[] }[];
  reorgRecovered: boolean; priorSnapshotArchivedThisRequest: boolean; interruptedWriteRecovered: boolean;
}
const genesis: Record<string, string> = { mainnet: '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08', testnet: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38' };
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const height = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const atomic = (value: unknown, signed = false) => typeof value === 'string' && (signed ? /^-?(0|[1-9][0-9]{0,15})$/ : /^(0|[1-9][0-9]{0,15})$/).test(value) && value !== '-0';
const ids = ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'];

/** Reject inconsistent pages before replacing the independently observed history view. */
export function checkedZcashHistory(raw: unknown, network: string, prior?: ZcashPoolHistory): ZcashPoolHistory {
  const value = raw as ZcashPoolHistory;
  const invalid = () => { throw Error('Pool history evidence is malformed or changed. Start a fresh window; previously accepted evidence is retained.'); };
  if (!value || value.schema !== 'zcash-pool-history-v1' || value.network !== network || !genesis[network]
    || !['PARTIAL', 'COMPLETE_WINDOW_AT_OBSERVED_TIP'].includes(value.status) || !value.source
    || value.source.genesis !== genesis[network] || !['zebra', 'zcashd'].includes(value.source.implementation)
    || !hash(value.source.tipHash) || !/^[0-9a-f]{8}$/.test(value.source.branchId) || !/^[0-9a-f]{8}$/.test(value.source.nextBranchId)
    || typeof value.source.observedAt !== 'string' || value.source.observedAt.length > 64 || !Number.isFinite(Date.parse(value.source.observedAt)) || !height(value.tipHeight) || value.tipHeight < 1
    || value.windowSize !== 144 || value.pageSize !== 16 || !value.verifiedThrough || !height(value.verifiedThrough.height)
    || !hash(value.verifiedThrough.hash) || value.verifiedThrough.height > value.tipHeight || !value.coverage
    || value.coverage.wholeChainHistory !== false || value.coverage.grossFlows !== 'unavailable' || value.coverage.poolTransactionCounts !== 'unavailable'
    || !height(value.coverage.fromHeight) || value.coverage.fromHeight < 1 || value.coverage.throughHeight !== value.verifiedThrough.height
    || !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 144 || JSON.stringify(value).length > 524288
    || ['reorgRecovered', 'priorSnapshotArchivedThisRequest', 'interruptedWriteRecovered'].some(key => typeof value[key] !== 'boolean')) invalid();
  if (value.status === 'PARTIAL' ? value.nextHeight !== value.verifiedThrough.height + 1 || value.verifiedThrough.height >= value.tipHeight
    : value.nextHeight !== null || value.verifiedThrough.height !== value.tipHeight || value.verifiedThrough.hash !== value.source.tipHash) invalid();
  const last = value.blocks[value.blocks.length - 1];
  if (value.blocks[0].height !== value.coverage.fromHeight || last.height !== value.verifiedThrough.height || last.hash !== value.verifiedThrough.hash) invalid();
  for (let index = 0; index < value.blocks.length; index++) {
    const block = value.blocks[index], previous = value.blocks[index - 1];
    if (!block || !height(block.height) || !hash(block.hash) || !hash(block.parent) || !height(block.timestamp) || !atomic(block.supplyZat)
      || !Array.isArray(block.pools) || block.pools.length < 5 || block.pools.length > 6) invalid();
    const seen = new Set<string>(); let sum = 0n;
    for (const pool of block.pools) {
      if (!pool || !ids.includes(pool.id) || seen.has(pool.id) || !atomic(pool.balanceZat) || !atomic(pool.netChangeZat, true) || typeof pool.monitored !== 'boolean') invalid();
      seen.add(pool.id); sum += BigInt(pool.balanceZat);
      if (previous) { const before = previous.pools.find(row => row.id === pool.id); if (!before || BigInt(pool.balanceZat) - BigInt(before.balanceZat) !== BigInt(pool.netChangeZat)) invalid(); }
    }
    if (sum !== BigInt(block.supplyZat) || ids.slice(0, 5).some(id => !seen.has(id)) || value.source.implementation === 'zebra' && !seen.has('ironwood')
      || previous && (block.height !== previous.height + 1 || block.parent !== previous.hash || block.pools.length !== previous.pools.length)) invalid();
  }
  if (prior) {
    if (value.tipHeight !== prior.tipHeight || ['implementation', 'genesis', 'tipHash', 'branchId', 'nextBranchId'].some(key => value.source[key] !== prior.source[key])
      || value.reorgRecovered || value.priorSnapshotArchivedThisRequest || value.coverage.fromHeight !== prior.coverage.fromHeight
      || value.verifiedThrough.height <= prior.verifiedThrough.height || value.verifiedThrough.height - prior.verifiedThrough.height > 16) invalid();
    for (let index = 0; index < prior.blocks.length; index++) if (JSON.stringify(value.blocks[index]) !== JSON.stringify(prior.blocks[index])) invalid();
  }
  return value;
}

export function signedZec(value: string): string {
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100000000n}.${(absolute % 100000000n).toString().padStart(8, '0')}`;
}
