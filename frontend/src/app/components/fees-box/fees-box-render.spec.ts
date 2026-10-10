// @vitest-environment jsdom
import 'zone.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef, inject, ɵresolveComponentResources } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { BehaviorSubject } from 'rxjs';
import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FeeEstimateState } from '@app/services/fee-estimate';
import { FeesBoxComponent } from './fees-box.component';

let state: FeeEstimateState;
const reconnect = vi.fn();
@Component({ standalone: true, imports: [CommonModule], schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: readFileSync('src/app/components/fees-box/fees-box.component.html', 'utf8') })
class RenderedFees extends FeesBoxComponent {
  constructor() {
    super({ feeEstimate$: state.snapshot$, liveFeed$: new BehaviorSubject({ status: 'data' }) } as never,
      { themeState$: new BehaviorSubject({ loading: false }), mempoolFeeColors: ['123456', 'abcdef'] } as never,
      inject(ChangeDetectorRef), { reconnectWebsocket: reconnect } as never);
  }
}
describe('actual fee recovery template', () => {
  beforeAll(async () => {
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    await ɵresolveComponentResources(url => Promise.resolve(url.endsWith('.html') ? readFileSync('src/app/components/fees-box/fees-box.component.html', 'utf8') : ''));
  });
  afterEach(() => { TestBed.resetTestingModule(); state.destroy(); vi.useRealTimers(); reconnect.mockReset(); });
  it('ends loading, offers one visible retry, preserves dated stale values and clears them on network switch', () => {
    vi.useFakeTimers(); state = new FeeEstimateState();
    const fixture = TestBed.createComponent(RenderedFees); fixture.detectChanges();
    const view = fixture.nativeElement;
    expect(view.querySelectorAll('.skeleton-loader').length).toBeGreaterThan(0);
    expect(view.querySelector('button').disabled).toBe(true);
    vi.advanceTimersByTime(5000); fixture.detectChanges();
    expect(view.querySelectorAll('.skeleton-loader')).toHaveLength(0);
    expect(view.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(view.querySelector('button').classList.contains('btn-outline-primary')).toBe(true);
    view.querySelector('button').click(); expect(reconnect).toHaveBeenCalledTimes(1);
    state.accept({ schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: 'mainnet', status: 'ready',
      observedAt: new Date().toISOString(), tip: { height: 1, hash: 'a'.repeat(64) }, reason: null,
      values: { fastestFee: 2, halfHourFee: 1.5, hourFee: 1, economyFee: 0.5, minimumFee: 0.1 } });
    fixture.detectChanges(); expect(view.querySelectorAll('app-fee-rate')).toHaveLength(4);
    state.offline(); fixture.detectChanges();
    expect(view.textContent).toContain('out of date'); expect(view.querySelector('time')).not.toBeNull();
    expect(view.querySelectorAll('app-fee-rate')).toHaveLength(4);
    state.reset('signet'); fixture.detectChanges(); expect(view.querySelectorAll('app-fee-rate')).toHaveLength(0);
  });
});
