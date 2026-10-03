import { afterEach, describe, expect, it, vi } from 'vitest';
import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
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
  const account = { chain: 'bitcoin', network, address: 'same-public-address' };
  return { schemaVersion: 'universe-portfolio-v2-summary-v1', account, aggregateState: 'proven', valuation: { quoteCurrency: 'USD', pricedValue: '1', pricedHoldingCount: 1, unpricedHoldingCount: 0, state: 'complete-priced' },
    envelope: { ...account, chainTip: null, sources: [] }, nativeBalance: { assetKey: `bitcoin:${network}:base:native:bitcoin`, quantityAtomic: '1', value: '1', valuationState: 'priced', price: { quoteCurrency: 'USD' }, sourceState: 'proven' } };
}

function fixture() {
  const api = { getSummary$: vi.fn((_chain: string, network: string) => of(summary(network))),
    getHoldings$: vi.fn((_chain: string, network: string) => of({ schemaVersion: 'universe-portfolio-v2-holdings-v1', account: summary(network).account, envelope: summary(network).envelope, holdings: [], sourceState: 'proven', nextCursor: null })), getActivity$: vi.fn((_chain: string, network: string) => of({ ...summary(network).account, schemaVersion: 'universe-portfolio-activity-v2', account: summary(network).account, checkpoint: null, events: [], sourceState: 'proven', nextCursor: null })) };
  const injector = Injector.create({ providers: [
    { provide: PortfolioV2ApiService, useValue: api }, { provide: PortfoliosStore, useValue: {} },
    { provide: NgZone, useValue: { runOutsideAngular: (fn: () => void) => fn() } },
  ] });
  return { service: runInInjectionContext(injector, () => new PortfolioDataService()), api };
}

describe('portfolio data identity and pending response isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps failed targets unknown instead of claiming a proven zero', async () => {
    const { service, api } = fixture();
    api.getSummary$.mockReturnValue(throwError(() => Error('outage')));
    await service.loadPortfolio(portfolio('failed'));
    expect(service.state().aggregation).toMatchObject({ state: 'unavailable', pricedTotal: null, unknownValueBucket: 'present' });
  });
  it('exposes actual retained provider state under exact network contexts and withdraws it on reset', async () => {
    const {service,api}=fixture();
    api.getSummary$.mockImplementation((_chain, network) => of({...summary(network),envelope:{...summary(network).envelope,sources:[{authorityId:'owned-index',state:network === 'signet' ? 'unavailable' : 'proven'}]}} as any));
    await service.loadPortfolio(portfolio('source', ['testnet','signet']));
    expect(service.sourceStates()).toEqual(expect.arrayContaining([{authorityId:'owned-index',state:'proven',context:'bitcoin:testnet'},{authorityId:'owned-index',state:'unavailable',context:'bitcoin:signet'}]));
    service.reset(); expect(service.sourceStates()).toEqual([]);
  });

  it('retains successful targets while retrying a failed network target', async () => {
    const { service, api } = fixture();
    api.getSummary$.mockImplementation((_chain, network) => network === 'signet' ? throwError(() => Error('outage')) : of(summary(network)));
    const input = portfolio('retry', ['testnet', 'signet']);
    await service.loadPortfolio(input);
    expect(service.state().aggregation?.unknownValueBucket).toBe('present');
    api.getSummary$.mockImplementation((_chain, network) => of(summary(network)));
    await service.retryFailed(input);
    expect(service.state().aggregation?.pricedTotal).toBe('2');
    expect(service.state().accounts).toHaveLength(2);
    expect(api.getSummary$).toHaveBeenCalledTimes(3);
  });

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
