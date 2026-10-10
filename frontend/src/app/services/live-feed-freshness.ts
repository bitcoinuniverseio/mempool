import { BehaviorSubject, Subscription, timer } from 'rxjs';
import { LoadState } from '@app/shared/load-state';
import { FEE_ESTIMATE_MAX_AGE_MS } from './fee-estimate';

/** Source timestamps, never replay subscriptions or ping receipt times, renew readiness. */
export class LiveFeedFreshness {
  readonly state$ = new BehaviorSubject<LoadState<boolean>>({ status: 'loading' });
  private deadline: Subscription;
  private observed = -Infinity;
  private after = -Infinity;
  constructor() { this.wait(); }
  accept(observedAt: string): void {
    const at = Date.parse(observedAt);
    if (!Number.isFinite(at) || at > Date.now() + 5_000 || Date.now() - at >= FEE_ESTIMATE_MAX_AGE_MS
      || at <= this.after || at < this.observed) {return;}
    this.observed = at;
    this.state$.next({ status: 'data', value: true, at });
    this.deadline?.unsubscribe();
    this.deadline = timer(Math.max(0, FEE_ESTIMATE_MAX_AGE_MS - (Date.now() - at))).subscribe(() => this.offline());
  }
  offline(): void {
    this.deadline?.unsubscribe();
    this.after = this.observed;
    this.state$.next(Number.isFinite(this.observed)
      ? { status: 'stale', value: true, at: this.observed, reason: 'network' }
      : { status: 'error', reason: 'unavailable', at: Date.now() });
  }
  reset(): void { this.after = this.observed = -Infinity; this.retry(); }
  retry(): void {
    this.after = this.observed;
    this.state$.next({ status: 'loading' });
    this.wait();
  }
  private wait(): void {
    this.deadline?.unsubscribe();
    this.deadline = timer(5_000).subscribe(() => this.state$.next({ status: 'error', reason: 'timeout', at: Date.now() }));
  }
  destroy(): void { this.deadline?.unsubscribe(); this.state$.complete(); }
}
