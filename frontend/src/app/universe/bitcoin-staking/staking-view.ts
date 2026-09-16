import { Observable, defer, EMPTY, Subscription } from 'rxjs';
import { switchMap, tap, catchError } from 'rxjs/operators';
export function slashingLabel(value: unknown): string {return value === true ? 'Reported slashed' : value === false ? 'Not reported slashed' : 'Unknown';}
export function reconciliationLabel(value: any): string {
  const a=value?.total_btc_stake_sat,b=value?.total_consumer_voting_power_sat;
  return Number.isSafeInteger(a) && a>=0 && Number.isSafeInteger(b) && b>=0 ? (a===b?'Reported totals equal':'Reported totals differ') : 'Unknown';
}

export function observeStaking<T>(trigger: Observable<unknown>, reset: () => void, read: () => Observable<T>, next: (v:T) => void, error: (e:any) => void): Subscription {
  return trigger.pipe(switchMap(() => defer(() => {reset();return read();}).pipe(tap(next),catchError(e => {error(e);return EMPTY;})))).subscribe();
}
