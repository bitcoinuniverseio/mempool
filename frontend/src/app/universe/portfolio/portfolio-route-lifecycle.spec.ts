import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  convertToParamMap,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from '@angular/router';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  initializePortfolioRoute,
  requireUnlockedPortfolioRoute,
} from './portfolio.routes';
import { PortfolioHomeComponent } from './home/portfolio-home.component';
import { PortfoliosStore } from './stores/portfolios.store';

const route = (portfolioId: string | null): ActivatedRouteSnapshot =>
  ({
    paramMap: convertToParamMap(portfolioId === null ? {} : { portfolioId }),
  }) as ActivatedRouteSnapshot;

const state = (url: string): RouterStateSnapshot =>
  ({ url }) as RouterStateSnapshot;

function runGuard<T>(
  guard: () => T,
  store: object,
  router: object = {}
): { result: T; injector: EnvironmentInjector } {
  const injector = createEnvironmentInjector(
    [
      { provide: PortfoliosStore, useValue: store },
      { provide: Router, useValue: router },
    ],
    Injector.NULL as EnvironmentInjector,
    'portfolio-route-lifecycle-test'
  );
  return {
    result: runInInjectionContext(injector, guard),
    injector,
  };
}

describe('saved Portfolio route lifecycle', () => {
  it('uses the Angular worker URL form that produces a browser worker chunk', () => {
    const source = readFileSync(
      new URL('./stores/vault.service.ts', import.meta.url),
      'utf8'
    );
    const angularConfig = JSON.parse(
      readFileSync(new URL('../../../../angular.json', import.meta.url), 'utf8')
    ) as {
      projects: { mempool: { architect: { build: { options: object } } } };
    };

    expect(source).toContain(
      `new URL('../workers/vault-kdf.worker', import.meta.url)`
    );
    expect(source).not.toContain(`vault-kdf.worker.ts', import.meta.url`);
    expect(
      angularConfig.projects.mempool.architect.build.options
    ).toMatchObject({ webWorkerTsConfig: 'tsconfig.worker.json' });
  });

  it('provides the chart runtime inside the standalone overview route', () => {
    const source = readFileSync(
      new URL('./home/overview.component.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('provideEchartsCore({');
    expect(source).toContain(`import('@app/graphs/echarts')`);
  });

  it('initializes the vault before a top-level Portfolio route renders', async () => {
    const initialize = vi.fn().mockResolvedValue('absent');
    const { result, injector } = runGuard(
      () => initializePortfolioRoute(route(null), state('/portfolio')),
      { initialize }
    );

    await expect(result).resolves.toBe(true);
    expect(initialize).toHaveBeenCalledOnce();
    injector.destroy();
  });

  it('preserves a locked deep URL for the unlock screen', async () => {
    const deepUrl = '/portfolio/p/qa-portfolio-001/holdings';
    const lockedTree = { kind: 'locked-return' };
    const createUrlTree = vi.fn().mockReturnValue(lockedTree);
    const { result, injector } = runGuard(
      () =>
        requireUnlockedPortfolioRoute(
          route('qa-portfolio-001'),
          state(deepUrl)
        ),
      {
        initialize: vi.fn().mockResolvedValue('locked'),
      },
      { createUrlTree }
    );

    await expect(result).resolves.toBe(lockedTree);
    expect(createUrlTree).toHaveBeenCalledWith(['/portfolio'], {
      queryParams: { returnUrl: deepUrl },
    });
    injector.destroy();
  });

  it('activates the requested saved portfolio before rendering its child route', async () => {
    const setActivePortfolio = vi.fn().mockResolvedValue(undefined);
    const createUrlTree = vi.fn();
    const { result, injector } = runGuard(
      () =>
        requireUnlockedPortfolioRoute(
          route('qa-portfolio-001'),
          state('/portfolio/p/qa-portfolio-001/overview')
        ),
      {
        initialize: vi.fn().mockResolvedValue('unlocked'),
        portfolios: () => [{ id: 'qa-portfolio-001' }],
        activePortfolioId: () => 'another-portfolio',
        setActivePortfolio,
      },
      { createUrlTree }
    );

    await expect(result).resolves.toBe(true);
    expect(setActivePortfolio).toHaveBeenCalledWith('qa-portfolio-001');
    expect(createUrlTree).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('routes an unknown local identifier to portfolio management', async () => {
    const managementTree = { kind: 'portfolio-management' };
    const setActivePortfolio = vi.fn();
    const createUrlTree = vi.fn().mockReturnValue(managementTree);
    const { result, injector } = runGuard(
      () =>
        requireUnlockedPortfolioRoute(
          route('missing-portfolio'),
          state('/portfolio/p/missing-portfolio/reports')
        ),
      {
        initialize: vi.fn().mockResolvedValue('unlocked'),
        portfolios: () => [{ id: 'qa-portfolio-001' }],
        activePortfolioId: () => 'qa-portfolio-001',
        setActivePortfolio,
      },
      { createUrlTree }
    );

    await expect(result).resolves.toBe(managementTree);
    expect(createUrlTree).toHaveBeenCalledWith(['/portfolio/manage']);
    expect(setActivePortfolio).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('returns an unlock to the requested saved child route', async () => {
    const deepUrl = '/portfolio/p/qa-portfolio-001/utxos';
    const setActivePortfolio = vi.fn().mockResolvedValue(undefined);
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const injector = createEnvironmentInjector(
      [
        {
          provide: PortfoliosStore,
          useValue: {
            vaultKind: (): string => 'unlocked',
            portfolios: (): { id: string }[] => [{ id: 'qa-portfolio-001' }],
            activePortfolio: (): null => null,
            setActivePortfolio,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ returnUrl: deepUrl }),
            },
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(), navigateByUrl },
        },
      ],
      Injector.NULL as EnvironmentInjector,
      'portfolio-unlock-return-test'
    );

    runInInjectionContext(
      injector,
      () => new PortfolioHomeComponent()
    ).ngOnInit();

    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith(deepUrl));
    expect(setActivePortfolio).toHaveBeenCalledWith('qa-portfolio-001');
    injector.destroy();
  });

  it('does not open another saved portfolio for an unknown return identifier', () => {
    const navigate = vi.fn().mockResolvedValue(true);
    const injector = createEnvironmentInjector(
      [
        {
          provide: PortfoliosStore,
          useValue: {
            vaultKind: (): string => 'unlocked',
            portfolios: (): { id: string }[] => [{ id: 'qa-portfolio-001' }],
            activePortfolio: (): { id: string } => ({
              id: 'qa-portfolio-001',
            }),
            setActivePortfolio: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({
                returnUrl: '/portfolio/p/missing-portfolio/reports',
              }),
            },
          },
        },
        {
          provide: Router,
          useValue: { navigate, navigateByUrl: vi.fn() },
        },
      ],
      Injector.NULL as EnvironmentInjector,
      'portfolio-unknown-return-test'
    );

    runInInjectionContext(
      injector,
      () => new PortfolioHomeComponent()
    ).ngOnInit();

    expect(navigate).toHaveBeenCalledWith(['/portfolio/manage']);
    injector.destroy();
  });
});
