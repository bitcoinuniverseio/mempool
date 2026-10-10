// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Subject } from 'rxjs';
import { Transaction } from '@interfaces/electrs.interface';
import { TransactionComponent } from '../transaction/transaction.component';
import { TrackerComponent } from './tracker.component';
type RetryController = Pick<TransactionComponent, 'txId' | 'tx' | 'rbfCachedUnavailable' | 'fetchRbfHistory$' | 'fetchCachedTx$' | 'retryRbfHistory'>;
function controller(prototype: object, cachedUnavailable: boolean, tx: Transaction | null): RetryController {
  return Object.assign(Object.create(prototype) as RetryController, { txId: 'a'.repeat(64), tx, rbfCachedUnavailable: cachedUnavailable, fetchRbfHistory$: new Subject<string>(), fetchCachedTx$: new Subject<string>() });
}
describe.each([['transaction', TransactionComponent.prototype], ['tracker', TrackerComponent.prototype]])('actual %s replacement Retry dispatch', (_name, prototype) => {
  it('performs one cached-body recovery attempt without a duplicate history request', () => {
    const c = controller(prototype, true, null), history: string[] = [], cached: string[] = [];
    c.fetchRbfHistory$.subscribe(id => history.push(id)); c.fetchCachedTx$.subscribe(id => cached.push(id)); c.retryRbfHistory(); expect(cached).toEqual([c.txId]); expect(history).toEqual([]);
  });
  it('does not refetch an unnecessary cached body when the observed transaction exists', () => {
    const c = controller(prototype, true, { txid: 'a'.repeat(64) } as Transaction), history: string[] = [], cached: string[] = [];
    c.fetchRbfHistory$.subscribe(id => history.push(id)); c.fetchCachedTx$.subscribe(id => cached.push(id)); c.retryRbfHistory(); expect(history).toEqual([c.txId]); expect(cached).toEqual([]);
  });
});
