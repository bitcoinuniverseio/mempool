// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PortfolioShellComponent } from './portfolio-shell.component';
import { PortfolioDataStateComponent } from '../shared/data-state.component';
import { PortfolioHomeComponent } from '../home/portfolio-home.component';
import { PortfolioDataService } from '../data/portfolio-data.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioVaultService } from '../stores/vault.service';
import { PortfolioSessionService } from '../stores/session.service';
import { emptyPortfolio } from '../stores/portfolio-model';
import { PORTFOLIO_ROUTES } from '../portfolio.routes';
import { OverviewComponent } from '../home/overview.component';
import { NgxEchartsDirective, NGX_ECHARTS_CONFIG } from 'ngx-echarts';
import { By } from '@angular/platform-browser';

@Component({ standalone: true, template: '<span>Portfolio child</span>' })
class ChildComponent {}

// Esbuild does not produce signal-input metadata for the unrelated status badge.
@Component({ selector: 'app-portfolio-data-state', standalone: true, template: '{{ state }}' })
class StateBadgeComponent { @Input() state = ''; }

describe('portfolio shell route ownership', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function fixture(initialize = true, actualOverview = false) {
    const portfolios = [emptyPortfolio('one', 'First private portfolio', '2026-09-05'), emptyPortfolio('two', 'Second private portfolio', '2026-09-05')];
    const vault = {
      probe: vi.fn(async () => ({ kind: 'unlocked' })), isUnlocked: vi.fn(() => true), lock: vi.fn(),
      listByType: vi.fn(async () => portfolios.map((value) => ({ id: value.id, value }))),
      get: vi.fn(async (id) => id === 'preferences' ? { activePortfolioId: 'one' } : null),
    };
    const store = new PortfoliosStore(vault as unknown as PortfolioVaultService);
    if (initialize) await store.initialize();
    const data = { state: signal({ loading: false, accounts: [], aggregation: null, completedAt: null }), reset: vi.fn(), loadPortfolio: vi.fn(async () => undefined) };
    TestBed.configureTestingModule({ providers: [
      provideRouter(actualOverview ? [{ path: 'portfolio', children: PORTFOLIO_ROUTES }] : [
        { path: 'portfolio', component: PortfolioHomeComponent },
        { path: 'portfolio/p/:portfolioId', component: PortfolioShellComponent, children: [{ path: 'overview', component: ChildComponent }] },
      ]),
      { provide: PortfoliosStore, useValue: store },
      { provide: PortfolioDataService, useValue: data },
      { provide: PortfolioSessionService, useValue: new PortfolioSessionService(store) },
    ] });
    TestBed.overrideComponent(PortfolioShellComponent, { remove: { imports: [PortfolioDataStateComponent] }, add: { imports: [StateBadgeComponent] } });
    if (actualOverview) {
      TestBed.overrideComponent(OverviewComponent, { remove: { imports: [PortfolioDataStateComponent] }, add: { imports: [StateBadgeComponent] } });
    }
    return { harness: await RouterTestingHarness.create(), store, data, vault };
  }

  it('loads the URL portfolio instead of the previously active portfolio on direct open and route reuse', async () => {
    const { harness, store, data } = await fixture();
    const shell = await harness.navigateByUrl('/portfolio/p/two/overview', PortfolioShellComponent);
    harness.detectChanges();
    expect(shell.portfolioId()).toBe('two');
    expect(store.activePortfolioId()).toBe('two');
    expect(data.loadPortfolio.mock.calls[0][0].id).toBe('two');
    expect(harness.routeNativeElement?.textContent).toContain('Second private portfolio');
    expect(harness.routeNativeElement?.textContent).toContain('Portfolio child');
    for (const section of ['reports', 'sources', 'time-machine']) {
      expect(harness.routeNativeElement?.querySelector(`a[href="/portfolio/p/two/${section}"]`)).not.toBeNull();
    }
    await harness.navigateByUrl('/portfolio/p/one/overview', PortfolioShellComponent);
    harness.detectChanges();
    expect(store.activePortfolioId()).toBe('one');
    expect(harness.routeNativeElement?.textContent).toContain('Portfolio child');
    expect(data.loadPortfolio.mock.calls.at(-1)?.[0].id).toBe('one');
    expect(data.reset).toHaveBeenCalledTimes(2);
  });

  it('activates the actual overview child with its route-provided chart dependency', async () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
    // Keep the real directive's DI and initialization, leaving canvas rendering to the browser check.
    vi.spyOn(NgxEchartsDirective.prototype, 'ngAfterViewInit').mockImplementation(() => undefined);
    const { harness } = await fixture(true, true);
    await harness.navigateByUrl('/portfolio/p/two/overview', PortfolioShellComponent);
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('app-portfolio-overview')).not.toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Portfolio value');
    expect(harness.routeNativeElement?.textContent).toContain('Tracked accounts');
    const chart = harness.routeDebugElement?.query(By.directive(NgxEchartsDirective));
    expect(chart).toBeDefined();
    const config = chart!.injector.get(NGX_ECHARTS_CONFIG);
    expect(typeof config.echarts).toBe('function');
  });

  it('clears selection and hides child data for an unknown portfolio and on lock', async () => {
    const { harness, store, data } = await fixture();
    await harness.navigateByUrl('/portfolio/p/two/overview', PortfolioShellComponent);
    await harness.navigateByUrl('/portfolio/p/missing/overview', PortfolioShellComponent);
    harness.detectChanges();
    expect(store.activePortfolio()).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('not available in this vault');
    expect(harness.routeNativeElement?.textContent).not.toContain('Portfolio child');
    expect(data.loadPortfolio).toHaveBeenCalledTimes(1);
    await harness.navigateByUrl('/portfolio/p/one/overview', PortfolioShellComponent);
    store.lock();
    harness.detectChanges();
    expect(store.activePortfolio()).toBeNull();
    expect(harness.routeNativeElement?.textContent).toContain('Unlock');
    expect(harness.routeNativeElement?.textContent).not.toContain('First private portfolio');
    expect(data.reset).toHaveBeenCalledTimes(4);
  });

  it('probes an existing vault after reload and preserves a requested portfolio after unlock', async () => {
    const { harness, store, vault, data } = await fixture(false);
    await harness.navigateByUrl('/portfolio?portfolioId=two');
    await vi.waitFor(() => { harness.detectChanges(); expect(store.activePortfolioId()).toBe('two'); });
    expect(vault.probe).toHaveBeenCalledOnce();
    expect(data.loadPortfolio.mock.calls.at(-1)?.[0].id).toBe('two');
  });
});
