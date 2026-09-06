import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { of, Subject } from 'rxjs';
import { PortfolioDataService } from './portfolio-data.service';
import { PortfolioV2ApiService } from './portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { emptyPortfolio, LocalPortfolio } from '../stores/portfolio-model';

function portfolio(id: string, networks = ['mainnet']): LocalPortfolio {
  return { ...emptyPortfolio(id, id, '2026-09-05'), accounts: networks.map((network) => ({
    id: `${id}-${network}`, name: network, chain: 'bitcoin', network, kind: 'address', addresses: ['same-public-address'], tags: [], createdAt: '2026-09-05',
  })) };
}

function summary(network: string) {
  return { aggregateState: 'live', valuation: { quoteCurrency: 'USD', pricedValue: '1', pricedHoldingCount: 1, unpricedHoldingCount: 0, state: 'complete-priced' },
    envelope: { sources: [] }, nativeBalance: { assetKey: `bitcoin:${network}:base:native:bitcoin`, quantityAtomic: '1', value: '1', valuationState: 'priced', price: { quoteCurrency: 'USD' }, sourceState: 'live' } };
}

function fixture() {
  const api = { getSummary$: vi.fn((_chain: string, network: string) => of(summary(network))),
    getHoldings$: vi.fn(() => of({ holdings: [] })), getActivity$: vi.fn(() => of({ events: [] })) };
  const injector = Injector.create({ providers: [
    { provide: PortfolioV2ApiService, useValue: api }, { provide: PortfoliosStore, useValue: {} },
    { provide: NgZone, useValue: { runOutsideAngular: (fn: () => void) => fn() } },
  ] });
  return { service: runInInjectionContext(injector, () => new PortfolioDataService()), api };
}

describe('portfolio data identity and pending response isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps an identical public address on testnet and signet as separate holdings and account identities', async () => {
    const { service, api } = fixture();
    await service.loadPortfolio(portfolio('one', ['testnet', 'signet']));
    expect(api.getSummary$.mock.calls.map((call) => call[1]).sort()).toEqual(['signet', 'testnet']);
    expect(service.state().aggregation?.holdings.map((holding) => holding.assetKey)).toEqual([
      'bitcoin:signet:base:native:bitcoin', 'bitcoin:testnet:base:native:bitcoin',
    ]);
    expect(service.state().aggregation?.duplicateAddresses).toEqual([]);
  });

  it('discards an old account response after a newer portfolio has completed', async () => {
    const { service, api } = fixture();
    const old = new Subject<ReturnType<typeof summary>>();
    api.getSummary$.mockReturnValueOnce(old);
    const pending = service.loadPortfolio(portfolio('old'));
    service.reset();
    await service.loadPortfolio(portfolio('new', ['signet']));
    const current = service.state();
    old.next(summary('mainnet')); old.complete();
    await pending;
    expect(service.state()).toBe(current);
    expect(service.state().accounts[0].accountId).toBe('new-signet');
  });

  it('cannot repopulate account data after the vault selection is cleared', async () => {
    const { service, api } = fixture();
    const old = new Subject<ReturnType<typeof summary>>();
    api.getSummary$.mockReturnValueOnce(old);
    const pending = service.loadPortfolio(portfolio('old'));
    service.reset();
    old.next(summary('mainnet')); old.complete();
    await pending;
    expect(service.state()).toEqual({ loading: false, accounts: [], aggregation: null, completedAt: null });
  });
});
