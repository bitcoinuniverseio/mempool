import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of } from 'rxjs';
import { classifyLoadFailure, loadFailureMessage } from '@app/shared/load-state';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
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
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArkDashboardComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<ArkViewModel>({ kind: 'loading' });
  readonly vm$: Observable<ArkViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Arkade / Ark VTXO & Exit Explorer');
  }

  ngOnInit(): void {
    // No per-read fallback: an operator or batch table the source could not
    // answer is an error with its reason, not an empty table. The revision
    // this replaces also inspected a VTXO by a fixed invented ID and labelled
    // its exit proof verified; nothing here names a VTXO the source did not.
    combineLatest([
      this.api.getArkOperators$(),
      this.api.getArkBatches$(),
    ]).pipe(
      map(([opsData, batchesData]): ArkViewModel => ({
        kind: 'ready',
        operators: opsData.operators,
        batches: batchesData.batches,
      })),
      catchError((error) => of<ArkViewModel>({ kind: 'error', message: loadFailureMessage(classifyLoadFailure(error)) })),
    ).subscribe((vm) => this.state.next(vm));
  }
}
