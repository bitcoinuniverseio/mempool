import { describe, expect, it, vi } from 'vitest';
import { UntypedFormBuilder } from '@angular/forms';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { TestTransactionsComponent } from './test-transactions.component';
import { ApiService } from '@app/services/api.service';

function setup() {
  const network = new BehaviorSubject('signet');
  const api = { testTransactions$: vi.fn().mockReturnValue(of([])) };
  const component = new TestTransactionsComponent(new UntypedFormBuilder(), api as any,
    { network: 'signet', networkChanged$: network } as any, { setTitle: vi.fn() } as any, {} as any);
  component.ngOnInit();
  return { component, api, network };
}

describe('test-only transaction admission lifecycle', () => {
  it('dispatches once while pending and cancels old-network results', () => {
    const { component, api, network } = setup();
    const old = new Subject();
    api.testTransactions$.mockReturnValue(old);
    component.testTxsForm.patchValue({ txs: 'aa' });
    component.testTxs(); component.testTxs();
    expect(api.testTransactions$).toHaveBeenCalledOnce();
    network.next('testnet');
    expect(old.observed).toBe(false);
    expect(component.isLoading).toBe(false);
    old.next([{ txid: 'stale', allowed: true }]);
    expect(component.results).toEqual([]);
  });

  it('cancels on destroy and refuses later dispatch', () => {
    const { component, api } = setup();
    const pending = new Subject(); api.testTransactions$.mockReturnValue(pending);
    component.testTxsForm.patchValue({ txs: 'aa' }); component.testTxs();
    component.ngOnDestroy();
    expect(pending.observed).toBe(false);
    component.testTxs(); expect(api.testTransactions$).toHaveBeenCalledOnce();
  });

  it('refuses malformed, nonfinite, excessive or inexact fee inputs before dispatch', () => {
    for (const fee of ['1oops', 'Infinity', 'NaN', '1e3', '-1', '0.0001', '9007199254740993']) {
      const { component, api } = setup();
      component.testTxsForm.patchValue({ txs: 'aa', maxfeerate: fee }); component.testTxs();
      expect(api.testTransactions$, fee).not.toHaveBeenCalled();
      expect(component.invalidMaxfeerate, fee).toBe(true);
      expect(component.error, fee).toContain('Maximum fee rate');
    }
  });

  it('converts exact sat/vB constraints including explicit zero and default omission', () => {
    for (const [fee, converted] of [['1.001', 0.00001001], ['0', 0], ['', null], ['10000', null]] as const) {
      const { component, api } = setup();
      component.testTxsForm.patchValue({ txs: 'aa, bb', maxfeerate: fee }); component.testTxs();
      expect(api.testTransactions$).toHaveBeenCalledWith(['aa', 'bb'], converted);
      expect(component.isLoading).toBe(false);
    }
  });

  it('retains valid input on failure and resets only after a successful retry', () => {
    const { component, api } = setup();
    api.testTransactions$.mockReturnValueOnce(throwError(() => ({ error: 'controlled source unavailable' })))
      .mockReturnValueOnce(of([{ txid: 'current', allowed: true }]));
    component.testTxsForm.patchValue({ txs: 'aa', maxfeerate: '1.001' }); component.testTxs();
    expect(component.error).toContain('controlled source unavailable');
    expect(component.testTxsForm.get('txs').value).toBe('aa');
    component.testTxs(); expect(component.results[0].txid).toBe('current');
    expect(component.error).toBe(''); expect(component.testTxsForm.get('txs').value).toBeNull();
  });

  it('refuses empty, incomplete or over-limit transaction lists', () => {
    for (const txs of ['', 'aa,', 'a', 'zz', Array(26).fill('aa').join(',')]) {
      const { component, api } = setup(); component.testTxsForm.patchValue({ txs }); component.testTxs();
      expect(api.testTransactions$).not.toHaveBeenCalled(); expect(component.error).toBeTruthy();
    }
  });

  it('handles synchronous source failure and allows a current retry', () => {
    const { component, api } = setup();
    api.testTransactions$.mockImplementationOnce(() => { throw new Error('source unavailable'); });
    component.testTxsForm.patchValue({ txs: 'aa' });
    expect(() => component.testTxs()).not.toThrow();
    expect(component.isLoading).toBe(false); expect(component.error).toBe('source unavailable');
    component.testTxs(); expect(api.testTransactions$).toHaveBeenCalledTimes(2);
  });

  it('serializes exact fee constraints and omitted default through the selected API prefix', () => {
    const api = Object.create(ApiService.prototype);
    api.apiBaseUrl = ''; api.apiBasePath = '/signet'; api.httpClient = { post: vi.fn().mockReturnValue(of([])) };
    api.testTransactions$(['aa'], 0.00001001);
    expect(api.httpClient.post).toHaveBeenCalledWith('/signet/api/txs/test?maxfeerate=0.00001001', ['aa']);
    api.testTransactions$(['aa'], null);
    expect(api.httpClient.post).toHaveBeenCalledWith('/signet/api/txs/test', ['aa']);
  });
});
