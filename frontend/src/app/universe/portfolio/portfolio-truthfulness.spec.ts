import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioDataService } from './data/portfolio-data.service';
import { OverviewComponent } from './home/overview.component';
import {
  ReportBuilderComponent,
  reportPercentage,
} from './reports/report-builder.component';
import { PortfoliosStore } from './stores/portfolios.store';
import { PortfolioSessionService } from './stores/session.service';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

function createComponent<T>(
  factory: () => T,
  providers: Parameters<typeof createEnvironmentInjector>[0]
): { component: T; injector: EnvironmentInjector } {
  const injector = createEnvironmentInjector(
    providers,
    Injector.NULL as EnvironmentInjector,
    'portfolio-truthfulness-test'
  );
  return {
    component: runInInjectionContext(injector, factory),
    injector,
  };
}

describe('portfolio value privacy', () => {
  it('offers only shown and hidden value states', () => {
    const session = new PortfolioSessionService({
      lock: vi.fn(),
    } as unknown as PortfoliosStore);

    expect(session.privacyLevel()).toBe('open');
    expect(session.valuesHidden()).toBe(false);

    session.cyclePrivacy();
    expect(session.privacyLevel()).toBe('values-hidden');
    expect(session.valuesHidden()).toBe(true);

    session.cyclePrivacy();
    expect(session.privacyLevel()).toBe('open');
    expect(session.valuesHidden()).toBe(false);
  });

  it('does not put hidden totals into chart configuration', () => {
    const hiddenTotal = '987654321.12345678';
    const dataState = signal({
      loading: false,
      accounts: [],
      aggregation: { pricedTotal: hiddenTotal },
      completedAt: null,
    });
    const { component, injector } = createComponent(
      () => new OverviewComponent(),
      [
        { provide: PortfolioDataService, useValue: { state: dataState } },
        { provide: PortfoliosStore, useValue: {} },
        {
          provide: PortfolioSessionService,
          useValue: { valuesHidden: (): boolean => true },
        },
      ]
    );

    const options = component.chartOptions();
    expect(options).toMatchObject({
      tooltip: { show: false },
      xAxis: { show: false, data: [] },
      yAxis: { show: false },
      series: [],
    });
    expect(JSON.stringify(options)).not.toContain(hiddenTotal);
    injector.destroy();
  });

  it('keeps public identifiers outside the value mask', () => {
    const model = source('./stores/portfolio-model.ts');
    const session = source('./stores/session.service.ts');
    const ephemeral = source('./home/ephemeral-portfolio.component.ts');
    const utxos = source('./utxos/utxo-center.component.ts');

    expect(model).not.toContain('hideIdentifiers');
    expect(model).not.toContain('presentationMode');
    expect(session).not.toContain('identifiersHidden');
    expect(ephemeral).toContain('<p class="mono">{{ truncated() }}</p>');
    expect(utxos).toContain('{{ row.outpointShort }}');
  });
});

describe('portfolio report truthfulness', () => {
  it('calculates percentages and keeps unavailable totals distinct', () => {
    expect(reportPercentage('50', '100')).toBe('50');
    expect(reportPercentage('1', '4')).toBe('25');
    expect(reportPercentage('1', '0')).toBeNull();
    expect(reportPercentage(null, '100')).toBeNull();
    expect(reportPercentage('1', null)).toBeNull();
  });

  it('shows the value column and labels unpriced rows as unavailable', () => {
    const valuesHidden = signal(false);
    const dataState = signal({
      loading: false,
      accounts: [],
      completedAt: null,
      aggregation: {
        pricedTotal: '100',
        holdings: [
          {
            assetKey: 'bitcoin:mainnet:native',
            displayName: 'Bitcoin',
            pricedValue: '50',
            locations: [{ address: 'bc1qexamplepublicaddress1234567890' }],
          },
          {
            assetKey: 'bitcoin:mainnet:unknown',
            displayName: 'Unpriced asset',
            pricedValue: null,
            locations: [{ address: 'bc1qanotherpublicaddress123456789' }],
          },
        ],
      },
    });
    const { component, injector } = createComponent(
      () => new ReportBuilderComponent(),
      [
        { provide: PortfolioDataService, useValue: { state: dataState } },
        {
          provide: PortfolioSessionService,
          useValue: { valuesHidden },
        },
      ]
    );

    expect(component.reportRows()).toEqual([
      expect.objectContaining({
        asset: 'Bitcoin',
        share: '50%',
        value: '50',
      }),
      expect.objectContaining({
        asset: 'Unpriced asset',
        share: 'Unavailable',
        value: 'Unpriced',
      }),
    ]);

    valuesHidden.set(true);
    expect(component.reportRows()[0].value).toBe('50%');
    expect(source('./reports/report-builder.component.ts')).toContain(
      '<td>{{ row.value }}</td>'
    );
    injector.destroy();
  });
});

describe('unavailable and scoped portfolio routes', () => {
  it('keeps the reserved share page request-free', () => {
    const share = source('./share/share-view.component.ts');

    expect(share).toContain('Portfolio sharing is not available');
    expect(share).toContain('No share');
    expect(share).not.toContain('HttpClient');
    expect(share).not.toMatch(/\.get\s*[<(]/);
    expect(share).not.toContain('/api/');
  });

  it('labels Time Machine as a single-address result and prints the address', () => {
    const timeMachine = source('./time-machine/time-machine.component.ts');

    expect(timeMachine).toContain('Single-address history comparison');
    expect(timeMachine).toMatch(/does\s+not combine multiple addresses\./);
    expect(timeMachine).toContain('<code>{{ delta.address }}</code>');
  });

  it('documents the compatibility and ephemeral route boundaries', () => {
    const workspace = source(
      '../../../../../docs/product/PORTFOLIO-WORKSPACE.md'
    );
    const address = source('../../../../../docs/product/ADDRESS-PORTFOLIO.md');

    expect(workspace).toContain('not a standalone portfolio workspace');
    expect(workspace).toContain('does not offer transactional rollback');
    expect(address).toContain('first holdings page, limited to 100 entries');
    expect(address).toContain('no tabs');
    expect(address).toMatch(/all\s+share operations are unavailable/);
    expect(address).not.toContain('?tab=');
  });
});
