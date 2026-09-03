/**
 * Types for BitVM and Bitcoin L2 Bridge-Proof Observatory.
 */

export interface L2BridgeSystem {
  readonly id: string;
  readonly name: string;
  readonly architecture: 'bitvm2' | 'clementine-bitvm' | 'zk-rollup-bridge' | 'sidechain-peg';
  readonly trustModel: '1-of-n' | 'multisig-federated' | 'committee-attested';
  readonly bridgeContractAddress: string;
  readonly lockedBtcSats: string;
  readonly operatorCount: number;
  readonly challengePeriodBlocks: number;
  readonly activeChallengesCount: number;
  readonly status: 'live' | 'testing' | 'halted';
  readonly description: string;
}

export interface L2Challenge {
  readonly challengeId: string;
  readonly systemId: string;
  readonly assertionTxid: string;
  readonly challengeTxid: string;
  readonly assertBlockHeight: number;
  readonly challengerAddress: string;
  readonly bondAmountSats: string;
  readonly status: 'pending_response' | 'disproved' | 'confirmed_honest' | 'slashed';
  readonly timeoutBlockHeight: number;
}

export interface L2ReserveAudit {
  readonly systemId: string;
  readonly totalLockedReserveSats: string;
  readonly reportedL2SupplySats: string;
  readonly reserveRatio: string;
  readonly lastAuditHeight: number;
  readonly reserveOutpoints: readonly { readonly outpoint: string; readonly valueSats: string }[];
}
