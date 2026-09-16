import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { WildkinBloodlinesComponent } from './wildkin-bloodlines.component';
import { WildkinCreaturesComponent } from './wildkin-creatures.component';
import { WildkinComponent } from './wildkin.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));
const seo = { setTitle: vi.fn() } as unknown as SeoService;

function observe<T>(view: { ngOnInit(): void; vm$: { subscribe(next: (value: T) => void): { unsubscribe(): void } } }): T {
  view.ngOnInit();
  let observed!: T;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  return observed;
}

describe('Wildkin pages on an absent source', () => {
  it('shows the overview error state with the reason', () => {
    const api = { getWildkinStatus$: unavailable } as unknown as UniverseApiService;
    const vm = observe<any>(new WildkinComponent(api, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.status).toBeUndefined();
  });

  it('shows the creatures error state with the reason rather than an empty catalog', () => {
    const api = { getWildkinCreatures$: unavailable } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({})) } as unknown as ActivatedRoute;
    const vm = observe<any>(new WildkinCreaturesComponent(api, route, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.creatures).toBeUndefined();
  });

  it('shows the bloodlines error state with the reason rather than an empty braid history', () => {
    const api = { getWildkinBraids$: unavailable } as unknown as UniverseApiService;
    const vm = observe<any>(new WildkinBloodlinesComponent(api, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.braids).toBeUndefined();
  });
});


describe('Wildkin source verdict and route transitions', () => {
  it('distinguishes invalid and missing braid verdicts', () => {
    const page = new WildkinBloodlinesComponent({} as never, seo);
    expect(page.braidVerdict(true)).toBe('Source Reports Valid');
    expect(page.braidVerdict(false)).toBe('Source Reports Invalid');
    expect(page.braidVerdict(undefined)).toBe('Validity Not Reported');
    expect(page.braidVerdict('true')).toBe('Validity Not Reported');
  });
  it('clears old creature immediately and cancels route reads on destroy', () => {
    const paramMap = new Subject<any>(); const response = new Subject<any>();
    const api = { getWildkinCreature$: (id: string) => id === 'first' ? of({ creatureId: 'first' }) : response };
    const page = new WildkinCreaturesComponent(api as never, { paramMap } as never, seo);
    let vm: any; page.vm$.subscribe(value => vm = value); page.ngOnInit();
    paramMap.next(convertToParamMap({ id: 'first' })); expect(vm.kind).toBe('detail');
    paramMap.next(convertToParamMap({ id: 'second' })); expect(vm.kind).toBe('loading'); expect(vm.selected).toBeUndefined();
    expect(response.observed).toBe(true); page.ngOnDestroy(); expect(response.observed).toBe(false);
    expect(paramMap.observed).toBe(false);
  });
});
