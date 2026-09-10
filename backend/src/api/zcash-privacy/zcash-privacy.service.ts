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
export class ZcashPrivacyEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const zcashNodeUnavailable =
  'Zcash privacy observations are unavailable. Pool balances, shielded supply, the chain tip and recent pool flows require the owned Zcash node (zcashd getblockchaininfo valuePools, UNIVERSE_ZCASH_RPC_ORIGIN), which is not connected on this deployment.';

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
];

/**
 * Zcash privacy evidence.
 *
 * The summary and the pools used to answer from constants: a tip height, a
 * circulating supply and five pool balances that no node reported, and two
 * recent flows with invented block hashes. No owned Zcash node is connected,
 * so those reads report the source they would need. The network upgrade
 * catalogue is protocol reference and stays answerable.
 */
export class ZcashPrivacyService {
  /** @asyncSafe */
  public async $getSummary(): Promise<ZcashPrivacySummary> {
    throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', zcashNodeUnavailable);
  }

  /** @asyncSafe */
  public async $getPools(): Promise<ZcashValuePool[]> {
    throw new ZcashPrivacyEvidenceError('unavailable-zcash-node', zcashNodeUnavailable);
  }

  /** @asyncSafe */
  public async $getUpgrades(): Promise<ZcashNetworkUpgrade[]> {
    return NETWORK_UPGRADES;
  }
}

export const zcashPrivacyService = new ZcashPrivacyService();
