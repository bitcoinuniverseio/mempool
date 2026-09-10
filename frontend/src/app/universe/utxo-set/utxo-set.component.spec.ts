import { HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UtxoSetComponent } from './utxo-set.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

describe('UTXO-set observatory on an absent source', () => {
  it('shows the error state with the reason rather than empty checkpoint and cohort tables', () => {
    const api = {
      getUtxoCheckpoints$: unavailable, getUtxoDistribution$: unavailable,
      getProtocolBearingUtxos$: unavailable, getUtreexoRoots$: unavailable,
    } as unknown as UniverseApiService;
    const view = new UtxoSetComponent(api, { setTitle: vi.fn() } as unknown as SeoService);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.checkpoints).toBeUndefined();
    expect(observed.scriptTypes).toBeUndefined();
  });
});
