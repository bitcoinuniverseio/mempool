import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of, startWith, switchMap, distinctUntilChanged, takeUntil } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

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
}

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
      this.api.getArkOperators$(), this.api.getArkBatches$(),
    ]).pipe(
      map(([opsData, batchesData]): ArkViewModel => {
        if (!Array.isArray(opsData?.operators) || !Array.isArray(batchesData?.batches)) throw Error('Malformed Ark operator or batch response.');
        return {kind: 'ready', operators: opsData.operators, batches: batchesData.batches};
      }),
      catchError(error => of<ArkViewModel>({kind: 'error', message: error?.error?.error || loadFailureMessage(classifyLoadFailure(error))})),
      startWith<ArkViewModel>({kind:'loading'}),
    )), takeUntil(this.destroyed));
  }
  ngOnDestroy(): void {this.destroyed.next();this.destroyed.complete();}
}
