import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioV2ApiService } from './data/portfolio-v2-api.service';
import {
  emptyPortfolioState,
  reflectAccountFailures,
  unreadableAccountState,
} from './data/portfolio-data.service';
import {
  OnboardingComponent,
  portfolioEphemeralRoute,
} from './onboarding/onboarding.component';
import { PerformanceComponent } from './performance/performance.component';
import { aggregatePortfolio } from './shared/aggregation';
import { completedRequestState } from './shared/request-state';
import { PortfoliosStore } from './stores/portfolios.store';
import { PortfolioSessionService } from './stores/session.service';
import type { LocalPortfolio } from './stores/portfolio-model';
import { SourcesComponent } from './sources/sources.component';
import { UtxoCenterComponent } from './utxos/utxo-center.component';

const address = `bc1q${'q'.repeat(38)}`;
const portfolio = {
  id: 'portfolio-1',
  name: 'Test portfolio',
  accounts: [
    {
      id: 'account-1',
      name: 'Bitcoin account',
      chain: 'bitcoin',
      network: 'mainnet',
      kind: 'address',
      addresses: [address],
      tags: [],
      createdAt: '2026-09-03T00:00:00.000Z',
    },
  ],
} as unknown as LocalPortfolio;

function createComponent<T>(
  factory: () => T,
  providers: Parameters<typeof createEnvironmentInjector>[0]
): { component: T; injector: EnvironmentInjector } {
  const injector = createEnvironmentInjector(
    providers,
    Injector.NULL as EnvironmentInjector,
    'portfolio-fail-closed-test'
  );
  return {
    component: runInInjectionContext(injector, factory),
    injector,
  };
}

async function waitForState(
  read: () => string,
  expected: string
): Promise<void> {
  await vi.waitFor(() => expect(read()).toBe(expected));
}

describe('portfolio aggregate failures', () => {
  it('does not turn total account failure into a proven zero', () => {
    const result = reflectAccountFailures(aggregatePortfolio([]), [
      { state: 'failed' },
    ]);

    expect(result.state).toBe('unavailable');
    expect(result.pricedTotal).toBeNull();
    expect(result.unknownValueBucket).toBe('present');
  });

  it('marks a successful subtotal as partial when another account fails', () => {
    const result = reflectAccountFailures(
      { ...aggregatePortfolio([]), pricedTotal: '12.5' },
      [{ state: 'ok' }, { state: 'failed' }]
    );

    expect(result.state).toBe('partial');
    expect(result.pricedTotal).toBe('12.5');
    expect(completedRequestState(1, 1)).toBe('partial');
  });

  it('marks undiscovered watch-only accounts as unavailable evidence', () => {
    const state = unreadableAccountState({
      id: 'watch-1',
      kind: 'xpub',
    });

    expect(state.state).toBe('failed');
    expect(state.retryable).toBe(false);
    expect(state.errorMessage).toContain('discovery is not available');
    const result = reflectAccountFailures(aggregatePortfolio([]), [state]);
    expect(result.state).toBe('unavailable');
    expect(result.pricedTotal).toBeNull();
  });

  it('does not treat a portfolio without readable accounts as zero', () => {
    const state = emptyPortfolioState('portfolio-empty');
    const result = reflectAccountFailures(aggregatePortfolio([]), [state]);

    expect(state.errorMessage).toContain('no readable public accounts');
    expect(result.state).toBe('unavailable');
    expect(result.pricedTotal).toBeNull();
  });
});

describe('ephemeral portfolio entry', () => {
  it('opens the exact user-supplied address without saving a fake record', async () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const createPortfolio = vi.fn();
    const { component, injector } = createComponent(
      () => new OnboardingComponent(),
      [
        { provide: Router, useValue: { navigate } },
        {
          provide: PortfoliosStore,
          useValue: { vaultKind: (): string => 'locked', createPortfolio },
        },
      ]
    );
    const actions = component as unknown as {
      choose(choice: 'ephemeral'): void;
      validateMaterial(value: string): void;
      save(): Promise<void>;
    };

    actions.choose('ephemeral');
    expect(component.step()).toBe('input');
    expect(navigate).not.toHaveBeenCalled();

    actions.validateMaterial(address);
    expect(component.valid()).toBe(true);
    expect(component.validation().toLowerCase()).toContain('checksum');
    await actions.save();

    expect(navigate).toHaveBeenCalledWith(
      portfolioEphemeralRoute('bitcoin', 'mainnet', address)
    );
    expect(createPortfolio).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('blocks unavailable entry modes without creating a portfolio', () => {
    const createPortfolio = vi.fn();
    const { component, injector } = createComponent(
      () => new OnboardingComponent(),
      [
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: PortfoliosStore,
          useValue: { vaultKind: (): string => 'unlocked', createPortfolio },
        },
      ]
    );
    const actions = component as unknown as {
      choose(choice: 'watch-only' | 'manual'): void;
    };

    actions.choose('watch-only');
    expect(component.step()).toBe('choose');
    expect(component.error()).toContain('not available');
    actions.choose('manual');
    expect(component.step()).toBe('choose');
    expect(createPortfolio).not.toHaveBeenCalled();
    injector.destroy();
  });
});

describe('portfolio account-backed surfaces', () => {
  const store = { activePortfolio: (): LocalPortfolio => portfolio };
  const session = { valuesHidden: (): boolean => false };
  const offlineApi = {
    getPerformance$: (): ReturnType<typeof throwError> =>
      throwError(() => new Error('offline')),
    getUtxos$: (): ReturnType<typeof throwError> =>
      throwError(() => new Error('offline')),
    getCoverage$: (): ReturnType<typeof throwError> =>
      throwError(() => new Error('offline')),
  };

  it('keeps a performance request failure distinct from empty history', async () => {
    const { component, injector } = createComponent(
      () => new PerformanceComponent(),
      [
        { provide: PortfoliosStore, useValue: store },
        { provide: PortfolioSessionService, useValue: session },
        { provide: PortfolioV2ApiService, useValue: offlineApi },
      ]
    );

    component.ngOnInit();
    await waitForState(component.requestState, 'error');
    expect(component.failedCount()).toBe(1);
    expect(component.reports()).toEqual([]);
    injector.destroy();
  });

  it('keeps a UTXO request failure distinct from an empty output set', async () => {
    const { component, injector } = createComponent(
      () => new UtxoCenterComponent(),
      [
        { provide: PortfoliosStore, useValue: store },
        { provide: PortfolioSessionService, useValue: session },
        { provide: PortfolioV2ApiService, useValue: offlineApi },
      ]
    );

    component.ngOnInit();
    await waitForState(component.requestState, 'error');
    expect(component.failedCount()).toBe(1);
    expect(component.utxos()).toEqual([]);
    injector.destroy();
  });

  it('keeps a source request failure distinct from an empty roster', async () => {
    const { component, injector } = createComponent(
      () => new SourcesComponent(),
      [
        { provide: PortfoliosStore, useValue: store },
        { provide: PortfolioV2ApiService, useValue: offlineApi },
      ]
    );

    component.ngOnInit();
    await waitForState(component.requestState, 'error');
    expect(component.entries()).toEqual([]);
    injector.destroy();
  });
});
