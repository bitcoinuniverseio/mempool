// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ArkProvidersComponent } from './ark-providers.component';
import { ArkVpackApiService } from './ark-vpack.service';

describe('Ark provider evidence', () => {
  beforeAll(() => {
    Object.defineProperty(ArkProvidersComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: ArkVpackApiService }, { type: ChangeDetectorRef }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());
  function render(api: any) {
    TestBed.configureTestingModule({providers: [provideRouter([]), {provide: ArkVpackApiService, useValue: api}]});
    const view = TestBed.createComponent(ArkProvidersComponent); view.detectChanges(); return view;
  }
  it('shows missing registry observations without inventing providers', () => {
    const view = render({networkChanges$: of('signet'), getProviders$: () => of([])});
    expect(view.nativeElement.textContent).toContain('No independently registered');
    expect(view.nativeElement.textContent).not.toContain('PGP Verified');
  });
  it('does not authenticate an untrusted signature or unobserved health', () => {
    const view = render({networkChanges$: of('signet'), getProviders$: () => of([
      {provider_id:'p', name:'Provider', network:'signet', signature_verified:true, signer_trusted:false, health_status:'online'}])});
    expect(view.nativeElement.textContent).toContain('Manifest not authenticated');
    expect(view.nativeElement.textContent).toContain('UNOBSERVED');
    expect(view.nativeElement.textContent).toContain('Unknown');
  });
  it('rejects malformed evidence', () => {
    const view = render({networkChanges$: of('signet'), getProviders$: () => of([null])});
    expect(view.nativeElement.textContent).toContain('invalid evidence');
  });
  it('cancels obsolete network reads and destroys both subscriptions', () => {
    const network = new BehaviorSubject('signet'); const first = new Subject<any>(); const second = new Subject<any>(); let calls = 0;
    const view = render({networkChanges$: network, getProviders$: () => ++calls === 1 ? first : second});
    network.next('testnet');
    expect(first.observed).toBe(false);
    first.next([{provider_id:'old',name:'Old',network:'signet'}]);
    expect(view.componentInstance.providers).toEqual([]);
    second.next([]); view.detectChanges(); expect(view.componentInstance.loading).toBe(false);
    view.destroy(); expect(network.observed).toBe(false); expect(second.observed).toBe(false);
  });
});
