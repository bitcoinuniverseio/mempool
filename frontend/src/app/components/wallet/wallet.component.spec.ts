import { describe, expect, it, vi } from 'vitest';
import { Subject, of } from 'rxjs';
import { WalletComponent } from './wallet.component';
import { Transaction } from '@interfaces/electrs.interface';

/**
 * The named wallet page has two async sources for the same list: the HTTP
 * snapshot of confirmed transactions and the websocket wallet stream. These
 * tests drive both in the order that used to throw (websocket first) and
 * check the destroy path releases the network subscription.
 */
const tx = (txid: string, height: number): Transaction => ({ txid, vin: [], vout: [], status: { confirmed: true, block_height: height } } as unknown as Transaction);

function build() {
  const paramMap = new Subject<{ get: (key: string) => string }>();
  const walletTransactions$ = new Subject<Transaction[]>();
  const networkChanged$ = new Subject<string>();
  const addressTransactions = new Subject<Transaction[]>();
  const component = new WalletComponent(
    { paramMap } as never,
    { navigate: vi.fn() } as never,
    { want: vi.fn(), startTrackingWallet: vi.fn(), stopTrackingWallet: vi.fn() } as never,
    { networkChanged$, walletTransactions$, network: 'signet' } as never,
    { getWallet$: () => of({ tb1qaddress: { stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 } } }) } as never,
    { getAddressesTransactions$: () => addressTransactions } as never,
    { playSound: vi.fn() } as never,
    { setTitle: vi.fn(), setDescription: vi.fn(), logSoft404: vi.fn() } as never,
    { transform: (value: string) => value } as never,
  );
  return { component, paramMap, walletTransactions$, networkChanged$, addressTransactions };
}

describe('named wallet transaction list', () => {
  it('accepts a websocket transaction before the HTTP snapshot and keeps it once', () => {
    const { component, paramMap, walletTransactions$, addressTransactions } = build();
    component.ngOnInit();
    paramMap.next({ get: () => 'demo' });
    expect(() => walletTransactions$.next([tx('live', 200)])).not.toThrow();
    expect(component.transactions.map(t => t.txid)).toEqual(['live']);

    addressTransactions.next([tx('old', 100), tx('older', 90)]);
    expect(component.transactions.map(t => t.txid)).toEqual(['live', 'old', 'older']);
    expect(component.isLoadingTransactions).toBe(false);

    // The same transaction arriving again updates status instead of duplicating.
    walletTransactions$.next([tx('live', 201)]);
    expect(component.transactions.filter(t => t.txid === 'live')).toHaveLength(1);
  });

  it('a snapshot that already contains the live transaction does not duplicate it', () => {
    const { component, paramMap, walletTransactions$, addressTransactions } = build();
    component.ngOnInit();
    paramMap.next({ get: () => 'demo' });
    walletTransactions$.next([tx('shared', 200)]);
    addressTransactions.next([tx('shared', 200), tx('old', 100)]);
    expect(component.transactions.map(t => t.txid)).toEqual(['shared', 'old']);
  });

  it('switching wallets starts from an empty list and loadMore never indexes an empty one', () => {
    const { component, paramMap, addressTransactions } = build();
    component.ngOnInit();
    paramMap.next({ get: () => 'one' });
    addressTransactions.next([tx('a', 1)]);
    paramMap.next({ get: () => 'two' });
    expect(component.transactions).toEqual([]);
    expect(component.isLoadingTransactions).toBe(true);
    addressTransactions.next([]);
    expect(() => component.loadMore()).not.toThrow();
  });

  it('destroying the component releases the network subscription', () => {
    const { component, networkChanged$ } = build();
    component.ngOnInit();
    expect(networkChanged$.observers.length).toBe(1);
    component.ngOnDestroy();
    expect(networkChanged$.observers.length).toBe(0);
    networkChanged$.next('testnet');
    expect(component.network).toBe('');
  });
});
