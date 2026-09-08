import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  map,
  of,
} from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { formatAtomicAmount } from '@app/universe/universe-evidence';
import { UniverseIdentifierComponent } from '@app/universe/universe-identifier.component';
import {
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
} from '@app/universe/universe.types';

interface LiquidViewModel {
  readonly kind: 'loading' | 'ready' | 'error';
  readonly summary?: LiquidObservatorySummary;
  readonly assets?: LiquidAssetRecord[];
  readonly pegs?: LiquidPegRecord[];
  readonly federation?: LiquidFederationEpoch;
}

@Component({
  selector: 'app-liquid-observatory',
  templateUrl: './liquid-observatory.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, UniverseIdentifierComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidObservatoryComponent implements OnInit {
  protected readonly formatAtomicAmount = formatAtomicAmount;
  private readonly state = new BehaviorSubject<LiquidViewModel>({
    kind: 'loading',
  });
  readonly vm$: Observable<LiquidViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService
  ) {
    this.seo.setTitle(
      'Liquid Confidential-Asset, Peg, and Federation Observatory'
    );
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getLiquidObservatorySummary$(),
      this.api.getLiquidAssets$(),
      this.api.getLiquidPegs$(),
      this.api.getLiquidFederation$(),
    ])
      .pipe(
        map(([summary, assetsData, pegsData, federation]): LiquidViewModel => ({
          kind: 'ready',
          summary,
          assets: assetsData.assets,
          pegs: pegsData.pegs,
          federation,
        })),
        catchError(() => of<LiquidViewModel>({ kind: 'error' }))
      )
      .subscribe((vm) => this.state.next(vm));
  }
}
