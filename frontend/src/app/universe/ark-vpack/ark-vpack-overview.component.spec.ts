// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ArkVpackOverviewComponent } from './ark-vpack-overview.component';
import { ArkVpackApiService } from './ark-vpack.service';

describe('Ark V-PACK implementation response contract', () => {
  beforeAll(() => {
    Object.defineProperty(ArkVpackOverviewComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: ArkVpackApiService }, { type: ChangeDetectorRef }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  const implementation = { implementation_id: 'arkade', implementation_name: 'Arkade', implementation_revision: '0.4.2',
    supported_vpack_versions: ['v0.1.0-mvv'], dialect_features: { native_extensions_supported: [],
      fee_anchor_type: 'ephemeral_anchor_v3', taproot_tree_style: 'standard_bip341_taptree' } };

  function render(supported_implementations: unknown) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ArkVpackApiService, useValue: {
      getOverview$: () => of({ total_vpack_versions: 1, active_providers_count: 0, recent_verified_anchors: 0,
        supported_implementations, providers: [], active_versions: ['v0.1.0-mvv'] }),
    } }] });
    const view = TestBed.createComponent(ArkVpackOverviewComponent);
    view.detectChanges();
    return view;
  }

  it('renders backend implementation objects with their reported versions', () => {
    const view = render([implementation]);
    expect(view.nativeElement.textContent).toContain('Arkade');
    expect(view.nativeElement.textContent).toContain('Supported V-PACK versions: v0.1.0-mvv');
    expect(view.componentInstance.loadError).toBeNull();
  });

  it.each([{ supported: ['arkd'] }, { supported: [null] },
    { supported: [{ ...implementation, supported_vpack_versions: 'v1' }] },
    { supported: [{ ...implementation, supported_vpack_versions: [42] }] }, { supported: null }])(
    'rejects malformed implementation data instead of presenting a healthy overview: $supported', ({ supported }) => {
      const view = render(supported);
      expect(view.componentInstance.overview).toBeNull();
      expect(view.nativeElement.querySelector('[role="alert"]').textContent).toContain('malformed');
      expect(view.nativeElement.textContent).not.toContain('0 Active ASPs');
    });
});
