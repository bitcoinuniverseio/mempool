// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ArkDashboardComponent } from './ark-dashboard.component';

describe('Ark native operator evidence rendering', () => {
  beforeAll(() => {
    Object.defineProperty(ArkDashboardComponent, 'ctorParameters', {configurable: true, value: () => [
      {type: UniverseApiService}, {type: SeoService}, {type: StateService},
    ]});
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());
  const render = (metrics: Record<string, unknown>, batchUnavailable = false) => {
    TestBed.overrideComponent(ArkDashboardComponent, {set: {
      template: readFileSync('src/app/universe/ark/ark-dashboard.component.html', 'utf8'),
      templateUrl: undefined, styles: [], styleUrls: [],
    }});
    TestBed.configureTestingModule({providers: [provideRouter([]),
      {provide: UniverseApiService, useValue: {
        getArkOperators$: () => of({operators: [{id: 'owned-asp', name: 'Owned native ASP', aspPubkey: 'public', status: 'observed', ...metrics}]}),
        getArkBatches$: () => batchUnavailable ? throwError(() => ({status: 503, error: {error: 'Native batch projection unavailable'}})) : of({batches: []}),
      }}, {provide: SeoService, useValue: {setTitle: vi.fn()}},
      {provide: StateService, useValue: {network: 'signet', networkChanged$: new Subject(), env: {ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool'}}},
    ]});
    const fixture = TestBed.createComponent(ArkDashboardComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  it('renders four unavailable operator metrics as Unknown while keeping native session duration separate', () => {
    const element = render({activeVtxoCount: null, currentBatchHeight: null, totalVolumeSats: null, roundIntervalSec: null,
      providerVersion: 'v0.9.16', sessionDurationSeconds: '120'});
    const text = element.textContent;
    expect(text.match(/Unknown/g)).toHaveLength(4);
    expect(text).toContain('Session duration: 120 seconds');
    expect(text).toContain('Provider version: v0.9.16');
    expect(text).toContain('OBSERVED');
    expect(text).not.toContain('ONLINE');
    expect(text).not.toContain('0 BTC');
    expect(text).not.toContain('null');
    expect(text).not.toContain('NaN');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it('preserves genuine zero evidence and exact large atomic volume without floating point rounding', () => {
    const text = render({activeVtxoCount: 0, currentBatchHeight: 0, totalVolumeSats: '9007199254740993', roundIntervalSec: 0}).textContent;
    expect(text).not.toContain('Unknown');
    expect(text).toContain('Cadence: 0 seconds');
    expect(text).toContain('#0');
    expect(text).toContain('90,071,992.54740993 BTC');
    expect(text).toContain('9007199254740993 sats');
    expect(text).not.toContain('Session duration:');
  });
  it('retains observed operator facts with a distinct unavailable batch warning instead of an empty directory', () => {
    const element = render({activeVtxoCount: null, currentBatchHeight: null, totalVolumeSats: null, roundIntervalSec: null,
      providerVersion: 'v0.9.16', sessionDurationSeconds: '120'}, true);
    expect(element.textContent).toContain('Owned native ASP');
    expect(element.textContent).toContain('OBSERVED');
    expect(element.textContent).toContain('Session duration: 120 seconds');
    expect(element.querySelector('[role="alert"]').textContent).toContain('Batch directory unavailable: Native batch projection unavailable');
    expect(element.textContent).toContain('do not establish batch or VTXO availability');
    expect(element.textContent).not.toContain('Ark Provider Unavailable');
    expect(element.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
