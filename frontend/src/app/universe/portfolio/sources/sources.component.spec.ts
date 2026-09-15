// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject } from 'rxjs';
import { SourcesComponent } from './sources.component';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { accountReadScope } from '../data/account-read-scope';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const account = (name: string, addresses: string[]) => ({ id: name, name, kind: 'addresses', chain: 'bitcoin', network: 'signet', addresses });
function fixture() {
  const activePortfolio = signal<any>({ accounts: [account('One', ['a', 'b']), account('Two', ['a', 'c'])] });
  const requests: any[] = [];
  const api = { getCoverage$: vi.fn((chain, network, address) => {
    const subject = new Subject<any>(); requests.push({ chain, network, address, subject }); return subject;
  }) };
  TestBed.configureTestingModule({ providers: [{ provide: PortfoliosStore, useValue: { activePortfolio } }, { provide: PortfolioV2ApiService, useValue: api }] });
  TestBed.overrideComponent(SourcesComponent, { set: { template: '', imports: [] } });
  const view = TestBed.createComponent(SourcesComponent); view.detectChanges();
  return { view, component: view.componentInstance, activePortfolio, requests };
}
it('reads every distinct address and preserves answered rows when another source fails', () => {
  const { component, requests } = fixture();
  requests[0].subject.next({ account: requests[0], roster: [{ protocol: 'base', state: 'proven' }] }); requests[0].subject.complete();
  requests[1].subject.error(Error('sensitive upstream text'));
  requests[2].subject.next({ account: requests[2], roster: [] }); requests[2].subject.complete();
  expect(requests.map(r => r.address)).toEqual(['a', 'b', 'c']);
  expect(component.entries()).toHaveLength(1);
  expect(component.reads()[0].accounts).toEqual(['One', 'Two']);
  expect(component.reads()[1].status).toContain('Unavailable');
  expect(component.loading()).toBe(false);
  expect(JSON.stringify(component.reads())).not.toContain('sensitive');
});
it('clears and cancels on portfolio changes, rejects mismatched identities and cleans up on destroy', () => {
  const { component, requests, activePortfolio, view } = fixture();
  activePortfolio.set({ accounts: [account('New', ['d'])] }); view.detectChanges();
  expect(requests[0].subject.observed).toBe(false);
  requests[1].subject.next({ account: { ...requests[1], network: 'mainnet' }, roster: [{ protocol: 'base' }] }); requests[1].subject.complete();
  expect(component.entries()).toHaveLength(0);
  expect(component.reads()[0].status).toContain('Unavailable');
  activePortfolio.set({ accounts: [account('Last', ['e'])] }); view.detectChanges(); view.destroy();
  expect(requests[2].subject.observed).toBe(false);
});
it('includes discovered public branches and explicitly bounds incomplete or unavailable account scope', () => {
  const scope = accountReadScope({ accounts: [
    { ...account('Derived', []), kind: 'xpub', discovery: { complete: false, derivedExternal: ['a'], derivedInternal: ['b'] } },
    account('Missing', []), account('Large', Array.from({ length: 201 }, (_, i) => `item${i}`)),
  ] } as any);
  expect(scope.targets.slice(0, 2).map(t => t.address)).toEqual(['a', 'b']);
  expect(scope.targets).toHaveLength(200);
  expect(scope.warnings.join(' ')).toContain('discovery is incomplete');
  expect(scope.warnings.join(' ')).toContain('Missing');
  expect(scope.warnings.join(' ')).toContain('3 additional');
});
