// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject } from 'rxjs';
import { TimeMachineComponent } from './time-machine.component';
import { PortfolioV2ApiService } from '../data/portfolio-v2-api.service';
import { PortfoliosStore } from '../stores/portfolios.store';
import { PortfolioSessionService } from '../stores/session.service';
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const portfolio = (address: string) => ({ quoteCurrency: 'USD', accounts: [{ id: address, name: address, kind: 'addresses', chain: 'bitcoin', network: 'signet', addresses: [address, address + '2'] }] });
function fixture() {
  const activePortfolio = signal<any>(portfolio('a')); const requests: any[] = [];
  const api = { getDelta$: vi.fn((chain, network, address, from, to) => { const subject = new Subject<any>(); requests.push({ chain, network, address, from, to, subject }); return subject; }) };
  TestBed.configureTestingModule({ providers: [{ provide: PortfoliosStore, useValue: { activePortfolio } }, { provide: PortfolioSessionService, useValue: { valuesHidden: signal(false) } }, { provide: PortfolioV2ApiService, useValue: api }] });
  TestBed.overrideComponent(TimeMachineComponent, { set: { template: '', imports: [] } });
  const view = TestBed.createComponent(TimeMachineComponent); view.detectChanges();
  return { view, component: view.componentInstance, activePortfolio, requests, api };
}
function answer(request: any, currency = 'EUR') { const identity = { chain: request.chain, network: request.network, address: request.address }; return { ...identity, from: { ...identity, requestedPoint: request.from, valuation: { quoteCurrency: currency, pricedValue: '10' } }, to: { ...identity, requestedPoint: request.to, valuation: { quoteCurrency: currency, pricedValue: '11' } } }; }
it('retains separate per-address results and explicit failures, uses returned quote currency', () => {
  const { component, requests } = fixture();
  requests[0].subject.next(answer(requests[0])); requests[0].subject.complete();
  requests[1].subject.error(Error('private detail'));
  expect(component.results()).toHaveLength(2); expect(component.results()[0].delta?.address).toBe('a');
  expect(component.results()[1].error).toContain('incomplete'); expect(component.loading()).toBe(false);
  expect((component as any).show('10', 'EUR')).toContain('EUR');
});
it('edits and portfolio changes cancel pending comparisons and clear prior evidence', () => {
  const { component, requests, activePortfolio, view } = fixture();
  component.editDate('from', '2026-01-01'); expect(requests[0].subject.observed).toBe(false); expect(component.results()).toHaveLength(0);
  activePortfolio.set(portfolio('b')); view.detectChanges(); expect(requests[1].address).toBe('b');
  requests[1].subject.next({ ...answer(requests[1]), network: 'mainnet' }); requests[1].subject.complete();
  expect(component.results()[0].delta).toBeNull(); expect(component.results()[0].error).toContain('invalid');
  view.destroy(); expect(requests[2].subject.observed).toBe(false);
});
it('rejects impossible or inverted dates without requesting sources', () => {
  const { component, api } = fixture(); component.editDate('from', '2026-02-31');
  (component as any).compare(new Event('submit')); expect(api.getDelta$).toHaveBeenCalledTimes(1); expect(component.error()).toContain('valid dates');
  component.editDate('from', '2026-03-02'); component.editDate('to', '2026-03-01');
  (component as any).compare(new Event('submit')); expect(api.getDelta$).toHaveBeenCalledTimes(1);
});
