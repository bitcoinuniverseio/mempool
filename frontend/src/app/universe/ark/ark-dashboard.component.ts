import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of, startWith, switchMap, distinctUntilChanged, takeUntil } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { formatAtomicAmount } from '@app/universe/universe-evidence';

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
}

type ArkSourceResult<T> = {readonly rows: T[]} | {readonly failure: string};
const sourceFailure = (error: unknown): string =>
  (error as {error?: {error?: string}})?.error?.error || loadFailureMessage(classifyLoadFailure(error));

@Component({
  selector: 'app-ark-dashboard',
  templateUrl: './ark-dashboard.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArkDashboardComponent implements OnInit, OnDestroy {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly destroyed = new Subject<void>();
  vm$: Observable<ArkViewModel>;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private networkState: StateService,
  ) {
    this.seo.setTitle('Arkade / Ark VTXO & Exit Explorer');
  }

  ngOnInit(): void {
    this.vm$ = this.networkState.networkChanged$.pipe(startWith(this.networkState.network), distinctUntilChanged(), switchMap(() => forkJoin([
      this.api.getArkOperators$().pipe(
        map(data => {if (!Array.isArray(data?.operators)) throw Error('Malformed Ark operator response.'); return {rows: data.operators} as ArkSourceResult<ArkOperator>;}),
        catchError(error => of<ArkSourceResult<ArkOperator>>({failure: sourceFailure(error)})),
      ),
      this.api.getArkBatches$().pipe(
        map(data => {if (!Array.isArray(data?.batches)) throw Error('Malformed Ark batch response.'); return {rows: data.batches} as ArkSourceResult<ArkBatch>;}),
        catchError(error => of<ArkSourceResult<ArkBatch>>({failure: sourceFailure(error)})),
      ),
    ]).pipe(
      map(([opsData, batchesData]): ArkViewModel => {
        const operators = 'rows' in opsData ? opsData.rows : undefined;
        const batches = 'rows' in batchesData ? batchesData.rows : undefined;
        const operatorFailure = 'failure' in opsData ? opsData.failure : undefined;
        const batchFailure = 'failure' in batchesData ? batchesData.failure : undefined;
        if (!operators?.length && !batches?.length && (operatorFailure || batchFailure)) return {kind: 'error', message: operatorFailure || batchFailure};
        return {kind: 'ready', operators, batches, operatorFailure, batchFailure};
      }),
      catchError(error => of<ArkViewModel>({kind: 'error', message: sourceFailure(error)})),
      startWith<ArkViewModel>({kind:'loading'}),
    )), takeUntil(this.destroyed));
  }
  ngOnDestroy(): void {this.destroyed.next();this.destroyed.complete();}
}
