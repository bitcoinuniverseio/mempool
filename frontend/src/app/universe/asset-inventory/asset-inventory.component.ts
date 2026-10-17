import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, TimeoutError } from 'rxjs';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { ExplorerNetwork } from '@app/universe/universe.types';
import {
  AssetInventory,
  AssetInventoryContractError,
  InventoryAccumulator,
  InventoryScopeKind,
} from './asset-inventory.types';
import { InventoryViewModel, buildInventoryView } from './asset-inventory.view';
import { AssetInventoryPresenterComponent, InventoryErrorKind } from './asset-inventory-presenter.component';

/** Pages read automatically before the walk pauses for the reader. */
export const INVENTORY_AUTO_PAGES = 20;
/** Times a walk restarts from page one when the source moved under it. */
export const INVENTORY_MAX_RESTARTS = 3;

export interface InventoryLoadState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error';
  readonly error: InventoryErrorKind | null;
  readonly model: InventoryViewModel | null;
  /** A next page is being read. */
  readonly loadingMore: boolean;
  /** More pages exist and the walk is paused (budget used or stopped). */
  readonly hasMore: boolean;
  /** A later page failed; what was read so far stays on screen. */
  readonly pageError: InventoryErrorKind | null;
  readonly restarts: number;
}

const IDLE: InventoryLoadState = {
  phase: 'idle', error: null, model: null, loadingMore: false, hasMore: false, pageError: null, restarts: 0,
};

/**
 * Loads the public asset inventory for one transaction, block or address and
 * hands it to the shared presenter.
 *
 * Every read is bound to one scope: the kind, key and chain inputs plus the
 * network the selection resolves to. A change to any of them, or to
 * `revision` (a confirmation, replacement or reorg on the host page), drops
 * the requests in flight and starts again, and each answer is checked against
 * a per-walk token so a late response can never land on the new scope.
 *
 * Blocks and addresses are paged by cursor. The walk continues on its own for
 * {@link INVENTORY_AUTO_PAGES} pages, can be stopped, and then waits for the
 * reader to continue, so a very large block never turns into an unbounded
 * background sweep while every page stays reachable. A cursor the producer
 * calls stale (409) or a page from a different snapshot restarts the walk
 * from page one, at most {@link INVENTORY_MAX_RESTARTS} times.
 */
@Component({
  selector: 'app-universe-asset-inventory',
  standalone: true,
  imports: [CommonModule, AssetInventoryPresenterComponent],
  template: `<app-universe-asset-inventory-presenter
    *ngIf="state.phase !== 'idle'"
    [scope]="scope" [state]="state"
    (retry)="retry()" (loadMore)="loadMore()" (stop)="stop()"></app-universe-asset-inventory-presenter>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetInventoryComponent implements OnChanges, OnDestroy {
  @Input() scope: InventoryScopeKind = 'transaction';
  /** Txid, block hash or address. */
  @Input() key: string | null = null;
  @Input() chain = 'bitcoin';
  /** Host page revision; any change re-reads the inventory. */
  @Input() revision: unknown = null;

  state: InventoryLoadState = IDLE;

  private token = 0;
  private network: ExplorerNetwork | null = null;
  private accumulator = new InventoryAccumulator();
  private budget = INVENTORY_AUTO_PAGES;
  private restarts = 0;
  private names = new Map<string, string>();
  private networkSubscription: Subscription | null = null;
  private pageSubscription: Subscription | null = null;
  private namesSubscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.scope && !changes.key && !changes.chain && !changes.revision) {return;}
    this.start();
  }

  ngOnDestroy(): void {
    this.token += 1;
    this.networkSubscription?.unsubscribe();
    this.pageSubscription?.unsubscribe();
    this.namesSubscription?.unsubscribe();
  }

  /** Explicit retry: continue a failed walk from its cursor, else start over. */
  retry(): void {
    if (this.state.pageError && this.accumulator.nextCursor && this.network) {
      this.budget = INVENTORY_AUTO_PAGES;
      this.fetch(this.accumulator.nextCursor, this.token);
      return;
    }
    this.start();
  }

  /** Continue a paused walk for another bounded run of pages. */
  loadMore(): void {
    const cursor = this.accumulator.nextCursor;
    if (!cursor || !this.network || this.state.loadingMore) {return;}
    this.budget = INVENTORY_AUTO_PAGES;
    this.fetch(cursor, this.token);
  }

  /** Stop the automatic walk; what was read stays, and it can be continued. */
  stop(): void {
    if (!this.state.loadingMore) {return;}
    this.pageSubscription?.unsubscribe();
    this.pageSubscription = null;
    this.budget = 0;
    this.update({ loadingMore: false, hasMore: this.accumulator.nextCursor !== null });
  }

  private start(): void {
    this.token += 1;
    const token = this.token;
    this.networkSubscription?.unsubscribe();
    this.pageSubscription?.unsubscribe();
    this.networkSubscription = null;
    this.pageSubscription = null;
    this.accumulator = new InventoryAccumulator();
    this.restarts = 0;
    this.network = null;
    if (!this.key) {
      this.state = IDLE;
      this.cd.markForCheck();
      return;
    }
    this.state = { ...IDLE, phase: 'loading' };
    this.cd.markForCheck();
    this.loadNames();
    // A network switch re-emits and begins a fresh walk under the new network.
    this.networkSubscription = this.api.chainNetwork$(this.chain).subscribe({
      next: (network) => {
        if (token !== this.token) {return;}
        this.begin(network, token);
      },
      error: (error: unknown) => {
        if (token !== this.token) {return;}
        this.fail(error);
      },
    });
  }

  private begin(network: ExplorerNetwork, token: number): void {
    this.network = network;
    this.accumulator = new InventoryAccumulator();
    this.budget = INVENTORY_AUTO_PAGES;
    this.state = { ...IDLE, phase: 'loading', restarts: this.restarts };
    this.cd.markForCheck();
    this.fetch(null, token);
  }

  private fetch(cursor: string | null, token: number): void {
    const network = this.network;
    const key = this.key;
    if (!network || !key) {return;}
    this.pageSubscription?.unsubscribe();
    if (cursor !== null) {this.update({ loadingMore: true, hasMore: false, pageError: null });}
    // Registered before subscribing: a synchronous answer may already start the
    // next page, and that page's subscription must be the one stop() cancels.
    const subscription = new Subscription();
    this.pageSubscription = subscription;
    subscription.add(this.api.getAssetInventory$(this.scope, key, { cursor, chain: this.chain, network }).subscribe({
      next: (page) => {
        if (token !== this.token) {return;}
        this.accept(page, token);
      },
      error: (error: unknown) => {
        if (token !== this.token) {return;}
        this.pageFailed(error, token);
      },
    }));
  }

  private accept(page: AssetInventory, token: number): void {
    try {
      this.accumulator.add(page);
    } catch (error) {
      this.pageFailed(error, token);
      return;
    }
    const next = this.accumulator.nextCursor;
    this.budget -= 1;
    const continuing = next !== null && this.budget > 0;
    this.update({
      phase: 'ready',
      error: null,
      model: this.model(),
      loadingMore: continuing,
      hasMore: next !== null && !continuing,
      pageError: null,
    });
    if (continuing) {this.fetch(next, token);}
  }

  private pageFailed(error: unknown, token: number): void {
    const kind = classifyInventoryError(error);
    if (kind === 'restart') {
      if (this.restarts < INVENTORY_MAX_RESTARTS && this.network) {
        this.restarts += 1;
        const network = this.network;
        this.begin(network, token);
        return;
      }
      this.fail(error, 'stale');
      return;
    }
    if (kind === 'ignore') {return;}
    if (kind !== 'hidden' && this.accumulator.pages > 0) {
      this.update({ loadingMore: false, hasMore: false, pageError: kind });
      return;
    }
    this.fail(error, kind);
  }

  private fail(error: unknown, kind: InventoryErrorKind | 'restart' | 'ignore' | 'hidden' = classifyInventoryError(error)): void {
    if (kind === 'ignore') {return;}
    if (kind === 'hidden') {
      this.state = IDLE;
    } else {
      this.state = { ...IDLE, phase: 'error', error: kind === 'restart' ? 'stale' : kind, restarts: this.restarts };
    }
    this.cd.markForCheck();
  }

  private update(patch: Partial<InventoryLoadState>): void {
    this.state = { ...this.state, ...patch, restarts: this.restarts };
    this.cd.markForCheck();
  }

  private model(): InventoryViewModel | null {
    const merged = this.accumulator.result();
    return merged ? buildInventoryView(merged, this.names) : null;
  }

  /** Registry names are presentation only; a failure leaves protocol ids. */
  private loadNames(): void {
    if (this.namesSubscription) {return;}
    this.namesSubscription = this.api.getProtocols$().subscribe({
      next: (response) => {
        this.names = new Map((response?.protocols ?? []).map((entry) => [entry.id, entry.displayName]));
        if (this.state.phase === 'ready') {this.update({ model: this.model() });}
      },
      error: () => undefined,
    });
  }
}

/**
 * What a failed read means for the reader. `restart` covers a cursor the
 * producer no longer accepts and a page from a different snapshot; `hidden`
 * is a network this overlay does not serve (the panel then stays out of the
 * way); `ignore` is a request abandoned because the selection already moved.
 */
export function classifyInventoryError(error: unknown): InventoryErrorKind | 'restart' | 'ignore' | 'hidden' {
  if (error instanceof TimeoutError) {return 'timeout';}
  if (error instanceof AssetInventoryContractError) {
    return error.code === 'scope-changed' || error.code === 'page-out-of-order' ? 'restart' : 'invalid';
  }
  if (error instanceof HttpErrorResponse || (error && typeof (error as HttpErrorResponse).status === 'number')) {
    const response = error as HttpErrorResponse;
    const code = response.error && typeof response.error === 'object' ? (response.error as { error?: unknown }).error : null;
    switch (response.status) {
      case 400:
        if (code === 'wrong-network') {return 'wrong-network';}
        if (code === 'invalid-cursor') {return 'restart';}
        return 'invalid-request';
      case 404: return 'not-found';
      case 409: return 'restart';
      case 503: return 'unconfigured';
      case 502:
      case 504: return 'unavailable';
      default: return 'error';
    }
  }
  if (error instanceof Error) {
    if (error.message === 'unsupported-overlay-network') {return 'hidden';}
    if (error.message === 'asset-request-context-changed') {return 'ignore';}
  }
  return 'error';
}
