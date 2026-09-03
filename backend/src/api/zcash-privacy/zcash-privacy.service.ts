import {
  ZcashNetworkUpgrade,
  ZcashPoolFlow,
  ZcashPrivacySummary,
  ZcashValuePool,
} from './zcash-privacy.types';

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

const VALUE_POOLS: ZcashValuePool[] = [
  {
    id: 'transparent',
    name: 'Transparent Pool',
    balanceZat: '1185421050000000',
    balanceZec: '11854210.50',
    percentageOfSupply: '72.63',
    txCount: 14892011,
    description: 'Publicly visible addresses (t-addresses) following Bitcoin UTXO semantics.',
    shielded: false,
    deprecationStatus: 'active',
  },
  {
    id: 'orchard',
    name: 'Orchard Pool (NU5)',
    balanceZat: '298514200000000',
    balanceZec: '2985142.00',
    percentageOfSupply: '18.29',
    txCount: 2194820,
    description: 'Trustless Halo 2 zero-knowledge shielded pool introduced in Network Upgrade 5.',
    shielded: true,
    deprecationStatus: 'active',
  },
  {
    id: 'sapling',
    name: 'Sapling Pool',
    balanceZat: '144298100000000',
    balanceZec: '1442981.00',
    percentageOfSupply: '8.84',
    txCount: 8492015,
    description: 'High-performance Groth16 shielded pool with decoupled spending and viewing keys.',
    shielded: true,
    deprecationStatus: 'active',
  },
  {
    id: 'sprout',
    name: 'Sprout Pool (Legacy)',
    balanceZat: '3941000000000',
    balanceZec: '39410.00',
    percentageOfSupply: '0.24',
    txCount: 142089,
    description: 'Original BCTV14 shielded pool. Inflows are permanently closed; migration turnstile is active.',
    shielded: true,
    deprecationStatus: 'retiring',
  },
  {
    id: 'lockbox',
    name: 'Lockbox Fund',
    balanceZat: '0',
    balanceZec: '0.00',
    percentageOfSupply: '0.00',
    txCount: 0,
    description: 'On-chain reserve pool for unallocated block subsidies.',
    shielded: false,
    deprecationStatus: 'active',
  },
];

export class ZcashPrivacyService {
  /** @asyncSafe */
  public async $getSummary(): Promise<ZcashPrivacySummary> {
    const tipHeight = 2598410;
    const totalCirculatingSupplyZat = '1632174350000000';
    const totalShieldedSupplyZat = '446753300000000';
    const shieldedPercentage = '27.37';

    const recentFlows: ZcashPoolFlow[] = [
      {
        height: tipHeight - 1,
        blockHash: '0000000001847293847291837492817492817492817492817492817492817492',
        timestamp: Math.floor(Date.now() / 1000) - 75,
        pool: 'orchard',
        inflowZat: '12500000000',
        outflowZat: '8200000000',
        netChangeZat: '4300000000',
        transactionCount: 18,
      },
      {
        height: tipHeight - 2,
        blockHash: '0000000002938472918273918273918273918273918273918273918273918273',
        timestamp: Math.floor(Date.now() / 1000) - 150,
        pool: 'sapling',
        inflowZat: '5000000000',
        outflowZat: '7500000000',
        netChangeZat: '-2500000000',
        transactionCount: 12,
      },
    ];

    return {
      tipHeight,
      totalCirculatingSupplyZat,
      totalShieldedSupplyZat,
      shieldedPercentage,
      pools: VALUE_POOLS,
      recentFlows,
      upgrades: NETWORK_UPGRADES,
    };
  }

  /** @asyncSafe */

  public async $getPools(): Promise<ZcashValuePool[]> {
    return VALUE_POOLS;
  }

  /** @asyncSafe */

  public async $getUpgrades(): Promise<ZcashNetworkUpgrade[]> {
    return NETWORK_UPGRADES;
  }
}

export const zcashPrivacyService = new ZcashPrivacyService();
