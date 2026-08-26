import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, startWith } from 'rxjs';
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

export function assetState$<T>(
  reference: string,
  request$: Observable<AssetLookupResult<T>>,
): Observable<AssetViewState<T>> {
  return request$.pipe(
    map((result): AssetViewState<T> =>
      result?.status === 'ok' && result.value
        ? { kind: 'ready', result, reference }
        : { kind: 'unavailable', result, reference },
    ),
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
