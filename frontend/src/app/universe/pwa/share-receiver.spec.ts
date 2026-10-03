// @vitest-environment jsdom
import { createEnvironmentInjector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ShareReceiverComponent } from './share-receiver.component';

function setup(root = '') {
  const network = new BehaviorSubject('signet');
  const query = new BehaviorSubject(convertToParamMap({text: 'a'.repeat(64)}));
  const state = {network: 'signet', networkChanged$: network, env: {ROOT_NETWORK: root, BASE_MODULE: 'mempool'}};
  const router = {navigate: vi.fn(), navigateByUrl: vi.fn()};
  const api = {getBlock$: vi.fn(() => of({})), getTransaction$: vi.fn(() => of({}))};
  const injector = createEnvironmentInjector([
    {provide: PLATFORM_ID, useValue: 'browser'}, {provide: ActivatedRoute, useValue: {queryParamMap: query}},
    {provide: Router, useValue: router}, {provide: StateService, useValue: state},
    {provide: ElectrsApiService, useValue: api},
  ], null as any);
  const component = runInInjectionContext(injector, () => new ShareReceiverComponent());
  return {component, injector, network, state, router, api, query};
}

describe('Shared identifiers retain their selected network', () => {
  it('opens a resolved block on Signet', () => {
    const s = setup(); const sub = s.component.resolution$.subscribe();
    expect(s.router.navigateByUrl).toHaveBeenCalledWith('/signet/block/' + 'a'.repeat(64));
    sub.unsubscribe(); s.injector.destroy();
  });
  it('opens a transaction fallback at an explicitly configured Signet root', () => {
    const s = setup('signet'); s.api.getBlock$.mockReturnValue(throwError(() => new Error('not a block')));
    const sub = s.component.resolution$.subscribe();
    expect(s.router.navigateByUrl).toHaveBeenCalledWith('/tx/' + 'a'.repeat(64));
    sub.unsubscribe(); s.injector.destroy();
  });
  it('prefixes plain heights while preserving explicit same-origin links', () => {
    const s = setup(); s.query.next(convertToParamMap({text: '42'}));
    const sub = s.component.resolution$.subscribe();
    expect(s.router.navigateByUrl).toHaveBeenLastCalledWith('/signet/block/42');
    s.query.next(convertToParamMap({url: window.location.origin + '/testnet4/block/9?mode=full'}));
    expect(s.router.navigateByUrl).toHaveBeenLastCalledWith('/testnet4/block/9?mode=full');
    sub.unsubscribe(); s.injector.destroy();
  });
  it('cancels an unresolved hash on a network change without opening stale data', () => {
    const s = setup(); const pending = new Subject<any>(); s.api.getBlock$.mockReturnValue(pending);
    const sub = s.component.resolution$.subscribe(); expect(pending.observed).toBe(true);
    s.state.network = 'testnet4'; s.network.next('testnet4');
    expect(pending.observed).toBe(false); pending.next({});
    expect(s.router.navigate).not.toHaveBeenCalled(); expect(s.router.navigateByUrl).not.toHaveBeenCalled();
    sub.unsubscribe(); s.injector.destroy();
  });
  it('cancels a pending lookup when the receiver is destroyed', () => {
    const s = setup(); const pending = new Subject<any>(); s.api.getBlock$.mockReturnValue(pending);
    const sub = s.component.resolution$.subscribe(); s.component.ngOnDestroy();
    expect(pending.observed).toBe(false); pending.next({});
    expect(s.router.navigate).not.toHaveBeenCalled(); expect(s.router.navigateByUrl).not.toHaveBeenCalled();
    sub.unsubscribe(); s.injector.destroy();
  });
});
