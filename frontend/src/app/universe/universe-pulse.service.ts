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
 * Three rules keep it honest and cheap:
 *
 * 1. The denominator is always published. A protocol count means nothing
 *    without "out of how many transactions we checked", so the tally carries
 *    the exact number of transactions resolved since the page opened.
 * 2. Work is strictly bounded. One request at a time, at most
 *    UNIVERSE_TRANSACTION_BATCH_LIMIT transactions per request, nothing at all
 *    while the tab is hidden, and a hard ceiling per session.
 * 3. Nothing is claimed before it is observed. The authority is "answering"
 *    only after it has resolved at least one transaction in this sample;
 *    until then its state is unknown, and after it stops answering the last
 *    sample is published as stale with its time, never as a fresh zero.
 */

const POLL_INTERVAL_MS = 2500;
const MAXIMUM_QUEUE = 400;
const MAXIMUM_RECENT = 40;
/** Ceiling on resolutions per page visit, so a long session cannot drift into unbounded work. */
const SESSION_RESOLVE_CEILING = 4000;
/** Transport failures in a row before the authority is reported as not answering. */
const FAILURE_THRESHOLD = 3;

export interface PulseEvent {
  readonly txid: string;
  readonly protocolIds: readonly string[];
  readonly actions: readonly ExplorerAssetAction[];
  readonly status: ExplorerTransactionAssetFlow['status'];
  readonly seenAt: number;
}

/**
 * What the sample can say about the authority.
 *
 * - unknown: nothing has been resolved yet, so nothing is claimed either way.
 * - observed: the authority resolved at least one transaction, and the tally
 *   is current.
 * - unavailable: the authority failed before resolving anything.
 * - stale: the authority failed after a sample existed; the tally is that
 *   sample, frozen at `lastSampleAt`.
 */
export type PulseObservation = 'unknown' | 'observed' | 'unavailable' | 'stale';

export interface PulseState {
  /** Transactions the authority answered for since this page opened. */
  readonly checked: number;
  /** Of those, how many carried at least one supported asset or action. */
  readonly withAssets: number;
  /** Protocol id to number of transactions it appeared in, within `checked`. */
  readonly protocolCounts: ReadonlyMap<string, number>;
  readonly recent: readonly PulseEvent[];
  readonly observation: PulseObservation;
  /** When the authority last resolved a transaction in this sample; null before it has. */
  readonly lastSampleAt: number | null;
  readonly startedAt: number;
  /** True once the session ceiling is reached and sampling has stopped. */
  readonly ceilingReached: boolean;
}

const EMPTY_STATE: PulseState = {
  checked: 0,
  withAssets: 0,
  protocolCounts: new Map(),
  recent: [],
  observation: 'unknown',
  lastSampleAt: null,
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
  /** The arrivals feed for the sampled network; replaced on a network switch. */
  private arrivals?: Subscription;
  /** Reference count: several surfaces can show the pulse at once. */
  private consumers = 0;
  /** Mirrors the tab visibility stream so the sampling loop can read it synchronously. */
  private tabHidden = false;
  /**
   * Identifies the sample a request belongs to. A network switch or a final
   * stop starts a new one, and a request that completes for an older sample
   * is dropped rather than applied to the current tally.
   */
  private generation = 0;
  private sampledNetwork: string | undefined;

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
    this.sampledNetwork = this.stateService.network;
    this.beginSample();

    // The arrivals feed is per network: a switch discards the sample and
    // resubscribes, so a Signet tally can never continue a mainnet one.
    if (this.stateService.networkChanged$) {
      this.subscriptions.add(
        this.stateService.networkChanged$.subscribe((network) => {
          if (network === this.sampledNetwork) {
            return;
          }
          this.sampledNetwork = network;
          this.beginSample();
        }),
      );
    }

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
    this.generation += 1;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.arrivals = undefined;
    this.queue = [];
    this.seen = new Set();
    this.inFlight = false;
    this.consecutiveFailures = 0;
    this.tabHidden = false;
    this.sampledNetwork = undefined;
    this.stateSubject.next(EMPTY_STATE);
  }

  ngOnDestroy(): void {
    this.consumers = 1;
    this.stop();
  }

  /** Discards any queued or in-flight work and starts a fresh, empty sample. */
  private beginSample(): void {
    this.generation += 1;
    this.queue = [];
    this.seen = new Set();
    this.inFlight = false;
    this.consecutiveFailures = 0;
    this.stateSubject.next({ ...EMPTY_STATE, startedAt: Date.now() });

    this.arrivals?.unsubscribe();
    this.arrivals = this.stateService.transactions$?.subscribe((transactions) => {
      if (!transactions?.length) {
        return;
      }
      for (const transaction of transactions) {
        this.enqueue(transaction?.txid);
      }
    });
    if (this.arrivals) {
      this.subscriptions.add(this.arrivals);
    }
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

    const generation = this.generation;
    const batch = this.queue.splice(0, UNIVERSE_TRANSACTION_BATCH_LIMIT);
    this.inFlight = true;
    try {
      const response = await firstValueFrom(this.api.getTransactionFlows$(batch));
      if (generation !== this.generation) {return;}
      this.apply(response?.results ?? []);
    } catch {
      if (generation !== this.generation) {return;}
      this.noteFailure(false);
    } finally {
      if (generation === this.generation) {
        this.inFlight = false;
      }
    }
  }

  /**
   * A batch is evidence only through its items. One valid resolved item
   * proves the authority answered; a batch whose every item the authority
   * refused is a failure of the authority, whatever the transport said.
   * Items it merely did not know about (invalid or not found) prove nothing
   * either way and leave the observation as it was.
   */
  private apply(results: readonly TransactionBatchItem[]): void {
    const resolved = results.filter((item) => item.status === 'ok' && !!item.flow);
    if (!resolved.length) {
      const refused = results.some((item) => item.status === 'unavailable' || item.status === 'unconfigured');
      if (refused) {
        this.noteFailure(true);
      }
      return;
    }
    this.consecutiveFailures = 0;

    const previous = this.stateSubject.value;
    const protocolCounts = new Map(previous.protocolCounts);
    const recent = [...previous.recent];
    let checked = previous.checked;
    let withAssets = previous.withAssets;
    const now = Date.now();

    for (const item of resolved) {
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
      observation: 'observed',
      lastSampleAt: now,
      startedAt: previous.startedAt || now,
      ceilingReached: previous.ceilingReached,
    });
  }

  /**
   * Records a failed batch. The authority refusing every item is reported at
   * once; a transport failure only after several in a row, so one dropped
   * request does not flap the label. Either way the tally is kept: it is the
   * last sample, marked stale with its time, or nothing if there was none.
   */
  private noteFailure(refusedByAuthority: boolean): void {
    this.consecutiveFailures += 1;
    if (!refusedByAuthority && this.consecutiveFailures < FAILURE_THRESHOLD) {return;}
    const current = this.stateSubject.value;
    const observation: PulseObservation = current.lastSampleAt === null ? 'unavailable' : 'stale';
    if (current.observation === observation) {return;}
    this.stateSubject.next({ ...current, observation });
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
