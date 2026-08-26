import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, Subscription, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { UniverseLocalService } from '@app/universe/universe-local.service';
import { BookmarkButtonComponent } from '@app/universe/bookmark-button/bookmark-button.component';
import { OrdRuneView } from '@app/universe/universe.types';
import {
  AssetViewState,
  applyDivisibility,
  assetState$,
  assetStatusMessage,
  assetTone,
  mintProgressPercent,
  utcFromSeconds,
} from '@app/universe/asset-lookup';
import { formatAtomicAmount, shortenIdentifier } from '@app/universe/universe-evidence';

/**
 * One rune, with its mint terms and current progress stated exactly as the
 * authority reports them.
 *
 * Mint progress is a real ratio out of a real cap. A rune with open terms has
 * no progress and the page says so, rather than showing a bar that means
 * nothing.
 */
@Component({
  selector: 'app-universe-rune',
  standalone: true,
  imports: [CommonModule, RouterModule, BookmarkButtonComponent],
  templateUrl: './rune.component.html',
  styleUrls: ['./rune.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RuneComponent implements OnInit, OnDestroy {
  state$: Observable<AssetViewState<OrdRuneView>>;

  readonly shorten = shortenIdentifier;
  readonly statusMessage = assetStatusMessage;
  readonly tone = assetTone;
  readonly utc = utcFromSeconds;
  readonly amount = formatAtomicAmount;

  private visitSubscription?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private api: UniverseApiService,
    private local: UniverseLocalService,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.state$ = this.route.paramMap.pipe(
      switchMap((params) => {
        const reference = (params.get('reference') || '').trim();
        this.seo.setTitle(`Rune ${reference}`);
        return assetState$<OrdRuneView>(reference, this.api.getRune$(reference));
      }),
    );

    this.visitSubscription = this.state$.subscribe((state) => {
      if (state.kind !== 'ready' || !state.result?.value) {return;}
      const rune = state.result.value;
      this.local.recordVisit({
        kind: 'rune',
        value: rune.rune,
        path: `/rune/${rune.rune}`,
        label: rune.spacedRune,
      });
    });
  }

  ngOnDestroy(): void {
    this.visitSubscription?.unsubscribe();
  }

  /** Supply figures respect the rune's own divisibility, never a float. */
  scaled(atomic: string, rune: OrdRuneView): string {
    return applyDivisibility(atomic, rune.divisibilityAtomic);
  }

  progress(rune: OrdRuneView): number | null {
    return mintProgressPercent(rune.mintsAtomic, rune.terms?.capAtomic);
  }

  mintStateLabel(rune: OrdRuneView): string {
    return rune.mintable
      ? $localize`:@@universe.rune.mintable:Open for minting`
      : $localize`:@@universe.rune.closed:Closed to minting`;
  }

  mintStateTone(rune: OrdRuneView): string {
    return rune.mintable ? 'pending' : 'proven';
  }

  /** Explains why minting is closed only when the terms actually prove it. */
  mintExplanation(rune: OrdRuneView): string {
    if (rune.mintable) {
      return $localize`:@@universe.rune.mintable-detail:The authority reports this rune can still be minted at the block below.`;
    }
    if (!rune.terms) {
      return $localize`:@@universe.rune.no-terms:This rune was etched without mint terms, so it was never open for public minting.`;
    }
    return $localize`:@@universe.rune.closed-detail:The authority reports this rune can no longer be minted at the block below.`;
  }

  hasHeightWindow(rune: OrdRuneView): boolean {
    return !!(rune.terms?.heightStartAtomic || rune.terms?.heightEndAtomic);
  }

  hasOffsetWindow(rune: OrdRuneView): boolean {
    return !!(rune.terms?.offsetStartAtomic || rune.terms?.offsetEndAtomic);
  }
}
