/**
 * Types for the Fractal Bitcoin and CAT-20 assets engine.
 *
 * All supply, balance, and fee numbers use exact integer strings to avoid
 * floating point rounding.
 */
export interface FractalTip {
  readonly schema: 'fractal-tip-v1';
  readonly observation: import('./fractal.native').FractalObservation;
  readonly height: number; readonly hash: string; readonly time: number; readonly network: 'fractal-testnet';
}

export interface FractalBlockSummary {
  readonly schema: 'fractal-block-v1';
  readonly observation: import('./fractal.native').FractalObservation;
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
  readonly schema: 'fractal-transaction-v1';
  readonly observation: import('./fractal.native').FractalObservation;
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
  readonly feeAtomic: string | null;
  readonly feeState: 'unknown-prevouts';
  readonly cat20State: 'not-joined';
  readonly cat20Operations?: readonly Cat20Operation[];
}

export interface FractalVin {
  readonly txid?: string;
  readonly vout?: number;
  readonly coinbase?: string;
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
  readonly schema: 'cat20-token-v1';
  readonly tokenId: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly maxSupplyAtomic: string | null;
  readonly circulatingSupplyAtomic: string;
  readonly mintLimitAtomic: string | null;
  readonly deployTxid: string;
  readonly deployHeight: number;
  readonly minterAddress: string | null;
  readonly minterPubKey: string;
  readonly minterType: 'open' | 'closed' | 'covenant' | null;
  readonly holderCount: number;
  readonly transferCount: number | null;
  readonly state: 'active' | 'minting' | 'capped' | null;
  readonly unavailable: readonly string[];
}

export interface Cat20Holder {
  readonly address: string | null;
  readonly ownerPubKeyHash: string;
  readonly balanceAtomic: string;
  readonly percentage: string | null;
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
  readonly schema: 'fractal-mempool-v1';
  readonly observation: import('./fractal.native').FractalObservation;
  readonly count: number;
  readonly totalBytes: number;
  readonly totalWeight: number | null;
  readonly minFeeRate: number | null;
  readonly maxFeeRate: number | null;
  readonly medianFeeRate: number | null;
  readonly pendingCat20TxCount: number | null;
  readonly unavailable: readonly string[];
}

export interface Cat20Page<T> {
  readonly schema: 'cat20-page-v1';
  readonly observation: import('./fractal.native').FractalObservation;
  readonly trackerSourceRevision: string;
  readonly checkpoint: import('./fractal.native').FractalCheckpoint;
  readonly items: readonly T[];
  readonly total: number;
  readonly nextCursor: string | null;
}
export interface Cat20PageRequest { limit?: number; cursor?: string; }
