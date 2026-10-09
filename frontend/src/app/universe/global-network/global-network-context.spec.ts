import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { Injector, runInInjectionContext } from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { GlobalNetworkNodeDetailComponent } from './global-network-node-detail.component';
import { GlobalNetworkOverviewComponent } from './global-network-overview.component';
import { GlobalNetworkNodesComponent } from './global-network-nodes.component';
import { GlobalNetworkSeedsComponent } from './global-network-seeds.component';
import { GlobalNetworkSnapshotsComponent } from './global-network-snapshots.component';

// Controlled actual peer fields: network is transport, not the selected Bitcoin chain.
const peer = (endpoint: string) => ({ id: 'peer-controlled', epoch_id: 'epoch-controlled', endpoint_id: endpoint,
  ip_or_onion: endpoint, port: 38333, services: null, services_hex: null, user_agent: '/Satoshi:30.3.0/',
  start_height: 102, relay: null, transport_v2: null, addrv2: null, latency_ms: null,
  observed_at: '2026-10-05T00:00:00Z', inbound: null, network: 'ipv4' });

function setup() {
  const params = new Subject(); const first = new Subject(); const second = new Subject();
  const api = { getNodeDetail$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
  const component = new GlobalNetworkNodeDetailComponent({ paramMap: params } as any, api as any,
    { markForCheck: vi.fn() } as any, { network: 'signet' } as any);
  component.ngOnInit();
  return { params, first, second, component };
}

describe('Global Network captured endpoint lifecycle', () => {
  it('cancels an old-network overview and reloads on an actual selected-context change', () => {
    const networkChanged$ = new BehaviorSubject('');
    const state = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$ };
    const first = new Subject(); const second = new Subject();
    const api = { getOverview$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const injector = Injector.create({ providers: [{ provide: StateService, useValue: state }] });
    const component = runInInjectionContext(injector, () => new GlobalNetworkOverviewComponent(api as any,
      { markForCheck: vi.fn() } as any));
    try {
      component.ngOnInit(); expect(first.observed).toBe(true);
      state.network = 'testnet4'; networkChanged$.next('testnet4');
      expect(first.observed).toBe(false); expect(api.getOverview$).toHaveBeenCalledTimes(2);
      expect(second.observed).toBe(true); expect(component.overview).toBeNull();
    } finally { component.ngOnDestroy(); }
  });

  it('cancels the first pending endpoint when the route changes', () => {
    const { params, first, second, component } = setup();
    try {
      params.next(convertToParamMap({ endpointId: 'first.example' }));
      expect(first.observed).toBe(true);
      params.next(convertToParamMap({ endpointId: 'second.example' }));
      expect(first.observed).toBe(false); expect(second.observed).toBe(true);
    } finally { component.ngOnDestroy(); }
  });

  it('never lets a late first response overwrite the current endpoint', () => {
    const { params, first, second, component } = setup();
    try {
      params.next(convertToParamMap({ endpointId: 'first.example' }));
      params.next(convertToParamMap({ endpointId: 'second.example' }));
      second.next(peer('second.example')); first.next(peer('first.example'));
      expect(component.node?.endpoint_id).toBe('second.example');
    } finally { component.ngOnDestroy(); }
  });

  it('clears the previous endpoint and its error before loading a new route', () => {
    const { params, first, component } = setup();
    try {
      params.next(convertToParamMap({ endpointId: 'first.example' })); first.next(peer('first.example'));
      component.error = 'controlled old failure';
      params.next(convertToParamMap({ endpointId: 'second.example' }));
      expect(component.node).toBeNull(); expect(component.error).toBeNull(); expect(component.loading).toBe(true);
    } finally { component.ngOnDestroy(); }
  });

  it('releases route and pending response subscriptions on destroy', () => {
    const { params, first, component } = setup();
    params.next(convertToParamMap({ endpointId: 'first.example' })); component.ngOnDestroy();
    expect(params.observed).toBe(false); expect(first.observed).toBe(false);
    first.next(peer('first.example')); expect(component.node).toBeNull();
  });

  it('replaces pending detail on selected-network change and ignores repeated selected context signals', () => {
    const params = new BehaviorSubject(convertToParamMap({ endpointId: 'same.example' }));
    const changes = new BehaviorSubject(''), first = new Subject(), second = new Subject();
    const state = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changes };
    const api = { getNodeDetail$: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const component = new GlobalNetworkNodeDetailComponent({ paramMap: params } as any, api as any,
      { markForCheck: vi.fn() } as any, state as any);
    try {
      component.ngOnInit(); changes.next(''); expect(api.getNodeDetail$).toHaveBeenCalledOnce();
      state.network = 'testnet4'; changes.next('testnet4'); expect(first.observed).toBe(false);
      first.next(peer('same.example')); expect(component.node).toBeNull(); expect(second.observed).toBe(true);
    } finally { component.ngOnDestroy(); }
  });

  it.each(['seeds', 'snapshots'] as const)('clears %s reports on replacement, recovers on retry and releases all work on destroy', kind => {
    const changes = new BehaviorSubject(''), oldPending = new Subject(), pending = new Subject();
    const state = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changes };
    const method = kind === 'seeds' ? 'getDnsSeeds$' : 'getSnapshots$';
    const read = vi.fn().mockReturnValueOnce(oldPending).mockReturnValueOnce(throwError(() => Error('Controlled unavailable')))
      .mockReturnValueOnce(pending);
    const api = { [method]: read }, cd = { markForCheck: vi.fn() };
    const component = kind === 'seeds' ? new GlobalNetworkSeedsComponent(api as any, cd as any, state as any)
      : new GlobalNetworkSnapshotsComponent(api as any, cd as any, state as any);
    component.ngOnInit(); state.network = 'testnet4'; changes.next('testnet4');
    expect(oldPending.observed).toBe(false); expect(component.report).toBeNull(); expect(component.error).toBeTruthy();
    component.retry(); expect(component.error).toBeNull(); expect(component.loading).toBe(true);
    pending.next({ configured_network: 'testnet4', scope: 'Controlled bounded records', [kind]: [], total: 0 });
    expect(component.report?.configured_network).toBe('testnet4'); component.ngOnDestroy();
    expect(pending.observed).toBe(false); component.retry(); changes.next('signet'); expect(read).toHaveBeenCalledTimes(3);
  });

  it('bounds explicit peer pagination and resets the offset on actual context change', () => {
    const changes = new BehaviorSubject(''), state = { network: '', env: { ROOT_NETWORK: 'signet' }, networkChanged$: changes };
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...peer(`peer${i}.example`), id: `peer-${i}` }));
    const api = { getNodes$: vi.fn().mockReturnValueOnce(of({ nodes: rows, total: 101 }))
      .mockReturnValueOnce(of({ nodes: [peer('last.example')], total: 101 }))
      .mockReturnValueOnce(of({ nodes: [], total: 0 })) };
    const component = new GlobalNetworkNodesComponent(api as any, { markForCheck: vi.fn() } as any, state as any);
    try {
      component.ngOnInit(); component.searchQuery = 'peer5.example'; component.applyFilter();
      expect(component.filteredNodes).toHaveLength(1); expect(component.totalCount).toBe(101);
      component.nextPage(); expect(api.getNodes$).toHaveBeenLastCalledWith(100, 100);
      component.nextPage(); expect(api.getNodes$).toHaveBeenCalledTimes(2);
      state.network = 'testnet4'; changes.next('testnet4');
      expect(api.getNodes$).toHaveBeenLastCalledWith(100, 0); expect(component.nodes).toEqual([]);
      expect(component.filteredNodes).toEqual([]); expect(component.offset).toBe(0);
    } finally { component.ngOnDestroy(); }
  });
});
