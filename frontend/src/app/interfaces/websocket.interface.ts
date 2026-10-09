import { SafeResourceUrl } from '@angular/platform-browser';
import { ILoadingIndicators } from '@app/services/state.service';
import { Transaction } from '@interfaces/electrs.interface';
import { Acceleration, BlockExtended, DifficultyAdjustment, RbfTree, TransactionStripped } from '@interfaces/node-api.interface';

export interface WebsocketResponse {
  backend?: 'esplora' | 'electrum' | 'none';
  block?: BlockExtended;
  blocks?: BlockExtended[];
  conversions?: Record<string, number>;
  txConfirmed?: string;
  historicalDate?: string;
  mempoolInfo?: MempoolInfo;
  vBytesPerSecond?: number;
  previousRetarget?: number;
  action?: string;
  data?: string[];
  tx?: Transaction;
  rbfTransaction?: ReplacedTransaction;
  txReplaced?: ReplacedTransaction;
  rbfInfo?: RbfTree;
  rbfLatest?: RbfTree[];
  rbfLatestSummary?: ReplacementInfo[];
  stratumJob?: StratumJob;
  stratumJobs?: Record<number, StratumJob>;
  utxoSpent?: object;
  transactions?: TransactionStripped[];
  loadingIndicators?: ILoadingIndicators;
  backendInfo?: IBackendInfo;
  da?: DifficultyAdjustment;
  /**
   * IMPLEMENTATION-HANDOFF [API-05] API-05-FEES-CONTRACT | F-FE-001 | FAIL.
   * Observed 2026-10-09: fees/recommended returned 503 while init-data supplied
   * unqualified cached fees. Source: bitcoin.routes.ts#getRecommendedFees,
   * websocket-handler.ts#updateSocketData; evidence public-http.json and
   * frontend-source-reproductions.json in the server preparation directory.
   * 1. Add FeeEstimateSnapshot and optional WebsocketResponse.feeEstimate:
   *    schemaVersion 'universe-fee-estimate-v1', chain 'bitcoin', network,
   *    status 'ready'|'syncing'|'stale'|'unavailable', observedAt ISO|null,
   *    tip {height,hash}|null, values Recommendedfees|null, reason string|null.
   *    Validate the envelope at runtime; this interface alone proves no input.
   * 2. Keep Recommendedfees numeric sat/vB fields unchanged. Only authoritative
   *    ready snapshots may populate legacy fees. Missing, malformed, expired or
   *    wrong-network metadata must not make cached values current.
   * 3. Coordinate this additive contract with backend websocket-handler.ts,
   *    StateService.feeEstimate$ (PROPOSED NEW), WebsocketService.handleResponse,
   *    FeesBoxComponent and ClockComponent in API-05 after API-01 through API-04.
   * 4. Add PROPOSED NEW services/fee-estimate.spec.ts and component fee tests.
   *    Assert REST/init/socket parity, absent proof, stale values, reconnect,
   *    network switch and fresh recovery; run npm test -- <new test paths>
   *    from frontend, then npm run lint and npm run build:universe.
   *    Test commands using proposed files remain unverified until implemented.
   * Acceptance: real Signet fee reads and rendered data have matching producer
   *    observation/tip; controlled sync/outage faults never show current fees.
   * Rollback producer and consumer together; do not accept bare legacy values.
   * Preparation only: no executable behavior changed here.
   */
  fees?: Recommendedfees;
  'track-tx'?: string;
  'track-address'?: string;
  'track-addresses'?: string[];
  'track-scriptpubkeys'?: string[];
  'track-asset'?: string;
  'track-mempool-block'?: number;
  'track-rbf'?: string;
  'track-rbf-summary'?: boolean;
  'track-accelerations'?: boolean;
  'track-wallet'?: string;
  'track-stratum'?: string | number;
  'watch-mempool'?: boolean;
  'refresh-blocks'?: boolean;
}

export interface ReplacedTransaction extends Transaction {
  txid: string;
}

export interface ReplacementInfo {
  mined: boolean;
  fullRbf: boolean;
  txid: string;
  oldFee: number;
  oldVsize: number;
  newFee: number;
  newVsize: number;
}
export interface MempoolBlock {
  blink?: boolean;
  height?: number;
  blockSize: number;
  blockVSize: number;
  nTx: number;
  medianFee: number;
  totalFees: number;
  feeRange: number[];
  index: number;
  isStack?: boolean;
}

export interface MempoolBlockWithTransactions extends MempoolBlock {
  transactionIds: string[];
  transactions: TransactionStripped[];
}

export interface MempoolBlockDelta {
  block: number;
  added: TransactionStripped[];
  removed: string[];
  changed: { txid: string, rate: number, flags: number, acc: boolean }[];
}
export interface MempoolBlockState {
  block: number;
  transactions: TransactionStripped[];
}
export type MempoolBlockUpdate = MempoolBlockDelta | MempoolBlockState;
export function isMempoolState(update: MempoolBlockUpdate): update is MempoolBlockState {
  return update['transactions'] !== undefined;
}
export function isMempoolDelta(update: MempoolBlockUpdate): update is MempoolBlockDelta {
  return update['transactions'] === undefined;
}

export interface MempoolBlockDeltaCompressed {
  added: TransactionCompressed[];
  removed: string[];
  changed: MempoolDeltaChange[];
}

export interface AccelerationDelta {
  added: Acceleration[];
  removed: string[];
  reset?: boolean;
}

export interface MempoolInfo {
  loaded: boolean;                 //  (boolean) True if the mempool is fully loaded
  size: number;                    //  (numeric) Current tx count
  bytes: number;                   //  (numeric) Sum of all virtual transaction sizes as defined in BIP 141.
  usage: number;                   //  (numeric) Total memory usage for the mempool
  maxmempool: number;              //  (numeric) Maximum memory usage for the mempool
  mempoolminfee: number;           //  (numeric) Minimum fee rate in BTC/kB for tx to be accepted.
  minrelaytxfee: number;           //  (numeric) Current minimum relay fee for transactions
}

// [txid, fee, vsize, value, rate, flags, acceleration?]
export type TransactionCompressed = [string, number, number, number, number, number, number, 1?];
// [txid, rate, flags, acceleration?]
export type MempoolDeltaChange = [string, number, number, (1|0)];

export interface IBackendInfo {
  hostname?: string;
  gitCommit: string;
  version: string;
  backend?: 'esplora' | 'electrum' | 'none';
  coreVersion?: string;
  /** How far the node this explorer reads has actually got. Null until read. */
  chainSync?: IChainSyncState | null;
}

export interface IChainSyncState {
  blocks: number;
  headers: number;
  initialBlockDownload: boolean;
  verificationProgress: number;
  checkedAt: string;
}

export interface Recommendedfees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  minimumFee: number;
  economyFee: number;
}

export interface HealthCheckHost {
  host: string;
  active: boolean;
  rtt: number;
  latestHeight: number;
  socket: boolean;
  outOfSync: boolean;
  unreachable: boolean;
  checked: boolean;
  lastChecked: number;
  link?: string;
  statusPage?: SafeResourceUrl;
  flag?: string;
  hashes?: {
    frontend?: string;
    backend?: string;
    electrs?: string;
    hybrid?: string;
    ssr?: string;
    core?: string;
    os?: string;
  };
}

export interface StratumJob {
  pool: number;
  height: number;
  coinbase: string;
  scriptsig: string;
  reward: number;
  jobId: string;
  extraNonce: string;
  extraNonce2Size: number;
  prevHash: string;
  coinbase1: string;
  coinbase2: string;
  merkleBranches: string[];
  version: string;
  bits: string;
  time: string;
  timestamp: number;
  cleanJobs: boolean;
  received: number;
}
