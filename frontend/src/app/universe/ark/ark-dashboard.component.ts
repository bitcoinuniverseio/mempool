import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Observable, Subject, BehaviorSubject, Subscription, catchError, forkJoin, map, of, startWith, switchMap, distinctUntilChanged, takeUntil, merge, tap, timeout } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { formatAtomicAmount } from '@app/universe/universe-evidence';
import { ArkNativeProofComponent } from './ark-native-proof.component';
import { ArkBatchPage, ArkBatchWindow, arkWindow, readArkBatch, readArkBatchPage, readArkSource, sameArkSource } from './ark-native-view';

import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
} from '@app/universe/universe.types';

interface ArkViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly operators?: ArkOperator[];
  readonly batches?: ArkBatch[];
  readonly virtualTxs?: ArkVirtualTx[];
  readonly message?: string;
  readonly operatorFailure?: string;
  readonly batchFailure?: string;
  readonly batchPage?: ArkBatchPage['page'];
}

type ArkSourceResult<T> = {readonly rows: T[]} | {readonly failure: string};
const sourceFailure = (error: unknown): string =>
  (error as {error?: {error?: string}})?.error?.error || loadFailureMessage(classifyLoadFailure(error));

@Component({
  selector: 'app-ark-dashboard',
  templateUrl: './ark-dashboard.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule, ArkNativeProofComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArkDashboardComponent implements OnInit, OnDestroy {
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly destroyed = new Subject<void>();
  private readonly refresh = new Subject<void>();
  private readonly detail = new BehaviorSubject<{kind: 'idle' | 'loading' | 'ready' | 'error'; batch?: ArkBatch; message?: string}>({kind:'idle'});
  readonly detail$ = this.detail.asObservable();
  afterSeconds = '0'; beforeSeconds = ''; windowLimit = 10; windowError = '';
  network = 'mainnet'; loading = false;
  private window: ArkBatchWindow = {after:'0', limit:10};
  private detailRequest = new Subscription(); private detailRevision = 0; private closed = false;
  vm$: Observable<ArkViewModel>;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private networkState: StateService,
  ) {
    this.seo.setTitle('Arkade / Ark VTXO & Exit Explorer');
  }

  ngOnInit(): void {
    const network = this.networkState.networkChanged$.pipe(startWith(this.networkState.network),
      map(value => value || this.networkState.env?.ROOT_NETWORK || 'mainnet'), distinctUntilChanged());
    this.vm$ = merge(network, this.refresh.pipe(map(() => this.network))).pipe(switchMap(selected => {
      this.network = selected; this.clearDetail(); this.loading = true;
      const window = {...this.window};
      return forkJoin([
      this.api.getArkOperators$().pipe(
        timeout(20000), map(data => {
          if (!Array.isArray(data?.operators) || data.operators.length > 100) {throw Error('Malformed Ark operator response.');}
          for (const operator of data.operators) {
            if (operator.source && readArkSource(operator.source, selected).profile.providerId !== operator.id) {throw Error('Ark operator belongs to a different provider.');}
          }
          return {rows: data.operators} as ArkSourceResult<ArkOperator>;
        }),
        catchError(error => of<ArkSourceResult<ArkOperator>>({failure: sourceFailure(error)})),
      ),
      this.api.getArkBatches$(window).pipe(
        timeout(20000), map(data => ({data:readArkBatchPage(data, selected, window)})),
        catchError(error => of({failure:sourceFailure(error)})),
      ),
    ]).pipe(
      map(([opsData, batchesData]): ArkViewModel => {
        const operators = 'rows' in opsData ? opsData.rows : undefined;
        const batches = 'data' in batchesData ? batchesData.data.batches : undefined;
        const operatorFailure = 'failure' in opsData ? opsData.failure : undefined;
        const batchFailure = 'failure' in batchesData ? batchesData.failure : undefined;
        if (operators?.some(operator => operator.source) && batches?.length && !operators.some(operator => operator.source &&
          sameArkSource(operator.source, batches[0].source!))) {
          return {kind:'ready', operators, batchFailure:'Ark round window source differs from the observed operator.'};
        }
        if (!operators?.length && !batches?.length && (operatorFailure || batchFailure)) return {kind: 'error', message: operatorFailure || batchFailure};
        return {kind: 'ready', operators, batches, operatorFailure, batchFailure, batchPage:'data' in batchesData ? batchesData.data.page : undefined};
      }),
      catchError(error => of<ArkViewModel>({kind: 'error', message: sourceFailure(error)})),
      startWith<ArkViewModel>({kind:'loading'}),
    );
    }), tap(value => {this.loading = value.kind === 'loading';}), takeUntil(this.destroyed));
  }
  loadWindow(): void {
    if (this.closed || this.loading) {return;}
    try {this.window = arkWindow(this.afterSeconds, this.beforeSeconds, this.windowLimit); this.windowError = ''; this.refresh.next();}
    catch (error) {this.windowError = error instanceof Error ? error.message : 'Invalid completed-round window.';}
  }
  retry(): void {if (!this.closed && !this.loading) {this.refresh.next();}}
  private clearDetail(): void {this.detailRevision++; this.detailRequest.unsubscribe(); this.detail.next({kind:'idle'});}
  readDetail(observed: ArkBatch): void {
    if (this.closed || this.loading || this.detail.value.kind === 'loading') {return;}
    this.clearDetail(); const revision = this.detailRevision; const network = this.network;
    this.detail.next({kind:'loading'});
    this.detailRequest = this.api.getArkBatch$(observed.batchId).pipe(timeout(20000)).subscribe({next:value => {
      if (this.closed || revision !== this.detailRevision) {return;}
      try {
        const batch = readArkBatch(value, network);
        if (batch.batchId !== observed.batchId || batch.anchorTxid !== observed.anchorTxid || batch.operatorId !== observed.operatorId
          || !sameArkSource(batch.source!, observed.source!)
          || Date.parse(batch.source!.observedAt) < Date.parse(observed.source!.observedAt)
          || batch.source!.anchor.height < observed.source!.anchor.height
          || batch.source!.anchor.height === observed.source!.anchor.height && batch.source!.anchor.hash !== observed.source!.anchor.hash) {throw Error('Ark detail does not match the selected round and provider.');}
        this.detail.next({kind:'ready', batch});
      } catch (error) {this.detail.next({kind:'error', message:error instanceof Error ? error.message : 'Malformed Ark round detail.'});}
    }, error:error => {if (!this.closed && revision === this.detailRevision) {this.detail.next({kind:'error', message:sourceFailure(error)});}}});
  }
  ngOnDestroy(): void {this.closed = true; this.clearDetail(); this.detail.complete(); this.destroyed.next();this.destroyed.complete();}
}
