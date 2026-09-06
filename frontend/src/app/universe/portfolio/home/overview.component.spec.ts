// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { PortfolioDataService, type PortfolioDataState } from '../data/portfolio-data.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { emptyPortfolio, type LocalPortfolio } from '../stores/portfolio-model';
import type { AggregationResult } from '../shared/aggregation';
import { OverviewComponent } from './overview.component';

describe('overview local-only valuation disclosure', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());

  function fixture(portfolio: LocalPortfolio) {
    const activePortfolio = signal<LocalPortfolio | null>(portfolio);
    const data = signal<PortfolioDataState>({ loading: false, accounts: [], completedAt: '2026-09-06', aggregation: {
      state: 'proven', pricedTotal: '0', quoteCurrency: 'USD', unknownValueBucket: 'absent',
    } as AggregationResult });
    TestBed.configureTestingModule({ providers: [
      { provide: PortfolioDataService, useValue: { state: data } },
      { provide: PortfoliosStore, useValue: { activePortfolio } },
      { provide: PortfolioSessionService, useValue: { valuesHidden: signal(false) } },
    ] });
    const component = TestBed.runInInjectionContext(() => new OverviewComponent());
    return { component, data, activePortfolio };
  }

  it('does not describe an empty manual aggregate as a combined USD valuation', () => {
    const { component } = fixture(emptyPortfolio('manual', 'Manual only', '2026-09-06'));
    expect(component.pricedTotalLabel()).toBe('-');
    expect(component.quote()).toBe('');
    expect(component.coverageLabel()).toContain('Manual entries stay separate');
  });

  it('preserves real source state and valuation for a watch-only account with no derived addresses yet', () => {
    const portfolio = emptyPortfolio('watch', 'Watch only', '2026-09-06');
    const { component, data } = fixture({ ...portfolio, accounts: [{
      id: 'xpub', name: 'Unexpanded watch account', kind: 'xpub', chain: 'bitcoin', network: 'mainnet', tags: [], createdAt: '2026-09-06',
    }] });
    data.update(current => ({ ...current, aggregation: { ...current.aggregation!, state: 'pending', pricedTotal: '12.50' } }));
    expect(component.state()).toBe('pending');
    expect(component.pricedTotalLabel()).toBe('12.50');
    expect(component.quote()).toBe('USD');
    expect(component.coverageLabel()).toBe('Priced in USD');
  });
});
