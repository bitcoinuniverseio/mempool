import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { ChannelComponent } from '../lightning/channel/channel.component';

function setup() {
  const params = new BehaviorSubject(convertToParamMap({ short_id: '1x1x1' }));
  const network = new BehaviorSubject('');
  const api = { getChannel$: vi.fn().mockReturnValue(of({short_id: '1x1x1', node_left: {}, node_right: {}})) };
  const electrs = {getTransaction$: vi.fn()};
  const component = new ChannelComponent(api as any, {paramMap: params} as any,
    {setTitle: vi.fn(), setDescription: vi.fn(), logSoft404: vi.fn()} as any, electrs as any, {networkChanged$: network} as any);
  component.ngOnInit(); return {component, api, electrs, params, network};
}
describe('Native Lightning channel failure and subscription lifecycle', () => {
  it('does not dereference node balances on an unavailable channel fallback', () => {
    const s = setup(); s.api.getChannel$.mockReturnValueOnce(throwError(() => ({status:503})));
    let channel: any; const sub = s.component.channel$.subscribe(value => channel = value);
    expect(() => s.component.showCloseBoxes(channel)).not.toThrow();
    expect(s.component.showCloseBoxes(channel)).toBe(false); sub.unsubscribe();
  });
  it('releases a pending provider read when its final view subscription leaves', () => {
    const s = setup(); const pending = new Subject(); s.api.getChannel$.mockReturnValueOnce(pending);
    const first = s.component.channel$.subscribe(), second = s.component.channel$.subscribe();
    expect(s.api.getChannel$).toHaveBeenCalledOnce(); first.unsubscribe(); expect(pending.observed).toBe(true);
    second.unsubscribe(); expect(pending.observed).toBe(false); expect(s.params.observed).toBe(false);
  });
  it('distinguishes 404 missing from unavailable and retries once while pending', () => {
    const s = setup(); s.api.getChannel$.mockReturnValueOnce(throwError(() => ({status:404})));
    const sub = s.component.channel$.subscribe(); expect(s.component.channelMissing).toBe(true);
    s.api.getChannel$.mockReturnValueOnce(throwError(() => ({status:503}))); s.component.retry();
    expect(s.component.channelMissing).toBe(false); const pending = new Subject(); s.api.getChannel$.mockReturnValueOnce(pending);
    s.component.retry(); s.component.retry(); expect(s.api.getChannel$).toHaveBeenCalledTimes(3);
    pending.next({short_id:'1x1x1',node_left:{},node_right:{}}); expect(s.component.error).toBeNull();
    s.component.ngOnDestroy(); s.component.retry(); expect(pending.observed).toBe(false); sub.unsubscribe();
  });
  it('cancels pending reads on route/network replacement and destroy, withholding old data', () => {
    const s = setup(); const old = new Subject(), current = new Subject(); s.api.getChannel$.mockReturnValueOnce(old).mockReturnValueOnce(current);
    const values: any[] = []; const sub = s.component.channel$.subscribe(v=>values.push(v));
    s.network.next('testnet'); expect(old.observed).toBe(false); expect(current.observed).toBe(true);
    old.next({short_id:'stale'}); expect(values.every(v=>v===null)).toBe(true);
    s.component.ngOnDestroy(); expect(current.observed).toBe(false); expect(s.network.observed).toBe(false);
    s.params.next(convertToParamMap({short_id:'after-destroy'})); expect(s.api.getChannel$).toHaveBeenCalledTimes(2); sub.unsubscribe();
  });
  it('treats unavailable fallback geometry as empty and preserves valid zero coordinates', () => {
    const s = setup(); s.api.getChannel$.mockReturnValueOnce(of({short_id:'1x1x1',node_left:{longitude:0,latitude:0,public_key:'left',alias:'Left'},node_right:{longitude:1,latitude:1,public_key:'right',alias:'Right'}}));
    const geometry: any[] = []; const errors: unknown[] = []; const sub = s.component.channelGeo$.subscribe({next:v=>geometry.push(v),error:e=>errors.push(e)});
    expect(geometry.at(-1)).toEqual(['left','Left',0,0,'right','Right',1,1]);
    s.api.getChannel$.mockReturnValueOnce(throwError(()=>({status:503}))); s.params.next(convertToParamMap({short_id:'2x2x2'}));
    expect(geometry.at(-1)).toEqual([]); expect(errors).toEqual([]); sub.unsubscribe();
  });
});
