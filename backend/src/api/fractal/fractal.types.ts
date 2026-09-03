/**
 * Types for the Fractal Bitcoin and CAT-20 assets engine.
 *
 * All supply, balance, and fee numbers use exact integer strings to avoid
 * floating point rounding.
 */

export interface FractalBlockSummary {
  readonly hash: string;
  readonly height: number;
  readonly time: number;
  readonly txCount: number;
  readonly size: number;
  readonly weight: number;
  readonly merkleRoot: string;
  readonly difficulty: number;
  readonly miner?: string;
}

export interface FractalTransactionView {
  readonly txid: string;
  readonly hash: string;
  readonly version: number;
  readonly size: number;
  readonly weight: number;
  readonly locktime: number;
  readonly vin: readonly FractalVin[];
  readonly vout: readonly FractalVout[];
  readonly blockHash?: string;
  readonly blockHeight?: number;
  readonly blockTime?: number;
  readonly feeAtomic: string;
  readonly cat20Operations?: readonly Cat20Operation[];
}

export interface FractalVin {
  readonly txid: string;
  readonly vout: number;
  readonly sequence: number;
  readonly scriptSig?: string;
  readonly witness?: readonly string[];
  readonly prevout?: FractalVout;
}

export interface FractalVout {
  readonly valueAtomic: string;
  readonly n: number;
  readonly scriptPubKey: {
    readonly asm: string;
    readonly hex: string;
    readonly type: string;
    readonly address?: string;
  };
}

export interface Cat20Token {
  readonly tokenId: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly maxSupplyAtomic: string;
  readonly circulatingSupplyAtomic: string;
  readonly mintLimitAtomic: string;
  readonly deployTxid: string;
  readonly deployHeight: number;
  readonly minterAddress: string;
  readonly minterType: 'open' | 'closed' | 'covenant';
  readonly holderCount: number;
  readonly transferCount: number;
  readonly state: 'active' | 'minting' | 'capped';
}

export interface Cat20Holder {
  readonly address: string;
  readonly balanceAtomic: string;
  readonly percentage: string;
}

export interface Cat20Operation {
  readonly type: 'deploy' | 'mint' | 'transfer' | 'burn';
  readonly tokenId: string;
  readonly amountAtomic: string;
  readonly fromAddress?: string;
  readonly toAddress?: string;
  readonly valid: boolean;
  readonly invalidReason?: string;
}

export interface FractalMempoolOverview {
  readonly count: number;
  readonly totalBytes: number;
  readonly totalWeight: number;
  readonly minFeeRate: number;
  readonly maxFeeRate: number;
  readonly medianFeeRate: number;
  readonly pendingCat20TxCount: number;
}
