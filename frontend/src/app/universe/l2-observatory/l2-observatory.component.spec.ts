import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Subject, throwError } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { L2ObservatoryComponent } from './l2-observatory.component';

const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

function pendingSource() {
  const systems: Subject<any>[] = [], challenges: Subject<any>[] = [], details: Subject<any>[] = [];
  const api: any = { getL2Systems$: vi.fn(() => { const read = new Subject<any>(); systems.push(read); return read; }),
    getL2Challenges$: vi.fn(() => { const read = new Subject<any>(); challenges.push(read); return read; }),
    getL2System$: vi.fn(() => { const read = new Subject<any>(); details.push(read); return read; }) };
  const state: any = { network: 'signet', env: { ROOT_NETWORK: 'mainnet' }, networkChanged$: new Subject<string>() };
  const params = new BehaviorSubject(convertToParamMap({}));
  const view = new (L2ObservatoryComponent as any)(api, { setTitle: vi.fn() }, state, { paramMap: params });
  let observed: any; const read = view.vm$.subscribe((value: any) => observed = value);
  view.ngOnInit();
  return { view, api, state, params, systems, challenges, details, read, observed: () => observed };
}

describe('L2 selected source ownership', () => {
  it('preserves every supplied atomic reserve digit and keeps unknown or malformed quantities explicit', () => {
    const fixture = pendingSource();
    expect(fixture.view.lockedReserve('1')).toBe('0.00000001 BTC');
    expect(fixture.view.lockedReserve('9007199254740993')).toBe('90071992.54740993 BTC');
    expect(fixture.view.lockedReserve('0')).toBe('0 BTC');
    for (const value of [null, undefined, '01', '-1', '1.5', '18446744073709551616']) { expect(fixture.view.lockedReserve(value)).toBe('Not reported'); }
    fixture.view.ngOnDestroy(); fixture.read.unsubscribe();
  });
  it('clears accepted rows and cancels old source reads immediately when the selected network changes', () => {
    const fixture = pendingSource();
    fixture.systems[0].next({ systems: [{ id: 'old' }] }); fixture.challenges[0].next({ challenges: [] });
    expect(fixture.observed().kind).toBe('ready');
    fixture.state.network = 'regtest'; fixture.state.networkChanged$.next('regtest');
    expect(fixture.observed().kind).toBe('loading'); expect(fixture.observed().systems).toBeUndefined();
    expect(fixture.systems[0].observed).toBe(false); expect(fixture.challenges[0].observed).toBe(false);
    fixture.systems[0].next({ systems: [{ id: 'late-old' }] }); expect(fixture.observed().kind).toBe('loading');
    fixture.view.ngOnDestroy(); fixture.read.unsubscribe();
  });
  it('reads the selected detail and its challenges rather than silently displaying the full directory', () => {
    const fixture = pendingSource(); fixture.params.next(convertToParamMap({ systemId: 'owned/bridge' }));
    expect(fixture.api.getL2System$).toHaveBeenCalledWith('owned/bridge');
    expect(fixture.api.getL2Challenges$).toHaveBeenLastCalledWith('owned/bridge');
    expect(fixture.systems[0].observed).toBe(false);
    fixture.details[0].next({ id: 'owned/bridge' }); fixture.challenges[1].next({ challenges: [] });
    expect(fixture.observed().systems).toEqual([{ id: 'owned/bridge' }]);
    fixture.params.next(convertToParamMap({ systemId: 'another' })); expect(fixture.observed().kind).toBe('loading');
    fixture.view.ngOnDestroy(); fixture.read.unsubscribe();
  });
  it('releases every pending source subscription on destruction', () => {
    const fixture = pendingSource(); fixture.view.ngOnDestroy();
    expect(fixture.systems[0].observed).toBe(false); expect(fixture.challenges[0].observed).toBe(false);
    fixture.read.unsubscribe();
  });
  it('withholds foreign detail and challenge identities, then recovers in a fresh route context', () => {
    const fixture = pendingSource(); fixture.params.next(convertToParamMap({ systemId: 'owned' }));
    fixture.details[0].next({ id: 'foreign' }); expect(fixture.observed().kind).toBe('error');
    fixture.params.next(convertToParamMap({ systemId: 'owned-again' }));
    fixture.details[1].next({ id: 'owned-again' }); fixture.challenges[2].next({ challenges: [{ systemId: 'foreign' }] });
    expect(fixture.observed().kind).toBe('error'); expect(fixture.observed().systems).toBeUndefined();
    fixture.params.next(convertToParamMap({ systemId: 'fresh' }));
    fixture.details[2].next({ id: 'fresh' }); fixture.challenges[3].next({ challenges: [{ systemId: 'fresh' }] });
    expect(fixture.observed().kind).toBe('ready'); expect(fixture.observed().systems).toEqual([{ id: 'fresh' }]);
    fixture.view.ngOnDestroy(); fixture.read.unsubscribe();
  });
});

describe('L2 observatory on an absent source', () => {
  it('shows the error state with the reason rather than empty bridge tables', () => {
    const api = { getL2Systems$: unavailable, getL2Challenges$: unavailable } as unknown as UniverseApiService;
    const view = new L2ObservatoryComponent(api, { setTitle: vi.fn() } as unknown as SeoService);
    view.ngOnInit();
    let observed: any;
    view.vm$.subscribe((value) => { observed = value; }).unsubscribe();
    expect(observed.kind).toBe('error');
    expect(observed.message).toBeTruthy();
    expect(observed.systems).toBeUndefined();
    expect(observed.challenges).toBeUndefined();
  });
});
