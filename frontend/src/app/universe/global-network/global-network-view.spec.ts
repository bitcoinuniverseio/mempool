// @vitest-environment jsdom
import 'zone.js';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { GlobalNetworkApiService } from './global-network.service';
import { GlobalNetworkSeedsComponent } from './global-network-seeds.component';
import { GlobalNetworkSnapshotsComponent } from './global-network-snapshots.component';
import { GlobalNetworkNodesComponent } from './global-network-nodes.component';

const seed = { seed_id: 'controlled-seed', hostname: 'seed.example.org', maintainer: 'chainparams', active: null,
  last_query_at: '2026-10-05T00:00:00.000Z', discovered_addrs_count: null, reachable_ratio: null, error: 'Controlled DNS unavailable' };
const configured = { configured_network: 'signet', scope: 'Configured DNS queries only; discovered peers are not probed.' };

describe('Actual Global templates with controlled producer-shaped envelopes', () => {
  beforeAll(() => {
    for (const component of [GlobalNetworkSeedsComponent, GlobalNetworkSnapshotsComponent, GlobalNetworkNodesComponent]) {
      Object.defineProperty(component, 'ctorParameters', { configurable: true,
        value: () => [{ type: GlobalNetworkApiService }, { type: ChangeDetectorRef }, { type: StateService }] });
    }
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the actual DNS wrapper rows, unknown values, scope and selected-context links', () => {
    const state = { isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool' }, networkChanged$: new BehaviorSubject('') };
    const http = { get: vi.fn().mockReturnValue(of({ ...configured, seeds: [seed], total: 1 })) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state },
      { provide: GlobalNetworkApiService, useValue: new GlobalNetworkApiService(http as any, state as any) }] });
    const fixture = TestBed.createComponent(GlobalNetworkSeedsComponent); fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain(seed.hostname); expect(text).toContain('Unknown'); expect(text).toContain('not probed');
    expect(text).toContain(configured.scope); expect(text).toContain('does not attest an independently observed node identity');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(http.get).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('a[href="/network/global/nodes"]')).toBeTruthy(); fixture.destroy();
  });

  it('clears DNS rows and metadata during replacement, fences late old replies, then recovers via the actual retry button', () => {
    const changes = new BehaviorSubject(''), pending = new Subject(), recovery = new Subject();
    const state = { isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool' }, networkChanged$: changes };
    const http = { get: vi.fn().mockReturnValueOnce(of({ ...configured, seeds: [seed], total: 1 }))
      .mockReturnValueOnce(pending).mockReturnValueOnce(recovery) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state },
      { provide: GlobalNetworkApiService, useValue: new GlobalNetworkApiService(http as any, state as any) }] });
    const fixture = TestBed.createComponent(GlobalNetworkSeedsComponent); fixture.detectChanges();
    state.network = 'testnet4'; changes.next('testnet4'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(seed.hostname);
    expect(fixture.nativeElement.textContent).not.toContain(configured.scope);
    pending.next({ ...configured, seeds: [seed], total: 1 }); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain(seed.hostname);
    const retry = [...fixture.nativeElement.querySelectorAll('button')].find((button: any) => button.textContent.includes('Retry')) as HTMLButtonElement;
    retry.click(); fixture.detectChanges();
    expect(pending.observed).toBe(false);
    recovery.next({ ...configured, configured_network: 'testnet4', seeds: [seed], total: 1 }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(seed.hostname);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    fixture.destroy(); expect(recovery.observed).toBe(false);
  });

  it('displays a retained foreign-network snapshot with its original scope rather than relabeling it', () => {
    const state = { isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool' }, networkChanged$: new BehaviorSubject('') };
    const snapshot = { snapshot_id: 'controlled-retained-testnet', network: 'testnet', block_height: 7,
      timestamp_utc: '2026-10-05T00:00:00.000Z', total_nodes: 0, v2_percentage: null,
      top_asns: [], top_clients: [], geo_distribution: [], scope: 'Peers connected to the owned node' };
    const http = { get: vi.fn().mockReturnValue(of({ ...configured, snapshots: [snapshot], total: 1 })) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state },
      { provide: GlobalNetworkApiService, useValue: new GlobalNetworkApiService(http as any, state as any) }] });
    const fixture = TestBed.createComponent(GlobalNetworkSnapshotsComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Configured network signet');
    expect(fixture.nativeElement.textContent).toContain('testnet — Peers connected to the owned node');
    expect(fixture.nativeElement.textContent).toContain('Unknown'); fixture.destroy();
  });

  it('never labels an unavailable source as an empty peer result, then shows genuine empty on recovery', () => {
    const state = { isBrowser: true, network: '', env: { ROOT_NETWORK: 'signet', BASE_MODULE: 'mempool' }, networkChanged$: new BehaviorSubject('') };
    const context = { chain_network: 'signet', genesis_hash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
      observed_at_utc: '2026-10-05T00:00:00.000Z', age_ms: 0, freshness_limit_ms: 30000, scope: 'Owned connected peers only' };
    const http = { get: vi.fn().mockReturnValueOnce(throwError(() => Error('Controlled source unavailable')))
      .mockReturnValueOnce(of({ ...context, nodes: [], total: 0 })) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state },
      { provide: GlobalNetworkApiService, useValue: new GlobalNetworkApiService(http as any, state as any) }] });
    const fixture = TestBed.createComponent(GlobalNetworkNodesComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('No nodes matched');
    const retry = [...fixture.nativeElement.querySelectorAll('button')].find((button: any) => button.textContent.includes('Retry')) as HTMLButtonElement;
    retry.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No nodes matched'); fixture.destroy();
  });
});
