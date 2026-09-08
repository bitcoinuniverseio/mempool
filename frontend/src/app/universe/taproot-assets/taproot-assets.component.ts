import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { TaprootAssetGroup, TaprootAssetItem } from '@app/universe/universe.types';

interface TaprootViewModel {
  readonly kind: 'loading' | 'ready' | 'detail' | 'error';
  readonly assets?: TaprootAssetItem[];
  readonly groups?: TaprootAssetGroup[];
  readonly selected?: TaprootAssetItem;
}

@Component({
  selector: 'app-taproot-assets',
  templateUrl: './taproot-assets.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaprootAssetsComponent implements OnInit {
  private readonly state = new BehaviorSubject<TaprootViewModel>({ kind: 'loading' });
  readonly vm$: Observable<TaprootViewModel> = this.state.asObservable();

  constructor(
    private api: UniverseApiService,
    private route: ActivatedRoute,
    private seo: SeoService,
  ) {
    this.seo.setTitle('Taproot Assets Directory');
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap((params) => {
        const assetId = params.get('assetId');
        if (assetId) {
          return this.api.getTaprootAsset$(assetId).pipe(
            switchMap((asset) => of<TaprootViewModel>({ kind: 'detail', selected: asset })),
            catchError(() => of<TaprootViewModel>({ kind: 'error' }))
          );
        }
        // No per-read fallback: a directory the source could not answer is an
        // error, not an empty directory. The two are different facts, and the
        // page has an error state for the first.
        return combineLatest([
          this.api.getTaprootAssets$(),
          this.api.getTaprootAssetGroups$(),
        ]).pipe(
          switchMap(([assetsData, groupsData]) => of<TaprootViewModel>({
            kind: 'ready',
            assets: assetsData.assets,
            groups: groupsData.groups,
          })),
          catchError(() => of<TaprootViewModel>({ kind: 'error' }))
        );
      })
    ).subscribe((vm) => this.state.next(vm));
  }
}
