import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import {
  ArkBatch,
  ArkOperator,
  ArkVirtualTx,
  ArkVtxo,
} from '@app/universe/universe.types';

interface ArkViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly operators?: ArkOperator[];
  readonly batches?: ArkBatch[];
  readonly virtualTxs?: ArkVirtualTx[];
  readonly selectedVtxo?: ArkVtxo;
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
    combineLatest([
      this.api.getArkOperators$().pipe(catchError(() => of({ operators: [] }))),
      this.api.getArkBatches$().pipe(catchError(() => of({ batches: [] }))),
      this.api.getArkVtxo$('vtxo-78192a83918273918273918273918273').pipe(catchError(() => of(null))),
    ]).subscribe(([opsData, batchesData, vtxo]) => {
      this.state.next({
        kind: 'ready',
        operators: opsData.operators,
        batches: batchesData.batches,
        selectedVtxo: vtxo || undefined,
      });
    });
  }
}
