// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { ApiService } from '@app/services/api.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ProvenanceGraphComponent } from './provenance-graph.component';

const id = 'a'.repeat(64), other = 'b'.repeat(64);
const source = (txid = id) => ({ txid, vin: [{ txid: other, vout: 3, prevout: { value: 1000 } }], vout: [{ value: 900 }], status: { confirmed: true } });
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
function fixture() {
  const params = new BehaviorSubject(convertToParamMap({ txid: id }));
  const networkChanged$ = new Subject<string>();
  const requests: Subject<any>[] = [];
  const getTransaction$ = vi.fn(() => { const request = new Subject<any>(); requests.push(request); return request; });
  const router = { navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: ActivatedRoute, useValue: { paramMap: params } }, { provide: Router, useValue: router },
    { provide: StateService, useValue: { network: 'signet', networkChanged$ } },
    { provide: ElectrsApiService, useValue: { getTransaction$, getOutspends$: () => of([{ spent: false }]) } },
    { provide: ApiService, useValue: { getRbfHistory$: () => of({ replacements: null, replaces: [] }) } },
    { provide: UniverseApiService, useValue: { getMempoolPackage$: () => of(null) } },
  ] });
  TestBed.overrideComponent(ProvenanceGraphComponent, { set: {
    template: readFileSync('src/app/universe/provenance-graph/provenance-graph.component.html', 'utf8'), styles: [], styleUrls: [],
  } });
  const view = TestBed.createComponent(ProvenanceGraphComponent); view.detectChanges();
  return { view, component: view.componentInstance, params, networkChanged$, requests, getTransaction$, router };
}
it('renders the initial nested diagram and selected-network links with one source request', () => {
  const { view, requests, getTransaction$, component, router } = fixture();
  requests[0].next(source()); view.detectChanges(); view.detectChanges();
  expect(view.nativeElement.querySelectorAll('svg .node')).toHaveLength(3);
  expect(view.nativeElement.querySelector('a').getAttribute('href')).toMatch(/^\/signet\//);
  expect(getTransaction$).toHaveBeenCalledTimes(1);
  component.open(`/tx/${id}`); expect(router.navigateByUrl).toHaveBeenCalledWith(`/signet/tx/${id}`);
});
it('clears and cancels immediately on route, network and destruction', () => {
  const { view, requests, params, networkChanged$ } = fixture();
  requests[0].next(source()); view.detectChanges(); view.detectChanges();
  params.next(convertToParamMap({ txid: other })); view.detectChanges();
  expect(view.nativeElement.querySelector('svg')).toBeNull();
  expect(view.nativeElement.textContent).toContain('Loading');
  networkChanged$.next('testnet4'); view.detectChanges();
  expect(requests[1].observed).toBe(false);
  requests[1].next(source(other)); view.detectChanges();
  expect(view.nativeElement.querySelector('svg')).toBeNull();
  requests[2].next(source(other)); view.detectChanges(); view.detectChanges();
  expect(view.nativeElement.querySelector('a').getAttribute('href')).toMatch(/^\/testnet4\//);
  params.next(convertToParamMap({ txid: id })); view.detectChanges(); view.destroy();
  expect(requests[3].observed).toBe(false);
});
it('rejects a mismatched source transaction and invalid route instead of showing old facts', () => {
  const { view, requests, params, getTransaction$ } = fixture();
  requests[0].next(source(other)); view.detectChanges();
  expect(view.nativeElement.querySelector('svg')).toBeNull();
  expect(view.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
  params.next(convertToParamMap({ txid: 'bad' })); view.detectChanges();
  expect(getTransaction$).toHaveBeenCalledTimes(1);
  expect(view.nativeElement.textContent).toContain('not a transaction id');
});
