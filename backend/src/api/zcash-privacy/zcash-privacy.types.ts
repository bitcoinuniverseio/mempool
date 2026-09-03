/**
 * Types for the Zcash Privacy Observatory.
 *
 * All amounts are exact zatoshis strings (1 ZEC = 100,000,000 zatoshis).
 */

export interface ZcashValuePool {
  readonly id: 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'lockbox';
  readonly name: string;
  readonly balanceZat: string;
  readonly balanceZec: string;
  readonly percentageOfSupply: string;
  readonly txCount: number;
  readonly description: string;
  readonly shielded: boolean;
  readonly deprecationStatus: 'active' | 'retiring' | 'deprecated';
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
  readonly name: string;
  readonly activationHeight: number;
  readonly branchId: string;
  readonly activatedAt: string;
  readonly features: readonly string[];
}

export interface ZcashPrivacySummary {
  readonly tipHeight: number;
  readonly totalCirculatingSupplyZat: string;
  readonly totalShieldedSupplyZat: string;
  readonly shieldedPercentage: string;
  readonly pools: readonly ZcashValuePool[];
  readonly recentFlows: readonly ZcashPoolFlow[];
  readonly upgrades: readonly ZcashNetworkUpgrade[];
}
