/**
 * Types for the Zcash Privacy Observatory.
 *
 * All amounts are exact zatoshis strings (1 ZEC = 100,000,000 zatoshis).
 */

export interface ZcashValuePool {
  readonly id: 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'lockbox' | 'ironwood';
  readonly name: string;
  readonly balanceZat: string;
  readonly balanceZec: string;
  readonly percentageOfSupply: string;
  readonly txCount: number | null;
  readonly monitored: boolean | null;
  readonly description: string;
  readonly shielded: boolean;
  readonly deprecationStatus: 'active' | 'retiring' | 'deprecated' | 'unknown';
}

export interface ZcashPoolFlow {
  readonly height: number;
  readonly blockHash: string;
  readonly timestamp: number;
  readonly pool: string;
  readonly inflowZat: string;
  readonly outflowZat: string;
  readonly netChangeZat: string;
  readonly transactionCount: number;
}

export interface ZcashNetworkUpgrade {
  readonly source?: string;
  readonly referenceStatus?: 'final' | 'draft-specification-settled-upgrade' | 'draft-upcoming';
  readonly network?: string;
  readonly observation?: false;
  readonly name: string;
  readonly activationHeight: number | null;
  readonly branchId: string;
  readonly activatedAt: string;
  readonly features: readonly string[];
}

export interface ZcashPrivacySummary {
  readonly schema: 'zcash-node-accounting-v1';
  readonly network: 'mainnet' | 'testnet';
  readonly source: { readonly implementation: 'zebra' | 'zcashd'; readonly genesis: string; readonly tipHash: string; readonly branchId: string; readonly nextBranchId: string; readonly observedAt: string };
  readonly tipHeight: number;
  readonly totalCirculatingSupplyZat: null;
  readonly nodeAccountedSupplyZat: string;
  readonly nodeAccountedSupplyZec: string;
  readonly historyStatus: 'unavailable';
  readonly totalShieldedSupplyZat: string;
  readonly shieldedPercentage: string;
  readonly pools: readonly ZcashValuePool[];
  readonly recentFlows: readonly ZcashPoolFlow[] | null;
  readonly upgrades: readonly ZcashNetworkUpgrade[];
}
