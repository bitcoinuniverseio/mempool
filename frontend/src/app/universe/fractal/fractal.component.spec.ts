import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { Cat20CenterComponent } from './cat20-center.component';
import { FractalDashboardComponent } from './fractal-dashboard.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));
const seo = { setTitle: vi.fn() } as unknown as SeoService;

function observe<T>(view: { ngOnInit(): void; vm$: { subscribe(next: (value: T) => void): { unsubscribe(): void } } }): T {
  view.ngOnInit();
  let observed!: T;
  view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
  return observed;
}

describe('Fractal pages on an absent source', () => {
  it('shows the dashboard error state with the reason when the node read fails', () => {
    const api = { getFractalTip$: unavailable, getFractalMempool$: unavailable, getFractalBlock$: unavailable } as unknown as UniverseApiService;
    const vm = observe<any>(new FractalDashboardComponent(api, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.tip).toBeUndefined();
  });

  it('reads the latest block at the reported tip rather than a fixed height', () => {
    const getFractalBlock$ = vi.fn(() => of({ height: 12, hash: 'h' }));
    const api = {
      getFractalTip$: () => of({ height: 12, hash: 'h', time: 0, network: 'fractal-mainnet' }),
      getFractalMempool$: () => of({ count: 0 }),
      getFractalBlock$,
    } as unknown as UniverseApiService;
    const vm = observe<any>(new FractalDashboardComponent(api, seo));
    expect(vm.kind).toBe('ready');
    expect(getFractalBlock$).toHaveBeenCalledWith('12');
  });

  it('shows the CAT-20 error state rather than an empty directory when the indexer read fails', () => {
    const api = { getCat20Tokens$: unavailable } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({})) } as unknown as ActivatedRoute;
    const vm = observe<any>(new Cat20CenterComponent(api, route, seo));
    expect(vm.kind).toBe('error');
    expect(vm.message).toBeTruthy();
    expect(vm.tokens).toBeUndefined();
  });

  it('does not show a token over an empty holder table when only the holder read fails', () => {
    const api = {
      getCat20Token$: () => of({ tokenId: 'token-1', holderCount: 3 }),
      getCat20Holders$: unavailable,
    } as unknown as UniverseApiService;
    const route = { paramMap: of(convertToParamMap({ tokenId: 'token-1' })) } as unknown as ActivatedRoute;
    const vm = observe<any>(new Cat20CenterComponent(api, route, seo));
    expect(vm.kind).toBe('error');
    expect(vm.holders).toBeUndefined();
  });
});
