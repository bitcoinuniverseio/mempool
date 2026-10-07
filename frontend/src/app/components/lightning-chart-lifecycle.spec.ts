import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, ReplaySubject, Subject } from 'rxjs';
import { UntypedFormBuilder } from '@angular/forms';
import { convertToParamMap } from '@angular/router';
import { LightningStatisticsChartComponent } from '../lightning/statistics-chart/lightning-statistics-chart.component';
import { NodesNetworksChartComponent } from '../lightning/nodes-networks-chart/nodes-networks-chart.component';
import { NodesPerISPChartComponent } from '../lightning/nodes-per-isp-chart/nodes-per-isp-chart.component';
import { NodesChannelsMap } from '../lightning/nodes-channels-map/nodes-channels-map.component';
// These ownership tests inspect actual derived data and request observers;
// native ECharts rendering is qualified separately in the browser.
vi.mock('@app/graphs/echarts', () => ({ echarts: { registerMap: vi.fn() } }));

const kinds = ['capacity', 'networks', 'isp', 'map'] as const;
function setup(kind: typeof kinds[number], initialNetworkEvent = true) {
  vi.useFakeTimers(); vi.stubGlobal('window', { innerWidth: 1200 });
  const network = initialNetworkEvent ? new BehaviorSubject('signet') : new ReplaySubject<string>(1), params = new BehaviorSubject(convertToParamMap({})), source = new Subject<any>();
  const state = { networkChanged$: network, isBrowser: true, env: {} };
  const api = { cachedRequest: vi.fn(() => source), listStatistics$: vi.fn(), getNodesPerIsp: vi.fn(() => source), getChannelsGeo$: vi.fn(() => source), getWorldNodes$: vi.fn() };
  const seo = { setTitle: vi.fn(), setDescription: vi.fn() }, storage = { getValue: vi.fn(() => null), setValue: vi.fn() };
  let component: any, stream: string;
  if (kind === 'capacity' || kind === 'networks') {
    const Type = kind === 'capacity' ? LightningStatisticsChartComponent : NodesNetworksChartComponent;
    component = new Type('en-US', seo as any, api as any, new UntypedFormBuilder(), storage as any,
      { getDefaultTimespan: () => '1m' } as any, state as any, {} as any);
    stream = kind === 'capacity' ? 'capacityObservable$' : 'nodesNetworkObservable$';
  } else if (kind === 'isp') {
    component = new NodesPerISPChartComponent(api as any, seo as any, {} as any, {} as any, {} as any, state as any);
    stream = 'nodesPerAsObservable$';
  } else {
    component = new NodesChannelsMap(seo as any, api as any, state as any,
      { getWorldMapJson$: of({ type: 'FeatureCollection', features: [] }) } as any, {} as any, {} as any, { paramMap: params } as any, {} as any);
    component.style = 'widget'; stream = 'channelsObservable';
  }
  component.prepareChartOptions = vi.fn(); component.ngOnInit();
  const failed = vi.fn(), values: any[] = []; const subscription = component[stream].subscribe({ next: value => values.push(value), error: failed });
  vi.advanceTimersByTime(101); component.chartInstance = { clear: vi.fn() };
  const value = () => kind === 'map' ? [] : kind === 'isp' ? { ispRanking: [[123, 'OwnedISP', 100000, 'GB', 2]], clearnetCapacity: 100000, unknownCapacity: 0, torCapacity: 0 }
    : { body: [{ added: 123, total_capacity: 100000, channel_count: 1, tor_nodes: 1, clearnet_nodes: 2, unannounced_nodes: 0, clearnet_tor_nodes: 0 }], headers: { get: () => '1' } };
  return { component, source, api, network, params, subscription, failed, values, value };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe.each(kinds)('native Lightning %s chart ownership', kind => {
  it('starts the root-network read without waiting for a network change event', () => {
    const f = setup(kind, false);
    expect(f.source.observed).toBe(true);
    expect(Object.values(f.api).reduce((sum, method) => sum + method.mock.calls.length, 0)).toBe(1);
    f.source.next(f.value()); f.source.complete();
    expect(f.component.prepareChartOptions).toHaveBeenCalledOnce();
    f.subscription.unsubscribe(); f.component.ngOnDestroy();
  });
  it('cancels previous-network reads and clears rendered options/data while replacement is pending', () => {
    const f = setup(kind); f.component.chartOptions = { series: [{ data: [999] }] };
    if (kind === 'capacity' || kind === 'networks') f.component.chartData = { old: true };
    for (const name of ['cachedRequest', 'getNodesPerIsp', 'getChannelsGeo$']) f.api[name].mockReturnValueOnce(new Subject<any>());
    f.network.next('testnet4'); expect(f.source.observed).toBe(false);
    expect(f.component.chartInstance.clear).toHaveBeenCalled(); expect(f.component.chartOptions).toEqual({});
    if (kind === 'capacity' || kind === 'networks') expect(f.component.chartData).toBeUndefined();
    f.subscription.unsubscribe(); f.component.ngOnDestroy?.();
  });
  it('tears down pending source observers when destroyed', () => {
    const f = setup(kind); f.component.ngOnDestroy?.(); expect(f.source.observed).toBe(false); f.subscription.unsubscribe();
  });
  it('does not clear a renderer already disposed by an earlier pending or failed view', () => {
    const f = setup(kind); f.component.chartInstance.isDisposed = () => true;
    f.network.next('testnet4'); expect(f.component.chartInstance.clear).not.toHaveBeenCalled();
    f.subscription.unsubscribe(); f.component.ngOnDestroy();
  });
  it('accepts the new renderer after a view remount and installs its handlers once', () => {
    const f = setup(kind), renderer = { on: vi.fn(), getZr: () => ({ on: vi.fn() }) };
    f.component.onChartInit(renderer); f.component.onChartInit(renderer);
    expect(f.component.chartInstance).toBe(renderer);
    const registrations = renderer.on.mock.calls.map(call => call[0]); expect(new Set(registrations).size).toBe(registrations.length);
    f.component.ngOnDestroy(); const late = { on: vi.fn(), getZr: () => ({ on: vi.fn() }) };
    f.component.onChartInit(late); expect(f.component.chartInstance).toBe(renderer); f.subscription.unsubscribe();
  });
  it('retains scope after a provider error and recovers only on explicit retry', () => {
    const f = setup(kind); f.source.error({ status: 503 }); expect(f.failed).not.toHaveBeenCalled();
    expect(f.component.loadError).toContain('unavailable');
    for (const name of ['cachedRequest', 'getNodesPerIsp', 'getChannelsGeo$']) f.api[name].mockReturnValueOnce(of(f.value()));
    f.component.retry(); vi.advanceTimersByTime(101); expect(f.component.loadError).toBeNull();
    expect(f.component.prepareChartOptions).toHaveBeenCalledOnce(); f.subscription.unsubscribe(); f.component.ngOnDestroy();
  });
  it('cancels the previous control scope and ignores its late value', () => {
    const f = setup(kind), replacement = new Subject<any>();
    for (const name of ['cachedRequest', 'getNodesPerIsp', 'getChannelsGeo$']) f.api[name].mockReturnValueOnce(replacement);
    if (kind === 'capacity' || kind === 'networks') f.component.radioGroupForm.get('dateSpan').setValue('1w');
    else if (kind === 'isp') f.component.sortBySubject.next(false);
    else f.params.next(convertToParamMap({ public_key: '02' + 'a'.repeat(64) }));
    expect(f.source.observed).toBe(false); vi.advanceTimersByTime(101);
    f.source.next(f.value()); expect(f.component.prepareChartOptions).not.toHaveBeenCalled();
    replacement.next(f.value()); replacement.complete(); expect(f.component.prepareChartOptions).toHaveBeenCalledOnce();
    if (kind === 'capacity') expect(f.component.chartData.capacity).toEqual([[123000, 100000]]);
    if (kind === 'networks') expect(f.component.chartData.clearnet_nodes).toEqual([[123000, 2]]);
    if (kind === 'isp') expect(f.component.sortBy).toBe('node-count');
    f.subscription.unsubscribe(); f.component.ngOnDestroy();
  });
  it('bounds a hanging source and blocks retries or context changes after teardown', () => {
    const f = setup(kind); vi.advanceTimersByTime(15001);
    expect(f.source.observed).toBe(false); expect(f.component.isLoading).toBe(false); expect(f.component.loadError).toContain('unavailable');
    f.component.ngOnDestroy();
    const requests = Object.values(f.api).map(fn => fn.mock.calls.length);
    f.component.retry(); f.network.next('testnet'); vi.advanceTimersByTime(101);
    expect(Object.values(f.api).map(fn => fn.mock.calls.length)).toEqual(requests); f.subscription.unsubscribe();
  });
  if (kind !== 'map') it('does not export a missing or cleared chart while pending, unavailable or destroyed', () => {
    const f = setup(kind); expect(() => f.component.onSaveChart()).not.toThrow();
    f.source.error({ status: 503 }); expect(() => f.component.onSaveChart()).not.toThrow();
    f.component.ngOnDestroy(); expect(() => f.component.onSaveChart()).not.toThrow(); f.subscription.unsubscribe();
  });
});
