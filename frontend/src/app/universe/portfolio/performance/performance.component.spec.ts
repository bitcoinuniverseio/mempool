// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Component, Input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject } from 'rxjs';
import { PerformanceComponent } from './performance.component';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
import { PortfolioDataStateComponent } from '../shared/data-state.component';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const account = (name: string, addresses: string[]) => ({ id: name, name, kind: 'addresses', chain: 'bitcoin', network: 'signet', addresses });
@Component({ selector: 'app-portfolio-data-state', standalone: true, template: '{{ state }}' })
class StateBadgeStub { @Input() state = ''; }
function fixture() {
  const activePortfolio = signal<any>({ accounts: [account('One', ['a', 'b']), account('Two', ['a'])] });
  const requests: any[] = [];
  const api = { getPerformance$: vi.fn((chain, network, address) => {
    const subject = new Subject<any>(); requests.push({ chain, network, address, subject }); return subject;
  }) };
  TestBed.configureTestingModule({ providers: [{ provide: PortfoliosStore, useValue: { activePortfolio } }, { provide: PortfolioSessionService, useValue: { valuesHidden: signal(false) } }, { provide: PortfolioV2ApiService, useValue: api }] });
  // Isolate the shared state badge: this JIT harness does not compile its required signal-input metadata.
  // The performance parent's coverage and monetary template remain intact.
  TestBed.overrideComponent(PerformanceComponent, { remove: { imports: [PortfolioDataStateComponent] }, add: { imports: [StateBadgeStub] } });
  const view = TestBed.createComponent(PerformanceComponent); view.detectChanges();
  return { view, component: view.componentInstance, activePortfolio, requests };
}
function report(target: any) { return { chain: target.chain, network: target.network, address: target.address, account: target, sourceState: 'unsupported', quoteCurrency: 'EUR', realizedPnl: '9007199254740993.12', unrealizedPnl: null, totalPnl: null, fees: null, warnings: [], methodology: 'Controlled evidence' }; }
it('deduplicates public addresses, preserves successful performance and discloses a failed account in the rendered view', () => {
  const f = fixture(); f.requests[0].subject.next(report(f.requests[0])); f.requests[1].subject.error(Error('private upstream payload')); f.view.detectChanges();
  expect(f.requests.map(r => r.address)).toEqual(['a', 'b']); expect(f.component.reports()).toHaveLength(1);
  expect(f.component.reads()[0].scope).toContain('One, Two'); expect(f.component.reads()[1].status).toContain('coverage unknown');
  expect(f.component.loading()).toBe(false); const text = f.view.nativeElement.textContent;
  expect(text).toContain('EUR'); expect(text).not.toContain('USD'); expect(text.replace(/[\u202f,]/g, '')).toContain('9007199254740993.12'); expect(text).toContain('coverage unknown'); expect(text).not.toContain('private upstream');
});
it('cancels on portfolio change and destroy and rejects a foreign-network response', () => {
  const f = fixture(); f.activePortfolio.set({ accounts: [account('New', ['c'])] }); f.view.detectChanges();
  expect(f.requests[0].subject.observed).toBe(false); expect(f.component.reports()).toHaveLength(0);
  f.requests[1].subject.next({ ...report(f.requests[1]), network: 'mainnet' });
  expect(f.component.reports()).toHaveLength(0); expect(f.component.reads()[0].status).toContain('coverage unknown');
  f.activePortfolio.set({ accounts: [account('Last', ['d'])] }); f.view.detectChanges(); f.view.destroy();
  expect(f.requests[2].subject.observed).toBe(false);
});
