import { ZcashPublicReader, ZCASH_GENESIS, zcashSourceReady, zcashBranchAt } from './zcash-owned-reader';
import { ZcashPrivacyEvidenceError } from './zcash-source-error';
import { ZcashPrivacySummary, ZcashValuePool } from './zcash-privacy.types';

const POOLS = ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'] as const;
let active = 0;
const invalid = () => new ZcashPrivacyEvidenceError('invalid-pool-evidence', 'The owned node returned incomplete or inconsistent exact pool accounting.');
function atomic(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(value)) return BigInt(value);
  throw invalid();
}
export function zec(value: bigint): string {
  return `${value / 100000000n}.${(value % 100000000n).toString().padStart(8, '0')}`;
}
function percentage(value: bigint, total: bigint): string {
  const hundredths = total === 0n ? 0n : value * 10000n / total;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

/** One bounded, uncached observation. Missing pool history is never an empty ledger. */
export async function observeZcashPools(reader: ZcashPublicReader, network: string): Promise<Omit<ZcashPrivacySummary, 'upgrades'>> {
  if (!['mainnet', 'testnet'].includes(network)) throw new ZcashPrivacyEvidenceError('invalid-network', 'Choose mainnet or testnet.', 400);
  if (active >= 2) throw new ZcashPrivacyEvidenceError('pool-source-busy', 'The bounded pool source is busy.');
  active++;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {controller.abort(); reject(new ZcashPrivacyEvidenceError('source-timeout', 'Pool observation exceeded its 15-second budget.'));}, 15000); });
  try {
    return await Promise.race([timeout, (async () => {
      const read = async (method: string, params: unknown[]) => {
        if (controller.signal.aborted) throw new ZcashPrivacyEvidenceError('source-timeout', 'Pool observation was cancelled.');
        const value = await reader.call(method, params, controller.signal);
        if (controller.signal.aborted) throw new ZcashPrivacyEvidenceError('source-timeout', 'Pool observation was cancelled.');
        return value;
      };
      const before = await read('getblockchaininfo', []);
      if (before?.chain !== (network === 'mainnet' ? 'main' : 'test') || !Number.isSafeInteger(before.blocks) || before.blocks < 0 || !/^[0-9a-f]{64}$/.test(before.bestblockhash)
        || !await zcashSourceReady(reader, before, controller.signal)) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'The selected Zcash source is not ready at a valid network checkpoint.');
      const genesis = await read('getblockhash', [0]);
      if (genesis !== ZCASH_GENESIS[network]) throw new ZcashPrivacyEvidenceError('unavailable-checkpoint', 'The owned source genesis differs from the selected network.');
      const branchId = before.consensus?.chaintip, nextBranchId = before.consensus?.nextblock;
      if (!/^[0-9a-f]{8}$/.test(branchId) || !/^[0-9a-f]{8}$/.test(nextBranchId)) throw invalid();
      if (branchId !== zcashBranchAt(network, before.blocks) || nextBranchId !== zcashBranchAt(network, before.blocks + 1)) throw new ZcashPrivacyEvidenceError('unavailable-branch', 'The observed branch differs from the pinned network upgrade schedule.');
      if (!Array.isArray(before.valuePools) || before.valuePools.length < 5 || before.valuePools.length > 6) throw invalid();
      const ids = new Set<string>();
      const values: Array<{id: ZcashValuePool['id']; amount: bigint; monitored: boolean | null}> = before.valuePools.map((pool: any) => {
        if (!pool || !POOLS.includes(pool.id) || ids.has(pool.id) || pool.monitored !== undefined && typeof pool.monitored !== 'boolean') throw invalid();
        ids.add(pool.id);
        return {id: pool.id, amount: atomic(pool.chainValueZat), monitored: pool.monitored ?? null};
      });
      if (POOLS.slice(0, 5).some(id => !ids.has(id)) || reader.implementation === 'zebra' && !ids.has('ironwood')) throw invalid();
      const total = atomic(before.chainSupply?.chainValueZat);
      if (values.reduce((sum, pool) => sum + pool.amount, 0n) !== total) throw invalid();
      const shielded = values.filter(pool => ['sprout', 'sapling', 'orchard', 'ironwood'].includes(pool.id)).reduce((sum, pool) => sum + pool.amount, 0n);
      const pools: ZcashValuePool[] = values.map(pool => ({id: pool.id, name: pool.id[0].toUpperCase() + pool.id.slice(1), balanceZat: pool.amount.toString(), balanceZec: zec(pool.amount), percentageOfSupply: percentage(pool.amount, total), txCount: null, monitored: pool.monitored, description: 'Exact node-accounted pool amount at the observed checkpoint.', shielded: ['sprout', 'sapling', 'orchard', 'ironwood'].includes(pool.id), deprecationStatus: 'unknown'}));
      const tip = await read('getblockhash', [before.blocks]);
      const after = await read('getblockchaininfo', []);
      if (tip !== before.bestblockhash || after?.chain !== before.chain || after.blocks !== before.blocks || after.bestblockhash !== before.bestblockhash || after.consensus?.chaintip !== branchId || after.consensus?.nextblock !== nextBranchId
        || !await zcashSourceReady(reader, after, controller.signal) || JSON.stringify(after.chainSupply) !== JSON.stringify(before.chainSupply) || JSON.stringify(after.valuePools) !== JSON.stringify(before.valuePools)) throw new ZcashPrivacyEvidenceError('source-changed', 'The Zcash checkpoint or pool accounting changed during observation. Retry.', 409);
      return {schema: 'zcash-node-accounting-v1' as const, network: network as 'mainnet' | 'testnet', source: {implementation: reader.implementation || 'zcashd', genesis, tipHash: tip, branchId, nextBranchId, observedAt: new Date().toISOString()}, tipHeight: before.blocks, totalCirculatingSupplyZat: null, nodeAccountedSupplyZat: total.toString(), nodeAccountedSupplyZec: zec(total), totalShieldedSupplyZat: shielded.toString(), shieldedPercentage: percentage(shielded, total), pools, recentFlows: null, historyStatus: 'unavailable' as const};
    })()]);
  } finally { clearTimeout(timer!); controller.abort(); active--; }
}
