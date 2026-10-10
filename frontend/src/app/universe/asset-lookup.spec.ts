import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY, NEVER, Subject, of, throwError } from 'rxjs';
import {
  ASSET_LOOKUP_EXTENDED_RESPONSE_MS,
  applyDivisibility,
  assetState$,
  assetStatusMessage,
  assetTone,
  mintProgressPercent,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import type { AssetLookupResult } from '@app/universe/universe.types';

function collect<T>(source: ReturnType<typeof assetState$<T>>): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const seen: unknown[] = [];
    source.subscribe({
      next: (value) => seen.push(value),
      error: reject,
      complete: () => resolve(seen),
    });
  });
}

const OK: AssetLookupResult<{ id: string }> = {
  schemaVersion: 'universe-explorer-asset-v1',
  status: 'ok',
  authorityId: 'ord',
  checkpoint: null,
  value: { id: 'x' },
};

describe('assetState$', () => {
  afterEach(() => vi.useRealTimers());

  it('makes an empty completion unavailable instead of leaving loading behind', async () => {
    expect((await collect(assetState$('x', () => EMPTY))).map((state: never) => state.kind))
      .toEqual(['loading', 'unavailable']);
  });

  it('bounds a never-answering request and releases its subscription', async () => {
    vi.useFakeTimers();
    const unsubscribed = vi.fn();
    const source = new (await import('rxjs')).Observable<AssetLookupResult<{ id: string }>>(() => unsubscribed);
    const result = collect(assetState$('x', () => source));
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await result).map((state: never) => state.kind)).toEqual(['loading', 'unavailable']);
    expect(unsubscribed).toHaveBeenCalledOnce();
  });

  it('catches a synchronous factory failure without an outer stream error', async () => {
    expect((await collect(assetState$('x', () => { throw Error('configuration'); })))
      .map((state: never) => state.kind)).toEqual(['loading', 'unavailable']);
  });

  it.each([0, -1, 1.5, NaN, Infinity, ASSET_LOOKUP_EXTENDED_RESPONSE_MS + 1])('rejects invalid deadline %s before reading', async deadline => {
    const request = vi.fn(() => NEVER);
    expect((await collect(assetState$('x', request, { firstResponseTimeoutMs: deadline })))
      .map((state: never) => state.kind)).toEqual(['loading', 'unavailable']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves a supported long first response and does not expire ready on idle', async () => {
    vi.useFakeTimers();
    const request = new Subject<AssetLookupResult<{ id: string }>>();
    const states: string[] = [];
    const subscription = assetState$('x', () => request, { firstResponseTimeoutMs: ASSET_LOOKUP_EXTENDED_RESPONSE_MS })
      .subscribe(state => states.push(state.kind));
    await vi.advanceTimersByTimeAsync(360_000);
    expect(states).toEqual(['loading']);
    request.next(OK);
    await vi.advanceTimersByTimeAsync(730_000);
    expect(states).toEqual(['loading', 'ready']);
    expect(request.observed).toBe(true);
    subscription.unsubscribe();
    expect(request.observed).toBe(false);
  });

  it('emits loading before the answer', async () => {
    const states = await collect(assetState$('x', of(OK)));
    expect(states.map((state: never) => state.kind)).toEqual(['loading', 'ready']);
  });

  it('turns a 404 into a miss, not an outage', async () => {
    const error = { status: 404, error: { ...OK, status: 'not-found', value: null } };
    const states = await collect(assetState$('x', throwError(() => error)));
    expect(states.map((state: never) => state.kind)).toEqual(['loading', 'missing']);
  });

  it('turns a 400 into an invalid reference', async () => {
    const states = await collect(assetState$('x', throwError(() => ({ status: 400 }))));
    expect(states.map((state: never) => state.kind)).toEqual(['loading', 'invalid']);
  });

  it('turns a 502 into unavailable', async () => {
    const states = await collect(assetState$('x', throwError(() => ({ status: 502 }))));
    expect(states.map((state: never) => state.kind)).toEqual(['loading', 'unavailable']);
  });

  it('treats a 200 with a non-ok status as unavailable rather than ready', async () => {
    const degraded = { ...OK, status: 'unavailable' as const, value: null };
    const states = await collect(assetState$('x', of(degraded)));
    expect(states.map((state: never) => state.kind)).toEqual(['loading', 'unavailable']);
  });
});

describe('assetStatusMessage', () => {
  it('never describes an outage as an absence', () => {
    expect(assetStatusMessage('not-found')).toContain('no record');
    expect(assetStatusMessage('unavailable')).toContain('could not be reached');
    expect(assetStatusMessage('unconfigured')).toContain('no asset authority configured');
    expect(assetStatusMessage(undefined)).toContain('could not be reached');
  });
});

describe('assetTone', () => {
  it('maps view kinds to evidence tones', () => {
    expect(assetTone('ready')).toBe('proven');
    expect(assetTone('missing')).toBe('partial');
    expect(assetTone('unavailable')).toBe('unavailable');
    expect(assetTone('invalid')).toBe('unavailable');
  });
});

describe('applyDivisibility', () => {
  it('places the decimal point exactly', () => {
    expect(applyDivisibility('1234567', '3')).toBe('1,234.567');
    expect(applyDivisibility('1000', '3')).toBe('1');
    expect(applyDivisibility('1', '3')).toBe('0.001');
  });

  it('treats zero divisibility as a whole number', () => {
    expect(applyDivisibility('1234', '0')).toBe('1,234');
  });

  it('keeps precision beyond the safe integer range', () => {
    const huge = '123456789012345678901234567890';
    expect(applyDivisibility(huge, '0').replace(/,/g, '')).toBe(huge);
  });

  it('refuses malformed input', () => {
    expect(applyDivisibility('abc', '2')).toBe('');
  });
});

describe('mintProgressPercent', () => {
  it('floors the ratio', () => {
    expect(mintProgressPercent('1', '3')).toBe(33);
    expect(mintProgressPercent('2', '3')).toBe(66);
  });

  it('reports zero progress as zero, not as missing', () => {
    expect(mintProgressPercent('0', '1000')).toBe(0);
  });

  it('caps at one hundred when mints exceed the cap', () => {
    expect(mintProgressPercent('2000', '1000')).toBe(100);
  });

  it('reports no progress at all when there is no cap', () => {
    expect(mintProgressPercent('5', null)).toBeNull();
    expect(mintProgressPercent('5', undefined)).toBeNull();
    expect(mintProgressPercent('5', '0')).toBeNull();
  });

  it('handles caps beyond the safe integer range', () => {
    expect(mintProgressPercent('500000000000000000000', '1000000000000000000000')).toBe(50);
  });
});

describe('utcFromSeconds', () => {
  it('formats a unix timestamp in UTC', () => {
    expect(utcFromSeconds('0')).toBe('1970-01-01 00:00:00 UTC');
  });

  it('returns nothing for junk', () => {
    expect(utcFromSeconds(null)).toBe('');
    expect(utcFromSeconds('abc')).toBe('');
  });
});
