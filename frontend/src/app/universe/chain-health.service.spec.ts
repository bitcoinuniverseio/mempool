import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ChainHealthService, ChainHealthState } from './chain-health.service';
import { UniverseApiService } from './universe-api.service';
import { ChainCapabilityEnvelope } from './universe.types';

afterEach(() => vi.useRealTimers());
describe('shared health polling and recovery', () => {
  it('shares one request, reports a failed refresh as unknown, and retries without a reload', () => {
    vi.useFakeTimers();
    const get = vi.fn().mockReturnValueOnce(throwError(() => new Error('down'))).mockReturnValue(of([]));
    const service = new ChainHealthService({ getChains$: get } as unknown as UniverseApiService, { isBrowser: true } as StateService);
    const seen: ChainHealthState[] = [];
    const first = service.state$.subscribe(value => seen.push(value));
    const second = service.capability$('bitcoin').subscribe();
    vi.advanceTimersByTime(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)?.error).toContain('refresh failed');
    service.retry();
    expect(get).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)?.error).toBeNull();
    first.unsubscribe(); second.unsubscribe();
    vi.advanceTimersByTime(30_000);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('clears old visible rows immediately and discards late responses when network changes', () => {
    vi.useFakeTimers();
    const changed = new BehaviorSubject('');
    const state = { isBrowser: true, network: '', networkChanged$: changed } as unknown as StateService;
    const old = new Subject<ChainCapabilityEnvelope[]>(), current = new Subject<ChainCapabilityEnvelope[]>();
    const get = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(current);
    const service = new ChainHealthService({ getChains$: get } as unknown as UniverseApiService, state);
    const seen: ChainHealthState[] = [];
    const subscription = service.state$.subscribe(value => seen.push(value));
    vi.advanceTimersByTime(0);
    state.network = 'signet'; changed.next('signet');
    expect(seen.at(-1)).toMatchObject({ capabilities: [], loading: true });
    old.next([{ chain: 'bitcoin', network: 'mainnet' } as ChainCapabilityEnvelope]);
    expect(seen.at(-1)?.capabilities).toEqual([]);
    vi.advanceTimersByTime(0);
    current.next([{ chain: 'bitcoin', network: 'signet' } as ChainCapabilityEnvelope]);
    expect(seen.at(-1)?.capabilities[0].network).toBe('signet');
    subscription.unsubscribe();
  });
});
