// @vitest-environment jsdom
import { UntypedFormBuilder } from '@angular/forms';
import { convertToParamMap } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddressComponent } from './address.component';
import { ADDRESS_READ_DEADLINE_MS } from '@app/shared/address-read-deadline';

afterEach(() => vi.useRealTimers());
function setup(history: Observable<unknown>) {
  document.body.scrollTo = vi.fn();
  const params = convertToParamMap({ id: 'tb1qtr70drlutyyu72c0hssvze9v3he8q5mpucqgmv' });
  const stats = { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 };
  const api = { getAddress$: vi.fn(() => of({ address: params.get('id'), chain_stats: stats, mempool_stats: stats })),
    getAddressTransactions$: vi.fn(() => history) };
  const state = { network: 'signet', env: { ACCELERATOR_BUTTON: false }, networkChanged$: new Subject(),
    connectionState$: new Subject(), loadingIndicators$: of({}), mempoolTransactions$: new Subject(),
    mempoolRemovedTransactions$: new Subject(), blockTransactions$: new Subject() };
  const websocket = { want: vi.fn(), startTrackAddress: vi.fn(), stopTrackingAddress: vi.fn(), stopTrackAccelerations: vi.fn() };
  const component = new AddressComponent({ paramMap: new BehaviorSubject(params), fragment: of(null), snapshot: { paramMap: params } } as never,
    api as never, websocket as never, state as never, {} as never, {} as never,
    { setTitle: vi.fn(), setDescription: vi.fn(), logSoft404: vi.fn() } as never, new UntypedFormBuilder(), {} as never);
  component.ngOnInit();
  return { component, api, state };
}
describe('address page controller recovery', () => {
  it('live arrivals during loading do not crash or mutate an old scope; refresh is coalesced after the owned read', () => {
    const pending = new Subject<unknown>();
    const { component, api, state } = setup(pending);
    state.mempoolTransactions$.next({ txid: 'a'.repeat(64) });
    state.blockTransactions$.next({ txid: 'b'.repeat(64) });
    api.getAddressTransactions$.mockReturnValue(of([]));
    pending.next([]); pending.complete();
    expect(api.getAddressTransactions$).toHaveBeenCalledTimes(2);
    expect(component.transactions).toEqual([]); expect(component.isLoadingTransactions).toBe(false);
    component.ngOnDestroy();
  });
  it('history failure does not end the retry subscription or masquerade as empty history', () => {
    const { component, api } = setup(throwError(() => ({ status: 429, error: { code: 'address-backend-busy' } })));
    expect(component.addressFailure).toBe('busy'); expect(component.transactions).toBeNull();
    expect(component.isLoadingTransactions).toBe(false);
    api.getAddressTransactions$.mockReturnValue(of([])); component.retryAddress();
    expect(api.getAddressTransactions$).toHaveBeenCalledTimes(2); expect(component.addressFailure).toBeNull();
    expect(component.transactions).toEqual([]); expect(component.fullyLoaded).toBe(true);
    component.ngOnDestroy();
  });
  it('a stalled history request is cancelled, leaves a usable retry and drains load-more on destruction', () => {
    vi.useFakeTimers(); const stopped = vi.fn();
    const { component, api } = setup(new Observable(() => stopped));
    vi.advanceTimersByTime(ADDRESS_READ_DEADLINE_MS);
    expect(stopped).toHaveBeenCalledTimes(1); expect(component.addressFailure).toBe('timeout');
    api.getAddressTransactions$.mockReturnValue(of([])); component.retryAddress();
    expect(component.transactions).toEqual([]);
    component.fullyLoaded = false; api.getAddressTransactions$.mockReturnValue(new Observable(() => stopped));
    component.loadMore(); component.ngOnDestroy();
    expect(stopped).toHaveBeenCalledTimes(2);
  });
});
