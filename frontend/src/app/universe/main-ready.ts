import { Observable, filter, map, merge, of, startWith, take, timer } from 'rxjs';
import { ChainHealthState } from './chain-health.service';

/**
 * How long the route column waits for the first health reading before it
 * renders anyway. Long enough for a status endpoint on a slow connection,
 * short enough that an unreachable one cannot hold the explorer blank.
 */
export const MAIN_READY_CAP_MS = 1_500;

/**
 * Whether the page column may render its route yet.
 *
 * The chain sync notice sits above the route and only knows whether it has
 * something to say once the first health reading arrives. Rendering the route
 * first and inserting the notice afterwards pushed every page down by the
 * notice's height: a layout shift of 0.135 on a phone, against a budget of
 * 0.1, on every route while the node was not reported as synced. So the route
 * waits for that first reading, and the notice takes its place before any
 * content has painted. The wait is capped so a status endpoint that never
 * answers costs at most the cap, and outside a browser there is nothing to
 * wait for.
 */
export function mainReady(state$: Observable<ChainHealthState>, isBrowser: boolean, capMs = MAIN_READY_CAP_MS): Observable<boolean> {
  if (!isBrowser) {
    return of(true);
  }
  return merge(
    state$.pipe(filter(state => !state.loading)),
    timer(capMs),
  ).pipe(
    take(1),
    map(() => true),
    startWith(false),
  );
}
