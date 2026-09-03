import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
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
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidObservatoryComponent implements OnInit {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  private readonly state = new BehaviorSubject<LiquidViewModel>({ kind: 'loading' });
  readonly vm$: Observable<LiquidViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Liquid Confidential-Asset, Peg, and Federation Observatory');
  }

  ngOnInit(): void {
    combineLatest([
      this.api.getLiquidObservatorySummary$().pipe(catchError(() => of(null))),
      this.api.getLiquidAssets$().pipe(catchError(() => of({ assets: [] }))),
      this.api.getLiquidPegs$().pipe(catchError(() => of({ pegs: [] }))),
      this.api.getLiquidFederation$().pipe(catchError(() => of(null))),
    ]).subscribe(([summary, assetsData, pegsData, federation]) => {
      if (!summary || !federation) {
        this.state.next({ kind: 'error' });
        return;
      }
      this.state.next({
        kind: 'ready',
        summary,
        assets: assetsData.assets,
        pegs: pegsData.pegs,
        federation,
      });
    });
  }
}
