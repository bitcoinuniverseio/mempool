// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StatechainOperatorDetailComponent } from './statechain-operator-detail.component';
import { OffchainApiService } from './offchain.service';

describe('statechain operator detail response contract', () => {
  beforeAll(() => {
    Object.defineProperty(StatechainOperatorDetailComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: ActivatedRoute }, { type: OffchainApiService }, { type: ChangeDetectorRef }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function render(overrides: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ operatorId: 'operator-1' }) } } },
      { provide: OffchainApiService, useValue: { getOperatorById$: () => of({
        operator_id: 'operator-1', display_name: 'Operator One', protocol: 'mercury_statechain',
        operator_public_key: '02' + '11'.repeat(32), networks: ['bitcoin'],
        endpoints: { clearnet: 'https://operator.example.test', tor_onion: 'http://example.onion' },
        supported_versions: ['v1', 'v2'], transfer_capabilities: [], recovery_capabilities: [],
        health: 'degraded', effective_from: '2026-09-01', expires_at: '2027-09-01',
        provenance: { registered_in_knowledge_registry: false, verified_signature: false }, ...overrides,
      }) } },
    ] });
    const view = TestBed.createComponent(StatechainOperatorDetailComponent);
    view.detectChanges();
    return view.nativeElement as HTMLElement;
  }

  it('renders backend endpoints while leaving absent terms unreported', () => {
    const page = render();
    expect(page.textContent).toContain('https://operator.example.test');
    expect(page.textContent).toContain('http://example.onion');
    expect(page.textContent).toContain('v1, v2');
    for (const label of ['Service Fee', 'Minimum Deposit', 'Maximum Deposit']) {
      const value = [...page.querySelectorAll('.p-3')].find(card => card.textContent?.includes(label));
      expect(value?.textContent).toContain('Not reported');
      expect(value?.textContent).not.toMatch(/NaN|0%|0 sat/);
    }
  });

  it.each([{}, { endpoints: null, supported_versions: null }, { endpoints: ['https://legacy.example'], supported_versions: 'v1' }])(
    'does not crash or invent values for missing or malformed optional observations: %j', overrides => {
      const page = render({ endpoints: undefined, supported_versions: undefined, ...overrides });
      expect(page.textContent).toContain('Not reported');
      expect(page.textContent).not.toContain('NaN');
    });
});
