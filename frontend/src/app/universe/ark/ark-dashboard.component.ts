import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  of,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { formatAtomicAmount } from '@app/universe/universe-evidence';
import { UniverseIdentifierComponent } from '@app/universe/universe-identifier.component';
import { ArkBatch, ArkOperator } from '@app/universe/universe.types';

interface ArkViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly operators?: ArkOperator[];
  readonly batches?: ArkBatch[];
}

@Component({
  selector: 'app-ark-dashboard',
  templateUrl: './ark-dashboard.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, UniverseIdentifierComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArkDashboardComponent implements OnInit {
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly state = new BehaviorSubject<ArkViewModel>({
    kind: 'loading',
  });
  readonly vm$: Observable<ArkViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService
  ) {
    this.seo.setTitle('Arkade / Ark VTXO & Exit Explorer');
  }

  ngOnInit(): void {
    combineLatest([this.api.getArkOperators$(), this.api.getArkBatches$()])
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        if (!result) {
          this.state.next({ kind: 'error' });
          return;
        }
        const [opsData, batchesData] = result;
        this.state.next({
          kind: 'ready',
          operators: opsData.operators,
          batches: batchesData.batches,
        });
      });
  }
}
