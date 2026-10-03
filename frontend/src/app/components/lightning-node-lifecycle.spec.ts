import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { NodeComponent } from '../lightning/node/node.component';

const node = (key: string) => ({ public_key: key, alias: key, sockets: 'example.org:9735', capacity: 1000,
  active_channel_count: 1, custom_records: {} });
function setup() {
  const params = new BehaviorSubject(convertToParamMap({ public_key: 'first' }));
  const network = new BehaviorSubject('');
  const api = { getChannelsGeo$: vi.fn().mockReturnValue(of([])) };
  const lightning = { getNode$: vi.fn().mockImplementation(key => of(node(key))) };
  const component = new NodeComponent(api as any, {} as any, lightning as any, { paramMap: params } as any,
    { setTitle: vi.fn(), setDescription: vi.fn(), logSoft404: vi.fn() } as any, { markForCheck: vi.fn() } as any,
    { networkChanged$: network } as any);
  component.ngOnInit(); return { component, params, network, api, lightning };
}
describe('Native Lightning node route recovery', () => {
  it('emits unavailable distance without an invalid observable error, then reads the next node', () => {
    const s = setup(); s.api.getChannelsGeo$.mockReturnValueOnce(throwError(() => new Error('provider unavailable')));
    const values: unknown[] = [], errors: unknown[] = [];
    const sub = s.component.avgChannelDistance$.subscribe({ next: value => values.push(value), error: error => errors.push(error) });
    expect(errors).toEqual([]); expect(values.at(-1)).toBeNull();
    s.params.next(convertToParamMap({ public_key: 'second' })); expect(s.api.getChannelsGeo$).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
  it('retains route subscription after failure and clears error on the next successful node', () => {
    const s = setup(); s.lightning.getNode$.mockReturnValueOnce(throwError(() => new Error('node unavailable')));
    const values: any[] = []; const sub = s.component.node$.subscribe(value => values.push(value));
    expect(s.component.error).toBeTruthy(); s.params.next(convertToParamMap({ public_key: 'second' }));
    expect(s.lightning.getNode$).toHaveBeenCalledTimes(2); expect(values.at(-1).public_key).toBe('second');
    expect(s.component.error).toBeNull(); sub.unsubscribe();
  });
  it('resets controls belonging to the previous node before projecting another node', () => {
    const s = setup(); const sub = s.component.node$.subscribe();
    s.component.selectedSocketIndex = 7; s.component.qrCodeVisible = true;
    s.component.showDetails = true; s.component.showFeatures = true; s.component.channelsListStatus = 'closed';
    s.params.next(convertToParamMap({ public_key: 'second' }));
    expect(s.component.selectedSocketIndex).toBe(0); expect(s.component.qrCodeVisible).toBe(false);
    expect(s.component.showDetails).toBe(false); expect(s.component.showFeatures).toBe(false);
    expect(s.component.channelsListStatus).toBeUndefined(); sub.unsubscribe();
  });
  it('cancels pending reads on selected network changes and never projects stale receipts', () => {
    const s = setup(); const oldNode = new Subject(), oldGeo = new Subject();
    s.lightning.getNode$.mockReturnValueOnce(oldNode); s.api.getChannelsGeo$.mockReturnValueOnce(oldGeo);
    const nodes: any[] = [], distances: unknown[] = [];
    const nodeSub = s.component.node$.subscribe(value => nodes.push(value));
    const geoSub = s.component.avgChannelDistance$.subscribe(value => distances.push(value));
    expect(oldNode.observed).toBe(true); expect(oldGeo.observed).toBe(true); s.network.next('testnet');
    expect(oldNode.observed).toBe(false); expect(oldGeo.observed).toBe(false);
    oldNode.next(node('stale')); oldGeo.next([[0,0,0,0,0,0,1,1]]);
    expect(nodes.filter(Boolean).map(value => value.public_key)).toEqual(['first']); expect(distances.every(value => value === null)).toBe(true);
    s.component.ngOnDestroy(); expect(s.params.observed).toBe(false); expect(s.network.observed).toBe(false);
    s.params.next(convertToParamMap({ public_key: 'after-destroy' })); expect(s.lightning.getNode$).toHaveBeenCalledTimes(2);
    nodeSub.unsubscribe(); geoSub.unsubscribe();
  });
  it('handles synchronous producer failure and preserves subsequent route recovery', () => {
    const s = setup(); s.lightning.getNode$.mockImplementationOnce(() => { throw new Error('synchronous failure'); });
    const errors: unknown[] = []; const sub = s.component.node$.subscribe({error: error => errors.push(error)});
    expect(errors).toEqual([]); expect(s.component.error?.message).toBe('synchronous failure');
    s.params.next(convertToParamMap({ public_key: 'recovery' })); expect(s.component.error).toBeNull();
    expect(s.lightning.getNode$).toHaveBeenCalledTimes(2); sub.unsubscribe();
  });
  it('clears the previously displayed node and distance while replacement reads remain pending', () => {
    const s = setup(); const nodes: any[] = [], distances: unknown[] = [];
    s.api.getChannelsGeo$.mockReturnValueOnce(of([[0,0,0,0,0,0,0,0]]));
    const nodeSub = s.component.node$.subscribe(value => nodes.push(value));
    const geoSub = s.component.avgChannelDistance$.subscribe(value => distances.push(value));
    expect(nodes.at(-1).public_key).toBe('first'); expect(distances.at(-1)).toBe(0);
    const pendingNode = new Subject(), pendingGeo = new Subject();
    s.lightning.getNode$.mockReturnValueOnce(pendingNode); s.api.getChannelsGeo$.mockReturnValueOnce(pendingGeo);
    s.params.next(convertToParamMap({ public_key: 'second' }));
    expect(nodes.at(-1)).toBeNull(); expect(distances.at(-1)).toBeNull();
    s.component.ngOnDestroy(); expect(pendingNode.observed).toBe(false); expect(pendingGeo.observed).toBe(false);
    nodeSub.unsubscribe(); geoSub.unsubscribe();
  });
});
