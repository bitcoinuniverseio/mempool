/**
 * Types for UTXO-Set, Supply, and Utreexo Observatory.
 */

export interface UtxoCheckpoint {
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly muhashHex: string;
  readonly totalTxOuts: number;
  readonly bogoSize: string;
  readonly totalAmountSats: string;
  readonly verifiedAtTimestamp: number;
}

export interface SupplyCohort {
  readonly label: string;
  readonly txOutCount: number;
  readonly totalAmountSats: string;
  readonly supplyPercentage: string;
}

export interface ScriptTypeDistribution {
  readonly scriptType: 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr' | 'other';
  readonly count: number;
  readonly totalAmountSats: string;
  readonly percentage: string;
}

export interface ProtocolBearingUtxos {
  readonly ordinalsBearingCount: number;
  readonly runesBearingCount: number;
  readonly stampsBearingCount: number;
  readonly multiProtocolCount: number;
  readonly pureBitcoinCount: number;
}

export interface UtreexoRootsView {
  readonly blockHeight: number;
  readonly numLeaves: number;
  readonly roots: readonly string[];
  readonly forestRows: number;
}
