import {
  ZcashNetworkUpgrade,
  ZcashPrivacySummary,
  ZcashValuePool,
} from './zcash-privacy.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export { ZcashPrivacyEvidenceError } from './zcash-source-error';
import { ZcashPrivacyEvidenceError } from './zcash-source-error';
import { ownedZcashReader, ZcashPublicReader } from './zcash-owned-reader';
import { observeZcashPools } from './zcash-pool-observation';
import { ZcashPoolHistory, ZcashPoolLedger } from './zcash-pool-ledger';

/** Activation facts from the Zcash protocol specification; a reference, not an observation. */
const NETWORK_UPGRADES: ZcashNetworkUpgrade[] = [
  {
    name: 'Overwinter',
    activationHeight: 347500,
    branchId: '0x5ba81b19',
    activatedAt: '2018-06-26',
    features: ['Transaction version 3', 'Replay protection', 'Configurable expiry'],
  },
  {
    name: 'Sapling',
    activationHeight: 419200,
    branchId: '0x76b809bb',
    activatedAt: '2018-10-28',
    features: ['Groth16 zk-SNARKs', 'Decoupled spend/output keys', 'Hardware wallet support'],
  },
  {
    name: 'Blossom',
    activationHeight: 653600,
    branchId: '0x2bb40e60',
    activatedAt: '2019-12-11',
    features: ['75-second target block time', 'Doubled throughput'],
  },
  {
    name: 'Heartwood',
    activationHeight: 903000,
    branchId: '0xf5b9230b',
    activatedAt: '2020-07-16',
    features: ['Shielded coinbase outputs to Sapling', 'FlyClient block headers'],
  },
  {
    name: 'Canopy',
    activationHeight: 1046400,
    branchId: '0xe9ff75a6',
    activatedAt: '2020-11-18',
    features: ['First halving', 'Development fund establishment', 'Sprout deprecation start'],
  },
  {
    name: 'NU5',
    activationHeight: 1687104,
    branchId: '0xc2d6d0b4',
    activatedAt: '2022-05-31',
    features: ['Halo 2 trustless zk-SNARKs', 'Orchard shielded pool', 'Unified Addresses'],
  },
  {
    name: 'NU6', activationHeight: 2726400, branchId: '0xc8e71055', activatedAt: '',
    features: ['ZIP 253 consensus upgrade'], source: 'https://zips.z.cash/zip-0253', referenceStatus: 'final',
  },
  {
    name: 'NU6.1', activationHeight: 3146400, branchId: '0x4dec4df0', activatedAt: '',
    features: ['ZIP 255 consensus upgrade'], source: 'https://zips.z.cash/zip-0255', referenceStatus: 'final',
  },
  {
    name: 'NU6.2', activationHeight: 3364600, branchId: '0x5437f330', activatedAt: '',
    features: ['Corrected Orchard proof circuit and proof length rules'], source: 'https://zips.z.cash/zip-0257', referenceStatus: 'final',
  },
  {
    name: 'NU6.3', activationHeight: 3428143, branchId: '0x37a5165b', activatedAt: '',
    features: ['Ironwood shielded pool', 'Orchard inbound transfer restrictions'],
    source: 'https://zips.z.cash/zip-0258', referenceStatus: 'draft-specification-settled-upgrade',
  },
  {
    name: 'NU7', activationHeight: null, branchId: '0x77190ad9', activatedAt: '',
    features: ['25-second target spacing', 'Network Sustainability Mechanism', 'Version 4 transaction removal'],
    source: 'https://zips.z.cash/zip-0259', referenceStatus: 'draft-upcoming',
  },
];

/**
 * Zcash privacy evidence.
 *
 * Observations require the operator-owned node, explicit readiness and a
 * stable, network-specific checkpoint. Exact amounts are node accounting;
 * historical flows and transaction counts remain unavailable until a durable
 * reversible ledger exists. Upgrade entries are independent references.
 */
export class ZcashPrivacyService {
  private ledger: ZcashPoolLedger | undefined;
  constructor(private readonly reader: ZcashPublicReader = ownedZcashReader) {}
  /** @asyncUnsafe Propagates bounded actual source and durable history failures. */
  public async $getHistory(network = 'mainnet'): Promise<ZcashPoolHistory> {
    if (!this.ledger) this.ledger = new ZcashPoolLedger(this.reader, process.env.UNIVERSE_ZCASH_POOL_LEDGER_FILE);
    return this.ledger.advance(network);
  }
  /* IMPLEMENTATION-HANDOFF [WP-BE-014]
   * Defect BE-014; COV-BE-014 privacy summary, value pools, upgrade reference.
   * Summary/pools always throw, although zcash-block-source supplies a
   * separate block tool. The public upgrade catalogue ends at NU5 despite
   * final NU6/NU6.1/NU6.2 specifications (R-BE-ZIP253/255/257). Current-source
   * reproduction records both missing operations and the returned names.
   * 1. Pin the operated Zcash node implementation/release, network/genesis,
   *    active branch and RPC schema. Extend zcash-block-source's owned reader
   *    for supported getblockchaininfo/value-pool facts; do not route these
   *    summaries to an unrelated public explorer or fabricate pool balances.
   * 2. Define exact zatoshi totals and supply accounting for the selected
   *    source. Bind every pool and derived flow to a consistent block
   *    checkpoint and retain reversible history across restart/reorg.
   * 3. Regenerate upgrade reference from pinned final specifications and
   *    implementation constants for each supported network. Include all
   *    applicable upgrades beyond NU5, verify heights/branch IDs and label
   *    reference facts separately from observed activation. Recheck newer
   *    releases before implementation; do not infer deployment from this list.
   * 4. Map service/types/routes and zcash-privacy consumers. Regress the
   *    existing raw-block/scanner path and verify summary/pools/upgrades on
   *    genuine Zcash testnet, upgrade boundaries, wrong branch/network,
   *    malformed/absent pool data, source outage, restart and reorg.
   * Acceptance: both observed views and the complete network-specific
   *    reference are correct, with exact totals and explicit unavailable data.
   * Rollback: preserve node/index checkpoints and restore matched schemas/
   *    adapters; never downgrade node consensus support to match old UI data.
   * Preparation only; current returned data and unavailable states remain.
   */
  /** @asyncUnsafe Propagates typed evidence failures to the mounted route handler. */
  public async $getSummary(network = 'mainnet'): Promise<ZcashPrivacySummary> {
    const observation = await observeZcashPools(this.reader, network);
    return {...observation, upgrades: await this.$getUpgrades(network)};
  }

  /** @asyncUnsafe Propagates typed evidence failures to the mounted route handler. */
  public async $getPools(network = 'mainnet'): Promise<ZcashValuePool[]> {
    return (await observeZcashPools(this.reader, network)).pools.slice();
  }

  /** @asyncSafe */
  public async $getUpgrades(network = 'mainnet'): Promise<ZcashNetworkUpgrade[]> {
    if (!['mainnet', 'testnet'].includes(network)) throw new ZcashPrivacyEvidenceError('invalid-network', 'Choose mainnet or testnet.', 400);
    // Zebra 6d1e414d6f55e4180d0e47baaa934bf97d5b4fec constants; NU7 mainnet remains unassigned in ZIP259.
    const heights = [207500, 280000, 584000, 903800, 1028500, 1842420, 2976000, 3536500, 4052000, 4134000, 4465026];
    return NETWORK_UPGRADES.map((upgrade, index) => ({...upgrade, network, observation: false,
      activationHeight: network === 'testnet' ? heights[index] : upgrade.activationHeight,
      activatedAt: network === 'testnet' ? '' : upgrade.activatedAt}));
  }
}

export const zcashPrivacyService = new ZcashPrivacyService();
