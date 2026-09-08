import { readFileSync } from 'node:fs';
import { convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { ArkDashboardComponent } from '@app/universe/ark/ark-dashboard.component';
import { DataStudioComponent } from '@app/universe/data-studio/data-studio.component';
import { Cat20CenterComponent } from '@app/universe/fractal/cat20-center.component';
import { FractalDashboardComponent } from '@app/universe/fractal/fractal-dashboard.component';
import { L2ObservatoryComponent } from '@app/universe/l2-observatory/l2-observatory.component';
import { LiquidObservatoryComponent } from '@app/universe/liquid-observatory/liquid-observatory.component';
import { NetworkObservatoryComponent } from '@app/universe/network-observatory/network-observatory.component';
import { StratumV2Component } from '@app/universe/stratum-v2/stratum-v2.component';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UtxoSetComponent } from '@app/universe/utxo-set/utxo-set.component';
import { WildkinBloodlinesComponent } from '@app/universe/wildkin/wildkin-bloodlines.component';

type ProductState = { readonly kind: string };
type ProductComponent = {
  readonly vm$: Observable<ProductState>;
  ngOnInit(): void;
};

function unavailableApi(): UniverseApiService {
  return new Proxy(
    {},
    {
      get: () => () => throwError(() => new Error('provider unavailable')),
    }
  ) as UniverseApiService;
}

function seo(): SeoService {
  return { setTitle: () => undefined } as unknown as SeoService;
}

function stateAfterInit(component: ProductComponent): string {
  let current = '';
  component.vm$.subscribe((state) => {
    current = state.kind;
  });
  component.ngOnInit();
  return current;
}

describe('first-party product failure states', () => {
  it.each([
    [
      'Ark',
      (): ProductComponent =>
        new ArkDashboardComponent(unavailableApi(), seo()),
    ],
    [
      'Fractal',
      (): ProductComponent =>
        new FractalDashboardComponent(unavailableApi(), seo()),
    ],
    [
      'Layer 2',
      (): ProductComponent =>
        new L2ObservatoryComponent(unavailableApi(), seo()),
    ],
    [
      'Liquid',
      (): ProductComponent =>
        new LiquidObservatoryComponent(unavailableApi(), seo()),
    ],
    [
      'Network',
      (): ProductComponent =>
        new NetworkObservatoryComponent(unavailableApi(), seo()),
    ],
    [
      'Stratum V2',
      (): ProductComponent => new StratumV2Component(unavailableApi(), seo()),
    ],
    [
      'UTXO intelligence',
      (): ProductComponent => new UtxoSetComponent(unavailableApi(), seo()),
    ],
    [
      'Wildkin bloodlines',
      (): ProductComponent =>
        new WildkinBloodlinesComponent(unavailableApi(), seo()),
    ],
  ])(
    '%s reports an error instead of an empty successful view',
    (_name, create): void => {
      expect(stateAfterInit(create())).toBe('error');
    }
  );

  it('treats a CAT-20 holder failure as an error instead of zero holders', () => {
    const api = {
      getCat20Token$: () => of({ tokenId: 'cat20-token' }),
      getCat20Holders$: () =>
        throwError(() => new Error('provider unavailable')),
    } as unknown as UniverseApiService;
    const route = {
      paramMap: of(convertToParamMap({ tokenId: 'cat20-token' })),
    };
    const subject = new Cat20CenterComponent(api, route as never, seo());

    expect(stateAfterInit(subject)).toBe('error');
  });

  it('exposes a Data Studio query failure instead of an empty result', () => {
    const api = {
      getDataCatalog$: () =>
        of({
          datasets: [
            { id: 'bitcoin.blocks', name: 'Blocks', category: 'Bitcoin' },
          ],
          streams: [],
          mcpTools: [],
        }),
      executeDataQuery$: () =>
        throwError(() => new Error('provider unavailable')),
    } as unknown as UniverseApiService;
    const subject = new DataStudioComponent(api, seo());
    let latest:
      { readonly kind: string; readonly queryError?: boolean } | undefined;
    subject.vm$.subscribe((state) => {
      latest = state;
    });

    subject.ngOnInit();

    expect(latest?.kind).toBe('ready');
    expect(latest?.queryError).toBe(true);
  });

  it('loads the Fractal block at the reported tip height', () => {
    const getFractalBlock$ = vi.fn(() => of({ height: 912345 }));
    const api = {
      getFractalTip$: () =>
        of({ height: 912345, hash: 'tip', time: 1, network: 'mainnet' }),
      getFractalMempool$: () => of({ count: 0 }),
      getFractalBlock$,
    } as unknown as UniverseApiService;
    const subject = new FractalDashboardComponent(api, seo());

    expect(stateAfterInit(subject)).toBe('ready');
    expect(getFractalBlock$).toHaveBeenCalledWith('912345');
  });

  it('attributes Wildkin counts to the provider without claiming independent verification', () => {
    const template = readFileSync(
      new URL('./wildkin/wildkin.component.html', import.meta.url),
      'utf8'
    );

    expect(template).toContain('Reported by the Wildkin authority');
    expect(template).not.toContain('Inscription-verified');
  });
});
