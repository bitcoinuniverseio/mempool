import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, defaultIfEmpty, defer, map, of, startWith, timeout } from 'rxjs';
import { AssetLookupResult, AssetLookupStatus } from '@app/universe/universe.types';
import { EvidenceTone } from '@app/universe/universe-evidence';

/**
 * Shared handling for the asset lookup routes.
 *
 * The overlay answers a miss with 404 and an outage with 502, and the
 * difference is the whole point: an inscription that does not exist and an
 * authority that is down must never look the same on screen.
 */

export interface AssetViewState<T> {
  readonly kind: 'loading' | 'ready' | 'missing' | 'unavailable' | 'invalid';
  readonly result?: AssetLookupResult<T>;
  readonly reference?: string;
}

/** Browser reads use the same-origin gateway's fixed 30s lane plus 5s margin.
 * Direct SSR reads conservatively allow three sequential reads, each with two
 * 60s attempts (including body abort), plus 5s. These are nominal I/O budgets,
 * not a network guarantee. Neither limit changes any server or RPC budget.
 */
export const ASSET_LOOKUP_GATEWAY_RESPONSE_MS = 35_000;
export const ASSET_LOOKUP_EXTENDED_RESPONSE_MS = 365_000;

export interface AssetLookupOptions {
  readonly firstResponseTimeoutMs?: number;
}

export function assetState$<T>(
  reference: string,
  request$: Observable<AssetLookupResult<T>> | (() => Observable<AssetLookupResult<T>>),
  options: AssetLookupOptions = {},
): Observable<AssetViewState<T>> {
  const deadline = options.firstResponseTimeoutMs ?? ASSET_LOOKUP_GATEWAY_RESPONSE_MS;
  return defer(() => {
    if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > ASSET_LOOKUP_EXTENDED_RESPONSE_MS) {
      throw new Error('Invalid asset first-response deadline');
    }
    return typeof request$ === 'function' ? request$() : request$;
  }).pipe(
    // Only the first response is bounded. Ready streams have no idle timer.
    timeout({ first: Number.isSafeInteger(deadline) && deadline > 0 ? deadline : ASSET_LOOKUP_GATEWAY_RESPONSE_MS }),
    map((result): AssetViewState<T> =>
      result?.status === 'ok' && result.value
        ? { kind: 'ready', result, reference }
        : { kind: 'unavailable', result, reference },
    ),
    defaultIfEmpty<AssetViewState<T>, AssetViewState<T>>({ kind: 'unavailable', reference }),
    catchError((error: HttpErrorResponse) => {
      const body = error?.error;
      const result: AssetLookupResult<T> | undefined =
        body && typeof body === 'object' && typeof body.status === 'string' ? body : undefined;
      if (error?.status === 404) {
        return of<AssetViewState<T>>({ kind: 'missing', result, reference });
      }
      if (error?.status === 400) {
        return of<AssetViewState<T>>({ kind: 'invalid', reference });
      }
      return of<AssetViewState<T>>({ kind: 'unavailable', result, reference });
    }),
    startWith<AssetViewState<T>>({ kind: 'loading', reference }),
  );
}

/** Says exactly what happened, and never dresses an outage as an absence. */
export function assetStatusMessage(status: AssetLookupStatus | undefined): string {
  switch (status) {
    case 'not-found':
      return $localize`:@@universe.asset.not-found:The asset authority has no record of this, as of the block below.`;
    case 'unconfigured':
      return $localize`:@@universe.asset.unconfigured:This deployment has no asset authority configured, so protocol assets cannot be looked up.`;
    case 'malformed':
      return $localize`:@@universe.asset.malformed:The asset authority replied with something this explorer refuses to trust.`;
    default:
      return $localize`:@@universe.asset.unavailable:The asset authority could not be reached. Nothing is claimed while that is true.`;
  }
}

export function assetTone(kind: AssetViewState<unknown>['kind']): EvidenceTone {
  if (kind === 'ready') {return 'proven';}
  if (kind === 'missing') {return 'partial';}
  return 'unavailable';
}

/**
 * Formats a whole-number amount against a divisibility, without floating
 * point. Rune supplies routinely exceed the safe integer range.
 */
export function applyDivisibility(atomic: string, divisibility: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(atomic ?? '')) {return '';}
  const decimals = Number(divisibility);
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 38) {
    return groupDigits(atomic);
  }
  const padded = atomic.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return fraction ? `${groupDigits(whole)}.${fraction}` : groupDigits(whole);
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Mint progress as a whole percent, floored.
 *
 * Returns null when the terms do not define a cap, because a mint with no cap
 * has no progress to report and inventing one would be a fabricated metric.
 */
export function mintProgressPercent(
  mintsAtomic: string,
  capAtomic: string | null | undefined,
): number | null {
  if (!capAtomic || !/^(0|[1-9][0-9]*)$/.test(capAtomic)) {return null;}
  if (!/^(0|[1-9][0-9]*)$/.test(mintsAtomic ?? '')) {return null;}
  const cap = BigInt(capAtomic);
  if (cap === 0n) {return null;}
  const mints = BigInt(mintsAtomic);
  const percent = (mints * 100n) / cap;
  return Number(percent > 100n ? 100n : percent);
}

/** Seconds since the epoch to a readable UTC timestamp. */
export function utcFromSeconds(atomic: string | null | undefined): string {
  if (!atomic || !/^(0|[1-9][0-9]{0,12})$/.test(atomic)) {return '';}
  const milliseconds = Number(atomic) * 1000;
  if (!Number.isFinite(milliseconds)) {return '';}
  return new Date(milliseconds).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}
