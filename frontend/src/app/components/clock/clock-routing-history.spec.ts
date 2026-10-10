// @vitest-environment jsdom
import 'zone.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef, Pipe, PipeTransform, inject, ɵresolveComponentResources } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, NavigationEnd, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, filter, firstValueFrom, take } from 'rxjs';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClockComponent } from './clock.component';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Pipe({ name: 'bytes', standalone: true })
class BytesPipe implements PipeTransform {
  transform(value: number): string { return String(value); }
}
@Component({ standalone: true, template: '' })
class EmptyPage {}
@Component({ standalone: true, imports: [CommonModule, BytesPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: readFileSync('src/app/components/clock/clock.component.html', 'utf8') })
class RoutedClock extends ClockComponent {
  constructor() {
    const state = { network: 'signet', env: { BASE_MODULE: 'mempool', ROOT_NETWORK: 'mainnet', BLOCK_WEIGHT_UNITS: 4000000, MEMPOOL_BLOCKS_AMOUNT: 8 },
      blocks$: new BehaviorSubject(Array.from({ length: 16 }, (_, index) => ({ height: 325661 - index, size: 100, tx_count: 2, weight: 400000 }))),
      feeEstimate$: new BehaviorSubject({ status: 'syncing', values: null }), mempoolInfo$: new BehaviorSubject({ usage: 1, size: 1 }) };
    super(state as never, { want: () => undefined } as never, inject(ActivatedRoute), inject(Router), new RelativeUrlPipe(state as never), inject(ChangeDetectorRef));
  }
  ngOnDestroy(): void { super.ngOnDestroy(); }
}

describe('actual Clock controller/template with Angular route history', () => {
  beforeAll(async () => {
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
    await ɵresolveComponentResources(url => Promise.resolve(url.endsWith('.html')
      ? readFileSync('src/app/components/clock/clock.component.html', 'utf8') : ''));
  });
  afterEach(() => TestBed.resetTestingModule());
  async function setup(): Promise<RouterTestingHarness> {
    TestBed.configureTestingModule({ providers: [provideRouter([
      { path: 'signet/clock/:mode/:index', component: RoutedClock },
      { path: 'signet', component: EmptyPage }, { path: 'tail', component: EmptyPage },
    ]), provideLocationMocks()] });
    // The harness creates a fixture rather than bootstrapping the application;
    // install the real Router's popstate listener before exercising history.
    TestBed.inject(Router).setUpLocationChangeListener();
    return RouterTestingHarness.create('/signet');
  }
  async function navigate(harness: RouterTestingHarness, url: string): Promise<void> {
    await TestBed.inject(Router).navigateByUrl(url);
    await harness.fixture.whenStable(); harness.detectChanges();
  }
  async function history(harness: RouterTestingHarness, direction: 'back' | 'forward'): Promise<void> {
    const completed = firstValueFrom(TestBed.inject(Router).events.pipe(filter(event => event instanceof NavigationEnd), take(1)));
    TestBed.inject(Location)[direction]();
    await completed; await harness.fixture.whenStable(); harness.detectChanges();
  }
  it('replaces the offered block alias while preserving Signet/query/fragment and forward entries', async () => {
    const harness = await setup(); const router = TestBed.inject(Router);
    await navigate(harness, '/signet/clock/block/0?stats=false#clock');
    expect(router.url).toBe('/signet/clock/mined/0?stats=false#clock');
    expect(harness.routeNativeElement.querySelector('.block-height').textContent).toBe('325661');
    await navigate(harness, '/tail');
    await history(harness, 'back'); expect(router.url).toBe('/signet/clock/mined/0?stats=false#clock');
    await history(harness, 'back'); expect(router.url).toBe('/signet');
    await history(harness, 'forward'); expect(router.url).toBe('/signet/clock/mined/0?stats=false#clock');
    await history(harness, 'forward'); expect(router.url).toBe('/tail');
  });
  it.each(['-1', 'not-a-number', '1.5', '1suffix', '9007199254740992'])('normalizes invalid index %s to safe zero without retaining a bad history entry', async index => {
    const harness = await setup();
    await navigate(harness, '/signet/clock/mined/' + index);
    expect(TestBed.inject(Router).url).toBe('/signet/clock/mined/0');
    expect((harness.routeDebugElement.componentInstance as RoutedClock).blockIndex).toBe(0);
    await history(harness, 'back'); expect(TestBed.inject(Router).url).toBe('/signet');
  });
  it('retains supported indices and states positive out-of-window requests without inventing block zero', async () => {
    const harness = await setup();
    await navigate(harness, '/signet/clock/mined/15');
    expect(harness.routeNativeElement.querySelector('.block-height').textContent).toBe('325646');
    await navigate(harness, '/signet/clock/mined/999');
    expect(TestBed.inject(Router).url).toBe('/signet/clock/mined/999');
    expect((harness.routeDebugElement.componentInstance as RoutedClock).blockIndex).toBe(999);
    expect(harness.routeNativeElement.textContent).toContain('outside the available Clock window');
    expect(harness.routeNativeElement.querySelector('.block-height')).toBeNull();
    expect(harness.routeNativeElement.querySelector('.stats.bottom.left')).toBeNull();
    await navigate(harness, '/signet/clock/mempool/7');
    expect(harness.routeNativeElement.querySelector('app-mempool-block-overview')).not.toBeNull();
    expect((harness.routeNativeElement.querySelector('app-mempool-block-overview') as unknown as { index: number }).index).toBe(7);
    await navigate(harness, '/signet/clock/mempool/8');
    expect(harness.routeNativeElement.querySelector('app-mempool-block-overview')).toBeNull();
    expect(harness.routeNativeElement.textContent).toContain('outside the available Clock window');
    // A configured larger window stays supported; we do not impose a new eight-block cap.
    (harness.routeDebugElement.componentInstance as RoutedClock).stateService.env.MEMPOOL_BLOCKS_AMOUNT = 12;
    await navigate(harness, '/signet/clock/mempool/11');
    expect((harness.routeNativeElement.querySelector('app-mempool-block-overview') as unknown as { index: number }).index).toBe(11);
  });
});
