import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { DataLiveStreamComponent } from './data-live-stream.component';
import { DataStudioComponent } from './data-studio.component';

const unavailable = (stage: string) => () => throwError(() => new HttpErrorResponse({
  status: 503, error: { stage, error: 'not connected' },
}));
const seo = { setTitle: vi.fn() } as unknown as SeoService;

function last<T>(component: { vm$: { subscribe: (next: (value: T) => void) => unknown } }): T {
  let value!: T;
  component.vm$.subscribe((next) => { value = next; });
  return value;
}

describe('Data Studio pages when the export service is absent', () => {
  it('reports the absent catalog with the failure message', () => {
    const api = { getDataCatalog$: unavailable('unavailable-data-catalog') } as unknown as UniverseApiService;
    const component = new DataStudioComponent(api, seo);
    component.ngOnInit();
    expect(last<{ kind: string; message?: string }>(component)).toMatchObject({ kind: 'error' });
    expect(last<{ message?: string }>(component).message).toContain('unavailable');
  });

  it('reports a query the engine did not answer instead of dropping it silently', () => {
    const catalog = { datasets: [{ id: 'bitcoin.blocks', name: 'Blocks', fields: [] }], streams: [], mcpTools: [] };
    const api = {
      getDataCatalog$: () => of(catalog),
      executeDataQuery$: unavailable('unavailable-query-engine'),
    } as unknown as UniverseApiService;
    const component = new DataStudioComponent(api, seo);
    component.ngOnInit();
    const vm = last<{ kind: string; executing?: boolean; queryResult?: unknown; queryError?: string }>(component);
    expect(vm.kind).toBe('ready');
    expect(vm.executing).toBe(false);
    expect(vm.queryResult).toBeUndefined();
    expect(vm.queryError).toContain('unavailable');
  });

  it('shows the live stream error state rather than an empty registry', () => {
    const api = { getDataCatalog$: unavailable('unavailable-data-catalog') } as unknown as UniverseApiService;
    const component = new DataLiveStreamComponent(api, seo);
    component.ngOnInit();
    expect(last<{ kind: string; message?: string }>(component)).toMatchObject({ kind: 'error' });
    expect(last<{ message?: string }>(component).message).toContain('unavailable');
  });
});
