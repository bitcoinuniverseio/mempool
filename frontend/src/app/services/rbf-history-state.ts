import { BehaviorSubject, defer, merge, Observable, of } from 'rxjs';
import { catchError, filter, map, startWith, switchMap, take, throwIfEmpty, timeout } from 'rxjs/operators';
import { RbfTree } from '@interfaces/node-api.interface';
import { ReplacementInfo, RbfHistoryAvailability } from '@interfaces/websocket.interface';

export type RbfReadState<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'unavailable' };
// Buffered same-origin gateway has a fixed 30s upstream deadline; allow 5s delivery margin.
// Only first response is bounded. No automatic retry, poll or idle expiry of retained history.
export const RBF_READ_TIMEOUT_MS = 35_000;
export function rbfRead$<T>(factory: () => Observable<T>, validate: (value: unknown) => boolean = () => true): Observable<RbfReadState<T>> {
  return defer(factory).pipe(timeout({ first: RBF_READ_TIMEOUT_MS }), take(1), throwIfEmpty(() => new Error('missing replacement response')),
    map(value => { if (!validate(value)) {throw new Error('malformed replacement response');} return { status: 'ready', value } as RbfReadState<T>; }),
    catchError(() => of<RbfReadState<T>>({ status: 'unavailable' })),
    startWith({ status: 'loading' } as RbfReadState<T>));
}
const reasons = new Set(['snapshot-oversize', 'snapshot-invalid', 'snapshot-changed', 'snapshot-read-failed', 'snapshot-restore-failed', 'rbf_restore_pending']);
export function readRbfAvailability(input: unknown): RbfHistoryAvailability | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {return null;}
  const v = input as Record<string, unknown>;
  if (v.schemaVersion !== 'universe-rbf-history-availability-v1') {return null;}
  if (v.status === 'available' && v.reason === null) {return v as unknown as RbfHistoryAvailability;}
  if (v.status === 'unavailable' && typeof v.reason === 'string' && reasons.has(v.reason)) {return v as unknown as RbfHistoryAvailability;}
  return null;
}
/** Restore eligibility only: no claim of complete history, native readiness or observation freshness. */
export class RbfHistoryState {
  readonly availability$ = new BehaviorSubject<'loading' | 'available' | 'unavailable'>('loading');
  readonly summary$ = new BehaviorSubject<RbfReadState<ReplacementInfo[]>>({ status: 'loading' });
  private blocked = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  canUseHistory(): boolean { return !this.blocked; }
  acceptMarker(input: unknown): boolean {
    if (input === undefined) {return !this.blocked;} // Additive compatibility; never clears a known quarantine.
    const marker = readRbfAvailability(input);
    this.blocked = !marker || marker.status === 'unavailable';
    this.availability$.next(this.blocked ? 'unavailable' : 'available');
    if (this.blocked) {this.failSummary();}
    return !this.blocked;
  }
  beginSummary(): void {
    this.clearTimer(); this.summary$.next({ status: 'loading' });
    this.timer = setTimeout(() => this.failSummary(), RBF_READ_TIMEOUT_MS);
  }
  acceptSummary(value: ReplacementInfo[]): boolean {
    if (this.blocked || !validRbfSummary(value)) { this.failSummary(); return false; }
    this.clearTimer(); this.summary$.next({ status: 'ready', value }); return true;
  }
  failSummary(): void { this.clearTimer(); this.summary$.next({ status: 'unavailable' }); }
  offline(): void { this.availability$.next('unavailable'); this.failSummary(); }
  reset(): void { this.blocked = false; this.availability$.next('loading'); this.clearTimer(); this.summary$.next({ status: 'loading' }); }
  destroy(): void { this.clearTimer(); }
  private clearTimer(): void { if (this.timer !== null) {clearTimeout(this.timer);} this.timer = null; }
}

export function scopedRbfRead$<T>(requests$: Observable<string>, networkChanges$: Observable<string>, availability$: Observable<string>, currentNetwork: () => string, allowed: () => boolean, factory: (txid: string) => Observable<T>, validate: (value: unknown) => boolean = () => true): Observable<RbfReadState<T>> {
  return merge(
    requests$.pipe(map(txid => ({ status: 'request' as const, txid, network: currentNetwork() }))),
    networkChanges$.pipe(map(() => ({ status: 'loading' as const }))),
    availability$.pipe(filter(status => status === 'unavailable'), map(() => ({ status: 'unavailable' as const }))),
  ).pipe(switchMap(event => event.status === 'request'
    ? rbfRead$(() => factory(event.txid), validate).pipe(map(state => state.status === 'ready' && (event.network !== currentNetwork() || !allowed()) ? { status: 'unavailable' } as RbfReadState<T> : state))
    : of<RbfReadState<T>>({ status: event.status })));
}

export function validRbfHistory(value: unknown): value is { replacements: RbfTree | null; replaces: string[] | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {return false;}
  const v = value as Record<string, unknown>;
  return (v.replacements === null || validRbfTree(v.replacements)) &&
    (v.replaces === null || (Array.isArray(v.replaces) && v.replaces.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))));
}

export function validRbfTree(value: unknown): value is RbfTree {
  const pending: unknown[] = [value]; const seen = new Set<object>();
  while (pending.length) {
    const node = pending.pop(); if (!node || typeof node !== 'object' || Array.isArray(node) || seen.has(node)) {return false;}
    seen.add(node); const tree = node as Record<string, unknown>; const tx = tree.tx as Record<string, unknown>;
    if (!tx || typeof tx !== 'object' || Array.isArray(tx) || typeof tx.txid !== 'string' || !/^[a-f0-9]{64}$/.test(tx.txid) ||
      !Number.isFinite(tx.fee) || Number(tx.fee) < 0 || !Number.isFinite(tx.vsize) || Number(tx.vsize) <= 0 ||
      !Number.isFinite(tree.time) || Number(tree.time) < 0 || typeof tree.fullRbf !== 'boolean' ||
      (tree.mined !== undefined && typeof tree.mined !== 'boolean') || !Array.isArray(tree.replaces)) {return false;}
    for (const child of tree.replaces) {pending.push(child);}
  }
  return true;
}
export function validRbfList(value: unknown): value is RbfTree[] { return Array.isArray(value) && value.every(validRbfTree); }

export function validRbfSummary(value: unknown): value is ReplacementInfo[] {
  return Array.isArray(value) && value.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { return false; }
    const v = entry as Record<string, unknown>;
    return typeof v.mined === 'boolean' && typeof v.fullRbf === 'boolean' && typeof v.txid === 'string' && /^[a-f0-9]{64}$/.test(v.txid) &&
      ['oldFee', 'oldVsize', 'newFee', 'newVsize'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key]) && Number(v[key]) >= 0) && Number(v.newVsize) > 0;
  });
}
