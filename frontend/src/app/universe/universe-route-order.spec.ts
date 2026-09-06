// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ɵresolveComponentResources as resolveComponentResources } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter, Router } from '@angular/router';
import { masterPageRoutes } from '@app/master-page.module';
import { ProtocolDetailComponent } from '@app/universe/protocol-detail/protocol-detail.component';

// SharedModule starts theme services. Recognition has no outlet and does not
// render these visual declarations; keep the real lazy route modules intact.
vi.mock('@app/shared/shared.module', async () => {
  const { NgModule } = await import('@angular/core');
  class SharedModule {}
  NgModule({})(SharedModule);
  return { SharedModule };
});

const reservedPaths = [
  'labs/consensus/compare', 'labs/consensus/conformance', 'labs/consensus/differential',
  'labs/consensus/cases', 'labs/consensus/formal', 'labs/consensus/specifications', 'labs/consensus/corpora',
  'protocols/bitcoin-staking', 'protocols/bitcoin-staking/delegations',
  'protocols/bitcoin-staking/delegation/:delegationId', 'protocols/bitcoin-staking/finality-providers',
  'protocols/bitcoin-staking/finality-provider/:providerId', 'protocols/bitcoin-staking/parameters',
  'protocols/bitcoin-staking/evidence', 'protocols/bitcoin-staking/reconciliation',
  'labs/consensus/case/:caseId', 'zcash/privacy', 'zcash/privacy/workspace', 'tx/:txid/bump',
  ...masterPageRoutes[0].children!.filter(route => route.path?.startsWith('lightning/')).map(route => route.path!),
];

function leaf(router: Router) {
  let route = router.routerState.snapshot.root;
  while (route.firstChild) { route = route.firstChild; }
  return route;
}

describe('reserved Universe routes through the Angular router', () => {
  beforeAll(async () => {
    // Load the real competing lazy modules before resolving their JIT resources.
    await Promise.all([
      import('@app/universe/universe.module'), import('@app/lightning/lightning.module'),
      import('@components/transaction/transaction.module'),
      import('@app/universe/multichain-explorer/multichain-explorer.module'),
    ]);
    // This suite checks route recognition and component identity, not rendering.
    // Vite has no Angular resource linker; AOT/browser checks cover real templates.
    await resolveComponentResources(() => Promise.resolve(''));
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  }, 60000);
  afterEach(() => TestBed.resetTestingModule());

  it.each(reservedPaths)('recognizes /%s as its declared component', async path => {
    const declared = masterPageRoutes[0].children!.find(route => route.path === path)!;
    const params = Object.fromEntries([...path.matchAll(/:([A-Za-z]+)/g)].map(match => [match[1], 'test-identity']));
    const url = '/' + path.replace(/:[A-Za-z]+/g, 'test-identity');
    const expected = await declared.loadComponent!() as unknown;
    await resolveComponentResources(() => Promise.resolve(''));
    TestBed.configureTestingModule({ providers: [provideRouter(masterPageRoutes)] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    expect(leaf(router).component).toBe(expected);
    expect(leaf(router).routeConfig?.path).toBe(path);
    expect(leaf(router).params).toEqual(params);
    expect(router.url).toBe(url);
  });

  it.each(['bip-119', 'not-a-known-proposal'])('preserves proposal identity %s for the actual detail handler', async proposalId => {
    TestBed.configureTestingModule({ providers: [provideRouter(masterPageRoutes)] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/labs/consensus/' + proposalId);
    expect(leaf(router).component?.name).toBe('ConsensusProposalDetailComponent');
    expect(leaf(router).params).toEqual({ proposalId });
  });

  it('preserves generic protocol detail through its actual lazy children', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(masterPageRoutes)] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/protocols/ordinals');
    expect(leaf(router).component).toBe(ProtocolDetailComponent);
    expect(leaf(router).params).toEqual({ id: 'ordinals' });
  });
});
