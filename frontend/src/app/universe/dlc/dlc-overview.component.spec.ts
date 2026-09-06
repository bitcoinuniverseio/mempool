// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DlcOverviewComponent } from './dlc-overview.component';
import { DlcApiService } from './dlc.service';

describe('DLC overview response contract', () => {
  beforeAll(() => {
    Object.defineProperty(DlcOverviewComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: DlcApiService }, { type: ChangeDetectorRef }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function render(event: Record<string, unknown>) {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: DlcApiService, useValue: {
      getOverview$: () => of({ total_oracles: 5, healthy_oracles: 3, active_events: 7,
        total_attestations: 2, verified_conflicts: 0, recent_attestations: [], active_conflicts: [],
        recent_events: [{ event_id: 'event-1', oracle_id: 'oracle-1', maturity_formatted: '2026-09-06', ...event }] }),
    } }] });
    const view = TestBed.createComponent(DlcOverviewComponent);
    view.detectChanges();
    return view.nativeElement as HTMLElement;
  }

  it('renders the backend descriptor type and counts without inventing revision coverage', () => {
    const page = render({ event_descriptor: { type: 'numeric' }, verified: false });
    expect(page.querySelector('tbody tr')?.textContent).toContain('numeric');
    expect(page.textContent).toContain('3 currently healthy');
    expect(page.textContent).toContain('Not verified');
    expect(page.textContent).toContain('Supported revisions not reported');
  });

  it.each([undefined, null, 'numeric', { descriptor_type: 'numeric' }, { type: 'unexpected' }])(
    'shows a missing or unsupported descriptor honestly: %j', event_descriptor => {
      const page = render({ event_descriptor });
      const cells = page.querySelectorAll('tbody tr td');
      expect(cells[2].textContent).toContain('Not reported');
      expect(cells[4].textContent).toContain('Not reported');
    });
});
