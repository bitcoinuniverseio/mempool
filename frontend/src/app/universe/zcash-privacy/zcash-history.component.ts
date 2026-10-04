import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject, Subscription, catchError, defer, finalize, of, take, tap, timeout } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '../universe-api.service';
import { checkedZcashHistory, signedZec, ZcashPoolHistory } from './zcash-history-view';

@Component({ selector: 'app-zcash-history', standalone: true, imports: [CommonModule], styleUrls: ['../product-page.scss'], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <section class="panel" *ngIf="vm$ | async as vm" aria-label="Bounded Zcash net pool history">
    <h2>Observed net pool history</h2>
    <p>Each manual request advances at most 16 blocks in a 144-block window. Net change is node pool accounting. Gross inflows, gross outflows and pool transaction counts remain unknown. This is not whole-chain history.</p>
    <button type="button" [disabled]="vm.pending" (click)="start()">Start a fresh history window</button>
    <button type="button" *ngIf="vm.history?.status === 'PARTIAL'" [disabled]="vm.pending" (click)="continueWindow()">Continue history window</button>
    <button type="button" *ngIf="vm.error" [disabled]="vm.pending" (click)="retry()">Retry history request</button>
    <button type="button" *ngIf="vm.pending" (click)="cancel()">Cancel history request</button>
    <p *ngIf="vm.pending" role="status">Reading one bounded history page…</p>
    <p *ngIf="vm.error" role="alert">{{ vm.error }}</p>
    <ng-container *ngIf="vm.history as history">
      <p>{{ history.status }} · {{ history.network }} · Blocks {{ history.coverage.fromHeight }}–{{ history.coverage.throughHeight }} at observed tip {{ history.tipHeight }}.</p>
      <p>Source {{ history.source.implementation }} · Genesis {{ history.source.genesis }} · Observed {{ history.source.observedAt }}</p>
      <p>Observed tip: <code>{{ history.source.tipHash }}</code>. Verified through: <code>{{ history.verifiedThrough.hash }}</code>.</p>
      <p *ngIf="history.reorgRecovered || history.priorSnapshotArchivedThisRequest || history.interruptedWriteRecovered">The source reports recovered or archived prior ledger state. This window is a new observation.</p>
      <table class="data-table"><thead><tr><th>Block</th><th>Pool</th><th>Net change (ZEC)</th><th>Balance (ZEC)</th></tr></thead><tbody>
        <ng-container *ngFor="let block of history.blocks"><tr *ngFor="let pool of block.pools"><td>{{ block.height }}</td><td>{{ pool.id }}</td><td>{{ zec(pool.netChangeZat) }}</td><td>{{ zec(pool.balanceZat) }}</td></tr></ng-container>
      </tbody></table>
    </ng-container>
  </section>` })
export class ZcashHistoryComponent implements OnInit, OnDestroy {
  private readonly view = new BehaviorSubject<{ pending: boolean; history?: ZcashPoolHistory; error?: string }>({pending: false});
  readonly vm$ = this.view.asObservable(); readonly zec = signedZec;
  private request?: Subscription; private context?: Subscription; private destroyed = false; private continuation = false;
  constructor(private api: UniverseApiService, private state: StateService) {}
  ngOnInit(): void { this.context = this.state.networkChanged$.subscribe(() => { this.request?.unsubscribe(); this.view.next({pending: false}); this.continuation = false; }); }
  start(): void { this.read(false); }
  continueWindow(): void { if (this.view.value.history?.status === 'PARTIAL') this.read(true); }
  retry(): void { if (this.view.value.error) this.read(this.continuation); }
  cancel(): void { this.request?.unsubscribe(); this.view.next({...this.view.value, pending: false, error: 'Local history observation cancelled. Accepted evidence is retained; the server may have committed its bounded ledger request.'}); }
  private read(continuation: boolean): void {
    if (this.destroyed || this.view.value.pending) return;
    const prior = continuation ? this.view.value.history : undefined;
    const network = this.api.chainNetwork('zcash'); this.continuation = continuation;
    this.view.next({...this.view.value, pending: true, error: undefined});
    this.request = defer(() => this.api.getZcashPrivacyHistory$()).pipe(timeout(20000), take(1), tap(raw => {
      const history = checkedZcashHistory(raw, network, prior); this.view.next({pending: false, history});
    }), catchError(error => { this.view.next({...this.view.value, pending: false, error: typeof error?.error?.error === 'string' ? error.error.error : error instanceof Error ? error.message : 'History source unavailable. Retry this request or start a fresh window.'}); return of(null); }),
    finalize(() => { if (!this.destroyed && this.view.value.pending) this.view.next({...this.view.value, pending: false}); })).subscribe();
  }
  ngOnDestroy(): void { this.destroyed = true; this.context?.unsubscribe(); this.request?.unsubscribe(); this.view.complete(); }
}
