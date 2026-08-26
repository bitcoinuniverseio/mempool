import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, firstValueFrom, timer } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { UniverseApiService, UNIVERSE_TRANSACTION_BATCH_LIMIT } from '@app/universe/universe-api.service';
import {
  ExplorerAssetAction,
  ExplorerTransactionAssetFlow,
  TransactionBatchItem,
} from '@app/universe/universe.types';

/**
 * Live protocol activity in the mempool.
 *
 * The explorer backend already pushes the newest mempool arrivals over the
 * existing socket. This service takes that stream, asks the asset authority
 * what those transactions actually do, and keeps a running tally.
 *
 * Two rules keep it honest and cheap:
 *
 * 1. The denominator is always published. A protocol count means nothing
 *    without "out of how many transactions we checked", so the tally carries
 *    the exact number of transactions resolved since the page opened.
 * 2. Work is strictly bounded. One request at a time, at most
 *    UNIVERSE_TRANSACTION_BATCH_LIMIT transactions per request, nothing at all
 *    while the tab is hidden, and a hard ceiling per session.
 */

const POLL_INTERVAL_MS = 2500;
const MAXIMUM_QUEUE = 400;
const MAXIMUM_RECENT = 40;
/** Ceiling on resolutions per page visit, so a long session cannot drift into unbounded work. */
const SESSION_RESOLVE_CEILING = 4000;

export interface PulseEvent {
  readonly txid: string;
  readonly protocolIds: readonly string[];
  readonly actions: readonly ExplorerAssetAction[];
  readonly status: ExplorerTransactionAssetFlow['status'];
  readonly seenAt: number;
}

export interface PulseState {
  /** Transactions the authority answered for since this page opened. */
  readonly checked: number;
  /** Of those, how many carried at least one supported asset or action. */
  readonly withAssets: number;
  /** Protocol id to number of transactions it appeared in, within `checked`. */
  readonly protocolCounts: ReadonlyMap<string, number>;
  readonly recent: readonly PulseEvent[];
  /** True while the authority is answering. False after repeated failures. */
  readonly authorityAnswering: boolean;
  readonly startedAt: number;
  /** True once the session ceiling is reached and sampling has stopped. */
  readonly ceilingReached: boolean;
}

const EMPTY_STATE: PulseState = {
  checked: 0,
  withAssets: 0,
  protocolCounts: new Map(),
  recent: [],
  authorityAnswering: true,
  startedAt: 0,
  ceilingReached: false,
};

@Injectable({ providedIn: 'root' })
export class UniversePulseService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<PulseState>(EMPTY_STATE);
  readonly state$: Observable<PulseState> = this.stateSubject.asObservable();

  private queue: string[] = [];
  private seen = new Set<string>();
  private inFlight = false;
  private consecutiveFailures = 0;
  private subscriptions = new Subscription();
  /** Reference count: several surfaces can show the pulse at once. */
  private consumers = 0;
  /** Mirrors the tab visibility stream so the sampling loop can read it synchronously. */
  private tabHidden = false;

  constructor(
    private stateService: StateService,
    private api: UniverseApiService,
  ) {}

  /**
   * Reference counted: every surface that shows the pulse calls start on
   * enter and stop on leave, and the sampling loop runs while at least one
   * of them is open.
   */
  start(): void {
    if (!this.stateService.isBrowser) {
      return;
    }
    this.consumers += 1;
    if (this.consumers > 1) {
      return;
    }
    this.stateSubject.next({ ...EMPTY_STATE, startedAt: Date.now() });

    this.subscriptions.add(
      this.stateService.transactions$.subscribe((transactions) => {
        if (!transactions?.length) {
          return;
        }
        for (const transaction of transactions) {
          this.enqueue(transaction?.txid);
        }
      }),
    );

    this.subscriptions.add(
      this.stateService.isTabHidden$.subscribe((hidden) => {
        this.tabHidden = !!hidden;
      }),
    );

    this.subscriptions.add(
      timer(0, POLL_INTERVAL_MS).subscribe(() => {
        void this.drain();
      }),
    );
  }

  stop(): void {
    if (this.consumers === 0) {return;}
    this.consumers -= 1;
    if (this.consumers > 0) {return;}
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.queue = [];
    this.seen = new Set();
    this.inFlight = false;
    this.consecutiveFailures = 0;
    this.tabHidden = false;
    this.stateSubject.next(EMPTY_STATE);
  }

  ngOnDestroy(): void {
    this.consumers = 1;
    this.stop();
  }

  private enqueue(txid: string | undefined): void {
    if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {return;}
    if (this.seen.has(txid)) {return;}
    this.seen.add(txid);
    this.queue.push(txid);
    if (this.queue.length > MAXIMUM_QUEUE) {
      // Under a burst the newest arrivals are the interesting ones; the tally
      // stays truthful because dropped entries were never counted.
      const dropped = this.queue.splice(0, this.queue.length - MAXIMUM_QUEUE);
      for (const entry of dropped) {this.seen.delete(entry);}
    }
  }

  private async drain(): Promise<void> {
    if (!this.consumers || this.inFlight || !this.queue.length) {return;}
    if (this.tabHidden) {return;}
    const current = this.stateSubject.value;
    if (current.checked >= SESSION_RESOLVE_CEILING) {
      if (!current.ceilingReached) {
        this.stateSubject.next({ ...current, ceilingReached: true });
      }
      return;
    }

    const batch = this.queue.splice(0, UNIVERSE_TRANSACTION_BATCH_LIMIT);
    this.inFlight = true;
    try {
      const response = await firstValueFrom(this.api.getTransactionFlows$(batch));
      this.consecutiveFailures = 0;
      this.apply(response?.results ?? []);
    } catch {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 3) {
        this.stateSubject.next({
          ...this.stateSubject.value,
          authorityAnswering: false,
        });
      }
    } finally {
      this.inFlight = false;
    }
  }

  private apply(results: readonly TransactionBatchItem[]): void {
    const previous = this.stateSubject.value;
    const protocolCounts = new Map(previous.protocolCounts);
    const recent = [...previous.recent];
    let checked = previous.checked;
    let withAssets = previous.withAssets;
    const now = Date.now();

    for (const item of results) {
      if (item.status !== 'ok' || !item.flow) {continue;}
      checked += 1;
      const protocolIds = protocolIdsOf(item.flow);
      if (!protocolIds.length) {continue;}
      withAssets += 1;
      for (const protocolId of protocolIds) {
        protocolCounts.set(protocolId, (protocolCounts.get(protocolId) ?? 0) + 1);
      }
      recent.unshift({
        txid: item.txid,
        protocolIds,
        actions: item.flow.actions ?? [],
        status: item.flow.status,
        seenAt: now,
      });
    }

    this.stateSubject.next({
      checked,
      withAssets,
      protocolCounts,
      recent: recent.slice(0, MAXIMUM_RECENT),
      authorityAnswering: true,
      startedAt: previous.startedAt || now,
      ceilingReached: previous.ceilingReached,
    });
  }
}

/** Every protocol this flow proves involvement of, deduplicated and sorted. */
export function protocolIdsOf(flow: ExplorerTransactionAssetFlow): string[] {
  const ids = new Set<string>();
  for (const position of [...(flow.inputs ?? []), ...(flow.outputs ?? [])]) {
    const id = position?.asset?.protocolId;
    if (id) {ids.add(id);}
  }
  for (const action of flow.actions ?? []) {
    if (action?.protocolId) {ids.add(action.protocolId);}
  }
  return [...ids].sort();
}
