import { BehaviorSubject, Subscription, timer } from 'rxjs';
import { FeeEstimateSnapshot, Recommendedfees } from '@interfaces/websocket.interface';

export const FEE_ESTIMATE_MAX_AGE_MS = 120_000;
const RECOVERY_DEADLINE_MS = 5_000;
const fields: (keyof Recommendedfees)[] = ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee'];
export function feeNetwork(network: string): string { return network || 'mainnet'; }

export function decodeFeeEstimate(input: unknown, network: string, now = Date.now()): FeeEstimateSnapshot | null {
  const value = input as FeeEstimateSnapshot;
  if (!value || value.schemaVersion !== 'universe-fee-estimate-v1' || value.chain !== 'bitcoin'
    || value.network !== feeNetwork(network) || !['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(value.network)
    || !['ready', 'syncing', 'stale', 'unavailable'].includes(value.status)
    || !(value.reason === null || typeof value.reason === 'string')) {return null;}
  if (value.observedAt !== null && typeof value.observedAt !== 'string') {return null;}
  const observed = value.observedAt === null ? null : Date.parse(value.observedAt);
  if (value.observedAt !== null && (typeof value.observedAt !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.observedAt)
    || !Number.isFinite(observed) || observed > now + 5_000)) {return null;}
  if (value.observedAt !== null && new Date(value.observedAt.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.observedAt.slice(0, 10)) {return null;}
  if (value.tip !== null && (!value.tip || !Number.isSafeInteger(value.tip.height) || value.tip.height < 0
    || typeof value.tip.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(value.tip.hash))) {return null;}
  if (value.status === 'ready') {
    if (observed === null || now - observed >= FEE_ESTIMATE_MAX_AGE_MS || !value.tip || !value.values
      || !fields.every(field => typeof value.values[field] === 'number' && Number.isFinite(value.values[field]) && value.values[field] >= 0)) {return null;}
  } else if (value.values !== null) {return null;}
  // Copy accepted evidence so a caller cannot mutate the shared snapshot.
  return { ...value, tip: value.tip && { ...value.tip }, values: value.values && { ...value.values } };
}

/** One source clock and bounded recovery deadline shared by every fee surface. */
export class FeeEstimateState {
  readonly snapshot$ = new BehaviorSubject<FeeEstimateSnapshot>(this.empty('syncing', 'awaiting_observation'));
  private deadline: Subscription;
  private after = -Infinity;
  private lastObserved = -Infinity;
  private timedOut = false;
  constructor(private network = '') { this.wait(); }

  private empty(status: FeeEstimateSnapshot['status'], reason: string): FeeEstimateSnapshot {
    return { schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: feeNetwork(this.network), status,
      observedAt: null, tip: null, values: null, reason };
  }
  reset(network: string): void {
    this.network = network;
    this.after = this.lastObserved = -Infinity;
    this.timedOut = false;
    this.snapshot$.next(this.empty('syncing', 'awaiting_observation'));
    this.wait();
  }
  accept(input: unknown): void {
    if (typeof (input as FeeEstimateSnapshot)?.network === 'string'
      && (input as FeeEstimateSnapshot).network !== feeNetwork(this.network)) {return;}
    const decoded = decodeFeeEstimate(input, this.network);
    if (!decoded) {
      this.deadline?.unsubscribe();
      this.snapshot$.next(this.empty('unavailable', 'invalid_observation'));
      return;
    }
    const observed = decoded.observedAt === null ? -Infinity : Date.parse(decoded.observedAt);
    if (decoded.status === 'ready' && (observed <= this.after || observed < this.lastObserved)) {return;}
    if (decoded.status !== 'ready') { this.after = Math.max(this.after, this.lastObserved); }
    if (decoded.status === 'syncing' && this.timedOut) {return;}
    const alreadyWaiting = this.snapshot$.value.status === 'syncing' && decoded.status === 'syncing';
    if (!alreadyWaiting) {this.deadline?.unsubscribe();}
    this.lastObserved = Math.max(this.lastObserved, observed);
    this.snapshot$.next(decoded);
    if (decoded.status === 'ready') {
      this.timedOut = false;
      this.deadline = timer(Math.max(0, FEE_ESTIMATE_MAX_AGE_MS - (Date.now() - observed))).subscribe(() => this.offline('expired_observation'));
    } else if (decoded.status === 'syncing' && !alreadyWaiting) {this.wait();}
  }
  offline(reason = 'disconnected'): void {
    this.deadline?.unsubscribe();
    this.after = this.lastObserved;
    const previous = this.snapshot$.value;
    this.snapshot$.next(previous.values ? { ...previous, status: 'stale', reason } : this.empty('unavailable', reason));
  }
  retry(): void {
    if (this.snapshot$.value.reason === 'awaiting_new_observation') {return;}
    this.after = this.lastObserved;
    this.timedOut = false;
    this.snapshot$.next(this.empty('syncing', 'awaiting_new_observation'));
    this.wait();
  }
  private wait(): void {
    this.deadline?.unsubscribe();
    this.deadline = timer(RECOVERY_DEADLINE_MS).subscribe(() => {
      this.timedOut = true;
      this.offline('observation_timeout');
    });
  }
  destroy(): void { this.deadline?.unsubscribe(); this.snapshot$.complete(); }
}
